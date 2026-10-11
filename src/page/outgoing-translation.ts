import { translate } from './bridge';
import { prepareOutgoing } from './history';
import { syncMessageMetadata } from './message-metadata';
import { newRpcId } from '@/shared/messages';
import type { OutgoingDraft } from '@/shared/message-history';
import type { TranslateRequest } from '@/shared/types';

// Text messages and media captions share the same send-time translation and
// exact-original persistence. Nothing here is called while the seller types.
export async function prepareTranslatedOutgoing(
  text: string, chatId: string, source: TranslateRequest['source'], target: string, preparedTranslation?: string,
): Promise<OutgoingDraft> {
  const result = preparedTranslation ? { translated: preparedTranslation, source: source ?? 'unknown' } : await translate({ text, source, target });
  if (!result.translated?.trim()) throw new Error('翻译结果为空，未发送原文');
  const draft: OutgoingDraft = {
    token: newRpcId(), chatId, original: text, translated: result.translated,
    source: !source || source === 'auto' ? result.source : source, target, createdAt: Date.now(),
  };
  syncMessageMetadata();
  await prepareOutgoing(draft);
  return draft;
}
