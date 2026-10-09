// Hook the outgoing-text-message send so we can replace the body with only its
// translation before WhatsApp encodes/transmits it. The original stays local in the
// persistent, local-only annotations below sent messages. Typing is never observed.
//
// The exact module/function name has shifted across WhatsApp Web versions. We try a
// list of known candidates and install on the first one we find. If all of them are
// missing, we log and fall back to a no-op.

import { tryRequire, getActiveChatId } from '../wa';
import { translate } from '../bridge';
import { getConfig } from '../store';
import { cancelOutgoing, prepareOutgoing, finishOutgoing } from '../history';
import { newRpcId } from '@/shared/messages';
import { syncMessageMetadata } from '../message-metadata';
import { normalizeChatId, parseMessageId, comparableText, type OutgoingDraft } from '@/shared/message-history';
import { chatKey, messageKey, modelField } from '@/shared/whatsapp-keys';

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
      let draft: OutgoingDraft | undefined;
      let next: any[];
      try {
        const rewritten = await maybeRewrite(args, c);
        next = rewritten.args;
        draft = rewritten.draft;
      } catch (err) {
        console.error('[wa-translate][send] translation/original-save failed; original NOT sent', err);
        throw err;
      }
      const before = new Set(chatMessages(args[0]).map(messageId).filter(Boolean));
      let result: any;
      try {
        // Never retry orig in a catch: a rejected send can already have queued a message.
        result = await orig(...next);
      } catch (err) {
        if (draft) cancelOutgoing(draft.token);
        throw err;
      }
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
  if (!config.enabled) {
    console.info('[wa-translate][send] skipped: translation disabled');
    return { args };
  }

  const targetLang = config.targetLang;
  if (!targetLang) {
    console.info('[wa-translate][send] skipped: target language not configured');
    return { args };
  }

  const body = args[c.bodyArgIndex];
  if (typeof body !== 'string' || !body.trim()) {
    console.warn('[wa-translate][send] skipped: message body is empty or not a string', {
      bodyType: typeof body,
    });
    return { args };
  }

  // Capture the chat before awaiting the provider; the active chat can change meanwhile.
  const chatId = chatKey(modelField(args[0], 'id')) ?? chatKey(args[0]) ?? getActiveChatId();

  console.info('[wa-translate][send] translation start', {
    provider: config.provider,
    target: targetLang,
    textChars: body.length,
  });

  const result = await translate({
    text: body,
    source: config.nativeLang || 'auto',
    target: targetLang,
  });
  if (!result.translated?.trim()) throw new Error('翻译结果为空，未发送原文');

  const draft: OutgoingDraft = {
    token: newRpcId(), chatId: chatId ?? '', original: body, translated: result.translated,
    source: config.nativeLang || result.source, target: targetLang, createdAt: Date.now(),
  };
  // Capture keys of existing React-backed bubbles BEFORE the send, including builds
  // without native data-id. This prevents matching an old identical translation.
  syncMessageMetadata();
  await prepareOutgoing(draft);

  const next = args.slice();
  next[c.bodyArgIndex] = result.translated;
  console.info('[wa-translate][send] body rewritten', {
    target: targetLang,
    translatedChars: result.translated.length,
    finalChars: result.translated.length,
    originalIncluded: false,
  });
  return { args: next, draft };
}
