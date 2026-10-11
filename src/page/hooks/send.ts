// Hook the outgoing-text-message send so we can replace the body with only its
// translation before WhatsApp encodes/transmits it. The original stays local in the
// persistent, local-only annotations below sent messages. Typing is never observed.
//
// The exact module/function name has shifted across WhatsApp Web versions. We try a
// list of known candidates and install on the first one we find. If all of them are
// missing, we log and fall back to a no-op.

import { tryRequire, getActiveChatId } from '../wa';
import { getConfig } from '../store';
import { cancelOutgoing, finishOutgoing } from '../history';
import { prepareTranslatedOutgoing } from '../outgoing-translation';
import { normalizeChatId, parseMessageId, comparableText, type OutgoingDraft } from '@/shared/message-history';
import { chatKey, messageKey, modelField } from '@/shared/whatsapp-keys';
import { businessDraftLanguage, businessDraftMessageId, notifyBusinessDraftSent, notifyBusinessMessageSent, notifyBusinessDraftSendStarted, notifyBusinessDraftSendFailed, nativeBusinessSendGuard, preparedNativeTranslation, confirmNativeBusinessSend, businessMediaDraft, isAutomaticBusinessReply, isNativeBusinessSend } from '../business-drafts';
import { confirmNativeSendResult, nativeMessageIds } from '../native-send-result';

interface Candidate {
  module: string;
  function: string;
  bodyArgIndex: number;
}

// Verified live against current WhatsApp Web (compose flow in WAWebComposeBox.react):
//   o("WAWebSendTextMsgChatAction").sendTextMsgToChat(chat, body, options)
//   o("WAWebNewsletterSendMsgAction").sendNewsletterTextMsg(chat, body, options)
const CANDIDATES: Candidate[] = [
  { module: 'WAWebSendTextMsgChatAction', function: 'sendTextMsgToChat', bodyArgIndex: 1 },
  { module: 'WAWebNewsletterSendMsgAction', function: 'sendNewsletterTextMsg', bodyArgIndex: 1 },
  // Fallbacks if WhatsApp renames in the future:
  { module: 'WAWebSendTextMsgChatAction', function: 'addAndSendTextMsg', bodyArgIndex: 1 },
];
let sendHookReady = false;
export const isTextSendHookReady = (): boolean => sendHookReady;

export function installSendHook(): Array<{ module: string; function: string }> {
  const installed: Array<{ module: string; function: string }> = [];
  const hookedModules = new Set<string>();
  for (const c of CANDIDATES) {
    // The public send function can call the lower-level fallback. Hooking both
    // translates the same message twice and loses the actual typed original.
    if (hookedModules.has(c.module)) continue;
    const mod = tryRequire(c.module);
    if (!mod || typeof mod[c.function] !== 'function') continue;
    const orig = mod[c.function].bind(mod);
    mod[c.function] = async (...args: any[]) => {
      const businessChat = chatKey(modelField(args[0], 'id')) ?? chatKey(args[0]) ?? getActiveChatId();
      const sentBody = args[c.bodyArgIndex];
      const businessMessageId = businessChat && typeof sentBody === 'string' ? businessDraftMessageId(businessChat, sentBody) : undefined;
      const nestedMediaCaption = businessChat && businessMessageId && typeof sentBody === 'string'
        && businessMediaDraft(businessChat)?.messageId === businessMessageId && isAutomaticBusinessReply(businessChat, sentBody);
      const validateNative = businessChat && businessMessageId ? nativeBusinessSendGuard(businessChat, businessMessageId, sentBody) : () => {};
      const nativeAutomatic = Boolean(businessChat && businessMessageId && isNativeBusinessSend(businessChat, businessMessageId));
      if (businessChat && businessMessageId) notifyBusinessDraftSendStarted(businessChat, businessMessageId, sentBody);
      let draft: OutgoingDraft | undefined;
      let next: any[];
      try {
        validateNative();
        const rewritten = await maybeRewrite(args, c);
        next = rewritten.args;
        draft = rewritten.draft;
      } catch (err) {
        console.error('[wa-translate][send] translation/original-save failed; original NOT sent', err);
        if (businessChat && businessMessageId) notifyBusinessDraftSendFailed(businessChat, businessMessageId,
          err instanceof Error ? `未发送：${err.message}` : '翻译失败，未发送，请恢复草稿后重试');
        throw err;
      }
      const before = new Set(chatMessages(args[0]).map(messageId).filter(Boolean));
      const nativeBefore = nativeAutomatic ? nativeMessageIds(args[0]) : new Set<string>();
      let result: any;
      try {
        validateNative();
        // Never retry orig in a catch: a rejected send can already have queued a message.
        result = await orig(...next);
      } catch (err) {
        if (draft) cancelOutgoing(draft.token);
        if (businessChat && businessMessageId) notifyBusinessDraftSendFailed(businessChat, businessMessageId,
          '发送状态不确定，请先检查聊天记录；确认未发送后再恢复草稿，避免重复发送。');
        throw err;
      }
      if (nativeAutomatic && businessChat && businessMessageId && !nestedMediaCaption) {
        try { await confirmNativeSendResult(result, args[0], businessChat, next[c.bodyArgIndex], false, nativeBefore, validateNative); }
        catch (error) {
          // The send was already attempted. Keep its saved original even when
          // delivery is uncertain, and never invoke the native sender again.
          if (draft) await finishOutgoing(draft.token, sentMessageId(result, draft.chatId)).catch(() => {});
          notifyBusinessDraftSendFailed(businessChat, businessMessageId, error instanceof Error ? error.message : '发送状态不确定，请检查聊天记录');
          throw error;
        }
      }
      if (businessChat && businessMessageId && !nestedMediaCaption) {
        notifyBusinessMessageSent(businessChat, businessMessageId);
        confirmNativeBusinessSend(businessChat, businessMessageId, false);
      }
      else if (businessChat && typeof sentBody === 'string' && !nestedMediaCaption) notifyBusinessDraftSent(businessChat, sentBody);
      if (draft) {
        // Prefer the actual sent model's MessageKey, even when the user has switched
        // chats before send completed. DOM matching remains a compatibility fallback.
        let id = sentMessageId(result, draft.chatId);
        if (!id) {
          const candidates = chatMessages(args[0]).filter((message: any) => {
            const candidateId = sentMessageId(message, draft!.chatId);
            const body = modelField(message, 'body');
            return candidateId && !before.has(candidateId) && typeof body === 'string'
              && comparableText(body) === comparableText(draft!.translated);
          });
          id = candidates.length === 1 ? messageId(candidates[0]) : null;
        }
        try { await finishOutgoing(draft.token, id); }
        catch (error) { console.error('[wa-translate][send] sent, but original ID binding failed', { messageId: id, error }); }
      }
      return result;
    };
    hookedModules.add(c.module);
    installed.push({ module: c.module, function: c.function });
    console.info(`[wa-translate] send hook installed on ${c.module}.${c.function}`);
  }
  if (installed.length === 0) {
    console.warn('[wa-translate] no candidate send module found; outbound translation disabled');
  }
  sendHookReady ||= installed.length > 0;
  return installed;
}

function messageId(message: any): string | null {
  return messageKey(modelField(message, 'id'));
}

export function sentMessageId(result: any, chatId: string): string | null {
  const models = Array.isArray(result) ? result : [result, result?.message, result?.msg];
  for (const model of models) {
    const id = messageId(model);
    const key = id ? parseMessageId(id) : null;
    if (key?.fromMe && key.chatId === normalizeChatId(chatId)) return id;
  }
  return null;
}

function chatMessages(chat: any): any[] {
  try {
    const models = chat?.msgs?.getModelsArray?.() ?? chat?.msgs?.models;
    return Array.isArray(models) ? models : [];
  } catch { return []; } // Metadata probing must never interfere with WhatsApp's send.
}

async function maybeRewrite(args: any[], c: Candidate): Promise<{ args: any[]; draft?: OutgoingDraft }> {
  const config = getConfig();
  console.info('[wa-translate][send] hook invoked', {
    function: c.function,
    argCount: args.length,
    enabled: config.enabled,
  });
  const body = args[c.bodyArgIndex];
  if (typeof body !== 'string' || !body.trim()) {
    console.warn('[wa-translate][send] skipped: message body is empty or not a string', {
      bodyType: typeof body,
    });
    return { args };
  }

  // Capture the chat before awaiting the provider; the active chat can change meanwhile.
  const chatId = chatKey(modelField(args[0], 'id')) ?? chatKey(args[0]) ?? getActiveChatId();
  const draftLanguage = chatId ? businessDraftLanguage(chatId, body) : undefined;
  if (draftLanguage === 'es-MX') {
    return { args }; // Already prepared in Spanish, including edits in the native composer.
  }

  if (!config.enabled) {
    if (draftLanguage === 'zh-CN') throw new Error('翻译已关闭，请启用翻译后再发送中文草稿');
    console.info('[wa-translate][send] skipped: translation disabled');
    return { args };
  }
  const targetLang = draftLanguage === 'zh-CN' ? 'es' : config.targetLang;
  const sourceLang = draftLanguage === 'zh-CN' ? 'zh-CN' : config.nativeLang || 'auto';
  if (!targetLang) {
    console.info('[wa-translate][send] skipped: target language not configured');
    return { args };
  }

  console.info('[wa-translate][send] translation start', {
    provider: config.provider,
    target: targetLang,
    textChars: body.length,
  });

  // Capture keys of existing React-backed bubbles BEFORE the send, including builds
  // without native data-id. This prevents matching an old identical translation.
  const prepared = chatId ? preparedNativeTranslation(chatId, businessDraftMessageId(chatId, body), body) : undefined;
  const draft = await prepareTranslatedOutgoing(body, chatId ?? '', sourceLang, targetLang, prepared);

  const next = args.slice();
  next[c.bodyArgIndex] = draft.translated;
  console.info('[wa-translate][send] body rewritten', {
    target: targetLang,
    translatedChars: draft.translated.length,
    finalChars: draft.translated.length,
    originalIncluded: false,
  });
  return { args: next, draft };
}
