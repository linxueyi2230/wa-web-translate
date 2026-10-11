import { comparableText, normalizeChatId } from '@/shared/message-history';
import type { ReplyLanguage } from '@/shared/types';

// Prepared Spanish replies bypass translation; Chinese business drafts are
// translated on Send. Both policies are scoped to the inserted draft's own chat.
const drafts = new Map<string, { text: string; messageId?: string; language: ReplyLanguage }>();
const mediaDrafts = new Map<string, string>();
const automatic = new Map<string, string>();
const sending = new Set<string>();
const finished = new Set<string>();
const nativeSends = new Map<string, { text: string; translated?: string; media: boolean; armed: boolean; validate: () => boolean }>();
const draftKey = (chatId: string, messageId: string) => `${normalizeChatId(chatId)}\u0000${messageId}`;
const automaticKey = (chatId: string, text: string) => `${normalizeChatId(chatId)}\u0000${comparableText(text)}`;

export function registerNativeBusinessSend(chatId: string, messageId: string, text: string, translated: string | undefined, media: boolean, validate: () => boolean): void {
  nativeSends.set(draftKey(chatId, messageId), { text, translated, media, armed: false, validate });
}
export const isNativeBusinessSend = (chatId: string, messageId: string): boolean => nativeSends.has(draftKey(chatId, messageId));
export function confirmNativeBusinessSend(chatId: string, messageId: string, media: boolean): void {
  const send = nativeSends.get(draftKey(chatId, messageId));
  if (send?.armed && send.media === media) window.postMessage({ __waBusiness: true, kind: 'NATIVE_SEND_CONFIRMED', chatId, messageId }, '*');
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
export function nativeBusinessSendGuard(chatId: string, messageId: string, text?: string): () => void {
  const send = nativeSends.get(draftKey(chatId, messageId));
  return () => {
    const nestedTranslation = typeof text === 'string' && automatic.has(automaticKey(chatId, text)) && comparableText(text) === comparableText(send?.translated ?? '');
    if (send && (!send.armed || !send.validate() || typeof text === 'string' && comparableText(text) !== comparableText(send.text) && !nestedTranslation)) {
      throw new Error('自动回复已暂停或草稿已变化，未发送，请检查后手动发送');
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
  finished.add(key);
  sending.delete(key);
  if (drafts.get(normalizeChatId(chatId))?.messageId === messageId) clearBusinessDraft(chatId);
  for (const [key, id] of automatic) if (id === messageId) automatic.delete(key);
  window.postMessage({ __waBusiness: true, kind: 'DRAFT_SENT', chatId: normalizeChatId(chatId), messageId }, '*');
}
