import { comparableText, normalizeChatId, parseMessageId } from '@/shared/message-history';
import { messageKey, modelField } from '@/shared/whatsapp-keys';
import { tryRequire } from './wa';

export function nativeChatMessages(chat: any): any[] {
  try {
    const local = chat?.msgs?.getModelsArray?.() ?? chat?.msgs?.models ?? [];
    const global = tryRequire('WAWebMsgCollection')?.MsgCollection;
    const all = global?.getModelsArray?.() ?? global?.models ?? [];
    return [...(Array.isArray(local) ? local : []), ...(Array.isArray(all) ? all : [])];
  } catch { return []; }
}
export function nativeMessageIds(chat: any): Set<string> {
  return new Set(nativeChatMessages(chat).map((model) => messageKey(modelField(model, 'id'))).filter((id): id is string => Boolean(id)));
}

// A resolved native call can mean only "queued". Accept an explicit OK result
// or the matching new outgoing model's ACK >= SENT(1), never CLOCK(0).
export async function confirmNativeSendResult(result: any, chat: any, chatId: string, text: string, media: boolean,
  before: Set<string>, validate: () => void, confirmedIds?: Set<string>): Promise<void> {
  const values: any[] = [];
  const visited = new WeakSet<object>();
  let rejection: unknown;
  const collect = (value: any): void => {
    if (value && typeof value === 'object') {
      if (visited.has(value)) return;
      visited.add(value);
    }
    if (value && typeof value.then === 'function') {
      void Promise.resolve(value).then(collect, (error) => { rejection = error; });
    } else if (Array.isArray(value)) value.forEach(collect);
    else if (value !== undefined && value !== null) {
      values.push(value);
      if (typeof value === 'object') for (const key of ['message', 'msg', 'sendMsgResult']) if (value[key]) collect(value[key]);
    }
  };
  collect(result);
  const deadline = Date.now() + 40_000;
  while (true) {
    if (rejection) throw new Error('原生发送返回失败，请检查聊天记录，勿重复发送');
    const states = values.map((value) => typeof value === 'string' ? value : value?.messageSendResult);
    if (states.some((value) => typeof value === 'string' && value.startsWith('ERROR_'))
      || values.some((value) => value?.success === false)) throw new Error('原生发送返回失败，请检查聊天记录，勿重复发送');
    const returnedIds = new Set(values.map((model) => messageKey(modelField(model, 'id'))).filter((id): id is string => {
      const key = id ? parseMessageId(id) : null;
      return Boolean(id && !before.has(id) && key?.fromMe && key.chatId === normalizeChatId(chatId));
    }));
    if (returnedIds.size === 1 && confirmedIds?.has([...returnedIds][0])) throw new Error('同一图片发送结果被重复返回，请检查聊天记录，勿重复发送');
    if (states.includes('OK')) {
      if (returnedIds.size === 1) {
        const id = [...returnedIds][0];
        confirmedIds?.add(id);
      }
      return;
    }
    const matches = new Map<string, any>();
    for (const model of [...values, ...nativeChatMessages(chat)]) {
      const id = messageKey(modelField(model, 'id'));
      const key = id ? parseMessageId(id) : null;
      if (!id || before.has(id) || confirmedIds?.has(id) || !key?.fromMe || key.chatId !== normalizeChatId(chatId) || returnedIds.size && !returnedIds.has(id)) continue;
      if (media && modelField(model, 'type') !== 'image') continue;
      if (!media && modelField(model, 'type') && modelField(model, 'type') !== 'chat') continue;
      if ([modelField(model, 'caption'), modelField(model, 'body')]
        .some((body) => typeof body === 'string' && comparableText(body) === comparableText(text))) matches.set(id, model);
    }
    const acknowledgements = [...matches.values()].map((model) => modelField(model, 'ack'));
    if (matches.size === 1 && acknowledgements.some((ack) => typeof ack === 'number' && ack < 0)) {
      throw new Error('对应消息发送失败，请检查聊天记录，勿重复发送');
    }
    if (matches.size === 1 && acknowledgements.some((ack) => typeof ack === 'number' && ack >= 1)) {
      confirmedIds?.add([...matches.keys()][0]);
      return;
    }
    // A late positive result still ends the already-attempted draft. Revoking
    // permission stops waiting, but does not erase evidence of a completed send.
    validate();
    if (Date.now() >= deadline) throw new Error('未收到明确发送确认，请检查聊天记录，勿重复发送');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
