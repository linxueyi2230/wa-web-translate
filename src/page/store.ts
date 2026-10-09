// Page-world wrapper around chrome.storage. The page world cannot use chrome.* directly,
// so we proxy via the content script with a lightweight RPC.

import type { Config } from '@/shared/types';
import { DEFAULT_CONFIG } from '@/shared/types';

type StoreEvent = 'config';

const subscribers = new Map<StoreEvent, Set<() => void>>();

let config: Config = { ...DEFAULT_CONFIG };

const STORE_TAG = '__waTransStore';

interface StoreResp {
  [STORE_TAG]: true;
  kind: 'STORE_PUSH';
  config?: Config;
}

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const data = e.data as StoreResp | undefined;
  if (!data || (data as unknown as Record<string, unknown>)[STORE_TAG] !== true) return;
  if (data.kind === 'STORE_PUSH') {
    if (data.config) {
      config = data.config;
      console.info('[wa-translate][store] config synced', {
        provider: config.provider,
        nativeLang: config.nativeLang,
        targetLang: config.targetLang,
        enabled: config.enabled,
        hasApiKey: Boolean(config.apiKeys[config.provider]),
      });
      fire('config');
    }
  }
});

function fire(ev: StoreEvent) {
  for (const fn of subscribers.get(ev) ?? []) {
    try {
      fn();
    } catch {}
  }
}

function emit(kind: string, payload: Record<string, unknown> = {}) {
  window.postMessage({ [STORE_TAG]: true, kind, ...payload }, '*');
}

export function requestSnapshot() {
  emit('STORE_REQUEST');
}

export function getConfig(): Config {
  return config;
}

export function subscribe(ev: StoreEvent, cb: () => void): () => void {
  if (!subscribers.has(ev)) subscribers.set(ev, new Set());
  subscribers.get(ev)!.add(cb);
  return () => subscribers.get(ev)?.delete(cb);
}
