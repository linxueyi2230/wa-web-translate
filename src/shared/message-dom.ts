import { parseMessageId } from './message-history';
import { isStanzaId } from './whatsapp-keys';

export const LOCAL_MESSAGE = '[data-wa-trans-local]';
export const QUOTED_MESSAGE = '[data-testid*="quoted"], .quoted-message, blockquote';
const QUOTE = QUOTED_MESSAGE;
export const MESSAGE_TEXT = '.selectable-text, [data-testid="selectable-text"], [data-testid="msg-text"]';
const TEXT = MESSAGE_TEXT;
export const MESSAGE_KEY_ATTRIBUTES = ['data-id', 'data-message-id', 'data-wa-trans-message-id'];
const KEYED = MESSAGE_KEY_ATTRIBUTES.map((name) => `[${name}]`).join(', ');
export const MESSAGE_BODY = `${TEXT}, [data-pre-plain-text] span[dir="auto"], [data-pre-plain-text] [data-testid="text-content"]`;
const NOT_HISTORY = `${LOCAL_MESSAGE}, ${QUOTE}, footer, header, [contenteditable="true"]`;
const ROOTS = [
  '#main', '[data-testid="conversation-panel-messages"]',
  '[data-testid="conversation-panel-body"]', '[data-testid="conversation-panel-wrapper"]',
];

export interface BubbleMessage {
  id: string;
  chatId: string;
  outgoing: boolean;
  text: string;
  host: HTMLElement;
}

export function messageBodies(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(MESSAGE_BODY))
    .filter((node) => !node.closest(NOT_HISTORY));
}

export function messageRoot(): { root: ParentNode; selector: string } {
  let first: { root: ParentNode; selector: string } | undefined;
  for (const selector of ROOTS) {
    const root = document.querySelector(selector);
    if (!root) continue;
    first ??= { root, selector };
    // #main can exist while the actual conversation is rendered in another panel.
    if (messageBodies(root).length) return { root, selector };
  }
  if (messageBodies().length) return { root: document, selector: 'document-message-keys' };
  // Only serialized MessageKeys with copyable message text qualify below. This
  // fallback does NOT select arbitrary text or the composer/search input.
  return first ?? { root: document, selector: 'document-message-keys' };
}

export function elementMessageId(node: Element): string | null {
  for (const attribute of MESSAGE_KEY_ATTRIBUTES) {
    const id = node.getAttribute(attribute);
    if (id && parseMessageId(id)) return id;
  }
  return null;
}

function keyedAncestor(node: Element): HTMLElement | null {
  for (let current: Element | null = node; current; current = current.parentElement) {
    if (elementMessageId(current)) return current as HTMLElement;
  }
  return null;
}

export function messageRows(): HTMLElement[] {
  const { root } = messageRoot();
  const rows = new Map<string, HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>(KEYED)) {
    const id = elementMessageId(element);
    if (id && !element.closest(NOT_HISTORY) && !rows.has(id)) {
      rows.set(id, element);
    }
  }
  // A legacy bubble can have its key on a wrapping row outside #main. Keep that
  // compatibility, but do not make these CSS classes a prerequisite.
  for (const bubble of root.querySelectorAll<HTMLElement>('.message-in, .message-out')) {
    const row = keyedAncestor(bubble);
    const id = row ? elementMessageId(row) : null;
    if (row && id && !rows.has(id) && !bubble.closest(NOT_HISTORY)) rows.set(id, row);
  }
  return [...rows.values()];
}

export function plainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element) || node.matches(LOCAL_MESSAGE)) return '';
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'IMG') return node.getAttribute('alt') ?? '';
  const text = Array.from(node.childNodes, plainText).join('');
  return /^(P|DIV)$/.test(node.tagName) ? `${text}\n` : text;
}

export function readBubble(element: HTMLElement): BubbleMessage | null {
  const row = keyedAncestor(element) ?? Array.from(element.querySelectorAll<HTMLElement>(KEYED))
    .find((child) => !!elementMessageId(child));
  const id = row ? elementMessageId(row) ?? '' : '';
  const key = parseMessageId(id);
  if (!row || !key) return null;
  const eligible = (node: HTMLElement) => !node.closest(NOT_HISTORY)
    && elementMessageId(keyedAncestor(node) ?? node) === id;
  const candidates = row.matches(TEXT) ? [row] : Array.from(row.querySelectorAll<HTMLElement>(TEXT));
  let textNode = candidates.find(eligible);
  if (!textNode) {
    // Some builds only expose copyable metadata + an auto-direction body span.
    textNode = Array.from(row.querySelectorAll<HTMLElement>(
      '[data-pre-plain-text] span[dir="auto"], [data-pre-plain-text] [data-testid="text-content"]',
    )).find(eligible);
  }
  if (!textNode) return null; // Non-text media/system events are not guessed at.
  const text = plainText(textNode).replace(/\u00a0/g, ' ').trim();
  if (!text) return null;
  let host = textNode.closest<HTMLElement>('[data-pre-plain-text]') ?? textNode.parentElement;
  // The metadata container can wrap the legacy .message-out element. The old
  // bubble.contains(host) check incorrectly rejected these perfectly valid rows.
  if (!host || (!row.contains(host) && !host.contains(row))) host = row;
  return { id, chatId: key.chatId, outgoing: key.fromMe, text, host };
}

// Counts only: no contact identifiers, message content or React props in diagnostics.
export function messageDomDiagnostics() {
  const { root, selector } = messageRoot();
  const ids = Array.from(root.querySelectorAll('[data-id]'), (node) => node.getAttribute('data-id') ?? '');
  const idFormats = { serialized: 0, stanza: 0, other: 0 };
  for (const id of ids) idFormats[parseMessageId(id) ? 'serialized' : isStanzaId(id) ? 'stanza' : 'other']++;
  const allowed = new Set(['true', 'false', 'c', 'us', 's', 'whatsapp', 'net', 'lid', 'g', 'newsletter', 'broadcast']);
  const idShapes = [...new Set(ids.map((id) => id.replace(/[A-Za-z0-9]+/g, (token) => allowed.has(token) ? token : 'X')
    .replace(/[^A-Za-z_@.:\-]/g, '?').slice(0, 100)))].slice(0, 4);
  return { root: selector, dataIdNodes: root.querySelectorAll('[data-id]').length,
    alternateIdNodes: root.querySelectorAll('[data-message-id]').length,
    modelIdNodes: root.querySelectorAll('[data-wa-trans-message-id]').length,
    textBodies: messageBodies(root).length,
    copyable: root.querySelectorAll('[data-pre-plain-text]').length,
    documentDataIds: document.querySelectorAll('[data-id]').length, idFormats, idShapes };
}
