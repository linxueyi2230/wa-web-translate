import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';

// Exercise BOTH real entry points, not just a mocked message observer. WhatsApp
// and Chrome's transport are fixtures; no real messages or API requests are sent.
const server = await createServer({
  configFile: false,
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null },
  appType: 'custom',
});
after(() => server.close());
const fixture = new JSDOM(`<!doctype html><body><div id="main"><footer>
  <div contenteditable="true" role="textbox" id="composer"></div>
  <button id="send" type="button">Send</button>
</footer></div></body>`, { url: 'https://web.whatsapp.com' });
after(() => fixture.window.close());
for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'CustomEvent', 'MessageEvent']) {
  globalThis[name] = name === 'window' ? fixture.window : fixture.window[name];
}
window.postMessage = (data) => queueMicrotask(() => window.dispatchEvent(
  new window.MessageEvent('message', { data: structuredClone(data), source: window }),
));
const previousInfo = console.info;
console.info = () => {};
after(() => { console.info = previousInfo; });

const requests = [];
const records = {
  config: { nativeLang: 'zh-CN', targetLang: 'en', enabled: true, provider: 'deepseek' },
};
const messageListeners = [];
globalThis.chrome = {
  storage: {
    local: {
      async get(key) { return structuredClone(key === null ? records : { [key]: records[key] }); },
      async set(patch) { Object.assign(records, structuredClone(patch)); },
      async remove(key) { delete records[key]; },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  runtime: {
    connect() {
      return {
        onMessage: { addListener(listener) { messageListeners.push(listener); } },
        onDisconnect: { addListener() {} },
        disconnect() {},
        postMessage(request) {
          requests.push(request);
          const translated = request.payload.target === 'en' ? 'Hello from send'
            : request.payload.target === 'es' ? 'Hola, amigo' : '收到的中文译文';
          queueMicrotask(() => {
            for (const listener of messageListeners) listener({
              __waTrans: true, kind: 'TRANSLATE_RESULT', id: request.id, ok: true,
              result: { translated, source: request.payload.source, target: request.payload.target },
            });
          });
        },
      };
    },
  },
};

let modernLayout = false;
let voidSend = false;
let reactOnlyLayout = false;
let modernKeys = false;
let bareDomIds = false;
const fixtureKey = (id) => modernKeys ? { $1: id, toString() { return this.$1; } } : { _serialized: id };
function messageBubble(id, text, outgoing) {
  const row = document.createElement('div');
  if (!reactOnlyLayout) row.dataset.id = bareDomIds ? id.split('_')[2] : id;
  const bubble = document.createElement('div');
  bubble.className = modernLayout ? 'x1n2onr6' : outgoing ? 'message-out' : 'message-in';
  row.setAttribute('role', 'row');
  const host = document.createElement('div');
  host.dataset.prePlainText = '[10:08] Person: ';
  const body = document.createElement('span');
  if (modernLayout) body.dataset.testid = 'selectable-text';
  else body.className = 'selectable-text';
  body.textContent = text;
  if (reactOnlyLayout || modernKeys) {
    body.__reactFiber$fixture = { memoizedProps: {}, return: {
      memoizedProps: { msg: { id: fixtureKey(id), body: text } }, return: null,
    } };
  }
  host.appendChild(body);
  bubble.appendChild(host);
  row.appendChild(bubble);
  document.querySelector('#main').insertBefore(row, document.querySelector('footer'));
  return bubble;
}

const chat = { id: { _serialized: '123@c.us' }, msgs: { models: [] } };
const sentBodies = [];
const sendModule = {
  async sendTextMsgToChat(_chat, body) {
    sentBodies.push(body);
    const id = `true_123@c.us_${modernKeys ? '3EB0123456789ABCSEND' : 'SEND'}${sentBodies.length}`;
    const model = { id: fixtureKey(id), body };
    if (voidSend) {
      setTimeout(() => messageBubble(id, body, true), 80);
      return; // Same behavior as the user's "send result has no message ID" log.
    }
    chat.msgs.models.push(model);
    messageBubble(id, body, true);
    return model;
  },
};
const originalSend = sendModule.sendTextMsgToChat;
window.require = (name) => name === 'WAWebSendTextMsgChatAction' ? sendModule
  : name === 'WAWebChatCollection' ? { ChatCollection: { getActive: () => chat } } : null;
window.Debug = { VERSION: '2.3000' };

const composer = document.getElementById('composer');
let sending;
// These handlers simulate WA's EXISTING controls, not extension-added controls.
const send = () => {
  sending = sendModule.sendTextMsgToChat(chat, composer.textContent, {}).then(() => {
    composer.textContent = '';
  });
};
document.getElementById('send').addEventListener('click', send);
composer.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) send();
});
await server.ssrLoadModule('/src/content/index.ts');
await server.ssrLoadModule('/src/page/index.ts');

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await wait(); }
  assert.fail('timed out waiting for fixture');
}
function type(text) {
  composer.textContent = text;
  composer.dispatchEvent(new window.Event('input', { bubbles: true }));
}
function checkAppearance(bubble, text, kind) {
  const local = bubble.querySelector('[data-wa-trans-local]');
  assert.equal(local.dataset.kind, kind);
  assert.equal(local.querySelector('.wa-translate-message-body').textContent, text);
  assert.equal(local.querySelector('.wa-translate-message-label'), null);
  assert.equal(local.children.length, 1);
  const style = window.getComputedStyle(local);
  assert.equal(style.color, 'rgb(128, 0, 32)');
  assert.equal(style.borderTopStyle, 'solid');
  assert.equal(style.borderTopWidth, '1px');
  assert.equal(document.querySelector('#wa-translate-draft-host, .wa-translate-draft'), null);
}

test('typing produces zero requests and no popup; Enter translates once and decorates only the sent bubble', async () => {
  await until(() => sendModule.sendTextMsgToChat !== originalSend);
  for (const text of ['你', '你好', '你好呀', '你好']) {
    type(text);
    await wait(100);
  }
  await wait(600); // Longer than the old 350 ms preview debounce.
  assert.equal(requests.length, 0);
  assert.equal(document.querySelector('#wa-translate-draft-host, .wa-translate-draft'), null);
  composer.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sending;
  const bubble = document.querySelector('.message-out');
  await until(() => bubble.querySelector('[data-kind="original"]'));
  assert.equal(requests.length, 1);
  assert.deepEqual(sentBodies, ['Hello from send']);
  assert.equal(bubble.querySelector('.selectable-text').textContent, 'Hello from send');
  checkAppearance(bubble, '你好', 'original');
});

test('the existing send button also translates once, without reintroducing an input preview', async () => {
  const before = requests.length;
  type('第二条中文');
  await wait(450);
  assert.equal(requests.length, before);
  document.getElementById('send').click();
  await sending;
  const bubble = Array.from(document.querySelectorAll('.message-out')).at(-1);
  await until(() => bubble.querySelector('[data-kind="original"]'));
  assert.equal(requests.length, before + 1);
  checkAppearance(bubble, '第二条中文', 'original');
});

test('incoming translation appears under a solid divider in wine red, with no visible heading or screenshot annotations', async () => {
  const before = requests.length;
  const bubble = messageBubble('false_123@c.us_RECEIVE', 'Hello from the other person', false);
  await until(() => bubble.querySelector('[data-kind="translation"]'));
  assert.equal(requests.length, before + 1);
  assert.equal(bubble.querySelector('.selectable-text').textContent, 'Hello from the other person');
  checkAppearance(bubble, '收到的中文译文', 'translation');
  assert.equal(bubble.textContent.includes('自动翻译'), false);
  assert.equal(bubble.textContent.includes('点击按钮翻译'), false);
  type('输入时不重复翻译历史');
  await wait(450);
  assert.equal(requests.length, before + 1);
});

test('void send + delayed classless Spanish message displays the exact saved Chinese below it without another API request', async () => {
  const { DEFAULT_CONFIG } = await server.ssrLoadModule('/src/shared/types.ts');
  window.postMessage({ __waTransStore: true, kind: 'STORE_PUSH',
    config: { ...DEFAULT_CONFIG, ...records.config, targetLang: 'es' } }, '*');
  await wait();
  const before = requests.length;
  modernLayout = true;
  voidSend = true;
  type('你好呀');
  document.getElementById('send').click();
  await sending;
  await until(() => document.querySelector('[data-id="true_123@c.us_SEND3"] [data-kind="original"]'));
  const row = document.querySelector('[data-id="true_123@c.us_SEND3"]');
  assert.equal(requests.length, before + 1);
  assert.equal(requests.at(-1).payload.target, 'es');
  assert.equal(sentBodies.at(-1), 'Hola, amigo');
  assert.equal(row.querySelector('[data-testid="selectable-text"]').textContent, 'Hola, amigo');
  checkAppearance(row, '你好呀', 'original');
  // Recycle the DOM row and restore from the message-ID cache without using AI.
  row.remove();
  const restored = messageBubble('true_123@c.us_SEND3', 'Hola, amigo', true);
  await until(() => restored.querySelector('[data-kind="original"]'));
  checkAppearance(restored, '你好呀', 'original');
  assert.equal(requests.length, before + 1);
});

test('void send with no DOM message IDs recovers the original through the page metadata bridge', async () => {
  const before = requests.length;
  reactOnlyLayout = true;
  modernLayout = true;
  voidSend = true;
  type('这次显示原文');
  await wait(150);
  assert.equal(requests.length, before);
  document.getElementById('send').click();
  await sending;
  const selector = '[data-wa-trans-message-id="true_123@c.us_SEND4"]';
  await until(() => document.querySelector(selector)?.parentElement.querySelector('[data-kind="original"]'));
  const body = document.querySelector(selector);
  const host = body.parentElement;
  assert.equal(host.closest('[data-id]'), null);
  assert.equal(body.textContent, 'Hola, amigo');
  checkAppearance(host, '这次显示原文', 'original');
  assert.equal(sentBodies.at(-1), 'Hola, amigo');
  assert.equal(requests.length, before + 1);

  host.parentElement.parentElement.remove();
  const restored = messageBubble('true_123@c.us_SEND4', 'Hola, amigo', true);
  await until(() => restored.querySelector('[data-kind="original"]'));
  checkAppearance(restored, '这次显示原文', 'original');
  assert.equal(requests.length, before + 1);
});

test('current WA key format: bare DOM stanza and toString-only keys bind and display exact Chinese with one request', async () => {
  const before = requests.length;
  modernKeys = true;
  bareDomIds = true;
  reactOnlyLayout = false;
  modernLayout = true;
  voidSend = false;
  chat.id = fixtureKey('123@c.us');
  type('这次是新版本格式');
  document.getElementById('send').click();
  await sending;
  const selector = '[data-id="3EB0123456789ABCSEND5"]';
  await until(() => document.querySelector(selector)?.querySelector('[data-kind="original"]'));
  const row = document.querySelector(selector);
  checkAppearance(row, '这次是新版本格式', 'original');
  assert.equal(row.querySelector('[data-testid="selectable-text"]').textContent, 'Hola, amigo');
  assert.equal(requests.length, before + 1);
  assert.equal(Object.hasOwn(chat.id, '_serialized'), false);
  assert.equal(Object.hasOwn(chat.msgs.models.at(-1).id, '_serialized'), false);
  row.remove();
  const restored = messageBubble('true_123@c.us_3EB0123456789ABCSEND5', 'Hola, amigo', true);
  await until(() => restored.querySelector('[data-kind="original"]'));
  checkAppearance(restored, '这次是新版本格式', 'original');
  assert.equal(requests.length, before + 1);
});
