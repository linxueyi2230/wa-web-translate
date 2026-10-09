import { HISTORY_TAG, type OutgoingDraft } from '@/shared/message-history';
import { newRpcId } from '@/shared/messages';

const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

window.addEventListener('message', (event) => {
  const data = event.data;
  if (event.source !== window || data?.[HISTORY_TAG] !== true || data.kind !== 'HISTORY_RESULT') return;
  const request = pending.get(data.id);
  if (!request) return;
  pending.delete(data.id);
  if (data.ok) request.resolve();
  else request.reject(new Error(data.error || '无法保存消息原文'));
});

export function prepareOutgoing(draft: OutgoingDraft): Promise<void> {
  return request('PREPARE_OUTGOING', { draft }, () => cancelOutgoing(draft.token));
}

export function finishOutgoing(token: string, messageId: string | null): Promise<void> {
  return request('SENT_OUTGOING', { token, messageId });
}

function request(kind: string, payload: Record<string, unknown>, onTimeout?: () => void): Promise<void> {
  const id = newRpcId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      onTimeout?.();
      reject(new Error('保存原文超时，请刷新 WhatsApp 页面后重试'));
    }, 8000);
    pending.set(id, {
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    window.postMessage({ [HISTORY_TAG]: true, kind, id, ...payload }, '*');
  });
}

export function cancelOutgoing(token: string): void {
  window.postMessage({ [HISTORY_TAG]: true, kind: 'CANCEL_OUTGOING', token }, '*');
}
