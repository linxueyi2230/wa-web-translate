import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer({ configFile: false,
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
after(() => server.close());
const { callModel, ProviderError } = await server.ssrLoadModule('/src/background/providers.ts');
const config = { provider: 'deepseek', apiKeys: { deepseek: 'test-key' }, model: {} };

test('DeepSeek 402 explains recharge and preserves the provider request ID', async () => {
  const originalFetch = globalThis.fetch;
  const body = JSON.stringify({ error: { message: 'Insufficient Balance (request_id: abc-123)',
    type: 'insufficient_balance_error', param: null, code: 'invalid_request_error' } });
  globalThis.fetch = async () => new Response(body, { status: 402 });
  try {
    await assert.rejects(callModel(config, { system: 'test', user: 'test' }), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /余额不足.*充值/);
      assert.match(error.message, /deepseek API error 402/);
      assert.ok(error.message.includes(body));
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('other DeepSeek failures are distinct and retain diagnostic details', () => {
  assert.match(new ProviderError('deepseek', 401, '{"error":"invalid key"}').message, /API Key.*验证失败/);
  assert.match(new ProviderError('deepseek', 429, 'rate limit').message, /请求过于频繁/);
  assert.equal(new ProviderError('deepseek', 418, 'unexpected').message, 'deepseek API error 418: unexpected');
  assert.equal(new ProviderError('openai', 402, 'payment required').message, 'openai API error 402: payment required');
});
