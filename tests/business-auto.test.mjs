import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';

// Real business controller, adapter, native button flow and sender hooks;
// WhatsApp transport and translations are local fixtures only.
const server = await createServer({ configFile: false,
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
after(() => server.close());
const fixture = new JSDOM('<body><div id="side"></div><div id="main"><footer><div id="composer" contenteditable="true" role="textbox" data-lexical-editor="true"></div><button aria-label="Send" id="send"><span data-icon="send"></span></button></footer></div></body>', { url: 'https://web.whatsapp.com' });
after(() => { window.dispatchEvent(new window.Event('pagehide')); fixture.window.close(); });
for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLButtonElement', 'HTMLTextAreaElement', 'HTMLInputElement', 'KeyboardEvent', 'MessageEvent', 'CustomEvent', 'MutationObserver', 'File']) {
  globalThis[name] = name === 'window' ? fixture.window : fixture.window[name];
}
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { width: this.isConnected && !this.hidden ? 100 : 0, height: 30, left: 0, top: 0, right: 100, bottom: 30 };
};
globalThis.DataTransfer = class {
  files = []; text = '';
  items = { add: (file) => this.files.push(file) };
  setData(_type, text) { this.text = text; }
  getData() { return this.text; }
};
globalThis.ClipboardEvent = class extends window.Event {
  constructor(type, options) { super(type, options); this.clipboardData = options.clipboardData; }
};
window.postMessage = (data) => queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', { source: window, data: structuredClone(data) })));
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
after(() => { Date.now = realNow; });
const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let attempt = 0; attempt < 300; attempt++) { if (check()) return; await wait(); }
  assert.fail(`timed out waiting for business fixture: ${JSON.stringify({ phase: controller.autoState, busy: controller.autoBusy, composer: composer.textContent, unfinished: Object.values(records).filter((record) => record?.message && !['sent', 'dismissed', 'no-match'].includes(record.status)).map((record) => ({ id: record.message.id, status: record.status, categories: record.categories, phraseIds: record.phraseIds, error: record.error })) })}`);
}
const { DEFAULT_CONFIG, DEFAULT_BUSINESS_DATA, DEFAULT_PRODUCT_KEYWORDS } = await server.ssrLoadModule('/src/shared/types.ts');
const { BUSINESS_RUNTIME_PREFIX } = await server.ssrLoadModule('/src/shared/business-replies.ts');
const records = { config: { ...DEFAULT_CONFIG, nativeLang: 'zh-CN', targetLang: 'es' } };
const storageListeners = [];
let workerListener;
const runtime = (request) => new Promise((resolve) => workerListener(request, { tab: { id: 1 } }, resolve));
globalThis.chrome = {
  runtime: { onConnect: { addListener() {} }, onMessage: { addListener(fn) { workerListener = fn; } }, sendMessage: runtime },
  storage: { local: {
    async get(key) { return structuredClone(key === null ? records : { [key]: records[key] }); },
    async set(patch) {
      const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: structuredClone(records[key]), newValue: structuredClone(value) }]));
      Object.assign(records, structuredClone(patch));
      queueMicrotask(() => storageListeners.forEach((listener) => listener(changes, 'local')));
    },
    async remove(key) { delete records[key]; },
  }, onChanged: { addListener(fn) { storageListeners.push(fn); }, removeListener(fn) { const index = storageListeners.indexOf(fn); if (index >= 0) storageListeners.splice(index, 1); } } },
};
await server.ssrLoadModule('/src/background/index.ts');
const events = [];
const sent = [];
const nativeClicks = [];
const photoBatches = [];
const collectionCallbacks = new Map();
const chatA = { id: '111@c.us', msgs: { models: [] } }, chatB = { id: '222@c.us', msgs: { models: [] } };
let active = chatA, outgoingSequence = 0, lastAcknowledgement;
let holdLastPhoto = false, rejectPhoto = -1;
const sendModule = {
  async sendTextMsgToChat(chat, body) {
    const model = { id: `true_${chat.id}_SENT${++outgoingSequence}`, body, type: 'chat', ack: 1 };
    sent.push({ chatId: chat.id, body, media: false }); chat.msgs.models.push(model); return model;
  },
};
const mediaModule = {
  prepRawMedia(file) {
    return { async sendToChat(chat, options) {
      const index = photoBatches.at(-1).files.indexOf(file);
      if (index === rejectPhoto) throw new Error('fixture upload rejected');
      const model = { id: `true_${chat.id}_PHOTO${++outgoingSequence}`, caption: options.caption ?? '', type: 'image', ack: 1 };
      sent.push({ chatId: chat.id, body: model.caption, media: true, name: file.name });
      chat.msgs.models.push(model);
      if (holdLastPhoto && index === photoBatches.at(-1).files.length - 1) { model.ack = 0; lastAcknowledgement = model; }
      return model;
    } };
  },
};
window.require = (name) => name === 'WAWebChatCollection' ? { ChatCollection: { getModelsArray: () => [chatA, chatB], getActive: () => active } }
  : name === 'WAWebMsgCollection' ? { MsgCollection: { getModelsArray: () => [...chatA.msgs.models, ...chatB.msgs.models], on: (event, fn) => collectionCallbacks.set(event, fn) } }
  : name === 'WAWebSendTextMsgChatAction' ? sendModule
  : name === 'WAWebPrepRawMedia' ? mediaModule
  : name === 'WAWebCmd' ? { Cmd: { openChatBottom: async ({ chat }) => { active = chat; } } } : null;
window.addEventListener('message', (event) => {
  const data = event.data; events.push(data);
  if (data.__waTransHistory === true && ['PREPARE_OUTGOING', 'SENT_OUTGOING'].includes(data.kind)) window.postMessage({ __waTransHistory: true, kind: 'HISTORY_RESULT', id: data.id, ok: true });
  if (data.__waTrans === true && data.kind === 'TRANSLATE_REQUEST') window.postMessage({ __waTrans: true, kind: 'TRANSLATE_RESULT', id: data.id, ok: false, error: 'unexpected fresh translation at Send' });
});
const composer = document.querySelector('#composer');
document.execCommand = (_command, _ui, text) => { document.activeElement.textContent = text ?? ''; return true; };
composer.addEventListener('paste', (event) => {
  const transfer = event.clipboardData;
  if (!transfer.files.length) {
    // Lexical commits asynchronously, and Send can become available later.
    const send = document.querySelector('#send'); send.disabled = true;
    setTimeout(() => { composer.textContent = transfer.getData('text/plain'); composer.dispatchEvent(new window.Event('input', { bubbles: true })); }, 10);
    setTimeout(() => { send.disabled = false; }, 25);
    return;
  }
  const root = document.createElement('div'); root.id = 'media-preview';
  root.innerHTML = '<div role="textbox" contenteditable="true" id="caption"></div><button aria-label="Close">Close</button><button aria-label="Send" id="media-send"><span data-icon="send"></span></button>';
  document.body.appendChild(root);
  const batch = { files: [...transfer.files], preparations: transfer.files.map((file) => mediaModule.prepRawMedia(file)) };
  photoBatches.push(batch);
  root.querySelector('[aria-label="Close"]').addEventListener('click', () => root.remove());
  root.querySelector('#media-send').addEventListener('click', () => {
    nativeClicks.push({ chatId: active.id, media: true });
    const text = root.querySelector('#caption').textContent;
    const recipient = active;
    const tasks = batch.preparations.map((preparation, index) => preparation.sendToChat(recipient, { caption: index === 0 ? text : '' }));
    Promise.allSettled(tasks).then(() => root.remove());
  });
});
document.querySelector('#send').addEventListener('click', () => {
  nativeClicks.push({ chatId: active.id, media: false });
  sendModule.sendTextMsgToChat(active, composer.textContent, {}).then(() => { composer.textContent = ''; });
});
const { installSendHook } = await server.ssrLoadModule('/src/page/hooks/send.ts');
const { installBusinessAdapter } = await server.ssrLoadModule('/src/page/business-adapter.ts');
const drafts = await server.ssrLoadModule('/src/page/business-drafts.ts');
const { BusinessReplies } = await server.ssrLoadModule('/src/content/business-replies.ts');
installSendHook(); installBusinessAdapter();
offset = 6000; // Initial idle protection has elapsed; all other waits remain real.
const business = structuredClone(DEFAULT_BUSINESS_DATA);
business.autoReply = { product: true, payment: true, shipping: true, trust: true };
business.productLanguage = business.shippingLanguage = business.trustLanguage = 'es-MX';
business.shippingDays = '9–12 días'; business.shippingMethod = 'Envío desde China'; business.dispatchText = 'El mismo día; costo de envío: 20 MXN';
business.trustText = 'Compra segura; verificamos el pago antes del envío.';
business.products = [{ id: 'one', name: 'Modelo A', model: 'DN166', description: 'Edición conmemorativa', price: '250', currency: 'MXN', images: [], coverImageId: '', keywords: DEFAULT_PRODUCT_KEYWORDS.map((text) => ({ id: text, text, enabled: true, source: 'default' })), enabled: true, updatedAt: Date.now() }];
records['businessData:v1'] = structuredClone(business);
const translations = [];
const controller = new BusinessReplies(async (request) => { translations.push(request.text); return { translated: request.target === 'es' ? `ES ${request.text}` : request.text, source: 'zh-CN', target: request.target }; });
controller.start();
let incomingSequence = 0;
async function incoming(text, chat = chatA) {
  const message = { id: `false_${chat.id}_INCOMING${++incomingSequence}`, body: text, t: Date.now() / 1000, isNewMsg: true };
  collectionCallbacks.get('add')(message);
  const id = message.id;
  await until(() => records[`${BUSINESS_RUNTIME_PREFIX}${id}`]);
  return { id, record: () => records[`${BUSINESS_RUNTIME_PREFIX}${id}`] };
}
async function configure() {
  await until(() => !controller.autoBusy);
  await chrome.storage.local.set({ 'businessData:v1': business });
  await wait(10);
}
const photos = (count) => Array.from({ length: count }, (_, index) => ({ id: `image-${index}`, name: `${index}.png`, dataUrl: 'data:image/png;base64,aGVsbG8=' }));

test('logistics, fees, trust and combined replies click native Send once and finish in the source chat', async () => {
  await until(() => controller.adapterStateReady);
  for (const [text, chat] of [['多久能收到', chatA], ['物流方式，运费多少钱', chatA], ['多久能收到，交易安全吗', chatB], ['价格，多久能收到', chatA]]) {
    const before = nativeClicks.length;
    const next = await incoming(text, chat);
    await until(() => next.record().status === 'sent');
    assert.equal(nativeClicks.length, before + 1);
    assert.equal(sent.at(-1).chatId, chat.id);
    assert.match(sent.at(-1).body, /20 MXN/);
    if (text.includes('交易安全')) assert.match(sent.at(-1).body, /Compra segura/);
    if (text.includes('价格')) assert.match(sent.at(-1).body, /Precio: 250 MXN/);
    await until(() => !controller.autoBusy);
  }
});

test('English and Spanish multiline quotations send unchanged, with no photos or quote translation requests', async () => {
  business.products[0].images = photos(2);
  for (const quote of ['Model A: 250 MXN\nModel B: 300 MXN', 'Modelo A: $250\nModelo B: $300']) {
    business.products[0].price = quote;
    await configure();
    const beforeBatches = photoBatches.length, beforeTranslations = translations.length;
    const next = await incoming('多少钱');
    await until(() => next.record().status === 'sent');
    assert.equal(sent.at(-1).body, quote);
    assert.equal(photoBatches.length, beforeBatches);
    assert.ok(!translations.slice(beforeTranslations).includes(quote));
  }
});

test('2 and 6 photos use one paste and one native click, and wait for the last photo ACK', async () => {
  business.products[0].price = '250';
  for (const count of [2, 6]) {
    business.products[0].images = photos(count); business.products[0].coverImageId = 'image-1';
    await configure(); holdLastPhoto = true; lastAcknowledgement = undefined;
    const before = nativeClicks.length, beforeBatches = photoBatches.length, beforeSent = sent.length;
    const next = await incoming('请给我产品的更多信息');
    await until(() => lastAcknowledgement && sent.length === beforeSent + count);
    assert.equal(next.record().status, 'sending');
    assert.equal(drafts.isBusinessDraftFinished(chatA.id, next.id), false);
    const batch = photoBatches.at(-1);
    assert.equal(photoBatches.length, beforeBatches + 1);
    assert.deepEqual(batch.files.map((file) => file.name), ['1.png', ...business.products[0].images.filter((image) => image.id !== 'image-1').map((image) => image.name)]);
    const sentPhotos = sent.slice(beforeSent);
    assert.match(sentPhotos[0].body, /Modelo A/);
    assert.ok(sentPhotos.slice(1).every((photo) => photo.body === ''));
    // Repeated callbacks for one preparation reuse its first attempt.
    await batch.preparations[0].sendToChat(chatA, { caption: 'unexpected repeat' });
    assert.equal(sent.length, beforeSent + count);
    lastAcknowledgement.ack = 1;
    await until(() => next.record().status === 'sent');
    assert.equal(nativeClicks.length, before + 1);
    assert.equal(events.filter((event) => event.kind === 'DRAFT_SENT' && event.messageId === next.id).length, 1);
    holdLastPhoto = false;
  }
});

test('a failed photo leaves the batch for manual inspection and never retries an already sent photo', async () => {
  business.products[0].images = photos(2); await configure(); rejectPhoto = 1;
  const before = nativeClicks.length, beforeSent = sent.length;
  const next = await incoming('商品信息');
  await until(() => next.record().status === 'ready' && next.record().manualOnly);
  assert.match(next.record().error, /图片发送状态不确定/);
  assert.equal(drafts.isBusinessDraftFinished(chatA.id, next.id), false);
  await photoBatches.at(-1).preparations[0].sendToChat(chatA, { caption: 'repeat' });
  await wait(550);
  assert.equal(nativeClicks.length, before + 1);
  assert.equal(sent.length, beforeSent + 1);
  rejectPhoto = -1;
});

test('Chinese captions reuse their prepared translation once and keep English quote text intact', async () => {
  business.productLanguage = 'zh-CN'; business.products[0].images = photos(2);
  const quote = 'Model A: 250 MXN\nModel B: 300 MXN';
  business.products[0].price = quote;
  await configure();
  const before = sent.length, beforeHistory = events.filter((event) => event.kind === 'PREPARE_OUTGOING').length;
  const next = await incoming('商品信息，价格');
  await until(() => next.record().status === 'sent');
  assert.equal(sent.length, before + 2);
  assert.ok(sent[before].body.endsWith(quote), JSON.stringify({ body: sent[before].body, reply: next.record().reply, prepared: next.record().preparedReply }));
  assert.equal(sent[before + 1].body, '');
  const originals = events.filter((event) => event.kind === 'PREPARE_OUTGOING').slice(beforeHistory);
  assert.equal(originals.length, 1);
  assert.equal(originals[0].draft.original, next.record().reply);
  assert.equal(originals[0].draft.translated, next.record().preparedReply);
  assert.equal(events.filter((event) => event.kind === 'TRANSLATE_REQUEST').length, 0);
  business.productLanguage = 'es-MX'; business.products[0].price = '250';
});

test('the automatic queue does not switch customers until every photo is confirmed', async () => {
  business.products[0].images = photos(2); await configure();
  holdLastPhoto = true; lastAcknowledgement = undefined;
  const before = nativeClicks.length;
  const first = await incoming('产品信息', chatA);
  await until(() => lastAcknowledgement);
  const next = await incoming('多久能收到', chatB);
  await until(() => next.record().status === 'queued');
  assert.equal(first.record().status, 'sending');
  assert.equal(active.id, chatA.id);
  assert.equal(nativeClicks.length, before + 1);
  lastAcknowledgement.ack = 1;
  await until(() => first.record().status === 'sent' && next.record().status === 'sent');
  assert.equal(active.id, chatB.id);
  assert.equal(nativeClicks.length, before + 2);
  holdLastPhoto = false;
});

test('closing any matched category makes a combined reply manual', async () => {
  business.autoReply.trust = false; await configure();
  const before = nativeClicks.length;
  const next = await incoming('多久能收到，交易安全吗', chatB);
  await until(() => next.record().status === 'ready' && next.record().reply);
  await wait(550);
  assert.equal(nativeClicks.length, before);
  // Simulate dismissing this manual draft before the later automatic scenarios.
  await controller.finishDraft(next.record(), 'dismissed');
  composer.textContent = '';
  composer.dispatchEvent(new window.Event('input', { bubbles: true }));
  business.autoReply.trust = true;
});

test('batch guards reject a second caption and cannot finish missing or failed attachments', () => {
  const id = 'false_111@c.us_GUARDBATCH';
  const first = {}, second = {};
  drafts.registerNativeBusinessSend(chatA.id, id, 'caption', 'caption', true, () => true, ['a', 'b']);
  drafts.armNativeBusinessSend(chatA.id, id);
  drafts.nativeBusinessSendGuard(chatA.id, id, 'caption', first)();
  assert.throws(() => drafts.nativeBusinessSendGuard(chatA.id, id, 'caption', second)(), /附件或说明已变化/);
  drafts.confirmNativeBusinessMediaAttachment(chatA.id, id, first);
  drafts.confirmNativeBusinessMediaAttachment(chatA.id, id, first);
  assert.equal(drafts.isBusinessDraftFinished(chatA.id, id), false);
  drafts.nativeBusinessSendGuard(chatA.id, id, '', second)();
  drafts.notifyBusinessDraftSendFailed(chatA.id, id, 'failed');
  assert.throws(() => drafts.nativeBusinessSendGuard(chatA.id, id, '', second)(), /已暂停或草稿已变化/);
  drafts.confirmNativeBusinessMediaAttachment(chatA.id, id, second);
  assert.equal(drafts.isBusinessDraftFinished(chatA.id, id), false);
  drafts.clearNativeBusinessSend(chatA.id, id);
});

test('one outgoing media ID cannot confirm two attachments', async () => {
  const { confirmNativeSendResult } = await server.ssrLoadModule('/src/page/native-send-result.ts');
  const ids = new Set();
  const result = { id: 'true_111@c.us_DUPLICATEPHOTO', type: 'image', caption: '', ack: 1 };
  await confirmNativeSendResult(result, chatA, chatA.id, '', true, new Set(), () => {}, ids);
  await assert.rejects(confirmNativeSendResult(result, chatA, chatA.id, '', true, new Set(), () => {}, ids), /重复返回/);
});

test('only the first saved attachment can carry the automatic caption', () => {
  const id = 'false_111@c.us_CAPTIONORDER';
  drafts.registerNativeBusinessSend(chatA.id, id, 'caption', 'caption', true, () => true, ['first', 'second']);
  const first = drafts.registerNativeBusinessMediaPreparation(chatA.id, id, {});
  const second = drafts.registerNativeBusinessMediaPreparation(chatA.id, id, {});
  drafts.armNativeBusinessSend(chatA.id, id);
  assert.throws(() => drafts.nativeBusinessSendGuard(chatA.id, id, '', first)(), /说明位置已变化/);
  assert.throws(() => drafts.nativeBusinessSendGuard(chatA.id, id, 'caption', second)(), /说明位置已变化/);
  drafts.clearNativeBusinessSend(chatA.id, id);
});

test('a media preparation invoked after cancellation retains its revoked authorization', async () => {
  active = chatA;
  const id = 'false_111@c.us_LATEMEDIA', text = 'late caption';
  drafts.registerBusinessDraft(chatA.id, text, id, 'es-MX');
  drafts.registerBusinessMediaDraft(chatA.id, id);
  drafts.registerNativeBusinessSend(chatA.id, id, text, text, true, () => true, ['late']);
  const preparation = mediaModule.prepRawMedia(new File(['test'], 'late.png', { type: 'image/png' }));
  drafts.clearNativeBusinessSend(chatA.id, id);
  const before = sent.length;
  await assert.rejects(preparation.sendToChat(chatA, { caption: text }), /已暂停或草稿已变化/);
  assert.equal(sent.length, before);
  drafts.clearBusinessDraft(chatA.id);
});

test('a switch closed during insertion cancels the task before the native button is clicked', async () => {
  const { NativeAutoReply } = await server.ssrLoadModule('/src/page/native-auto-reply.ts');
  active = chatA;
  let clicks = 0;
  const button = document.createElement('button'); button.addEventListener('click', () => clicks++);
  const control = { enabled: true, epoch: 1, token: 'cancel-token', expiresAt: Date.now() + 60_000, editorBusy: false };
  const native = new NativeAutoReply({ busy: () => '', insert: async () => native.sync({ ...control, enabled: false }),
    validateDraft() {}, isDraftInput: () => false, sendButton: () => button, authorize: async () => true, customer: () => 'test', state() {} });
  native.sync(control); offset += 6000;
  await assert.rejects(native.send({ id: 'cancel-action', messageId: 'false_111@c.us_CANCEL', chatId: chatA.id, text: 'reply', preparedReply: 'reply', draftLanguage: 'es-MX', images: [], queueToken: control.token }), /已暂停或配置已变化/);
  assert.equal(clicks, 0);
});

const commonPhrase = (id, content, enabled = true, words = ['欢迎']) => ({ id, title: `管理标题${id}`, content, enabled, language: 'es-MX', keywords: words.map((text) => ({ id: text, text, enabled: true, source: 'manual' })), updatedAt: Date.now() });

test('enabled common phrases automatically merge once per rule without any category switch', async () => {
  business.autoReply = { product: false, payment: false, shipping: false, trust: false };
  business.phrases = [commonPhrase('hello', 'Bienvenido', true, ['你好', '欢迎']), commonPhrase('help', '¿En qué puedo ayudarte?'), commonPhrase('off', 'NO ENVIAR', false)];
  await configure();
  for (let repeat = 0; repeat < 2; repeat++) {
    const before = nativeClicks.length;
    const next = await incoming('你好，欢迎', chatB);
    await until(() => next.record().status === 'sent');
    assert.deepEqual(next.record().categories, ['phrase']);
    assert.deepEqual(next.record().phraseIds, ['hello', 'help']);
    assert.equal(sent.at(-1).body, 'Bienvenido. \n\n¿En qué puedo ayudarte?');
    assert.equal(nativeClicks.length, before + 1);
    assert.equal(sent.at(-1).chatId, chatB.id);
  }
});

test('disabled common phrases never create a draft or replay an old incoming message when enabled later', async () => {
  business.phrases = [commonPhrase('disabled', 'Ya estamos disponibles', false, ['有人吗'])];
  await configure(); active = chatA;
  const before = nativeClicks.length;
  const old = await incoming('有人吗', chatB);
  await until(() => old.record().status === 'no-match');
  assert.equal(old.record().reply, undefined);
  business.phrases[0].enabled = true; await configure(); await wait(550);
  assert.equal(nativeClicks.length, before);
  assert.equal(old.record().status, 'no-match');
  const fresh = await incoming('有人吗', chatB);
  await until(() => fresh.record().status === 'sent');
  assert.equal(sent.at(-1).body, 'Ya estamos disponibles');
  assert.equal(nativeClicks.length, before + 1);
});

test('common phrases and enabled business categories share one automatic reply and one image batch', async () => {
  business.autoReply.product = true; business.autoReply.shipping = true;
  business.phrases = [commonPhrase('welcome', 'Gracias por contactarnos')];
  await configure();
  for (const [text, category, count] of [['欢迎，多久能收到', 'shipping', 1], ['欢迎，商品信息', 'product', 2]]) {
    const before = nativeClicks.length, beforeSent = sent.length;
    const next = await incoming(text, chatA);
    await until(() => next.record().status === 'sent');
    assert.deepEqual(next.record().categories, [category, 'phrase']);
    assert.equal(nativeClicks.length, before + 1);
    const messages = sent.slice(beforeSent);
    assert.equal(messages.length, count);
    assert.ok(messages[0].body.endsWith('Gracias por contactarnos'));
    assert.ok(!messages[0].body.includes('管理标题'));
    if (category === 'shipping') assert.match(messages[0].body, /Tiempo estimado/);
    else { assert.match(messages[0].body, /Modelo A/); assert.equal(messages[1].body, ''); }
  }
});

test('an incoming Hola automatically sends a phrase configured only with 你好 without incoming AI translation', async () => {
  business.autoReply = { product: false, payment: false, shipping: false, trust: false };
  business.phrases = [commonPhrase('greeting', 'Hola, ¿en qué puedo ayudarte?', true, ['你好'])];
  await configure();
  for (const greeting of ['Hola', 'Hola!', '您好']) {
    const beforeClicks = nativeClicks.length, beforeTranslations = translations.length;
    const next = await incoming(greeting, chatB);
    await until(() => next.record().status === 'sent');
    assert.deepEqual(next.record().phraseIds, ['greeting']);
    assert.equal(sent.at(-1).body, 'Hola, ¿en qué puedo ayudarte?');
    assert.equal(sent.at(-1).chatId, chatB.id);
    assert.equal(nativeClicks.length, beforeClicks + 1);
    assert.equal(translations.length, beforeTranslations);
    // Repeated collection events must never send the same incoming message twice.
    collectionCallbacks.get('add')({ id: next.id, body: greeting, t: Date.now() / 1000, isNewMsg: true });
    await wait(30);
    assert.equal(nativeClicks.length, beforeClicks + 1);
  }
});

test('Chinese greeting content still translates once and reuses the prepared reply for native Send', async () => {
  business.phrases = [{ ...commonPhrase('chinese-greeting', '您好，需要了解哪款商品？', true, ['你好']), language: 'zh-CN' }];
  await configure();
  const beforeTranslations = translations.length;
  const beforeFreshTranslations = events.filter((event) => event.kind === 'TRANSLATE_REQUEST').length;
  for (let repeat = 0; repeat < 2; repeat++) {
    const beforeClicks = nativeClicks.length;
    const beforeHistory = events.filter((event) => event.kind === 'PREPARE_OUTGOING').length;
    const next = await incoming('Hola', chatA);
    await until(() => next.record().status === 'sent');
    assert.equal(next.record().translated, '你好');
    assert.equal(next.record().reply, '您好，需要了解哪款商品？');
    assert.equal(sent.at(-1).body, 'ES 您好，需要了解哪款商品？');
    assert.equal(nativeClicks.length, beforeClicks + 1);
    const original = events.filter((event) => event.kind === 'PREPARE_OUTGOING').slice(beforeHistory)[0];
    assert.equal(original?.draft.original, next.record().reply);
    assert.equal(original?.draft.translated, next.record().preparedReply);
  }
  assert.deepEqual(translations.slice(beforeTranslations), ['您好，需要了解哪款商品？']);
  assert.equal(events.filter((event) => event.kind === 'TRANSLATE_REQUEST').length, beforeFreshTranslations);
});

test('disabled greeting keyword and disabled phrase do not send Hola or replay it after enabling', async () => {
  business.phrases[0].keywords[0].enabled = false;
  await configure();
  const before = nativeClicks.length;
  const old = await incoming('Hola', chatB);
  await until(() => old.record().status === 'no-match');
  business.phrases[0].keywords[0].enabled = true; business.phrases[0].enabled = false;
  await configure();
  const disabled = await incoming('Hola', chatB);
  await until(() => disabled.record().status === 'no-match');
  business.phrases[0].enabled = true; await configure(); await wait(550);
  assert.equal(old.record().status, 'no-match'); assert.equal(disabled.record().status, 'no-match');
  assert.equal(nativeClicks.length, before);
  const fresh = await incoming('Hola', chatB);
  await until(() => fresh.record().status === 'sent');
  assert.equal(nativeClicks.length, before + 1);
});
