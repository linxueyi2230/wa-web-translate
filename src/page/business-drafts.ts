import { comparableText, normalizeChatId } from '@/shared/message-history';
import type { ReplyLanguage } from '@/shared/types';

// Prepared Spanish replies bypass translation; Chinese business drafts are
// translated on Send. Both policies are scoped to the inserted draft's own chat.
const drafts = new Map<string, { text: string; messageId?: string; language: ReplyLanguage }>();
const mediaDrafts = new Map<string, string>();
const automatic = new Map<string, string>();
const sending = new Set<string>();
const finished = new Set<string>();
interface NativeSend {
  text: string;
  translated?: string;
  media: boolean;
  imageIds: readonly string[];
  attachments: Map<object, { captioned: boolean; confirmed: boolean }>;
  preparations: Map<object, object>;
  preparationOrder: object[];
  dispatched: number;
  confirmedMessageIds: Set<string>;
  failed: boolean;
  armed: boolean;
  validate: () => boolean;
}
const nativeSends = new Map<string, NativeSend>();
const draftKey = (chatId: string, messageId: string) => `${normalizeChatId(chatId)}\u0000${messageId}`;
const automaticKey = (chatId: string, text: string) => `${normalizeChatId(chatId)}\u0000${comparableText(text)}`;

export function registerNativeBusinessSend(chatId: string, messageId: string, text: string, translated: string | undefined, media: boolean, validate: () => boolean, imageIds: readonly string[] = []): void {
  nativeSends.set(draftKey(chatId, messageId), { text, translated, media, imageIds: media ? imageIds.length ? [...imageIds] : ['cover'] : [],
    attachments: new Map(), preparations: new Map(), preparationOrder: [], dispatched: 0,
    confirmedMessageIds: new Set(), failed: false, armed: false, validate });
}
export const isNativeBusinessSend = (chatId: string, messageId: string): boolean => nativeSends.has(draftKey(chatId, messageId));
export function registerNativeBusinessMediaPreparation(chatId: string, messageId: string, source: unknown): object | undefined {
  const send = nativeSends.get(draftKey(chatId, messageId));
  if (!send?.media) return undefined;
  const file = source && typeof source === 'object' ? source : {};
  const current = send.preparations.get(file);
  if (current) return current;
  const attachment = {};
  send.preparations.set(file, attachment);
  send.preparationOrder.push(attachment);
  return attachment;
}
export async function dispatchNativeBusinessMedia<T>(chatId: string, messageId: string, attachment: object | undefined,
  validate: () => void, dispatch: () => T | Promise<T>): Promise<T> {
  const send = nativeSends.get(draftKey(chatId, messageId));
  if (!send || !attachment) { validate(); return dispatch(); }
  const index = send.preparationOrder.indexOf(attachment);
  if (index < 0 || index >= send.imageIds.length) throw new Error('图片组的附件已变化，请人工检查');
  // Caption translation/history can finish after an uncaptioned photo is ready.
  // Invoke WA's own senders in saved attachment order, without waiting for ACKs.
  while (index > send.dispatched) {
    validate();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  validate();
  if (index !== send.dispatched) throw new Error('本张图片已提交发送，请检查聊天记录，勿重复发送');
  const result = dispatch();
  send.dispatched++;
  return result;
}
const mediaComplete = (send: NativeSend): boolean => !send.failed && send.attachments.size === send.imageIds.length
  && [...send.attachments.values()].every((attachment) => attachment.confirmed)
  && [...send.attachments.values()].filter((attachment) => attachment.captioned).length === 1;
export function confirmNativeBusinessSend(chatId: string, messageId: string, media: boolean): void {
  const send = nativeSends.get(draftKey(chatId, messageId));
  if (send?.armed && send.media === media && !send.failed && (!media || mediaComplete(send))) window.postMessage({ __waBusiness: true, kind: 'NATIVE_SEND_CONFIRMED', chatId, messageId }, '*');
}
export function nativeBusinessMediaConfirmedIds(chatId: string, messageId: string): Set<string> | undefined {
  return nativeSends.get(draftKey(chatId, messageId))?.confirmedMessageIds;
}
export function confirmNativeBusinessMediaAttachment(chatId: string, messageId: string, attachment: object): void {
  const send = nativeSends.get(draftKey(chatId, messageId));
  const item = send?.attachments.get(attachment);
  if (!send || !item || send.failed || item.confirmed) return;
  item.confirmed = true;
  if (send.attachments.size === send.imageIds.length && [...send.attachments.values()].every((entry) => entry.confirmed) && !mediaComplete(send)) {
    notifyBusinessDraftSendFailed(chatId, messageId, '图片组缺少商品说明，请检查聊天记录，勿重复发送');
    return;
  }
  if (mediaComplete(send)) {
    notifyBusinessMessageSent(chatId, messageId);
    confirmNativeBusinessSend(chatId, messageId, true);
  }
}
export function armNativeBusinessSend(chatId: string, messageId: string): void {
  const send = nativeSends.get(draftKey(chatId, messageId));
  if (send) send.armed = true;
}
export function clearNativeBusinessSend(chatId: string, messageId: string): void {
  const send = nativeSends.get(draftKey(chatId, messageId));
  if (send) send.armed = false; // Also revoke guards already captured by an async sender.
  nativeSends.delete(draftKey(chatId, messageId));
}
export function nativeBusinessSendGuard(chatId: string, messageId: string, text?: string, mediaAttachment?: object): () => void {
  const send = nativeSends.get(draftKey(chatId, messageId));
  return () => {
    const nestedTranslation = typeof text === 'string' && automatic.has(automaticKey(chatId, text)) && comparableText(text) === comparableText(send?.translated ?? '');
    const emptyMediaCaption = send?.media && mediaAttachment && !text?.trim();
    if (send && (!send.armed || send.failed || !send.validate() || typeof text === 'string' && comparableText(text) !== comparableText(send.text) && !nestedTranslation && !emptyMediaCaption)) {
      throw new Error('自动回复已暂停或草稿已变化，未发送，请检查后手动发送');
    }
    if (send && mediaAttachment && !send.attachments.has(mediaAttachment)) {
      const index = send.preparationOrder.indexOf(mediaAttachment);
      if (index === 0 && !text?.trim() || index > 0 && text?.trim()) throw new Error('图片组的说明位置已变化，已停止发送，请人工检查');
      if (!send.media || send.attachments.size >= send.imageIds.length
        || text?.trim() && [...send.attachments.values()].some((attachment) => attachment.captioned)) throw new Error('图片组的附件或说明已变化，已停止发送，请人工检查');
      send.attachments.set(mediaAttachment, { captioned: Boolean(text?.trim()), confirmed: false });
    }
  };
}
export function preparedNativeTranslation(chatId: string, messageId: string | undefined, text: string): string | undefined {
  const send = messageId ? nativeSends.get(draftKey(chatId, messageId)) : undefined;
  return send && comparableText(send.text) === comparableText(text) ? send.translated : undefined;
}

export function registerAutomaticBusinessReply(chatId: string, text: string, messageId: string): void { automatic.set(automaticKey(chatId, text), messageId); }
export function clearAutomaticBusinessReply(chatId: string, text: string): void { automatic.delete(automaticKey(chatId, text)); }
export function isAutomaticBusinessReply(chatId: string, text: string): boolean { return automatic.has(automaticKey(chatId, text)); }

export function isBusinessDraftSending(chatId: string, messageId?: string): boolean {
  return messageId ? sending.has(draftKey(chatId, messageId))
    : [...sending].some((key) => key.startsWith(`${normalizeChatId(chatId)}\u0000`));
}
export function isBusinessDraftFinished(chatId: string, messageId: string): boolean { return finished.has(draftKey(chatId, messageId)); }
export function notifyBusinessDraftSendStarted(chatId: string, messageId: string, text?: string): void {
  const key = draftKey(chatId, messageId);
  // Native click, text hooks and every photo in an album share one lifecycle.
  // Nested send calls must not overwrite a Chinese draft with translated text.
  if (sending.has(key) || finished.has(key)) return;
  sending.add(key);
  window.postMessage({ __waBusiness: true, kind: 'DRAFT_SEND_STARTED', chatId: normalizeChatId(chatId), messageId, text }, '*');
}
export function notifyBusinessDraftSendFailed(chatId: string, messageId: string, error: string): void {
  const key = draftKey(chatId, messageId);
  if (finished.has(key)) return;
  const send = nativeSends.get(key);
  if (send) send.failed = true;
  sending.delete(key);
  window.postMessage({ __waBusiness: true, kind: 'DRAFT_SEND_FAILED', chatId: normalizeChatId(chatId), messageId, error }, '*');
}

export function registerBusinessDraft(chatId: string, text: string, messageId?: string, language?: ReplyLanguage): void {
  if (messageId && (isBusinessDraftSending(chatId, messageId) || isBusinessDraftFinished(chatId, messageId))) return;
  const current = drafts.get(normalizeChatId(chatId));
  const sameDraft = !messageId || current?.messageId === messageId;
  if (!sameDraft) mediaDrafts.delete(normalizeChatId(chatId));
  drafts.set(normalizeChatId(chatId), { text, messageId: messageId ?? current?.messageId,
    language: language ?? (sameDraft ? current?.language : undefined) ?? 'es-MX' });
}
export function clearBusinessDraft(chatId: string): void { drafts.delete(normalizeChatId(chatId)); mediaDrafts.delete(normalizeChatId(chatId)); }
export function registerBusinessMediaDraft(chatId: string, messageId: string): void { mediaDrafts.set(normalizeChatId(chatId), messageId); }
export function clearBusinessMediaDraft(chatId: string): void { mediaDrafts.delete(normalizeChatId(chatId)); }
export function businessMediaDraft(chatId: string): { chatId: string; messageId: string; language: ReplyLanguage } | undefined {
  const chat = normalizeChatId(chatId);
  const draft = drafts.get(chat);
  const messageId = mediaDrafts.get(chat);
  return messageId && draft?.messageId === messageId ? { chatId: chat, messageId, language: draft.language } : undefined;
}
export function businessDraftLanguage(chatId: string, text: string): ReplyLanguage | undefined {
  if (automatic.has(automaticKey(chatId, text))) return 'es-MX';
  const draft = drafts.get(normalizeChatId(chatId));
  return draft && comparableText(text) === comparableText(draft.text) ? draft.language : undefined;
}
export function isBusinessDraft(chatId: string, text: string): boolean {
  return businessDraftLanguage(chatId, text) !== undefined;
}
export function notifyBusinessDraftSent(chatId: string, text: string): void {
  if (!isBusinessDraft(chatId, text)) return;
  const messageId = businessDraftMessageId(chatId, text);
  if (messageId) notifyBusinessMessageSent(chatId, messageId);
  else clearBusinessDraft(chatId);
}
export function businessDraftMessageId(chatId: string, text: string): string | undefined {
  return automatic.get(automaticKey(chatId, text)) ?? (isBusinessDraft(chatId, text) ? drafts.get(normalizeChatId(chatId))?.messageId : undefined);
}
export function notifyBusinessMessageSent(chatId: string, messageId: string): void {
  const key = draftKey(chatId, messageId);
  if (finished.has(key)) return;
  const send = nativeSends.get(key);
  if (send?.media && !mediaComplete(send)) return;
  finished.add(key);
  sending.delete(key);
  if (drafts.get(normalizeChatId(chatId))?.messageId === messageId) clearBusinessDraft(chatId);
  for (const [key, id] of automatic) if (id === messageId) automatic.delete(key);
  window.postMessage({ __waBusiness: true, kind: 'DRAFT_SENT', chatId: normalizeChatId(chatId), messageId }, '*');
}
