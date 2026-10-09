import type { Config } from './types';

export const HISTORY_TAG = '__waTransHistory';
export const PENDING_TTL_MS = 5 * 60_000;

export interface OutgoingDraft {
  token: string;
  chatId: string;
  original: string;
  translated: string;
  source: string;
  target: string;
  createdAt: number;
}

export interface PendingOutgoing extends OutgoingDraft {
  baselineIds: string[];
  ready: boolean;
}

export interface OriginalRecord extends OutgoingDraft {
  messageId: string;
}

export interface TranslationRecord {
  messageId: string;
  text: string;
  translated: string;
  target: string;
  context: string;
  createdAt: number;
}

export function normalizeChatId(id: string): string {
  return id.replace(/@s\.whatsapp\.net$/, '@c.us');
}

// WhatsApp's DOM data-id is a serialized MessageKey, NOT the display name of a chat.
export function parseMessageId(id: string): { fromMe: boolean; chatId: string } | null {
  const match = /^(true|false)_([^_]+@[^_]+)_.+$/.exec(id);
  return match ? { fromMe: match[1] === 'true', chatId: normalizeChatId(match[2]) } : null;
}

export function comparableText(text: string): string {
  return text.replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchesPending(
  draft: PendingOutgoing, messageId: string, text: string, now = Date.now(),
): boolean {
  const key = parseMessageId(messageId);
  return !!key?.fromMe && key.chatId === normalizeChatId(draft.chatId)
    && now >= draft.createdAt && now - draft.createdAt <= PENDING_TTL_MS
    && !draft.baselineIds.includes(messageId)
    && comparableText(draft.translated) === comparableText(text);
}

export function translationContext(config: Config): string {
  // Never put an API key into a history record or a page-world message.
  return JSON.stringify([config.nativeLang, config.provider,
    config.model[config.provider] ?? '', config.personality]);
}

export function validDraft(value: unknown): value is OutgoingDraft {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return ['token', 'chatId', 'original', 'translated', 'source', 'target']
    .every((key) => typeof v[key] === 'string' && (v[key] as string).length > 0)
    && typeof v.createdAt === 'number' && Number.isFinite(v.createdAt)
    && typeof v.chatId === 'string' && /^[^\s_]+@[^\s_]+$/.test(v.chatId);
}
