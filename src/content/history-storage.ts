import type { OriginalRecord, PendingOutgoing, TranslationRecord } from '@/shared/message-history';
import { comparableText } from '@/shared/message-history';

const PREFIX = 'waTranslate:history:v1:';
const PENDING = `${PREFIX}pending:`;

// Separate keys avoid losing one record when two translations finish concurrently.
// Original records are NOT evicted by a translation-cache size limit.
export class HistoryStorage {
  constructor(private readonly area = chrome.storage.local) {}

  async loadPending(): Promise<PendingOutgoing[]> {
    const all = await this.area.get(null);
    return Object.entries(all).filter(([key]) => key.startsWith(PENDING))
      .map(([, value]) => value as PendingOutgoing)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async prepare(draft: PendingOutgoing): Promise<void> {
    await this.area.set({ [`${PENDING}${draft.token}`]: draft });
  }

  async cancel(token: string): Promise<void> {
    await this.area.remove(`${PENDING}${token}`);
  }

  async bind(draft: PendingOutgoing, messageId: string): Promise<OriginalRecord> {
    const { baselineIds: _, ready: __, ...payload } = draft;
    const record: OriginalRecord = { ...payload, messageId };
    // Persist first. If cleanup fails, the saved original still exists.
    await this.area.set({ [`${PREFIX}original:${messageId}`]: record });
    await this.cancel(draft.token);
    return record;
  }

  async original(messageId: string, text: string): Promise<OriginalRecord | null> {
    const key = `${PREFIX}original:${messageId}`;
    const record = (await this.area.get(key))[key] as OriginalRecord | undefined;
    // An edited message must not display the old original as if it were still current.
    return record?.messageId === messageId && comparableText(record.translated)
      === comparableText(text) ? record : null;
  }

  private async translationKey(messageId: string, text: string, context: string): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify([text, context]));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${PREFIX}translation:${messageId}:${hash}`;
  }

  async translation(messageId: string, text: string, context: string): Promise<TranslationRecord | null> {
    const key = await this.translationKey(messageId, text, context);
    const record = (await this.area.get(key))[key] as TranslationRecord | undefined;
    return record?.messageId === messageId && record.text === text && record.context === context
      ? record : null;
  }

  async saveTranslation(record: TranslationRecord): Promise<void> {
    const key = await this.translationKey(record.messageId, record.text, record.context);
    await this.area.set({ [key]: record });
  }
}
