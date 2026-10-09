import { normalizeChatId, parseMessageId } from './message-history';

// Newer WA keys cache their string in a minified field instead of _serialized.
// Use the key's own serialization method; never patch WA prototypes or guess
// minified property names. All callers share this adapter (send + DOM metadata).
function serialized(value: unknown, valid: (text: string) => boolean): string | null {
  if (typeof value === 'string') return valid(value) ? value : null;
  if (!value || typeof value !== 'object') return null;
  try {
    const cached = (value as any)._serialized;
    if (typeof cached === 'string' && valid(cached)) return cached;
  } catch { /* A getter may disappear/change between WA releases. */ }
  try {
    const method = (value as any).toString;
    if (typeof method === 'function' && method !== Object.prototype.toString) {
      const text = method.call(value);
      if (typeof text === 'string' && valid(text)) return text;
    }
  } catch { /* Probing must never interfere with WhatsApp. */ }
  return null;
}

export function chatKey(value: unknown): string | null {
  const id = serialized(value, (text) => /^[^\s_@]+@[^\s_@]+$/.test(text));
  return id ? normalizeChatId(id) : null;
}

export function messageKey(value: unknown): string | null {
  const id = serialized(value, (text) => !!parseMessageId(text));
  if (id) return id;
  // A plain copied key can lose its prototype. Only reconstruct from explicit
  // direction + remote + stanza fields, not an arbitrary string/object property.
  try {
    const key = value as any;
    const remote = chatKey(key?.remote);
    if (typeof key?.fromMe === 'boolean' && remote && isStanzaId(key.id)) {
      const participant = chatKey(key.participant);
      return `${key.fromMe}_${remote}_${key.id}${participant ? `_${participant}` : ''}`;
    }
  } catch {}
  return null;
}

export function isStanzaId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9]{8,128}$/.test(value);
}

export function stanzaId(id: string): string | null {
  return parseMessageId(id) ? id.split('_')[2] || null : isStanzaId(id) ? id : null;
}

export function modelField(model: any, name: string): unknown {
  try {
    const direct = model?.[name];
    if (direct !== undefined && direct !== null) return direct;
  } catch {}
  try {
    const attribute = model?.attributes?.[name];
    if (attribute !== undefined && attribute !== null) return attribute;
  } catch {}
  try { return typeof model?.get === 'function' ? model.get(name) : undefined; }
  catch { return undefined; }
}
