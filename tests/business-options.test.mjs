import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';

const fixture = new JSDOM('<body><div id="root"></div></body>', { url: 'https://extension.test/options' });
for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement']) globalThis[name] = name === 'window' ? fixture.window : fixture.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const server = await createServer({ configFile: false,
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
const { DEFAULT_CONFIG, DEFAULT_BUSINESS_DATA } = await server.ssrLoadModule('/src/shared/types.ts');
const stored = { config: structuredClone(DEFAULT_CONFIG) };
globalThis.chrome = { storage: { local: {
  async get(key) { return structuredClone({ [key]: stored[key] }); },
  async set(patch) { Object.assign(stored, structuredClone(patch)); },
}, onChanged: { addListener() {}, removeListener() {} } } };
const { OptionsApp } = await server.ssrLoadModule('/src/options/OptionsApp.tsx');
const root = createRoot(document.querySelector('#root'));
after(async () => { await act(async () => root.unmount()); fixture.window.close(); await server.close(); });
const click = async (text) => {
  const button = [...document.querySelectorAll('button')].find((element) => element.textContent === text);
  assert.ok(button, `missing button: ${text}`);
  await act(async () => button.click());
};

test('the product editor saves English and Spanish multiline quotes while preserving 2–6 images', async () => {
  const alerts = []; window.alert = (message) => alerts.push(message);
  for (const [count, quote] of [[2, 'Model A: 250 MXN\nModel B: 300 MXN'], [6, 'Modelo A: $250\nModelo B: $300']]) {
    const business = structuredClone(DEFAULT_BUSINESS_DATA); business.activeTab = 'product';
    const images = Array.from({ length: count }, (_, index) => ({ id: `photo-${index}`, name: `${index}.png`, dataUrl: 'data:image/png;base64,aGVsbG8=' }));
    business.products = [{ id: 'one', name: 'Product', model: 'A', description: '', price: '250', currency: 'MXN', images, coverImageId: images[1].id, keywords: [], enabled: true, updatedAt: Date.now() }];
    stored['businessData:v1'] = business;
    await act(async () => root.render(createElement(OptionsApp, { key: count })));
    await click('编辑');
    assert.equal(document.querySelector('[aria-label="启用此商品"]').getAttribute('role'), 'switch');
    const price = document.querySelector('textarea[aria-label="价格或报价说明"]');
    assert.ok(price);
    assert.equal(document.querySelector('input[type="number"]'), null);
    assert.equal(document.querySelectorAll('.opts-image-item').length, count);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(price, quote);
      price.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await click('保存商品');
    const saved = stored['businessData:v1'].products[0];
    assert.equal(saved.price, quote);
    assert.deepEqual(saved.images, images);
    assert.equal(saved.coverImageId, images[1].id);
    assert.equal(saved.currency, 'MXN');
    assert.ok(document.querySelector('.opts-product-main').textContent.includes(quote));
    assert.ok(!document.querySelector('.opts-product-main').textContent.includes(`${quote} MXN`));
    await click('编辑');
    assert.equal(document.querySelector('textarea[aria-label="价格或报价说明"]').value, quote);
    await click('取消');
  }
  assert.deepEqual(alerts, []);
});

const fill = async (label, text) => {
  const input = document.querySelector(`[aria-label="${label}"]`);
  assert.ok(input, `missing field: ${label}`);
  await act(async () => {
    const prototype = input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, text);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};

test('the auto tab is removed and each category switch immediately takes effect for legacy configurations', async () => {
  stored['businessData:v1'] = { activeTab: 'auto', globalAutoReply: false, riskConfirmed: false };
  await act(async () => root.render(createElement(OptionsApp, { key: 'legacy' })));
  assert.deepEqual([...document.querySelectorAll('.opts-tabs button')].map((button) => button.textContent), ['设置', '商品', '支付方式', '物流', '信任与保障', '常用语']);
  assert.equal(document.querySelector('.opts-tabs [aria-selected="true"]').textContent, '设置');
  for (const [tab, category] of [['商品', 'product'], ['支付方式', 'payment'], ['物流', 'shipping'], ['信任与保障', 'trust']]) {
    await click(tab);
    const toggle = document.querySelector(`#${category}-auto`);
    assert.equal(toggle.getAttribute('role'), 'switch');
    assert.equal(toggle.getAttribute('aria-checked'), 'false');
    await act(async () => toggle.click());
    assert.equal(stored['businessData:v1'].autoReply[category], true);
    assert.match(document.querySelector(`#${category}-auto-help`).textContent, /已生效/);
    assert.ok(!document.body.textContent.includes('总开关'));
  }
  assert.equal('globalAutoReply' in stored['businessData:v1'], false);
});

test('common phrase list starts empty and supports add, edit, enable, disable, keyword changes and delete', async () => {
  window.confirm = () => true;
  const business = structuredClone(DEFAULT_BUSINESS_DATA); business.activeTab = 'phrase';
  stored['businessData:v1'] = business;
  await act(async () => root.render(createElement(OptionsApp, { key: 'phrases' })));
  assert.equal(document.querySelectorAll('.opts-phrase-row').length, 0);
  assert.match(document.querySelector('.opts-empty').textContent, /还没有常用语/);
  for (const [title, content, word] of [['欢迎语', 'Hola, bienvenido', 'hola'], ['订单提醒', 'Tu pedido está en camino', 'pedido']]) {
    await click('添加常用语');
    await fill('常用语标题 *', title); await fill('常用语回复内容', content);
    await act(async () => {
      const select = document.querySelector('[aria-label="常用语内容语言"]');
      select.value = 'es-MX'; select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await click('保存常用语');
    assert.match(document.querySelector('[role="alert"]').textContent, /至少添加一个/);
    await fill('新常用语关键词', word); await click('添加关键词'); await click('保存常用语');
  }
  assert.equal(document.querySelectorAll('.opts-phrase-row').length, 2);
  assert.deepEqual(stored['businessData:v1'].phrases.map((phrase) => phrase.title), ['欢迎语', '订单提醒']);
  assert.ok(stored['businessData:v1'].phrases.every((phrase) => phrase.enabled && phrase.language === 'es-MX'));
  await act(async () => [...document.querySelector('.opts-phrase-row').querySelectorAll('button')].find((button) => button.textContent === '编辑').click());
  assert.equal(document.querySelector('[aria-label="启用此常用语"]').getAttribute('role'), 'switch');
  await fill('常用语标题 *', '新欢迎语'); await fill('常用语回复内容', 'Hola de nuevo'); await fill('修改关键词hola', 'bienvenido');
  const keywordSwitch = document.querySelector('[aria-label="启用关键词bienvenido"]');
  assert.equal(keywordSwitch.getAttribute('role'), 'switch');
  await act(async () => keywordSwitch.click());
  assert.equal(keywordSwitch.getAttribute('aria-checked'), 'false');
  await click('保存常用语');
  assert.equal(stored['businessData:v1'].phrases[0].content, 'Hola de nuevo');
  assert.equal(stored['businessData:v1'].phrases[0].keywords[0].text, 'bienvenido');
  assert.equal(stored['businessData:v1'].phrases[0].keywords[0].enabled, false);
  assert.match(document.querySelector('.opts-phrase-row').textContent, /请启用触发关键词/);
  const phraseSwitch = document.querySelector('[aria-label="启用新欢迎语"]');
  assert.equal(phraseSwitch.getAttribute('role'), 'switch');
  assert.equal(phraseSwitch.getAttribute('aria-checked'), 'true');
  await act(async () => phraseSwitch.click());
  assert.equal(stored['businessData:v1'].phrases[0].enabled, false);
  assert.equal(phraseSwitch.getAttribute('aria-checked'), 'false');
  assert.match(document.querySelector('.opts-phrase-row').textContent, /已关闭/);
  assert.equal(document.querySelector('input[type="checkbox"]'), null);
  await act(async () => document.querySelectorAll('.opts-phrase-row')[1].querySelector('.opts-danger-link').click());
  assert.equal(stored['businessData:v1'].phrases.length, 1);
  await act(async () => document.querySelector('.opts-phrase-row .opts-danger-link').click());
  assert.deepEqual(stored['businessData:v1'].phrases, []);
  assert.match(document.querySelector('.opts-empty').textContent, /还没有常用语/);
});

test('plugin, payment method, business keyword and group invitation controls are visible switches that persist their values', async () => {
  const business = structuredClone(DEFAULT_BUSINESS_DATA);
  stored['businessData:v1'] = business; stored.config = structuredClone(DEFAULT_CONFIG);
  await act(async () => root.render(createElement(OptionsApp, { key: 'all-switches' })));
  const plugin = document.querySelector('#enabled');
  assert.equal(plugin.getAttribute('role'), 'switch');
  assert.equal(document.querySelector('input[type="checkbox"]'), null);
  await act(async () => plugin.click());
  assert.equal(stored.config.enabled, false);
  assert.match(plugin.textContent, /已关闭/);
  await act(async () => plugin.click());
  assert.equal(stored.config.enabled, true);
  await click('支付方式');
  const method = business.paymentMethods[0];
  const payment = document.querySelector(`[aria-label="启用${method.name}"]`);
  assert.equal(payment.getAttribute('role'), 'switch');
  await act(async () => payment.click());
  assert.equal(stored['businessData:v1'].paymentMethods[0].enabled, false);
  const keyword = business.paymentKeywords[0];
  const keywordToggle = document.querySelector(`[aria-label="启用关键词${keyword.text}"]`);
  assert.equal(keywordToggle.getAttribute('role'), 'switch');
  await act(async () => keywordToggle.click());
  assert.equal(stored['businessData:v1'].paymentKeywords[0].enabled, false);
  assert.equal(document.querySelector('input[type="checkbox"]'), null);
  await click('信任与保障');
  const invite = document.querySelector('#include-group');
  assert.equal(invite.getAttribute('role'), 'switch');
  await act(async () => invite.click());
  assert.equal(stored['businessData:v1'].includeGroupInvite, !business.includeGroupInvite);
  assert.equal(document.querySelector('input[type="checkbox"]'), null);
});

test('fresh settings default to simplified Chinese and Spanish while saved language choices and custom style survive reload', async () => {
  delete stored.config; stored['businessData:v1'] = structuredClone(DEFAULT_BUSINESS_DATA);
  await act(async () => root.render(createElement(OptionsApp, { key: 'new-language-defaults' })));
  assert.equal(document.querySelector('#native-lang').value, 'zh-CN');
  assert.equal(document.querySelector('#target-lang').value, 'es');
  await act(async () => {
    const select = document.querySelector('#target-lang');
    select.value = 'en'; select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await act(async () => root.render(createElement(OptionsApp, { key: 'saved-language-choice' })));
  assert.equal(document.querySelector('#target-lang').value, 'en');
  const { loadConfig } = await server.ssrLoadModule('/src/shared/storage.ts');
  const { LEGACY_DEFAULT_TRANSLATION_STYLE } = await server.ssrLoadModule('/src/shared/translation-policy.ts');
  stored.config = { nativeLang: 'ja', targetLang: 'fr', personality: LEGACY_DEFAULT_TRANSLATION_STYLE };
  const upgraded = await loadConfig();
  assert.equal(upgraded.personality, DEFAULT_CONFIG.personality);
  assert.equal(upgraded.nativeLang, 'ja'); assert.equal(upgraded.targetLang, 'fr');
  stored.config.personality = 'Use concise, friendly language.';
  assert.equal((await loadConfig()).personality, 'Use concise, friendly language.');
});
