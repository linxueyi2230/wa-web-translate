import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';

const server = await createServer({
  configFile: false,
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  // Use an unstarted server for Vite's HMR transport: no network/listening ports.
  server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null },
  appType: 'custom',
});
after(() => server.close());
const originalInfo = console.info;
console.info = () => {};
after(() => { console.info = originalInfo; });
const { MessageTranslations, readBubble } = await server.ssrLoadModule('/src/content/message-translations.ts');
const { HistoryStorage } = await server.ssrLoadModule('/src/content/history-storage.ts');
const { DEFAULT_CONFIG } = await server.ssrLoadModule('/src/shared/types.ts');
const { matchesPending, translationContext, HISTORY_TAG } = await server.ssrLoadModule('/src/shared/message-history.ts');
const { installMessageMetadata, syncMessageMetadata } = await server.ssrLoadModule('/src/page/message-metadata.ts');
const { messageDomDiagnostics } = await server.ssrLoadModule('/src/shared/message-dom.ts');
const { chatKey, messageKey, modelField } = await server.ssrLoadModule('/src/shared/whatsapp-keys.ts');
const config = { ...DEFAULT_CONFIG, nativeLang: 'zh-CN', targetLang: 'en' };
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await wait(); }
  assert.fail('timed out waiting for fixture');
}

function area() {
  const records = {};
  return {
    records,
    async get(key) {
      return structuredClone(key === null ? records : { [key]: records[key] });
    },
    async set(patch) { Object.assign(records, structuredClone(patch)); },
    async remove(key) { delete records[key]; },
  };
}

function dom(t) {
  const fixture = new JSDOM('<body><div id="main"></div></body>', { url: 'https://web.whatsapp.com' });
  for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'CustomEvent', 'MessageEvent']) {
    globalThis[name] = name === 'window' ? fixture.window : fixture.window[name];
  }
  // Browser postMessage has source===window. jsdom omits it by default.
  fixture.window.postMessage = (data) => queueMicrotask(() => fixture.window.dispatchEvent(
    new fixture.window.MessageEvent('message', { data: structuredClone(data), source: fixture.window }),
  ));
  t.after(() => fixture.window.close());
  return fixture.window;
}

function bubble(id, text, outgoing = false) {
  const row = document.createElement('div');
  row.dataset.id = id;
  const node = document.createElement('div');
  node.className = outgoing ? 'message-out' : 'message-in';
  const host = document.createElement('div');
  host.className = 'copyable-text';
  host.dataset.prePlainText = '[12:00] Person: ';
  const body = document.createElement('span');
  body.className = 'selectable-text';
  body.textContent = text;
  host.appendChild(body);
  node.appendChild(host);
  row.appendChild(node);
  document.querySelector('#main').appendChild(row);
  return { row, node, host, body };
}

function engine(t, translate, storage = area()) {
  const instance = new MessageTranslations(translate, new HistoryStorage(storage));
  instance.setConfig(config);
  instance.start();
  t.after(() => instance.stop());
  return { instance, storage };
}

function draft(patch = {}) {
  return {
    token: 'draft-1', chatId: '123@c.us', original: '你好吗？', translated: 'How are you?',
    source: 'zh-CN', target: 'en', createdAt: Date.now(), ...patch,
  };
}

async function historyRequest(kind, payload) {
  const id = Math.random().toString();
  const promise = new Promise((resolve, reject) => {
    const handler = (event) => {
      if (event.data?.kind !== 'HISTORY_RESULT' || event.data.id !== id) return;
      window.removeEventListener('message', handler);
      if (event.data.ok) resolve();
      else reject(new Error(event.data.error));
    };
    window.addEventListener('message', handler);
  });
  window.postMessage({ [HISTORY_TAG]: true, kind, id, ...payload }, '*');
  return promise;
}

test('pending matching never attaches an original to an old, incoming or different-chat message', () => {
  const pending = { ...draft(), baselineIds: ['true_123@c.us_OLD'] };
  assert.equal(matchesPending(pending, 'true_123@c.us_NEW', 'How are you?'), true);
  assert.equal(matchesPending(pending, 'true_123@s.whatsapp.net_NEW', 'How are you?'), true);
  for (const id of ['true_123@c.us_OLD', 'false_123@c.us_NEW', 'true_456@c.us_NEW', 'bad-id']) {
    assert.equal(matchesPending(pending, id, 'How are you?'), false);
  }
  assert.equal(matchesPending(pending, 'true_123@c.us_NEW', 'How are you?', pending.createdAt + 600_000), false);
});

test('modern minified MsgKey/Wid serialization is read without mutating WhatsApp objects', () => {
  const key = { $1: 'true_123@lid_3EB0123456789ABC', toString() { return this.$1; } };
  const wid = { $1: '123@s.whatsapp.net', toString() { return this.$1; } };
  assert.equal(messageKey(key), key.$1);
  assert.equal(chatKey(wid), '123@c.us');
  assert.equal(Object.hasOwn(key, '_serialized'), false);
  assert.equal(modelField({ attributes: { id: key } }, 'id'), key);
  assert.equal(modelField({ get(name) { return name === 'id' ? key : undefined; } }, 'id'), key);
  assert.equal(messageKey({ fromMe: true, remote: wid, id: '3EB0123456789ABC' }), 'true_123@c.us_3EB0123456789ABC');
  assert.equal(messageKey({ get _serialized() { throw Error('old getter'); }, toString() { return key.$1; } }), key.$1);
  for (const bad of ['3EB0123456789ABC', {}, { toString() { return '[object Object]'; } }, { toString() { throw Error('unsupported'); } }]) {
    assert.equal(messageKey(bad), null);
  }
});

test('bare DOM stanza + modern toString-only React key shows originals and cached incoming translations', async (t) => {
  dom(t);
  t.after(installMessageMetadata());
  let calls = 0;
  const { instance, storage } = engine(t, async () => {
    calls++;
    return { translated: '收到的新格式消息', source: 'en', target: 'zh-CN' };
  });
  await historyRequest('PREPARE_OUTGOING', { draft: draft() });
  await historyRequest('SENT_OUTGOING', { token: 'draft-1', messageId: null });
  const outgoing = bubble('3EB0123456789ABC', 'How are you?', true);
  outgoing.node.className = 'x-new-build';
  const key = { $1: 'true_123@c.us_3EB0123456789ABC', toString() { return this.$1; } };
  outgoing.body.__reactFiber$fixture = { memoizedProps: {}, return: {
    memoizedProps: { renamedMessageProp: { attributes: { id: key, body: 'How are you?' } } }, return: null,
  } };
  instance.scan();
  await until(() => outgoing.node.querySelector('[data-kind="original"]'));
  assert.equal(calls, 0);
  assert.equal(outgoing.node.querySelector('.wa-translate-message-body').textContent, '你好吗？');
  assert.equal(Object.hasOwn(key, '_serialized'), false);
  assert.deepEqual(messageDomDiagnostics().idFormats, { serialized: 0, stanza: 1, other: 0 });
  assert.deepEqual(messageDomDiagnostics().idShapes, ['X']);

  const incoming = bubble('3EBFEDCBA9876543', 'Hello', false);
  incoming.body.__reactProps$fixture = { message: { id: {
    $1: 'false_123@c.us_3EBFEDCBA9876543', toString() { return this.$1; },
  }, body: 'Hello' } };
  await until(() => incoming.node.querySelector('[data-kind="translation"]'));
  assert.equal(calls, 1);
  assert.equal(incoming.body.textContent, 'Hello');
  instance.stop();
  engine(t, async () => assert.fail('cached local text must survive refresh'), storage).instance.scan();
  await until(() => incoming.node.querySelector('[data-kind="translation"]'));
  assert.equal(outgoing.node.querySelector('.wa-translate-message-body').textContent, '你好吗？');
});

test('bare IDs require a matching message model or explicit direction and a model-backed active chat', (t) => {
  dom(t);
  const item = bubble('3EB0123456789ABC', 'How are you?', true);
  const active = { id: { toString: () => '123@lid' } };
  window.require = (name) => name === 'WAWebChatCollection' ? { ChatCollection: { getActive: () => active } } : null;
  syncMessageMetadata();
  assert.equal(item.body.dataset.waTransMessageId, 'true_123@lid_3EB0123456789ABC');
  window.require = () => null;
  syncMessageMetadata();
  assert.equal(item.body.hasAttribute('data-wa-trans-message-id'), false);
  item.body.__reactProps$fixture = { msg: { id: { toString: () => 'true_123@lid_3EB9999999999999' }, body: 'How are you?' } };
  syncMessageMetadata();
  assert.equal(item.body.hasAttribute('data-wa-trans-message-id'), false); // Equal words are not an identity match.
});

test('incoming annotations persist across page reload; original message text is unchanged', async (t) => {
  dom(t);
  let calls = 0;
  const { instance, storage } = engine(t, async () => { calls++; return { translated: '你好', target: 'zh-CN', source: 'en' }; });
  const first = bubble('false_123@c.us_A', 'Hello');
  instance.scan();
  await until(() => first.node.querySelector('.wa-translate-message-body')?.textContent === '你好');
  assert.equal(first.body.textContent, 'Hello');
  assert.equal(first.node.querySelectorAll('[data-wa-trans-local]').length, 1);
  await wait(250); // Our own DOM mutations must not cause more translations.
  assert.equal(calls, 1);
  instance.stop();
  const next = engine(t, async () => { assert.fail('cached history must not call the provider'); }, storage).instance;
  next.scan();
  await until(() => first.node.querySelector('.wa-translate-message-body')?.textContent === '你好');
});

test('sent bubbles recover EXACT input, not a reverse translation, including repeated texts', async (t) => {
  dom(t);
  const old = bubble('true_123@c.us_OLD', 'How are you?', true);
  const { instance, storage } = engine(t, async () => ({ translated: '你怎么样？', source: 'en', target: 'zh-CN' }));
  await historyRequest('PREPARE_OUTGOING', { draft: draft() });
  await historyRequest('SENT_OUTGOING', { token: 'draft-1', messageId: null });
  const first = bubble('true_123@c.us_NEW1', 'How are you?', true);
  instance.scan();
  await until(() => first.node.querySelector('.wa-translate-message-body')?.textContent === '你好吗？');
  assert.equal(old.body.textContent, 'How are you?');
  await historyRequest('PREPARE_OUTGOING', { draft: draft({ token: 'draft-2', original: '最近怎么样？' }) });
  await historyRequest('SENT_OUTGOING', { token: 'draft-2', messageId: null });
  const second = bubble('true_123@c.us_NEW2', 'How are you?', true);
  instance.scan();
  await until(() => second.node.querySelector('.wa-translate-message-body')?.textContent === '最近怎么样？');
  instance.stop();
  engine(t, async () => assert.fail('original must be restored without provider'), storage).instance.scan();
  await until(() => second.node.querySelector('.wa-translate-message-body')?.textContent === '最近怎么样？');
  assert.equal(first.node.querySelector('.wa-translate-message-body').textContent, '你好吗？');
  assert.match(first.node.querySelector('[data-wa-trans-local]').getAttribute('aria-label'), /原文/);
  assert.equal(first.node.querySelector('.wa-translate-message-label'), null);
});

test('sent model ID binds originals even when that chat is not mounted', async (t) => {
  dom(t);
  const { instance, storage } = engine(t, async () => assert.fail('must use saved original'));
  await historyRequest('PREPARE_OUTGOING', { draft: draft() });
  await historyRequest('BIND_OUTGOING', { token: 'draft-1', messageId: 'true_123@c.us_HIDDEN' });
  instance.stop();
  const message = bubble('true_123@c.us_HIDDEN', 'How are you?', true);
  const reload = engine(t, async () => assert.fail('must use saved original'), storage).instance;
  reload.scan();
  await until(() => message.node.querySelector('.wa-translate-message-body')?.textContent === '你好吗？');
});

for (const layout of ['no-legacy-class', 'text-testid', 'outer-copyable-host', 'alternate-chat-root', 'directional-body', 'non-message-data-id', 'alternate-key-attribute', 'empty-main']) {
  test(`send without a returned ID still shows the saved original: ${layout}`, async (t) => {
    dom(t);
    const { instance } = engine(t, async () => assert.fail('saved input must not be reverse-translated'));
    const main = document.getElementById('main');
    if (layout === 'alternate-chat-root' || layout === 'empty-main') {
      main.removeAttribute('id');
      main.dataset.testid = 'conversation-panel-messages';
      if (layout === 'empty-main') {
        const staleMain = document.createElement('div');
        staleMain.id = 'main';
        staleMain.innerHTML = '<footer><div contenteditable="true" class="selectable-text">draft, not history</div></footer>';
        document.body.prepend(staleMain);
      }
    }
    await historyRequest('PREPARE_OUTGOING', { draft: draft() });
    await historyRequest('SENT_OUTGOING', { token: 'draft-1', messageId: null });
    const row = document.createElement('div');
    row.dataset.id = 'true_123@c.us_COMPAT';
    if (layout === 'alternate-key-attribute') {
      delete row.dataset.id;
      row.dataset.messageId = 'true_123@c.us_COMPAT';
    }
    row.setAttribute('role', 'row');
    const cssClass = layout === 'no-legacy-class' ? 'x1n2onr6' : 'message-out';
    const marker = layout === 'text-testid' ? 'data-testid="selectable-text"'
      : layout === 'directional-body' ? 'dir="auto"' : 'class="selectable-text"';
    row.innerHTML = layout === 'outer-copyable-host'
      ? `<div class="copyable-text" data-pre-plain-text="[12:00] Person: "><div class="${cssClass}"><span ${marker}>How are you?</span></div></div>`
      : `<div class="${cssClass}"><div class="copyable-text" data-pre-plain-text="[12:00] Person: "><span ${marker}>How are you?</span></div></div>`;
    if (layout === 'non-message-data-id') row.querySelector('.copyable-text').dataset.id = 'not-a-message-key';
    main.appendChild(row);
    instance.scan();
    await until(() => row.querySelector('[data-kind="original"]'));
    assert.equal(row.querySelector('.wa-translate-message-body').textContent, '你好吗？');
    assert.equal(row.querySelectorAll('[data-wa-trans-local]').length, 1);
    assert.equal(row.querySelector('.selectable-text, [data-testid="selectable-text"], span[dir="auto"]').textContent, 'How are you?');
  });
}

test('React-backed outgoing and incoming bubbles without DOM IDs get stable local annotations', async (t) => {
  dom(t);
  t.after(installMessageMetadata());
  let calls = 0;
  const { instance, storage } = engine(t, async () => {
    calls++;
    return { translated: '收到的中文', source: 'en', target: 'zh-CN' };
  });
  await historyRequest('PREPARE_OUTGOING', { draft: draft() });
  await historyRequest('SENT_OUTGOING', { token: 'draft-1', messageId: null });
  const sent = bubble('true_123@c.us_FIBER', 'How are you?', true);
  delete sent.row.dataset.id;
  sent.node.className = 'x-message';
  sent.body.__reactFiber$fixture = { memoizedProps: {}, return: {
    memoizedProps: { msg: { id: { _serialized: 'true_123@c.us_FIBER' }, body: 'How are you?' } }, return: null,
  } };
  assert.equal(messageDomDiagnostics().dataIdNodes, 0);
  await until(() => sent.node.querySelector('[data-kind="original"]'));
  assert.equal(calls, 0);
  assert.equal(sent.node.querySelector('.wa-translate-message-body').textContent, '你好吗？');
  assert.equal(sent.body.textContent, 'How are you?');
  assert.equal(sent.body.dataset.waTransMessageId, 'true_123@c.us_FIBER');

  const received = bubble('false_123@c.us_PROPS', 'Hello', false);
  delete received.row.dataset.id;
  received.host.__reactProps$fixture = { message: { id: { _serialized: 'false_123@c.us_PROPS' }, body: 'Hello' } };
  await until(() => received.node.querySelector('[data-kind="translation"]'));
  assert.equal(calls, 1);
  assert.equal(received.body.textContent, 'Hello');
  assert.equal(received.node.querySelector('.wa-translate-message-body').textContent, '收到的中文');

  instance.stop();
  engine(t, async () => assert.fail('persisted messages must not call AI again'), storage).instance.scan();
  await until(() => received.node.querySelector('[data-kind="translation"]'));
  assert.equal(sent.node.querySelector('.wa-translate-message-body').textContent, '你好吗？');
});

test('React metadata never invents a key for mismatched text, quoted snippets or composer', (t) => {
  dom(t);
  const item = bubble('true_123@c.us_OLD', 'Different text', true);
  delete item.row.dataset.id;
  item.body.__reactProps$fixture = { msg: { id: { _serialized: 'true_123@c.us_OLD' }, body: 'How are you?' } };
  syncMessageMetadata();
  assert.equal(item.body.hasAttribute('data-wa-trans-message-id'), false);
  item.body.textContent = 'How are you?';
  syncMessageMetadata();
  assert.equal(item.body.dataset.waTransMessageId, 'true_123@c.us_OLD');
  item.body.__reactProps$fixture.msg = undefined; // A recycled row no longer owns that message.
  syncMessageMetadata();
  assert.equal(item.body.hasAttribute('data-wa-trans-message-id'), false);

  item.body.__reactProps$fixture = { msg: { id: { _serialized: 'true_123@c.us_QUOTE' }, body: 'How are you?' } };
  item.host.dataset.testid = 'quoted-message';
  const composer = document.createElement('div');
  composer.setAttribute('contenteditable', 'true');
  composer.className = 'selectable-text';
  composer.textContent = 'How are you?';
  composer.__reactProps$fixture = item.body.__reactProps$fixture;
  document.getElementById('main').appendChild(composer);
  syncMessageMetadata();
  assert.equal(item.body.hasAttribute('data-wa-trans-message-id'), false);
  assert.equal(composer.hasAttribute('data-wa-trans-message-id'), false);
});

test('scroll refreshes React identity when a virtualized row is recycled with identical text', async (t) => {
  dom(t);
  const item = bubble('true_123@c.us_OLD', 'Same words', true);
  delete item.row.dataset.id;
  const model = { id: { _serialized: 'true_123@c.us_OLD' }, body: 'Same words' };
  item.body.__reactProps$fixture = { msg: model };
  t.after(installMessageMetadata());
  assert.equal(item.body.dataset.waTransMessageId, 'true_123@c.us_OLD');
  model.id._serialized = 'true_123@c.us_NEW'; // No DOM text/class/key mutation.
  window.dispatchEvent(new window.Event('scroll'));
  await until(() => item.body.dataset.waTransMessageId === 'true_123@c.us_NEW');
});

test('equal translated texts wait for exact send IDs rather than swapping two originals', async (t) => {
  dom(t);
  const { instance } = engine(t, async () => assert.fail('pending sends must not be reverse-translated'));
  await historyRequest('PREPARE_OUTGOING', { draft: draft() });
  await historyRequest('PREPARE_OUTGOING', { draft: draft({ token: 'second', original: '最近怎么样？' }) });
  const firstRow = bubble('true_123@c.us_FIRST', 'How are you?', true);
  const secondRow = bubble('true_123@c.us_SECOND', 'How are you?', true);
  instance.scan();
  await until(() => secondRow.node.querySelector('.wa-translate-message-body')?.textContent === '正在关联发送记录…');
  // Resolve the second send first, and deliberately reverse the DOM text-match order.
  await historyRequest('SENT_OUTGOING', { token: 'second', messageId: 'true_123@c.us_FIRST' });
  await historyRequest('SENT_OUTGOING', { token: 'draft-1', messageId: 'true_123@c.us_SECOND' });
  instance.scan();
  await until(() => secondRow.node.querySelector('.wa-translate-message-body')?.textContent === '你好吗？');
  assert.equal(firstRow.node.querySelector('.wa-translate-message-body').textContent, '最近怎么样？');
});

test('virtualized rerenders share an in-flight translation and append only one local row', async (t) => {
  dom(t);
  let calls = 0;
  let resolve;
  const { instance } = engine(t, async () => { calls++; return new Promise((done) => { resolve = done; }); });
  const old = bubble('false_123@c.us_RERENDER', 'Hello');
  instance.scan();
  await until(() => resolve);
  old.row.remove();
  const replacement = bubble('false_123@c.us_RERENDER', 'Hello');
  instance.scan();
  await wait(50);
  assert.equal(calls, 1);
  resolve({ translated: '你好', target: 'zh-CN', source: 'en' });
  await until(() => replacement.node.querySelector('.wa-translate-message-body')?.textContent === '你好');
  assert.equal(replacement.node.querySelectorAll('[data-wa-trans-local]').length, 1);
});

test('offscreen history waits until scrolling into view before calling the provider', async (t) => {
  dom(t);
  let calls = 0;
  const { instance } = engine(t, async () => { calls++; return { translated: '你好', source: 'en', target: 'zh-CN' }; });
  const message = bubble('false_123@c.us_OFFSCREEN', 'Hello');
  message.node.getBoundingClientRect = message.row.getBoundingClientRect = () => ({ top: 10000, bottom: 10100 });
  instance.scan();
  await wait(150);
  assert.equal(calls, 0);
  message.node.getBoundingClientRect = message.row.getBoundingClientRect = () => ({ top: 100, bottom: 200 });
  window.dispatchEvent(new window.Event('scroll'));
  await until(() => message.node.querySelector('.wa-translate-message-body')?.textContent === '你好');
  assert.equal(calls, 1);
});

test('quotes are excluded, emoji/multiline captions are preserved, and annotations are not re-read', (t) => {
  dom(t);
  const message = bubble('false_123@c.us_CAPTION', '');
  const quote = document.createElement('div');
  quote.dataset.testid = 'quoted-message';
  quote.innerHTML = '<span class="selectable-text">do not translate this quote</span>';
  message.node.prepend(quote);
  message.body.innerHTML = 'Hello<br>world<img alt="😊">';
  const local = document.createElement('div');
  local.dataset.waTransLocal = 'true';
  local.innerHTML = '<span class="selectable-text">not message text</span>';
  message.host.appendChild(local);
  assert.equal(readBubble(message.node).text, 'Hello\nworld😊');
});

test('edited text invalidates the cache and recycled DOM cannot receive a stale response', async (t) => {
  dom(t);
  let resolveFirst;
  let calls = 0;
  const { instance } = engine(t, async () => {
    calls++;
    if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
    return { translated: '新消息', source: 'en', target: 'zh-CN' };
  });
  const message = bubble('false_123@c.us_ONE', 'first');
  instance.scan();
  await until(() => resolveFirst);
  message.row.dataset.id = 'false_123@c.us_TWO';
  message.body.textContent = 'second';
  instance.scan();
  await until(() => message.node.querySelector('.wa-translate-message-body')?.textContent === '新消息');
  resolveFirst({ translated: '旧消息', source: 'en', target: 'zh-CN' });
  await wait(100);
  assert.equal(message.node.querySelector('.wa-translate-message-body').textContent, '新消息');
  message.body.textContent = 'edited second';
  instance.scan();
  await until(() => calls === 3);
});

test('changing native language invalidates translations; disabling removes local UI', async (t) => {
  dom(t);
  let calls = 0;
  const { instance } = engine(t, async ({ target }) => {
    calls++;
    return { translated: target === 'zh-CN' ? '中文' : '日本語', target, source: 'en' };
  });
  const message = bubble('false_123@c.us_CONFIG', 'Hello');
  instance.scan();
  await until(() => message.node.querySelector('.wa-translate-message-body')?.textContent === '中文');
  instance.setConfig({ ...config, nativeLang: 'ja' });
  instance.scan();
  await until(() => message.node.querySelector('.wa-translate-message-body')?.textContent === '日本語');
  assert.equal(calls, 2);
  instance.setConfig({ ...config, enabled: false });
  assert.equal(message.node.querySelector('[data-wa-trans-local]'), null);
  assert.equal(message.body.textContent, 'Hello');
});

test('a failed translation retries only on user action, never on every DOM render', async (t) => {
  dom(t);
  let calls = 0;
  const { instance } = engine(t, async () => {
    calls++;
    if (calls === 1) throw new Error('mock HTTP 429');
    return { translated: '重试成功', target: 'zh-CN', source: 'en' };
  });
  const message = bubble('false_123@c.us_RETRY', 'Hello');
  instance.scan();
  await until(() => message.node.querySelector('button'));
  for (let i = 0; i < 10; i++) instance.scan();
  assert.equal(calls, 1);
  message.node.querySelector('button').click();
  await until(() => message.node.querySelector('.wa-translate-message-body')?.textContent === '重试成功');
  assert.equal(calls, 2);
});

test('local annotation uses textContent, never executes HTML from a provider', async (t) => {
  dom(t);
  const unsafe = '<img src=x onerror="alert(1)"><script>bad()</script>';
  const { instance } = engine(t, async () => ({ translated: unsafe, source: 'en', target: 'zh-CN' }));
  const message = bubble('false_123@c.us_HTML', 'Hello');
  instance.scan();
  await until(() => message.node.querySelector('.wa-translate-message-body')?.textContent === unsafe);
  assert.equal(message.node.querySelector('[data-wa-trans-local] img'), null);
  assert.equal(message.node.querySelector('[data-wa-trans-local] script'), null);
});

test('per-record storage retains concurrent writes and invalidates edited sent originals', async () => {
  const storage = area();
  const repository = new HistoryStorage(storage);
  const context = translationContext(config);
  const record = (messageId) => ({ messageId, context, text: 'hello', translated: '你好', target: 'zh-CN', createdAt: Date.now() });
  await Promise.all([repository.saveTranslation(record('A')), repository.saveTranslation(record('B'))]);
  assert.equal((await repository.translation('A', 'hello', context)).translated, '你好');
  assert.equal((await repository.translation('B', 'hello', context)).translated, '你好');
  assert.equal(await repository.translation('A', 'edited', context), null);
  await repository.bind({ ...draft(), baselineIds: [], ready: true }, 'true_123@c.us_EDIT');
  assert.equal(await repository.original('true_123@c.us_EDIT', 'edited text'), null);
});

test('chat IDs never fall back to duplicate display names', async (t) => {
  dom(t);
  document.body.insertAdjacentHTML('afterbegin', '<div contenteditable="true" role="textbox" id="search"></div>');
  document.querySelector('#main').innerHTML = '<header><span title="Same display name"></span></header><div contenteditable="true" role="textbox" id="composer"></div>';
  const { getActiveChatIdFromDom } = await server.ssrLoadModule('/src/page/wa.ts');
  assert.equal(getActiveChatIdFromDom(), null);
  bubble('false_123@s.whatsapp.net_DOM', 'Hello');
  assert.equal(getActiveChatIdFromDom(), '123@c.us');
});

test('send hook sends only the translation, saves input, and never hooks its nested fallback', async (t) => {
  dom(t);
  let calls = 0;
  let sentBody;
  let translationFails = false;
  let sendFails = false;
  let origCalls = 0;
  const chat = { id: { _serialized: '123@c.us' }, msgs: { models: [] } };
  const model = { id: { _serialized: 'true_123@c.us_SEND' }, body: 'How are you?' };
  const module = {
    async sendTextMsgToChat(...args) { return module.addAndSendTextMsg(...args); },
    async addAndSendTextMsg(_chat, body) {
      origCalls++;
      sentBody = body;
      if (sendFails) throw new Error('mock queued send rejection');
      chat.msgs.models.push(model);
      return [model, Promise.resolve()];
    },
  };
  window.require = (name) => name === 'WAWebSendTextMsgChatAction' ? module : null;
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data?.kind === 'TRANSLATE_REQUEST') {
      calls++;
      window.postMessage({ __waTrans: true, kind: 'TRANSLATE_RESULT', id: data.id, ok: !translationFails,
        result: { translated: 'How are you?', source: 'zh-CN', target: 'en' }, error: 'mock provider failure' }, '*');
    }
  });
  const { storage } = engine(t, async () => assert.fail('not mounted'));
  const { installSendHook } = await server.ssrLoadModule('/src/page/hooks/send.ts');
  window.postMessage({ __waTransStore: true, kind: 'STORE_PUSH', config: { ...config, sendBoth: true } }, '*');
  await wait();
  const installed = installSendHook();
  assert.equal(installed.length, 1);
  const result = await module.sendTextMsgToChat(chat, '你好吗？', {});
  assert.equal(result[0], model);
  assert.equal(sentBody, 'How are you?');
  assert.equal(calls, 1);
  assert.equal((await new HistoryStorage(storage).original(model.id._serialized, model.body)).original, '你好吗？');
  // Translation failure must not silently send the original.
  translationFails = true;
  sentBody = undefined;
  await assert.rejects(module.sendTextMsgToChat(chat, '第二条', {}), /provider failure/);
  assert.equal(sentBody, undefined);
  translationFails = false;
  sendFails = true;
  await assert.rejects(module.sendTextMsgToChat(chat, '第三条', {}), /send rejection/);
  assert.equal(origCalls, 2); // Only one call to WhatsApp even when orig rejects.
  sendFails = false;
  storage.set = async () => { throw new Error('mock local storage quota exceeded'); };
  sentBody = undefined;
  await assert.rejects(module.sendTextMsgToChat(chat, '第二条', {}), /quota/);
  assert.equal(sentBody, undefined);
});
