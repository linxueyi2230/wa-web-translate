import assert from "node:assert/strict";
import { test, after } from "node:test";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { createServer as httpServer } from "node:http";
import { fileURLToPath } from "node:url";
const fixture = new JSDOM("<!doctype html><body></body>", {
  url: "https://web.whatsapp.com/",
});
globalThis.window = fixture.window;
globalThis.document = fixture.window.document;
globalThis.location = fixture.window.location;
const emitted = [];
window.postMessage = (message) =>
  queueMicrotask(() => {
    emitted.push(message);
    window.dispatchEvent(
      new window.MessageEvent("message", { data: message, source: window }),
    );
  });
const messages = [];
const listeners = {};
const collection = {
  models: messages,
  on(name, handler) {
    (listeners[name] ||= []).push(handler);
  },
};
const chat = { id: "52123456789@c.us", msgs: { models: messages } };
let textSends = 0;
let mediaSends = 0;
let prepared = false;
const add = (model) => {
  messages.push(model);
  for (const handler of listeners.add || []) handler(model);
  return model;
};
const modules = {
  WAWebUserPrefsInfo: {
    getMaybeMeUser: () => "13800000001@c.us",
    getPushname: () => "Fixture",
  },
  WAWebChatCollection: { ChatCollection: { models: [chat] } },
  WAWebMsgCollection: { MsgCollection: collection },
  WAWebSendTextMsgChatAction: {
    async sendTextMsgToChat(target, text) {
      assert.equal(target, chat);
      textSends++;
      add({
        id: "false_99999999999@c.us_OTHERCHAT123",
        body: "unrelated incoming",
        ack: 1,
        type: "chat",
        t: Date.now() / 1000,
      });
      return add({
        id: "true_52123456789@c.us_TEXTSEND123",
        body: text,
        ack: 1,
        type: "chat",
        t: Date.now() / 1000,
      });
    },
  },
  WAWebMediaOpaqueData: {
    default: {
      async createFromData(blob) {
        assert.ok(blob instanceof Blob);
        return { blob };
      },
    },
  },
  WAWebPrepRawMedia: {
    prepRawMedia(opaque, options) {
      assert.ok(!(opaque instanceof Promise));
      assert.ok(opaque.blob instanceof Blob);
      prepared = false;
      return {
        async waitForPrep() {
          prepared = true;
        },
        async sendToChat({ chat: target, options: sendOptions }) {
          assert.equal(target, chat);
          assert.equal(prepared, true);
          mediaSends++;
          return add({
            id: `true_52123456789@c.us_MEDIASEND12${mediaSends}`,
            body: sendOptions.caption,
            caption: sendOptions.caption,
            ack: 1,
            type: options.isPtt ? "ptt" : "image",
            t: Date.now() / 1000,
          });
        },
      };
    },
  },
};
window.require = (name) => {
  if (modules[name]) return modules[name];
  throw new Error("missing");
};
const server = await createServer({
  configFile: false,
  resolve: {
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  },
  server: { middlewareMode: true, hmr: { server: httpServer() }, watch: null },
  appType: "custom",
});
const { installHaomaiConnector } = await server.ssrLoadModule(
  "/src/page/haomai-connector.ts",
);
installHaomaiConnector();
after(async () => {
  window.dispatchEvent(new window.Event("pagehide"));
  fixture.window.close();
  await server.close();
});
const command = async (message) => {
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        __haomaiConnector: true,
        contextGeneration: "fixture-context",
        ...message,
      },
      source: window,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
};
await command({ kind: "MODE", active: true });
test("server dispatch uses the actual native text sender exactly once and associates its observation", async () => {
  const data = {
    id: "server-text-1",
    kind: "text",
    text: "Hola",
    remoteConversationKey: chat.id,
    idempotencyKey: "server-text-idempotency",
  };
  await command({
    kind: "DISPATCH",
    nonce: "nonce-text",
    remoteAccountKey: "13800000001@c.us",
    data,
  });
  await command({
    kind: "DISPATCH",
    nonce: "nonce-text",
    remoteAccountKey: "13800000001@c.us",
    data,
  });
  assert.equal(textSends, 1);
  const result = emitted.find(
    (m) => m.operation === "result" && m.payload.id === data.id,
  );
  assert.equal(result.payload.ok, true);
  assert.equal(
    result.payload.remoteMessageKey,
    "true_52123456789@c.us_TEXTSEND123",
  );
  const observed = emitted.find(
    (m) =>
      m.operation === "ingest" &&
      m.payload.idempotencyKey === "server-text-idempotency",
  );
  assert.equal(observed.payload.direction, "outgoing");
});
test("native image and voice sends await opaque data/preparation and support packed sendToChat signatures", async () => {
  for (const [kind, mimeType] of [
    ["image", "image/png"],
    ["audio", "audio/ogg"],
  ]) {
    const data = {
      id: `server-${kind}-1`,
      kind,
      text: "",
      remoteConversationKey: chat.id,
      idempotencyKey: `idempotency-${kind}`,
      attachments: [{ mimeType, dataUrl: `data:${mimeType};base64,AQIDBA==` }],
    };
    await command({
      kind: "DISPATCH",
      nonce: `nonce-${kind}`,
      remoteAccountKey: "13800000001@c.us",
      data,
    });
    const result = emitted.find(
      (m) => m.operation === "result" && m.payload.id === data.id,
    );
    assert.equal(result.payload.ok, true);
  }
  assert.equal(mediaSends, 2);
});
test("dispatch refuses a different logged in source account before sending", async () => {
  const before = textSends;
  await command({
    kind: "DISPATCH",
    nonce: "wrong-source",
    remoteAccountKey: "another@c.us",
    data: {
      id: "wrong-source-message",
      kind: "text",
      text: "never send",
      remoteConversationKey: chat.id,
    },
  });
  assert.equal(textSends, before);
  const result = emitted.find(
    (m) => m.operation === "result" && m.payload.id === "wrong-source-message",
  );
  assert.equal(result.payload.ok, false);
});
test("received image is relayed as bytes while unavailable media reports a retryable failure without fake text", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  add({
    id: "false_52123456789@c.us_INBOUNDIMAGE1",
    type: "image",
    isNewMsg: true,
    t: Date.now() / 1000,
    mediaData: {
      mediaBlob: {
        forceToBlob: () => new Blob([bytes], { type: "image/png" }),
      },
    },
  });
  add({
    id: "false_52123456789@c.us_MISSINGIMAGE1",
    type: "image",
    isNewMsg: true,
    t: Date.now() / 1000,
    mediaData: {},
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const received = emitted.find(
    (m) =>
      m.operation === "ingest" &&
      m.payload.remoteMessageKey === "false_52123456789@c.us_INBOUNDIMAGE1",
  );
  assert.equal(received.payload.kind, "image");
  assert.equal(received.payload.media.sizeBytes, bytes.length);
  assert.equal(received.payload.text, "");
  assert.equal(received.payload.remoteAccountKey, "13800000001@c.us");
  const failure = emitted.find(
    (m) =>
      m.operation === "sync_error" &&
      m.payload.remoteMessageKey === "false_52123456789@c.us_MISSINGIMAGE1",
  );
  assert.equal(failure.payload.errorCode, "platform_media_module_unavailable");
  assert.ok(
    !emitted.some(
      (m) =>
        m.operation === "ingest" &&
        m.payload.remoteMessageKey === "false_52123456789@c.us_MISSINGIMAGE1",
    ),
  );
});

test("explicit recent import is bounded to 100 original messages and cannot cross the logged in source", async () => {
  messages.length = 0;
  for (let i = 0; i < 150; i++)
    messages.push({
      id: `false_52123456789@c.us_IMPORT${String(i).padStart(6, "0")}`,
      type: "chat",
      body: `original ${i}`,
      t: Date.now() / 1000 - 3600 - i,
    });
  const start = emitted.length;
  await command({
    kind: "IMPORT_RECENT",
    jobId: "import-job-1",
    nonce: "import-nonce",
    remoteAccountKey: "13800000001@c.us",
    limit: 999,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const ingests = emitted.slice(start).filter((m) => m.operation === "ingest");
  assert.equal(ingests.length, 100);
  assert.ok(
    ingests.every(
      (m) =>
        m.payload.historical === true &&
        m.payload.remoteAccountKey === "13800000001@c.us",
    ),
  );
  assert.equal(ingests[0].payload.text, "original 0");
  assert.equal(ingests[99].payload.text, "original 99");
  const result = emitted.find(
    (m) =>
      m.operation === "import_result" && m.payload.jobId === "import-job-1",
  );
  assert.equal(result.payload.readCount, 100);
  assert.equal(result.payload.failedCount, 0);
  const before = emitted.filter((m) => m.operation === "ingest").length;
  await command({
    kind: "IMPORT_RECENT",
    jobId: "import-job-wrong",
    nonce: "wrong-nonce",
    remoteAccountKey: "another-account@c.us",
    limit: 100,
  });
  assert.equal(emitted.filter((m) => m.operation === "ingest").length, before);
  const failure = emitted.find(
    (m) =>
      m.operation === "import_result" && m.payload.jobId === "import-job-wrong",
  );
  assert.equal(failure.payload.errorCode, "source_account_changed");
});
