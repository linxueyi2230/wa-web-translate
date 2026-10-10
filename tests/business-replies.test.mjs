import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';

const server = await createServer({ configFile: false,
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
after(() => server.close());
const { buildReplyPlan, matchesKeyword, matchesKeywords } = await server.ssrLoadModule('/src/shared/business-replies.ts');
const { DEFAULT_BUSINESS_DATA, DEFAULT_CONFIG, DEFAULT_PRODUCT_KEYWORDS } = await server.ssrLoadModule('/src/shared/types.ts');
const keyword = (text, enabled = true) => ({ id: text, text, enabled, source: 'manual' });
const product = (id, text = '纪念版') => ({ id, name: `${id}纪念版`, model: 'DN166', description: '纪念版商品', price: '250', currency: 'MXN', images: [], coverImageId: '', keywords: [keyword(text), ...DEFAULT_PRODUCT_KEYWORDS.map((text) => keyword(text))], enabled: true, updatedAt: Date.now() });
function data() { return structuredClone(DEFAULT_BUSINESS_DATA); }

test('Chinese keywords use phrases, Latin terms require whole words, disabled keywords do not match', () => {
  assert.equal(matchesKeyword('请问什么时候发货？', '什么时候发货'), true);
  assert.equal(matchesKeyword('I prefer OXXO.', 'oxxo'), true);
  assert.equal(matchesKeyword('OXXOother', 'OXXO'), false);
  assert.equal(matchesKeywords('什么时候发货', [keyword('什么时候发货', false)]), false);
});

test('a generic enquiry selects the sole enabled product but pricing always requires a draft', () => {
  const business = data(); business.products = [product('one')];
  business.globalAutoReply = true; business.riskConfirmed = true; business.autoReply.product = true;
  const information = buildReplyPlan('请给我商品信息', business);
  assert.equal(information.products[0].id, 'one');
  assert.equal(information.autoAllowed, true);
  assert.ok(!information.parts.map((part) => part.text).join('').includes('250'));
  const pricing = buildReplyPlan('这款多少钱，老客户有优惠吗？', business);
  assert.equal(pricing.autoAllowed, false);
  assert.match(pricing.parts[0].text, /250 MXN/);
});

test('ambiguous products and combined categories remain manual; selection narrows to one product', () => {
  const business = data(); business.products = [product('one'), product('two')];
  business.globalAutoReply = true; business.riskConfirmed = true;
  business.autoReply = { product: true, payment: true, shipping: true, trust: true };
  const ambiguous = buildReplyPlan('纪念版商品的型号是什么', business);
  assert.equal(ambiguous.needsProductSelection, true); assert.equal(ambiguous.autoAllowed, false);
  const selected = buildReplyPlan('纪念版商品的型号是什么', business, undefined, 'one');
  assert.equal(selected.products.length, 1);
  assert.equal(buildReplyPlan('纪念版多久能收到', business, undefined, 'one').autoAllowed, false);
});

test('blank payment content never sends; alternatives depend on the payment context', () => {
  const business = data();
  assert.equal(buildReplyPlan('怎么付款', business).missing.length, 1);
  business.paymentMethods[0].content = 'Datos bancarios';
  business.paymentMethods[1].content = 'Datos OXXO';
  assert.equal(buildReplyPlan('怎么付款', business).parts[0].text, 'Datos bancarios');
  assert.deepEqual(buildReplyPlan('这个不方便', business).categories, []);
  const alternative = buildReplyPlan('这个不方便', business, 'payment');
  assert.equal(alternative.paymentOptions, true); assert.match(alternative.parts[0].text, /OXXO/);
  assert.ok(!alternative.parts[0].text.includes('Datos OXXO'));
  assert.equal(buildReplyPlan('OXXO', business).parts[0].text, 'Datos OXXO');
});

test('global, category and risk acknowledgement are all required; the group link must be valid', () => {
  const business = data(); business.globalAutoReply = true; business.autoReply.shipping = true;
  assert.equal(buildReplyPlan('多久能收到', business).autoAllowed, false);
  business.riskConfirmed = true;
  assert.equal(buildReplyPlan('多久能收到', business).autoAllowed, true);
  business.includeGroupInvite = true; business.customerGroupUrl = 'https://example.com/invite';
  assert.ok(buildReplyPlan('可靠吗', business).missing.length > 0);
  business.customerGroupUrl = 'https://chat.whatsapp.com/TestInvite';
  const trust = buildReplyPlan('可靠吗', business);
  assert.equal(trust.parts.at(-1).language, 'es-MX');
  assert.match(trust.parts.at(-1).text, /número de teléfono/);
});

const records = { config: { ...DEFAULT_CONFIG, nativeLang: 'zh-CN', targetLang: 'es' } };
let listener;
globalThis.chrome = {
  runtime: { onConnect: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
  storage: { local: {
    async get(key) { return structuredClone(key === null ? records : { [key]: records[key] }); },
    async set(patch) { Object.assign(records, structuredClone(patch)); },
  } },
};
await server.ssrLoadModule('/src/background/index.ts');
const rpc = (kind, payload = {}) => new Promise((resolve) => listener({ kind: `BUSINESS_RUNTIME_${kind}`, ...payload }, {}, resolve));

test('the worker serializes claims and blocks duplicate sends, price sends and cooldown violations', async () => {
  const message = { id: 'false_123@c.us_NEWMSG0001', chatId: '123@c.us', text: '多久能收到', receivedAt: Date.now() };
  const accepted = await rpc('ACCEPT', { message }); assert.equal(accepted.ok, true);
  const claims = await Promise.all([rpc('CLAIM', { messageId: message.id, owner: 'a' }), rpc('CLAIM', { messageId: message.id, owner: 'b' })]);
  assert.equal(claims.filter((result) => result.result).length, 1);
  const owner = claims.find((result) => result.result).result.owner;
  const business = data(); business.globalAutoReply = true; business.riskConfirmed = true; business.autoReply.shipping = true;
  records['businessData:v1'] = business;
  await rpc('UPDATE', { messageId: message.id, owner, patch: { translated: '多久能收到', reply: 'De 9 a 12 días', categories: ['shipping'], productIds: [], status: 'processing' } });
  assert.equal((await rpc('CAN_SEND', { messageId: message.id, owner })).result, true);
  assert.equal((await rpc('CAN_SEND', { messageId: message.id, owner })).result, false);
  const next = { ...message, id: 'false_123@c.us_NEWMSG0002' };
  await rpc('ACCEPT', { message: next }); await rpc('CLAIM', { messageId: next.id, owner });
  await rpc('UPDATE', { messageId: next.id, owner, patch: { translated: '多久能收到', reply: 'De 9 a 12 días', categories: ['shipping'], productIds: [], status: 'processing' } });
  assert.equal((await rpc('CAN_SEND', { messageId: next.id, owner })).result, false);
  await rpc('UPDATE', { messageId: next.id, owner, patch: { translated: '多少钱', categories: ['product'] } });
  business.autoReply.product = true;
  assert.equal((await rpc('CAN_SEND', { messageId: next.id, owner })).result, false);
});

test('the WhatsApp adapter sends to the source chat and never inserts B into A or overwrites typed text', async () => {
  const fixture = new JSDOM('<!doctype html><body><div id="main"><footer><div contenteditable="true" role="textbox"></div></footer></div></body>', { url: 'https://web.whatsapp.com' });
  for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'MessageEvent']) globalThis[name] = name === 'window' ? fixture.window : fixture.window[name];
  const composer = document.querySelector('[contenteditable]');
  composer.tabIndex = 0;
  document.execCommand = (_command, _ui, text) => { composer.textContent = text; return true; };
  const chatA = { id: '111@c.us' }; const chatB = { id: '222@c.us' }; const sent = [];
  const callbacks = new Map();
  window.require = (name) => name === 'WAWebChatCollection' ? { ChatCollection: { getModelsArray: () => [chatA, chatB], getActive: () => chatA } }
    : name === 'WAWebMsgCollection' ? { MsgCollection: { getModelsArray: () => [], on: (event, callback) => callbacks.set(event, callback) } }
    : name === 'WAWebSendTextMsgChatAction' ? { sendTextMsgToChat: async (chat, body) => sent.push({ chat, body }) } : null;
  window.postMessage = (data) => queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', { source: window, data })));
  const received = [];
  window.addEventListener('message', (event) => {
    if (event.data.kind === 'INCOMING') received.push(event.data.message);
    if (event.data.kind === 'VERIFY_SEND') window.postMessage({ __waBusiness: true, kind: 'SEND_AUTHORIZED', id: event.data.id, allowed: true });
  });
  const { installBusinessAdapter } = await server.ssrLoadModule('/src/page/business-adapter.ts');
  installBusinessAdapter();
  const action = (kind, chatId, text) => new Promise((resolve) => {
    const id = `${kind}${Math.random()}`;
    const observe = (event) => { if (event.data.kind === 'ACTION_RESULT' && event.data.id === id) { window.removeEventListener('message', observe); resolve(event.data); } };
    window.addEventListener('message', observe);
    window.postMessage({ __waBusiness: true, kind, id, chatId, text });
  });
  try {
    callbacks.get('add')({ id: 'false_222@c.us_FRESHMSG01', body: 'Hola', t: Date.now() / 1000, isNewMsg: true });
    callbacks.get('add')({ id: 'false_222@c.us_OLDMSG0001', body: 'Old history', t: Date.now() / 1000 - 100, isNewMsg: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(received.length, 1); assert.equal(received[0].chatId, '222@c.us');
    assert.equal((await action('INSERT_DRAFT', '222@c.us', 'Hola B')).ok, false);
    composer.textContent = '正在输入';
    assert.equal((await action('INSERT_DRAFT', '111@c.us', 'Hola A')).ok, false);
    assert.equal(composer.textContent, '正在输入');
    composer.textContent = '';
    assert.equal((await action('INSERT_DRAFT', '111@c.us', 'Hola A')).ok, true);
    assert.equal(composer.textContent, 'Hola A');
    assert.equal((await action('SEND_REPLY', '222@c.us', 'Hola B')).ok, true);
    assert.equal(sent[0].chat, chatB); assert.equal(sent[0].body, 'Hola B');
  } finally { fixture.window.close(); }
});
