import { getActiveChatId, tryRequire } from '../wa';
import { getConfig } from '../store';
import { prepareTranslatedOutgoing } from '../outgoing-translation';
import { cancelOutgoing, finishOutgoing } from '../history';
import {
  businessMediaDraft, registerAutomaticBusinessReply, isAutomaticBusinessReply,
  clearAutomaticBusinessReply, notifyBusinessMessageSent, notifyBusinessDraftSendStarted, notifyBusinessDraftSendFailed,
  nativeBusinessSendGuard, preparedNativeTranslation, confirmNativeBusinessMediaAttachment,
  isNativeBusinessSend, nativeBusinessMediaConfirmedIds,
  registerNativeBusinessMediaPreparation, dispatchNativeBusinessMedia,
} from '../business-drafts';
import { confirmNativeSendResult, nativeMessageIds } from '../native-send-result';
import { chatKey, modelField } from '@/shared/whatsapp-keys';
import { normalizeChatId, type OutgoingDraft } from '@/shared/message-history';
import { sentMessageId } from './send';
import { showSendNotice } from '../send-notice';

const modules = new WeakMap<object, (...args: any[]) => any>();
const preparations = new WeakSet<object>();

// Ordinary uploads have no business draft owner, but their captions still need
// the same send-time translation and failure handling as ordinary text.
function decorateOrdinaryMedia(preparation: any): any {
  if (!preparation || preparations.has(preparation)) return preparation;
  if (typeof preparation.sendToChat !== 'function') {
    if (getConfig().enabled) {
      showSendNotice('图片发送接口已变化，无法安全翻译说明，请刷新页面后重试');
      throw new Error('图片发送接口已变化，无法安全翻译说明');
    }
    return preparation;
  }
  const send = preparation.sendToChat;
  const wrapped = async function (this: unknown, ...args: any[]) {
    const packed = args.length === 1 && args[0]?.chat;
    const chat = packed ? args[0].chat : args[0];
    const options = packed ? args[0].options : args[1];
    const caption = options?.caption;
    const config = getConfig();
    if (!config.enabled || typeof caption !== 'string' || !caption.trim()) return send.apply(this, args);
    const chatId = chatKey(modelField(chat, 'id')) ?? chatKey(chat);
    let draft: OutgoingDraft | undefined;
    let marked = false;
    let attempted = false;
    try {
      if (!chatId || !config.targetLang) throw new Error('无法确认图片收件人或目标语言');
      draft = await prepareTranslatedOutgoing(caption, chatId, config.nativeLang || 'auto', config.targetLang);
      if (!getConfig().enabled) throw new Error('翻译已关闭，已停止图片说明发送');
      const next = args.slice();
      const nextOptions = { ...options, caption: draft.translated };
      if (packed) next[0] = { ...args[0], options: nextOptions };
      else next[1] = nextOptions;
      // Some WhatsApp versions route captions through the text send function.
      registerAutomaticBusinessReply(chatId, draft.translated, draft.token);
      marked = true;
      attempted = true;
      const result = await send.apply(this, next);
      try { await finishOutgoing(draft.token, sentMessageId(result, chatId)); }
      catch (error) { console.error('[wa-translate][media] sent, but original ID binding failed', error); }
      return result;
    } catch (error) {
      if (draft && !attempted) cancelOutgoing(draft.token);
      showSendNotice(attempted ? '图片发送状态不确定，请先检查聊天记录，勿重复发送'
        : `未发送图片说明：${error instanceof Error ? error.message : '翻译失败，请重试'}`);
      throw error;
    } finally {
      if (marked && chatId && draft) clearAutomaticBusinessReply(chatId, draft.translated);
    }
  };
  try {
    Object.defineProperty(wrapped, 'length', { value: send.length });
    preparation.sendToChat = wrapped;
    if (preparation.sendToChat !== wrapped) throw new Error('图片发送接口不可写');
    preparations.add(preparation);
  } catch (error) {
    if (getConfig().enabled) {
      showSendNotice('无法监听图片发送，无法安全翻译说明，请刷新页面后重试');
      throw error;
    }
  }
  return preparation;
}

// Install before pasting a business draft's files. Each preparation keeps its
// own chat/source-language identity, including separate captions in an album.
export function installBusinessMediaSendHook(): boolean {
  let available = false;
  const candidates = [tryRequire('WAWebPrepRawMedia'), tryRequire('WAWebMediaPrep')?.MediaPrep];
  for (const module of candidates) {
    if (!module || typeof module.prepRawMedia !== 'function') continue;
    if (modules.get(module) === module.prepRawMedia) { available = true; continue; }
    const original = module.prepRawMedia;
    const wrapped = function (this: unknown, ...args: any[]) {
      const chatId = getActiveChatId();
      const owner = chatId ? businessMediaDraft(chatId) : undefined;
      const attachment = owner ? registerNativeBusinessMediaPreparation(owner.chatId, owner.messageId, args[0]) : undefined;
      // Capture before any asynchronous preparation: clearing the task must
      // revoke even a sender that WA invokes only after cancellation.
      const preparationGuard = attachment && owner ? nativeBusinessSendGuard(owner.chatId, owner.messageId) : undefined;
      const result = original.apply(this, args);
      const decorate = (preparation: any) => {
        if (!owner) return decorateOrdinaryMedia(preparation);
        if (!preparation || preparations.has(preparation)) return preparation;
        if (typeof preparation.sendToChat !== 'function') {
          if (owner.language === 'zh-CN' || isNativeBusinessSend(owner.chatId, owner.messageId)) throw new Error('图片发送接口已变化，已停止图片草稿，请人工处理');
          return preparation;
        }
        const send = preparation.sendToChat;
        let nativeAttempt: Promise<any> | undefined;
        const rewrittenSend = function (this: unknown, ...sendArgs: any[]) {
          if (nativeAttempt) return nativeAttempt;
          const nativeAutomatic = Boolean(attachment) || isNativeBusinessSend(owner.chatId, owner.messageId);
          const perform = async () => {
            const packed = sendArgs.length === 1 && sendArgs[0]?.chat;
            const chat = packed ? sendArgs[0].chat : sendArgs[0];
            const options = packed ? sendArgs[0].options : sendArgs[1];
            const recipient = chatKey(modelField(chat, 'id')) ?? chatKey(chat);
            const caption = options?.caption;
            const captionGuard = nativeBusinessSendGuard(owner.chatId, owner.messageId, typeof caption === 'string' ? caption : '', attachment ?? preparation);
            const validateNative = () => { preparationGuard?.(); captionGuard(); };
            const confirmedIds = nativeBusinessMediaConfirmedIds(owner.chatId, owner.messageId);
            // Nested manual captions may already have been translated.
            if (!nativeAutomatic && recipient && typeof caption === 'string' && isAutomaticBusinessReply(recipient, caption)) {
              validateNative();
              return send.apply(this, sendArgs);
            }
            notifyBusinessDraftSendStarted(owner.chatId, owner.messageId, typeof caption === 'string' ? caption : undefined);
            let draft: OutgoingDraft | undefined;
            let markedCaption: string | undefined;
            let attempted = false;
            let returned = false;
            let result: any;
            try {
              if (!recipient || normalizeChatId(recipient) !== owner.chatId || !options) throw new Error('无法确认图片草稿的收件人或说明字段，已停止发送');
              validateNative();
              const next = sendArgs.slice();
              if (owner.language === 'es-MX' && typeof caption === 'string' && /\p{Script=Han}/u.test(caption)) throw new Error('西班牙语图片说明包含中文，已阻止发送，请先翻译或修改草稿');
              // Only nonempty Chinese captions need translation; uncaptioned
              // photos retain the same batch owner until the whole group finishes.
              if (owner.language === 'zh-CN' && typeof caption === 'string' && caption.trim() && !isAutomaticBusinessReply(owner.chatId, caption)) {
                if (!getConfig().enabled) throw new Error('翻译已关闭，请启用翻译后再发送中文草稿');
                draft = await prepareTranslatedOutgoing(caption, owner.chatId, 'zh-CN', 'es', preparedNativeTranslation(owner.chatId, owner.messageId, caption));
                if (!getConfig().enabled) throw new Error('翻译已关闭，已停止图片说明发送');
                const nextOptions = { ...options, caption: draft.translated };
                if (packed) next[0] = { ...sendArgs[0], options: nextOptions };
                else next[1] = nextOptions;
              }
              // A media sender can call the text sender internally. Mark only the
              // final Spanish body for this chat so it is never translated twice.
              markedCaption = draft?.translated ?? (typeof caption === 'string' && caption.trim() ? caption : undefined);
              if (markedCaption) registerAutomaticBusinessReply(owner.chatId, markedCaption, owner.messageId);
              attempted = true;
              validateNative();
              const before = nativeAutomatic ? nativeMessageIds(chat) : new Set<string>();
              result = await dispatchNativeBusinessMedia(owner.chatId, owner.messageId, attachment, validateNative, () => send.apply(this, next));
              returned = true;
              if (nativeAutomatic) await confirmNativeSendResult(result, chat, owner.chatId, markedCaption ?? '', true, before, validateNative, confirmedIds);
              if (draft) {
                try { await finishOutgoing(draft.token, sentMessageId(result, owner.chatId)); }
                catch (error) { console.error('[wa-translate][media] sent, but original ID binding failed', error); }
              }
              if (nativeAutomatic) confirmNativeBusinessMediaAttachment(owner.chatId, owner.messageId, attachment ?? preparation);
              else notifyBusinessMessageSent(owner.chatId, owner.messageId);
              return result;
            } catch (error) {
              if (draft) {
                if (returned) await finishOutgoing(draft.token, sentMessageId(result, owner.chatId)).catch(() => {});
                else cancelOutgoing(draft.token);
              }
              notifyBusinessDraftSendFailed(owner.chatId, owner.messageId, attempted
                ? '图片发送状态不确定，请先检查聊天记录，避免重复发送。'
                : `未发送图片说明：${error instanceof Error ? error.message : '翻译失败，请恢复草稿后重试'}`);
              throw error;
            } finally {
              if (markedCaption) clearAutomaticBusinessReply(owner.chatId, markedCaption);
            }
          };
          const attempt = perform();
          if (nativeAutomatic) nativeAttempt = attempt;
          return attempt;
        };
        // Existing callers use arity to choose { chat, options } vs two args.
        Object.defineProperty(rewrittenSend, 'length', { value: send.length });
        try { preparation.sendToChat = rewrittenSend; }
        catch {
          if (owner.language === 'zh-CN' || isNativeBusinessSend(owner.chatId, owner.messageId)) throw new Error('无法监听图片发送，已停止图片草稿，请人工处理');
          return preparation;
        }
        if (preparation.sendToChat !== rewrittenSend) {
          if (owner.language === 'zh-CN' || isNativeBusinessSend(owner.chatId, owner.messageId)) throw new Error('无法监听图片发送，已停止图片草稿，请人工处理');
          return preparation;
        }
        preparations.add(preparation);
        return preparation;
      };
      return result && typeof result.then === 'function' ? result.then(decorate) : decorate(result);
    };
    try {
      module.prepRawMedia = wrapped;
      if (module.prepRawMedia === wrapped) { modules.set(module, wrapped); available = true; }
    } catch { /* An immutable module cannot safely send Chinese media drafts. */ }
  }
  return available;
}
