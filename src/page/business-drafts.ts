import { comparableText, normalizeChatId } from '@/shared/message-history';

// The send hook must not translate a prepared Spanish reply for a second time.
// This applies only to an explicitly inserted business draft in its own chat.
const drafts = new Map<string, { text: string; messageId?: string }>();
const automatic = new Map<string, string>();
const automaticKey = (chatId: string, text: string) => `${normalizeChatId(chatId)}\u0000${comparableText(text)}`;

export function registerAutomaticBusinessReply(chatId: string, text: string, messageId: string): void { automatic.set(automaticKey(chatId, text), messageId); }
export function clearAutomaticBusinessReply(chatId: string, text: string): void { automatic.delete(automaticKey(chatId, text)); }

export function registerBusinessDraft(chatId: string, text: string, messageId?: string): void {
  const current = drafts.get(normalizeChatId(chatId));
  drafts.set(normalizeChatId(chatId), { text, messageId: messageId ?? current?.messageId });
}
export function clearBusinessDraft(chatId: string): void { drafts.delete(normalizeChatId(chatId)); }
export function isBusinessDraft(chatId: string, text: string): boolean {
  const draft = drafts.get(normalizeChatId(chatId));
  return automatic.has(automaticKey(chatId, text)) || Boolean(draft && comparableText(text) === comparableText(draft.text));
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
  if (drafts.get(normalizeChatId(chatId))?.messageId === messageId) clearBusinessDraft(chatId);
  for (const [key, id] of automatic) if (id === messageId) automatic.delete(key);
  window.postMessage({ __waBusiness: true, kind: 'DRAFT_SENT', chatId, messageId }, '*');
}
