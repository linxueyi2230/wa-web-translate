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
const { buildReplyPlan, businessSettingsSignature, formatReplyParts, productReplyImages, matchesKeyword, matchesKeywords, matchesPhraseKeywords, simpleGreetingChinese } = await server.ssrLoadModule('/src/shared/business-replies.ts');
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

test('a sole product can automatically reply to information and price enquiries', () => {
  const business = data(); business.products = [product('one')];
  business.autoReply.product = true;
  const information = buildReplyPlan('请给我商品信息', business);
  assert.equal(information.products[0].id, 'one');
  assert.equal(information.autoAllowed, true);
  assert.ok(!information.parts.map((part) => part.text).join('').includes('250'));
  const pricing = buildReplyPlan('这款多少钱，老客户有优惠吗？', business);
  assert.equal(pricing.autoAllowed, true);
  assert.equal(pricing.productPriceOnly, true);
  assert.match(pricing.parts.map((part) => part.text).join('\n'), /250 MXN/);
});

test('ambiguous products remain manual; selecting one narrows the reply plan', () => {
  const business = data(); business.products = [product('one'), product('two')];

  business.autoReply = { product: true, payment: true, shipping: true, trust: true };
  const ambiguous = buildReplyPlan('纪念版商品的型号是什么', business);
  assert.equal(ambiguous.needsProductSelection, true); assert.equal(ambiguous.autoAllowed, false);
  const selected = buildReplyPlan('纪念版商品的型号是什么', business, undefined, 'one');
  assert.equal(selected.products.length, 1);
  assert.equal(buildReplyPlan('纪念版多久能收到', business, undefined, 'one').autoAllowed, true);
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

test('each category switch is sufficient without a global or risk acknowledgement switch', () => {
  const business = data(); business.autoReply.shipping = true;
  assert.equal(buildReplyPlan('多久能收到', business).autoAllowed, true);
  business.autoReply.shipping = false;
  assert.equal(buildReplyPlan('多久能收到', business).autoAllowed, false);
  business.autoReply.shipping = true;
  assert.equal(buildReplyPlan('多久能收到', business).autoAllowed, true);
  business.includeGroupInvite = true; business.customerGroupUrl = 'https://example.com/invite';
  assert.ok(buildReplyPlan('可靠吗', business).missing.length > 0);
  business.customerGroupUrl = 'https://chat.whatsapp.com/TestInvite';
  const trust = buildReplyPlan('可靠吗', business);
  assert.equal(trust.parts.at(-1).language, business.trustLanguage);
  assert.match(trust.parts.at(-1).text, /电话号码/);
});

const records = { config: { ...DEFAULT_CONFIG, nativeLang: 'zh-CN', targetLang: 'es' } };
let listener;
globalThis.chrome = {
  runtime: { onConnect: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
  storage: { local: {
    async get(key) { return structuredClone(key === null ? records : { [key]: records[key] }); },
    async set(patch) { Object.assign(records, structuredClone(patch)); },
    async remove(key) { delete records[key]; },
  } },
};
await server.ssrLoadModule('/src/background/index.ts');
const rpc = (kind, payload = {}) => new Promise((resolve) => listener({ kind: `BUSINESS_RUNTIME_${kind}`, ...payload }, { tab: { id: payload.tabId ?? 1 } }, resolve));

const { translationContext } = await server.ssrLoadModule('/src/shared/message-history.ts');

test('worker authorization allows quotes and combined replies but requires leases and every category switch', async () => {
  const owner = 'worker-test';
  const lease = (await rpc('QUEUE_ACQUIRE', { owner })).result;
  const business = data();
  business.autoReply = { product: true, payment: true, shipping: true, trust: true };
  records['businessData:v1'] = business;
  let sequence = 0;
  const queue = async (categories, patch = {}) => {
    const message = { id: `false_123@c.us_AUTH${++sequence}`, chatId: '123@c.us', text: '价格和物流', receivedAt: Date.now() };
    await rpc('ACCEPT', { message });
    const claims = await Promise.all([rpc('CLAIM', { messageId: message.id, owner }), rpc('CLAIM', { messageId: message.id, owner: 'other' })]);
    assert.equal(claims.filter((result) => result.result).length, 1);
    await rpc('UPDATE', { messageId: message.id, owner, patch: { status: 'queued', translated: '多少钱，多久能收到', reply: '价格：250 MXN', preparedReply: 'Precio: 250 MXN', categories, productIds: [], settingsSignature: businessSettingsSignature(business), translationContext: translationContext(records.config), ...patch } });
    return { messageId: message.id, owner, queueToken: lease.token };
  };
  try {
    const pricing = await queue(['product']);
    assert.equal((await rpc('CAN_SEND', { ...pricing, queueToken: 'wrong' })).result, false);
    assert.equal((await rpc('CAN_SEND', { ...pricing, tabId: 2 })).result, false);
    assert.equal((await rpc('CAN_SEND', pricing)).result, true);
    assert.equal((await rpc('CAN_SEND', pricing)).result, false);
    assert.equal((await rpc('CHECK_SEND', pricing)).result, true);
    const combined = await queue(['shipping', 'trust']);
    assert.equal((await rpc('CAN_SEND', combined)).result, true);
    const another = await queue(['shipping']);
    assert.equal((await rpc('CAN_SEND', another)).result, true); // New IDs have no category cooldown.
    for (const category of ['product', 'shipping', 'trust']) {
      const candidate = await queue(['product', 'shipping', 'trust']);
      business.autoReply[category] = false;
      assert.equal((await rpc('CAN_SEND', candidate)).result, false);
      business.autoReply[category] = true;
    }
    assert.equal((await rpc('CAN_SEND', await queue(['product'], { manualOnly: true }))).result, false);
    assert.equal((await rpc('CAN_SEND', await queue(['product'], { productIds: ['one', 'two'] }))).result, false);
    assert.equal((await rpc('CAN_SEND', await queue([]))).result, false);
    const disabled = await queue(['shipping']);
    business.autoReply.shipping = false;
    assert.equal((await rpc('CAN_SEND', disabled)).result, false);
    business.autoReply.shipping = true;
    records.config.enabled = false;
    assert.equal((await rpc('CAN_SEND', disabled)).result, false);
    records.config.enabled = true;
  } finally { await rpc('QUEUE_RELEASE', { owner, token: lease.token }); }
});

test('the adapter never inserts into another chat, overwrites typed text or uses a direct send fallback', async () => {
  const fixture = new JSDOM('<!doctype html><body><div id="main"><footer><div contenteditable="true" role="textbox"></div></footer></div></body>', { url: 'https://web.whatsapp.com' });
  for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLButtonElement', 'KeyboardEvent', 'MessageEvent']) globalThis[name] = name === 'window' ? fixture.window : fixture.window[name];
  const composer = document.querySelector('[contenteditable]');
  composer.tabIndex = 0;
  composer.getBoundingClientRect = () => ({ width: 100, height: 30 });
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
    assert.equal((await action('SEND_REPLY', '222@c.us', 'Hola B')).ok, false);
    assert.equal(sent.length, 0);
  } finally { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); }
});

test('free-form quotations retain language, line breaks and currency while numeric prices keep the currency label', () => {
  const business = data(); business.autoReply.product = true; business.autoReply.shipping = true;
  business.products = [product('one')];
  for (const quote of ['Model A: 250 MXN\nModel B: 300 MXN', 'Modelo A: $250\nModelo B: $300']) {
    business.products[0].price = quote;
    const plan = buildReplyPlan('多少钱', business);
    assert.equal(plan.autoAllowed, true);
    assert.equal(plan.parts.length, 1);
    assert.equal(plan.parts[0].verbatim, true);
    assert.equal(formatReplyParts(plan.parts, 'es-MX'), quote);
    const combined = buildReplyPlan('多少钱，多久能收到', business);
    assert.equal(combined.autoAllowed, true);
    assert.ok(formatReplyParts(combined.parts, 'es-MX').startsWith(`${quote}\n\n`));
  }
  business.products[0].price = '250.50';
  assert.equal(formatReplyParts(buildReplyPlan('多少钱', business).parts, 'es-MX'), 'Precio: 250.50 MXN');
  business.products[0].price = '   ';
  assert.equal(buildReplyPlan('多少钱', business).autoAllowed, false);
});

test('shipping fees and combined trust enquiries obey all matched switches', () => {
  const business = data(); business.autoReply.shipping = true; business.autoReply.trust = true;
  for (const text of ['多久能收到', '物流方式，运费多少钱', '多久能收到，交易安全吗']) assert.equal(buildReplyPlan(text, business).autoAllowed, true);
  business.autoReply.trust = false;
  assert.equal(buildReplyPlan('多久能收到，交易安全吗', business).autoAllowed, false);
  business.shippingDays = '';
  assert.equal(buildReplyPlan('多久能收到', business).autoAllowed, false);
});

test('product image batches contain every saved photo with the cover first, except price-only replies', () => {
  for (const count of [2, 6]) {
    const item = product('one');
    item.images = Array.from({ length: count }, (_, index) => ({ id: `photo-${index}`, name: `${index}.png`, dataUrl: '' }));
    item.coverImageId = item.images[1].id;
    assert.deepEqual(productReplyImages(item).map((image) => image.id), ['photo-1', ...item.images.filter((image) => image.id !== 'photo-1').map((image) => image.id)]);
    assert.deepEqual(productReplyImages(item, true), []);
    item.coverImageId = 'removed-cover';
    assert.deepEqual(productReplyImages(item), item.images);
  }
});

const phrase = (id, content = `Contenido ${id}`, enabled = true, words = ['欢迎']) => ({ id, title: `常用语标题${id}`, content, enabled, language: 'es-MX', keywords: words.map((word) => keyword(word)), updatedAt: 1 });

test('a configured greeting matches Hola and translation variants without changing other keyword rules', () => {
  const business = data(); business.phrases = [phrase('hello', 'Bienvenido', true, ['你好'])];
  for (const greeting of ['Hola', 'HOLA!', '您好', '嗨，欢迎', 'Hello', 'Hi']) {
    const plan = buildReplyPlan(greeting, business);
    assert.equal(plan.autoAllowed, true, greeting);
    assert.deepEqual(plan.phrases.map((item) => item.id), ['hello']);
  }
  // Even a different Chinese translation still uses the customer's original greeting.
  assert.equal(buildReplyPlan('早上好', business, undefined, undefined, 'Hola').autoAllowed, true);
  for (const text of ['cholado', 'high quality', '夜店很嗨', '您好牌商品']) {
    assert.equal(matchesPhraseKeywords(text, [keyword('你好')]), false, text);
  }
  assert.equal(matchesPhraseKeywords('Hola', [keyword('你好', false)]), false);
  assert.equal(matchesPhraseKeywords('Hola', [keyword('欢迎')]), false);
  business.phrases[0].enabled = false;
  assert.deepEqual(buildReplyPlan('Hola', business).categories, []);
  business.phrases[0].enabled = true; business.phrases[0].keywords[0].enabled = false;
  assert.deepEqual(buildReplyPlan('Hola', business).categories, []);
});

test('only standalone greetings bypass incoming translation; combined questions retain all their intents', () => {
  for (const greeting of ['Hola', ' HOLA! ', '👋 Hola 🙂', 'Hello', 'hi']) assert.equal(simpleGreetingChinese(greeting), '你好');
  assert.equal(simpleGreetingChinese('您好！'), '您好');
  assert.equal(simpleGreetingChinese('你好'), '你好');
  for (const text of ['Hola, ¿cómo pago?', 'Hola, shipping?', '你好，多久能收到', 'cholado', '']) assert.equal(simpleGreetingChinese(text), undefined, text);
  const business = data(); business.autoReply.shipping = true;
  business.phrases = [phrase('hello', 'Bienvenido', true, ['你好'])];
  const combined = buildReplyPlan('嗨，多久能收到', business, undefined, undefined, 'Hola, ¿cuánto tarda?');
  assert.deepEqual(combined.categories, ['shipping', 'phrase']);
  assert.equal(combined.autoAllowed, true);
  assert.equal(combined.parts.at(-1).text, 'Bienvenido');
});

test('common phrases start empty and each enabled entry can automatically reply with no category or global switch', () => {
  const business = data();
  assert.deepEqual(business.phrases, []);
  assert.deepEqual(buildReplyPlan('欢迎', business).categories, []);
  business.phrases = [phrase('one', 'Hola', true, ['多少钱'])];
  const plan = buildReplyPlan('多少钱', business);
  assert.deepEqual(plan.categories, ['phrase']);
  assert.equal(plan.autoAllowed, true);
  assert.equal(plan.productPriceOnly, false);
  assert.equal(formatReplyParts(plan.parts, 'es-MX'), 'Hola');
  business.phrases[0].enabled = false;
  assert.deepEqual(buildReplyPlan('多少钱', business).categories, []);
});

test('multiple common phrases merge in list order, once per entry, excluding disabled rules and keywords', () => {
  const business = data();
  business.phrases = [phrase('one', 'Bienvenido', true, ['欢迎', '你好']), phrase('two', 'En qué puedo ayudarte'), phrase('off', 'NO ENVIAR', false), phrase('off-key', 'NO ENVIAR')];
  business.phrases[3].keywords[0].enabled = false;
  const plan = buildReplyPlan('你好，欢迎', business);
  assert.deepEqual(plan.phrases.map((item) => item.id), ['one', 'two']);
  assert.deepEqual(plan.parts.map((part) => part.text), ['Bienvenido', 'En qué puedo ayudarte']);
  assert.equal(plan.autoAllowed, true);
  const reply = formatReplyParts(plan.parts, 'es-MX');
  assert.equal(reply, 'Bienvenido. \n\nEn qué puedo ayudarte');
  assert.ok(!reply.includes('标题'));
  assert.ok(!reply.includes('NO ENVIAR'));
});

test('common phrase keywords match Chinese translations or original Latin words, and combine with business replies', () => {
  const business = data(); business.phrases = [phrase('help', 'Con gusto', true, ['help'])];
  assert.equal(buildReplyPlan('我需要帮助', business, undefined, undefined, 'Please HELP.').autoAllowed, true);
  assert.deepEqual(buildReplyPlan('很有帮助', business, undefined, undefined, 'helpful').categories, []);
  business.phrases[0].keywords = [keyword('欢迎')];
  business.autoReply.shipping = true;
  const plan = buildReplyPlan('欢迎，多久能收到', business);
  assert.deepEqual(plan.categories, ['shipping', 'phrase']);
  assert.equal(plan.autoAllowed, true);
  assert.equal(plan.parts.at(-1).text, 'Con gusto');
  business.autoReply.shipping = false;
  assert.equal(buildReplyPlan('欢迎，多久能收到', business).autoAllowed, false);
});

test('legacy global switches are ignored, the removed tab is redirected and old data gets an empty phrase list', async () => {
  const { loadBusinessData } = await server.ssrLoadModule('/src/shared/storage.ts');
  records['businessData:v1'] = { activeTab: 'auto', globalAutoReply: false, riskConfirmed: false, autoReply: { shipping: true } };
  const business = await loadBusinessData();
  assert.equal(business.activeTab, 'settings');
  assert.deepEqual(business.phrases, []);
  assert.equal('globalAutoReply' in business, false);
  assert.equal('riskConfirmed' in business, false);
  assert.equal(buildReplyPlan('多久能收到', business).autoAllowed, true);
});

test('worker authorization validates every matched common phrase instead of a phrase-wide switch', async () => {
  const business = data(); business.phrases = [phrase('on'), phrase('off', 'NO', false)];
  records['businessData:v1'] = business;
  const owner = 'phrase-worker', lease = (await rpc('QUEUE_ACQUIRE', { owner })).result;
  let sequence = 0;
  try {
    for (const [ids, allowed] of [[['on'], true], [['off'], false], [['missing'], false], [[], false], [['on', 'off'], false]]) {
      const message = { id: `false_123@c.us_PHRASEAUTH${++sequence}`, chatId: '123@c.us', text: '欢迎', receivedAt: Date.now() };
      await rpc('ACCEPT', { message }); await rpc('CLAIM', { messageId: message.id, owner });
      await rpc('UPDATE', { messageId: message.id, owner, patch: { status: 'queued', translated: '欢迎', reply: 'Contenido', preparedReply: 'Contenido', categories: ['phrase'], productIds: [], phraseIds: ids, settingsSignature: businessSettingsSignature(business), translationContext: translationContext(records.config) } });
      assert.equal((await rpc('CAN_SEND', { messageId: message.id, owner, queueToken: lease.token })).result, allowed);
    }
  } finally { await rpc('QUEUE_RELEASE', { owner, token: lease.token }); }
});
