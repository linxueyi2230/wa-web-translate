import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createServer } from "vite";
import { createServer as httpServer } from "node:http";
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: { server: httpServer() }, watch: null }, appType: "custom" });
after(() => server.close());
const { migrateActiveFields } = await server.ssrLoadModule("/src/shared/active-migration.ts");
const records = {};
globalThis.chrome = { storage: { local: {
  async get(key) { return { [key]: structuredClone(records[key]) }; },
  async set(value) { Object.assign(records, structuredClone(value)); },
} } };
const storage = await server.ssrLoadModule("/src/shared/storage.ts");
test("legacy false switches and nested keywords migrate without changing user content", () => {
  const legacy = { enabled: false, text: "keep enabled in text", keywords: [{ enabled: true }], activeWins: { active: false, enabled: true } };
  const original = structuredClone(legacy);
  const upgraded = migrateActiveFields(legacy);
  assert.deepEqual(upgraded, { active: false, text: "keep enabled in text", keywords: [{ active: true }], activeWins: { active: false } });
  assert.deepEqual(legacy, original);
});
test("custom non-boolean enabled fields survive recursively without overriding active false", () => {
  const custom = {
    enabled: "custom text",
    nested: { enabled: { label: "custom object", enabled: false } },
    nullable: { enabled: null },
    numeric: { enabled: 7 },
    both: { active: false, enabled: "keep custom value" },
  };
  assert.deepEqual(migrateActiveFields(custom), {
    enabled: "custom text",
    nested: { enabled: { label: "custom object", active: false } },
    nullable: { enabled: null },
    numeric: { enabled: 7 },
    both: { active: false, enabled: "keep custom value" },
  });
  assert.equal(custom.nested.enabled.enabled, false);
});
test("old backend and standalone preferences retain disabled state on load and new saves use active", async () => {
  records.config = { enabled: false, personality: "custom tone", apiKeys: { deepseek: "fixture-only" } };
  records["haomai:backend"] = { enabled: false };
  const loaded = await storage.loadConfig();
  assert.equal(loaded.active, false);
  assert.equal(loaded.enabled, undefined);
  assert.equal(loaded.personality, "custom tone");
  assert.equal(loaded.apiKeys.deepseek, "fixture-only");
  records["haomai:backend"] = { enabled: true };
  records.config = { enabled: true };
  assert.equal((await storage.loadConfig()).active, false);
  records["haomai:backend"] = { active: false, enabled: true };
  assert.equal((await storage.loadConfig()).active, true);
  await storage.saveConfig({ active: false });
  assert.equal(records.config.active, false);
  assert.equal(records.config.enabled, undefined);
});
test("legacy product, payment, phrase and keyword settings survive business load and save", async () => {
  records["businessData:v1"] = {
    products: [{ id: "product", enabled: false, keywords: [{ text: "custom", enabled: false }] }],
    paymentMethods: [{ id: "payment", enabled: false }],
    phrases: [{ id: "phrase", enabled: true, keywords: [{ text: "phrase keyword", enabled: true }] }],
  };
  const data = await storage.loadBusinessData();
  assert.equal(data.products[0].active, false);
  assert.equal(data.products[0].keywords[0].active, false);
  assert.equal(data.paymentMethods[0].active, false);
  assert.equal(data.phrases[0].active, true);
  assert.equal(data.phrases[0].keywords[0].text, "phrase keyword");
  await storage.saveBusinessData(data);
  assert.ok(!JSON.stringify(records["businessData:v1"]).includes('"enabled"'));
});
