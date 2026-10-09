import {
  newRpcId,
  TAG,
  type RpcMessage,
  type TranslateRpcRequest,
} from '@/shared/messages';
import type { TranslateRequest, TranslateResult } from '@/shared/types';

interface Pending {
  resolve: (r: TranslateResult) => void;
  reject: (e: Error) => void;
  request: TranslateRequest;
  startedAt: number;
}

const pending = new Map<string, Pending>();

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const data = e.data as RpcMessage | undefined;
  if (!data || (data as unknown as Record<string, unknown>)[TAG] !== true) return;
  if (data.kind !== 'TRANSLATE_RESULT') return;
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  const elapsed = Math.round(performance.now() - p.startedAt);
  if (data.ok) {
    console.info('[wa-translate][bridge] response ok', {
      requestId: data.id,
      elapsedMs: elapsed,
      source: data.result.source,
      target: data.result.target,
      translatedChars: data.result.translated.length,
      changed: data.result.translated.trim() !== p.request.text.trim(),
    });
    p.resolve(data.result);
  } else {
    console.error('[wa-translate][bridge] response error', {
      requestId: data.id,
      elapsedMs: elapsed,
      error: data.error,
    });
    p.reject(new Error(data.error));
  }
});

export function translate(req: TranslateRequest, timeoutMs = 30000): Promise<TranslateResult> {
  const id = newRpcId();
  const startedAt = performance.now();
  const msg: TranslateRpcRequest = {
    __waTrans: true,
    kind: 'TRANSLATE_REQUEST',
    id,
    payload: req,
  };
  console.info('[wa-translate][bridge] request sent', {
    requestId: id,
    source: req.source ?? 'auto',
    target: req.target,
    textChars: req.text.length,
  });
  return new Promise<TranslateResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        console.warn('[wa-translate][bridge] request timed out', {
          requestId: id,
          timeoutMs,
        });
        reject(new Error('Translate request timed out'));
      }
    }, timeoutMs);
    pending.set(id, {
      resolve: (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
      request: req,
      startedAt,
    });
    window.postMessage(msg, '*');
  });
}
