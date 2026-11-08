import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';

const server = await createServer({ configFile: false,
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
const fixture = new JSDOM('<body></body>', { url: 'https://web.whatsapp.com' });
after(async () => { fixture.window.close(); await server.close(); });
for (const name of ['window', 'document', 'Element', 'HTMLElement', 'MessageEvent']) globalThis[name] = name === 'window' ? fixture.window : fixture.window[name];
window.postMessage = (data) => queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', { source: window, data })));
const sent = [];
const media = { prepRawMedia(kind) {
  if (kind === 'missing') return {};
  const preparation = { async sendToChat(chat, options) { sent.push(options.caption); return { id: `true_${chat.id}_test` }; } };
  return kind === 'immutable' ? Object.freeze(preparation) : preparation;
} };
const chat = { id: '123@c.us' };
window.require = (name) => name === 'WAWebPrepRawMedia' ? media : name === 'WAWebChatCollection' ? { ChatCollection: { getActive: () => chat } } : null;
let response = 'Hola';
window.addEventListener('message', ({ data }) => {
  if (data.__waTrans && data.kind === 'TRANSLATE_REQUEST') window.postMessage({ __waTrans: true, kind: 'TRANSLATE_RESULT', id: data.id, ok: true, result: { translated: response, source: 'zh-CN', target: 'es' } });
  if (data.__waTransHistory && ['PREPARE_OUTGOING', 'SENT_OUTGOING'].includes(data.kind)) window.postMessage({ __waTransHistory: true, kind: 'HISTORY_RESULT', id: data.id, ok: true });
});
const { installBusinessMediaSendHook } = await server.ssrLoadModule('/src/page/hooks/media-send.ts');
assert.equal(installBusinessMediaSendHook(), true);

test('ordinary media captions are translated and unchanged Chinese is blocked', async () => {
  await media.prepRawMedia().sendToChat(chat, { caption: '你好' });
  assert.deepEqual(sent, ['Hola']);
  response = '你好';
  await assert.rejects(media.prepRawMedia().sendToChat(chat, { caption: '你好' }), /仍包含中文/);
  assert.deepEqual(sent, ['Hola']);
  await media.prepRawMedia().sendToChat(chat, { caption: '' });
  assert.deepEqual(sent, ['Hola', '']);
});

test('ordinary media with unavailable or immutable sender fails closed', () => {
  assert.throws(() => media.prepRawMedia('missing'), /无法安全翻译/);
  assert.throws(() => media.prepRawMedia('immutable'));
});

test('a replaced media preparation function is hooked again', async () => {
  media.prepRawMedia = () => ({ async sendToChat(_chat, options) { sent.push(options.caption); } });
  assert.equal(installBusinessMediaSendHook(), true);
  response = 'Buenos días';
  await media.prepRawMedia().sendToChat(chat, { caption: '早上好' });
  assert.equal(sent.at(-1), 'Buenos días');
});
