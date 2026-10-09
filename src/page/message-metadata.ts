// DOM MessageKeys are not present in every WhatsApp build. Read ONLY the message
// model attached to a rendered text node's React ancestors, then expose its key
// through a local DOM attribute for the isolated-world renderer. Never change
// WhatsApp's props/models/body, nor serialize a React tree across the bridge.
import { comparableText, parseMessageId } from '@/shared/message-history';
import { LOCAL_MESSAGE, MESSAGE_BODY, messageBodies, plainText } from '@/shared/message-dom';
import { isStanzaId, messageKey, modelField, stanzaId } from '@/shared/whatsapp-keys';
import { getActiveChatIdFromModel } from './wa';

const ATTRIBUTE = 'data-wa-trans-message-id';
const MODEL_PROPS = ['msg', 'message', 'msgModel', 'messageModel', 'model', 'item', 'msgData', 'messageData', 'data'];
interface KeyDiagnostics { keyCandidates: number; serializedKeys: number; textMismatches: number; domKeyMismatches: number }

function nativeKey(body: HTMLElement): string | null {
  for (let node: HTMLElement | null = body; node; node = node.parentElement) {
    for (const name of ['data-id', 'data-message-id']) {
      const id = node.getAttribute(name);
      if (id && (parseMessageId(id) || isStanzaId(id))) return id;
    }
  }
  return null;
}

function matchingModel(props: any, text: string, domKey: string | null, diagnostics: KeyDiagnostics): string | null {
  const candidates = [props, ...MODEL_PROPS.map((key) => props?.[key])];
  // Component prop names can change. Inspect only immediate object-valued props,
  // never children arrays/React trees/collections containing other messages.
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(props)).slice(0, 24)) {
      if (['children', 'ref', 'style'].includes(name) || MODEL_PROPS.includes(name)) continue;
      if (descriptor.value && typeof descriptor.value === 'object' && !Array.isArray(descriptor.value)) candidates.push(descriptor.value);
    }
  }
  for (const model of candidates) {
    const key = modelField(model, 'id');
    if (key == null) continue;
    diagnostics.keyCandidates++;
    const id = messageKey(key);
    if (!id) continue;
    diagnostics.serializedKeys++;
    if (domKey) {
      // A bare DOM stanza is already an exact identifier; match it to the model
      // key instead of rejecting it or requiring identical emoji/text markup.
      if (stanzaId(id) !== stanzaId(domKey)) { diagnostics.domKeyMismatches++; continue; }
      const native = parseMessageId(domKey), resolved = parseMessageId(id)!;
      if (native && (native.chatId !== resolved.chatId || native.fromMe !== resolved.fromMe)) {
        diagnostics.domKeyMismatches++;
        continue;
      }
      return id;
    }
    const body = modelField(model, 'body');
    if (typeof body === 'string' && comparableText(body) === text) return id;
    diagnostics.textMismatches++;
  }
  return null;
}

function reactMessageId(body: HTMLElement, text: string, domKey: string | null, diagnostics: KeyDiagnostics): { id: string | null; foundReact: boolean } {
  let foundReact = false;
  const visited = new Set<object>();
  for (let node: HTMLElement | null = body, depth = 0; node && depth < 12; node = node.parentElement, depth++) {
    for (const name of Object.getOwnPropertyNames(node)) {
      if (!/^__react(Fiber|InternalInstance|Props)\$/.test(name)) continue;
      foundReact = true;
      const attached = (node as any)[name];
      if (name.startsWith('__reactProps$')) {
        const id = matchingModel(attached, text, domKey, diagnostics);
        if (id) return { id, foundReact };
        continue;
      }
      for (let fiber = attached, hops = 0; fiber && hops < 40 && !visited.has(fiber); fiber = fiber.return, hops++) {
        visited.add(fiber);
        const id = matchingModel(fiber.memoizedProps, text, domKey, diagnostics);
        if (id) return { id, foundReact };
      }
    }
  }
  return { id: null, foundReact };
}

export function syncMessageMetadata(): void {
  let bodies = 0, reactBodies = 0, mapped = 0, mappedByDom = 0;
  const diagnostics: KeyDiagnostics = { keyCandidates: 0, serializedKeys: 0, textMismatches: 0, domKeyMismatches: 0 };
  const activeChatId = getActiveChatIdFromModel();
  for (const body of messageBodies()) {
    if (body.parentElement?.closest(MESSAGE_BODY)) continue; // One canonical body, not each nested span.
    bodies++;
    try {
      const text = comparableText(plainText(body));
      if (!text) continue;
      const domKey = nativeKey(body);
      const result = reactMessageId(body, text, domKey, diagnostics);
      if (result.foundReact) reactBodies++;
      let id = result.id;
      if (!id && domKey && isStanzaId(domKey) && activeChatId
        && body.closest('#main, [data-testid="conversation-panel-messages"], [data-testid="conversation-panel-body"], [data-testid="conversation-panel-wrapper"]')) {
        const outgoing = !!body.closest('.message-out'), incoming = !!body.closest('.message-in');
        if (outgoing !== incoming) {
          id = `${outgoing}_${activeChatId}_${domKey}`;
          mappedByDom++;
        }
      }
      if (id) {
        mapped++;
        if (body.getAttribute(ATTRIBUTE) !== id) body.setAttribute(ATTRIBUTE, id);
      } else {
        // A recycled text node must not keep a previous message's identity.
        body.removeAttribute(ATTRIBUTE);
      }
    } catch {
      body.removeAttribute(ATTRIBUTE); // Unknown internals must not break WA or the send flow.
    }
  }
  const summary = { bodies, reactBodies, mapped, mappedByDom, hasActiveChat: !!activeChatId, ...diagnostics };
  const signature = JSON.stringify(summary);
  if (signature !== lastSummary) {
    lastSummary = signature;
    console.info('[wa-translate][history] page message metadata', summary);
  }
}

let lastSummary = '';
export function installMessageMetadata(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (!timer) timer = setTimeout(() => { timer = null; syncMessageMetadata(); }, 50);
  };
  const observer = new MutationObserver((changes) => {
    if (changes.some((change) => {
      const target = change.target instanceof Element ? change.target : change.target.parentElement;
      if (target?.closest(LOCAL_MESSAGE)) return false;
      return ![...change.addedNodes, ...change.removedNodes].every((node) => node instanceof Element && node.matches(LOCAL_MESSAGE))
        || change.type !== 'childList';
    })) schedule();
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['data-id', 'data-message-id', 'data-pre-plain-text', 'class', 'data-testid', 'dir'] });
  // Virtual lists can recycle identical text without changing the DOM body.
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  const stop = () => {
    observer.disconnect();
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    if (timer) clearTimeout(timer);
  };
  window.addEventListener('pagehide', stop, { once: true });
  syncMessageMetadata();
  console.info('[wa-translate][history] page message metadata bridge installed');
  return stop;
}
