// Thin wrappers around WhatsApp Web's internal Metro modules, exposed via window.require
// once the bundle is loaded (Web 2.3000+).
import { normalizeChatId, parseMessageId } from '@/shared/message-history';
import { elementMessageId, messageRoot, messageRows } from '@/shared/message-dom';
import { chatKey, modelField } from '@/shared/whatsapp-keys';

declare global {
  interface Window {
    require: (name: string) => any;
    Debug?: { VERSION?: string };
  }
}

export const isReady = (): boolean =>
  typeof window.require === 'function' &&
  parseInt(window.Debug?.VERSION?.split('.')?.[1] ?? '0', 10) >= 3000;

export function waitTillReady(): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => {
      if (isReady()) resolve();
      else setTimeout(tick, 200);
    };
    tick();
  });
}

// WhatsApp lazy-loads many modules only after the user authenticates and opens a chat.
// Wait until the modules our hooks depend on are reachable via window.require, or until
// timeoutMs elapses (so the rest of init still proceeds even if some module is renamed).
export function waitForModules(modules: string[], timeoutMs = 60_000): Promise<string[]> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      const missing = modules.filter((m) => !tryRequire(m));
      if (missing.length === 0) return resolve([]);
      if (Date.now() - startedAt > timeoutMs) return resolve(missing);
      setTimeout(tick, 250);
    };
    tick();
  });
}

export function tryRequire<T = any>(name: string): T | null {
  try {
    return window.require(name) as T;
  } catch {
    return null;
  }
}

export function injectToFunction(
  target: { module: string; function: string },
  callback: (orig: (...args: any[]) => any, ...args: any[]) => any,
): boolean {
  const mod = tryRequire(target.module);
  if (!mod || typeof mod[target.function] !== 'function') return false;
  const orig = mod[target.function].bind(mod);
  mod[target.function] = (...args: any[]) => callback(orig, ...args);
  return true;
}

export function getActiveChatId(): string | null {
  return getActiveChatIdFromModel() ?? getActiveChatIdFromDom();
}

export function getActiveChatIdFromModel(): string | null {
  // Verified: WAWebChatCollection.ChatCollection.getActive() returns the active chat model.
  try {
    const C = tryRequire('WAWebChatCollection')?.ChatCollection;
    const active = typeof C?.getActive === 'function' ? C.getActive() : null;
    const id = chatKey(modelField(active, 'id'));
    if (id) return id;
  } catch {}
  try {
    const arr = tryRequire('WAWebChatCollection')?.ChatCollection?.getModelsArray?.();
    if (Array.isArray(arr)) {
      const active = arr.find((m: any) => m?.active);
      const id = chatKey(modelField(active, 'id'));
      if (id) return id;
    }
  } catch {}
  return null;
}

export function getActiveChatIdFromDom(): string | null {
  const main = messageRoot().root;
  // The chat header carries the chat id on a child element via data-id or via attributes
  // on the title bar. WhatsApp changes these often; we try a few stable signals.
  const header = main.querySelector('header');
  const idAttr = header?.querySelector('[data-id]')?.getAttribute('data-id');
  // A display name is not a unique identifier. For persistent originals, use a
  // serialized MessageKey from the active conversation instead.
  if (idAttr) {
    const message = parseMessageId(idAttr);
    if (message) return message.chatId;
    if (/^[^\s_]+@[^\s_]+$/.test(idAttr)) return normalizeChatId(idAttr);
  }
  for (const row of messageRows()) {
    const key = parseMessageId(elementMessageId(row) ?? '');
    if (key) return key.chatId;
  }
  return null;
}
