import { createHash } from "node:crypto";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createServer } from "vite";
import { createServer as httpServer } from "node:http";
import { fileURLToPath } from "node:url";
const server = await createServer({
  configFile: false,
  resolve: {
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  },
  server: { middlewareMode: true, hmr: { server: httpServer() }, watch: null },
  appType: "custom",
});
after(() => server.close());
const protocol = await server.ssrLoadModule("/src/shared/haomai/protocol.ts");
test("UUIDv7 preserves string IDs and camelCase protocol validates routing", () => {
  assert.match(
    protocol.uuidV7(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.throws(() =>
    protocol.parseEnvelope({ version: 1, id: "1", type: "response", data: {} }),
  );
  assert.equal(
    protocol.parseEnvelope({
      version: 1,
      id: "1",
      requestId: null,
      type: "response",
      action: "system.ping",
      code: "ok",
      message: "",
      data: {},
      timestamp: new Date().toISOString(),
    }).action,
    "system.ping",
  );
});
test("API configuration rejects credentials and remote cleartext", () => {
  assert.equal(
    protocol.validateApiBase("http://127.0.0.1:8080/api/v1/"),
    "http://127.0.0.1:8080/api/v1",
  );
  for (const value of [
    "http://example.com/api/v1",
    "https://u:p@example.com/api/v1",
    "https://example.com/api/v1?accessToken=secret",
  ])
    assert.throws(() => protocol.validateApiBase(value));
});
const listeners = [];
const local = {};
const session = {};
const calls = [];
const deliveries = [];
const sockets = [];
const alarmListeners = [];
let manifestVersion = "0.1.0";
const failures = new Map();
const extensionId = "haomai-test";
const trusted = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/src/options/index.html`,
};
function area(records) {
  return {
    async get(key) {
      return key === null ? structuredClone(records) : { [key]: records[key] };
    },
    async set(value) {
      Object.assign(records, structuredClone(value));
    },
    async remove(key) {
      delete records[key];
    },
    async setAccessLevel() {},
  };
}
globalThis.chrome = {
  storage: { local: area(local), session: area(session) },
  runtime: {
    id: extensionId,
    getURL: (p) => `chrome-extension://${extensionId}/${p.replace(/^\//, "")}`,
    getManifest: () => ({ version: manifestVersion }),
    onMessage: { addListener: (f) => listeners.push(f) },
    onStartup: { addListener() {} },
    sendMessage: async () => {},
  },
  alarms: {
    create() {},
    onAlarm: { addListener: (f) => alarmListeners.push(f) },
  },
  tabs: {
    query: async () => [],
    sendMessage: async (id, message) => {
      deliveries.push({ id, message });
    },
  },
};
class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  constructor() {
    this.readyState = 0;
    sockets.push(this);
  }
  close() {
    this.readyState = 3;
  }
}
globalThis.WebSocket = Socket;
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  const path = new URL(url).pathname.replace("/api/v1", "");
  const failure = failures.get(path);
  if (failure) {
    failures.delete(path);
    return new Response(
      JSON.stringify({
        version: 1,
        id: "failure",
        type: "response",
        action: "test",
        code:
          failure === 401
            ? "invalid_refresh_token"
            : "dependencies_unavailable",
        data: null,
      }),
      { status: failure },
    );
  }
  if (url === "https://oss.fixture/upload")
    return new Response(null, { status: 200 });
  let data = {};
  if (
    url.endsWith("/media/images/upload-intents") ||
    url.endsWith("/media/audio/upload-intents")
  )
    data = {
      mediaId: "media-observed-1",
      method: "PUT",
      url: "https://oss.fixture/upload",
      headers: { "Content-Type": "image/png" },
    };
  if (url.endsWith("/media/media-observed-1/complete"))
    data = { id: "media-observed-1", status: "ready" };
  if (url.endsWith("/auth/login") || url.endsWith("/auth/refresh"))
    data = {
      accessToken: "private-access-token",
      refreshToken: "private-refresh-token",
      expiresInSeconds: 900,
      clientId: "chrome-client",
      user: { id: "user-1", phone: "13800000000" },
    };
  if (url.endsWith("/social-accounts/sync"))
    data = {
      items: [
        {
          id: "source-1",
          platform: "whatsapp",
          remoteAccountKey: "13800000000@c.us",
          connectorClientId: "chrome-client",
          online: true,
          loginState: "logged_in",
        },
      ],
    };
  if (url.endsWith("/conversations/conversation-language/messages"))
    data = {
      items: [
        {
          id: "message-es",
          originalText: "hola",
          sourceLanguage: "es",
          targetLanguage: "zh",
          createdBy: "actor-1",
        },
        {
          id: "message-old",
          originalText: "history",
          sourceLanguage: null,
          targetLanguage: "zh",
        },
      ],
      total: 2,
      nextCursor: null,
    };
  if (url.endsWith("/realtime/tickets"))
    data = { ticket: "one-time-ticket", protocol: "haomai.v1" };
  return new Response(
    JSON.stringify({
      version: 1,
      id: "server-id",
      requestId: null,
      type: "response",
      action: "test",
      code: "ok",
      message: "",
      data,
      timestamp: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
await server.ssrLoadModule("/src/background/haomai.ts");
async function send(message, sender = trusted) {
  if (
    message.kind === "HAOMAI_CONTENT" &&
    message.operation !== "mode" &&
    message.payload
  ) {
    const mode = await send(
      { kind: "HAOMAI_CONTENT", operation: "mode" },
      sender,
    );
    message = {
      ...message,
      payload: {
        contextGeneration: mode?.data?.contextGeneration,
        ...message.payload,
      },
    };
  }
  return new Promise((resolve) => {
    const handled = listeners.some(
      (listener) => listener(message, sender, resolve) === true,
    );
    if (!handled) queueMicrotask(() => resolve(undefined));
  });
}
test("WA page cannot invoke authenticated UI API or obtain credentials", async () => {
  const before = calls.length;
  const response = await send(
    { kind: "HAOMAI_UI", operation: "api", path: "/me" },
    {
      id: extensionId,
      frameId: 0,
      tab: { id: 1 },
      url: "https://web.whatsapp.com/",
    },
  );
  assert.equal(response.ok, false);
  assert.equal(calls.length, before);
  const other = await send(
    { kind: "HAOMAI_CONTENT", operation: "mode" },
    {
      id: extensionId,
      frameId: 0,
      tab: { id: 1 },
      url: "https://evil.example/",
    },
  );
  assert.equal(other, undefined);
});
test("login stores auth in trusted session storage and exposes only profile snapshots", async () => {
  const response = await send({
    kind: "HAOMAI_UI",
    operation: "login",
    body: { phone: "13800000000", password: "test-password" },
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.user.id, "user-1");
  assert.equal(response.data.accessToken, undefined);
  assert.equal(
    session["haomai:private-session"].accessToken,
    "private-access-token",
  );
  assert.ok(!JSON.stringify(local).includes("private-access-token"));
  const snapshot = await send({ kind: "HAOMAI_UI", operation: "snapshot" });
  assert.equal(snapshot.data.user.id, "user-1");
  assert.ok(!JSON.stringify(snapshot).includes("private-access-token"));
  const request = JSON.parse(
    calls.find((c) => c.url.endsWith("/auth/login")).init.body,
  );
  assert.equal(request.client.type, "chrome");
  assert.equal(request.client.appVersion, manifestVersion);
  assert.match(request.client.installationKey, /-7/);
  const denied = await send({
    kind: "HAOMAI_UI",
    operation: "api",
    path: "/admin/users",
  });
  assert.equal(denied.ok, false);
});
test("message source language and nullable historical metadata survive the authenticated API bridge", async () => {
  const response = await send({
    kind: "HAOMAI_UI",
    operation: "api",
    path: "/conversations/conversation-language/messages",
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.items[0].sourceLanguage, "es");
  assert.equal(response.data.items[0].createdBy, "actor-1");
  assert.equal(response.data.items[1].sourceLanguage, null);
  assert.equal(response.data.items[1].originalText, "history");
});

test("unowned WA result cannot claim delivery and path traversal never reaches server", async () => {
  const before = calls.length;
  const result = await send(
    {
      kind: "HAOMAI_CONTENT",
      operation: "result",
      payload: { id: "forged-message", nonce: "fake", ok: true },
    },
    {
      id: extensionId,
      frameId: 0,
      tab: { id: 3 },
      url: "https://web.whatsapp.com/",
    },
  );
  assert.equal(result.ok, false);
  assert.equal(calls.length, before);
  const traversal = await send({
    kind: "HAOMAI_UI",
    operation: "api",
    path: "/../../admin/users",
  });
  assert.equal(traversal.ok, false);
  assert.equal(calls.length, before);
});

test("dispatch deduplicates concurrent events and authenticates result tab ownership", async () => {
  const wa = {
    id: extensionId,
    frameId: 0,
    tab: { id: 7 },
    url: "https://web.whatsapp.com/",
  };
  const synced = await send(
    {
      kind: "HAOMAI_CONTENT",
      operation: "sync",
      payload: {
        remoteAccountKey: "13800000000@c.us",
        loginState: "logged_in",
      },
    },
    wa,
  );
  assert.equal(synced.ok, true);
  const frame = {
    version: 1,
    id: "event-1",
    requestId: null,
    type: "event",
    action: "message.dispatch",
    code: null,
    message: "",
    timestamp: new Date().toISOString(),
    data: {
      id: "message-1",
      sourceAccountId: "source-1",
      remoteConversationKey: "52123456789@c.us",
      kind: "text",
      text: "hello",
    },
  };
  const ws = sockets.at(-1);
  assert.ok(ws);
  ws.onmessage({ data: JSON.stringify(frame) });
  ws.onmessage({ data: JSON.stringify(frame) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const sends = deliveries.filter((d) => d.message.kind === "HAOMAI_DISPATCH");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].id, 7);
  assert.equal(sends[0].message.remoteAccountKey, "13800000000@c.us");
  assert.ok(!JSON.stringify(sends).includes("private-access-token"));
  const nonce = sends[0].message.nonce;
  const forged = await send(
    {
      kind: "HAOMAI_CONTENT",
      operation: "result",
      payload: { id: "message-1", nonce, ok: true },
    },
    { ...wa, tab: { id: 8 } },
  );
  assert.equal(forged.ok, false);
  const result = await send(
    {
      kind: "HAOMAI_CONTENT",
      operation: "result",
      payload: {
        id: "message-1",
        nonce,
        ok: true,
        remoteMessageKey: "true_52123456789@c.us_ABCDEFGHIJKL",
      },
    },
    wa,
  );
  assert.equal(result.ok, true);
  const reported = calls.find((c) =>
    c.url.endsWith("/messages/message-1/result"),
  );
  assert.equal(JSON.parse(reported.init.body).state, "sent");
  assert.equal(
    reported.init.headers.Authorization,
    "Bearer private-access-token",
  );
});

test("media observations upload in background with computed digests and ingest actual media IDs", async () => {
  const wa = {
    id: extensionId,
    frameId: 0,
    tab: { id: 7 },
    url: "https://web.whatsapp.com/",
  };
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const response = await send(
    {
      kind: "HAOMAI_CONTENT",
      operation: "ingest",
      payload: {
        remoteAccountKey: "13800000000@c.us",
        remoteMessageKey: "false_52123456789@c.us_IMAGEFILE123",
        remoteConversationKey: "52123456789@c.us",
        text: "",
        kind: "image",
        direction: "incoming",
        occurredAt: new Date().toISOString(),
        media: {
          mimeType: "image/png",
          sizeBytes: bytes.length,
          originalName: "customer.png",
          base64: bytes.toString("base64"),
        },
      },
    },
    wa,
  );
  assert.equal(response.ok, true);
  const intent = calls.find((c) =>
    c.url.endsWith("/media/images/upload-intents"),
  );
  assert.ok(intent);
  const body = JSON.parse(intent.init.body);
  assert.equal(
    body.md5Base64,
    createHash("md5").update(bytes).digest("base64"),
  );
  assert.equal(body.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(body.purpose, "message");
  const upload = calls.find((c) => c.url === "https://oss.fixture/upload");
  assert.deepEqual(Buffer.from(upload.init.body), bytes);
  assert.equal(upload.init.headers.Authorization, undefined);
  const ingest = calls.find((c) => c.url.endsWith("/messages/ingest"));
  assert.ok(ingest);
  const record = JSON.parse(ingest.init.body);
  assert.equal(record.kind, "image");
  assert.deepEqual(record.mediaIds, ["media-observed-1"]);
  assert.equal(record.text, "");
  assert.equal(record.direction, "incoming");
  assert.ok(!JSON.stringify(deliveries).includes("https://oss.fixture/upload"));
});

test("unavailable media remains visible and retry sends only message keys to the matching WA tab", async () => {
  const wa = {
    id: extensionId,
    frameId: 0,
    tab: { id: 7 },
    url: "https://web.whatsapp.com/",
  };
  const observation = {
    remoteAccountKey: "13800000000@c.us",
    remoteMessageKey: "false_52123456789@c.us_UNAVAILABLE123",
    remoteConversationKey: "52123456789@c.us",
    kind: "audio",
    errorCode: "platform_media_module_unavailable",
  };
  const recorded = await send(
    { kind: "HAOMAI_CONTENT", operation: "sync_error", payload: observation },
    wa,
  );
  assert.equal(recorded.ok, true);
  const snapshot = await send({ kind: "HAOMAI_UI", operation: "snapshot" });
  assert.equal(snapshot.data.syncFailures.length, 1);
  assert.equal(
    snapshot.data.syncFailures[0].remoteMessageKey,
    observation.remoteMessageKey,
  );
  const retry = await send({ kind: "HAOMAI_UI", operation: "retrySync" });
  assert.equal(retry.ok, true);
  const command = deliveries.find(
    (d) => d.message.kind === "HAOMAI_RETRY_SYNC",
  );
  assert.equal(command.id, 7);
  assert.deepEqual(command.message.ids, [observation.remoteMessageKey]);
  assert.ok(!JSON.stringify(command).includes("private-access-token"));
  const before = calls.length;
  await send(
    {
      kind: "HAOMAI_CONTENT",
      operation: "ingest",
      payload: {
        ...observation,
        remoteAccountKey: "another-account@c.us",
        kind: "text",
        text: "fake",
        direction: "incoming",
        occurredAt: new Date().toISOString(),
      },
    },
    wa,
  );
  assert.equal(
    calls.length,
    before,
    "observation from another account must not reach server",
  );
});

test("recent-history import is an explicit trusted-page action bound to its source account and tab", async () => {
  const started = await send({
    kind: "HAOMAI_UI",
    operation: "importRecent",
    sourceAccountId: "source-1",
  });
  assert.equal(started.ok, true);
  assert.equal(started.data.started, true);
  const dispatch = deliveries.find(
    (d) => d.message.kind === "HAOMAI_IMPORT_RECENT",
  );
  assert.equal(dispatch.id, 7);
  assert.equal(dispatch.message.limit, 100);
  assert.equal(dispatch.message.remoteAccountKey, "13800000000@c.us");
  assert.ok(!JSON.stringify(dispatch).includes("private-access-token"));
  const result = {
    jobId: dispatch.message.jobId,
    nonce: dispatch.message.nonce,
    remoteAccountKey: dispatch.message.remoteAccountKey,
    readCount: 100,
    failedCount: 1,
  };
  const forged = await send(
    { kind: "HAOMAI_CONTENT", operation: "import_result", payload: result },
    {
      id: extensionId,
      frameId: 0,
      tab: { id: 9 },
      url: "https://web.whatsapp.com/",
    },
  );
  assert.equal(forged.ok, false);
  const accepted = await send(
    { kind: "HAOMAI_CONTENT", operation: "import_result", payload: result },
    {
      id: extensionId,
      frameId: 0,
      tab: { id: 7 },
      url: "https://web.whatsapp.com/",
    },
  );
  assert.equal(accepted.ok, true);
  const snapshot = await send({ kind: "HAOMAI_UI", operation: "snapshot" });
  assert.equal(snapshot.data.importStatus.state, "queued");
  assert.equal(snapshot.data.importStatus.readCount, 100);
  const other = await send({
    kind: "HAOMAI_UI",
    operation: "importRecent",
    sourceAccountId: "not-my-source",
  });
  assert.equal(other.ok, false);
});

const authStore = await server.ssrLoadModule(
  "/src/background/session-store.ts",
);
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}
test("re-login replaces the old socket and late revocation cannot clear the new login", async () => {
  const previous = sockets.at(-1);
  const installationKey = local["haomai:installation"];
  previous.readyState = Socket.OPEN;
  manifestVersion = "0.1.1";
  const result = await send({
    kind: "HAOMAI_UI",
    operation: "login",
    body: { phone: "13800000000", password: "fixture" },
  });
  assert.equal(result.ok, true);
  await settle();
  assert.equal(previous.readyState, 3);
  assert.notEqual(sockets.at(-1), previous);
  previous.onmessage({
    data: JSON.stringify({
      version: 1,
      id: "late",
      type: "event",
      action: "session.revoked",
      data: {},
    }),
  });
  previous.onclose();
  assert.equal(
    (await send({ kind: "HAOMAI_UI", operation: "snapshot" })).data.user.id,
    "user-1",
  );
  assert.equal(local["haomai:installation"], installationKey);
  const ticket = calls
    .filter((call) => call.url.endsWith("/realtime/tickets"))
    .at(-1);
  assert.equal(JSON.parse(ticket.init.body).client.appVersion, "0.1.1");
  assert.equal((await authStore.loadStoredSession()).clientId, "chrome-client");
});

test("extension update restores durable login with empty session storage and reports the running version", async () => {
  const installationKey = local["haomai:installation"];
  await send({
    kind: "HAOMAI_UI",
    operation: "settings",
    settings: { ...local["haomai:backend"], active: false },
  });
  for (const key of Object.keys(session)) delete session[key];
  listeners.length = 0;
  alarmListeners.length = 0;
  local["haomai:backend"].active = true;
  const loginCount = calls.filter((call) =>
    call.url.endsWith("/auth/login"),
  ).length;
  const before = sockets.length;
  await server.ssrLoadModule("/src/background/haomai.ts?upgrade=1");
  const snapshot = await send({ kind: "HAOMAI_UI", operation: "snapshot" });
  await settle();
  assert.equal(snapshot.data.user.id, "user-1");
  assert.equal(sockets.length, before + 1);
  assert.equal(local["haomai:installation"], installationKey);
  assert.equal(
    calls.filter((call) => call.url.endsWith("/auth/login")).length,
    loginCount,
  );
  assert.equal(
    JSON.parse(
      calls.filter((call) => call.url.endsWith("/realtime/tickets")).at(-1).init
        .body,
    ).client.appVersion,
    manifestVersion,
  );
  assert.ok(!JSON.stringify(local).includes("private-refresh-token"));
});

test("temporary refresh failure retains login, alarm retries, and revoked refresh clears durable credentials", async () => {
  sockets.at(-1).readyState = 3;
  failures.set("/realtime/tickets", 401);
  failures.set("/auth/refresh", 503);
  alarmListeners[0]({ name: "haomai:reconnect" });
  await settle();
  assert.equal((await authStore.loadStoredSession()).user.id, "user-1");
  assert.equal(
    (await send({ kind: "HAOMAI_UI", operation: "snapshot" })).data.user.id,
    "user-1",
  );
  failures.set("/realtime/tickets", 401);
  alarmListeners[0]({ name: "haomai:reconnect" });
  await settle();
  assert.equal(sockets.at(-1).readyState, Socket.CONNECTING);
  sockets.at(-1).readyState = 3;
  failures.set("/realtime/tickets", 401);
  failures.set("/auth/refresh", 401);
  alarmListeners[0]({ name: "haomai:reconnect" });
  await settle();
  assert.equal(await authStore.loadStoredSession(), null);
  assert.equal(session["haomai:private-session"], undefined);
});

test("explicit logout removes credentials from both durable and temporary stores", async () => {
  await send({
    kind: "HAOMAI_UI",
    operation: "login",
    body: { phone: "13800000000", password: "fixture" },
  });
  await send({ kind: "HAOMAI_UI", operation: "logout" });
  assert.equal(await authStore.loadStoredSession(), null);
  assert.equal(session["haomai:private-session"], undefined);
});

test("logout tombstone prevents an interrupted cache cleanup from resurrecting a session", async () => {
  session["haomai:private-session"] = {
    accessToken: "old",
    refreshToken: "old",
    clientId: "chrome-client",
    user: { id: "user-1" },
  };
  listeners.length = 0;
  alarmListeners.length = 0;
  const before = sockets.length;
  await server.ssrLoadModule(
    "/src/background/haomai.ts?restart-after-logout=1",
  );
  const snapshot = await send({ kind: "HAOMAI_UI", operation: "snapshot" });
  assert.equal(snapshot.data.user, null);
  assert.equal(sockets.length, before);
  assert.equal(session["haomai:private-session"], undefined);
});

test("legacy session migrates once, simultaneous wakeups share a connection, and API changes clear login", async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("haomai-private-auth");
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  session["haomai:private-session"] = {
    accessToken: "private-access-token",
    refreshToken: "private-refresh-token",
    clientId: "chrome-client",
    user: { id: "user-1" },
  };
  listeners.length = 0;
  alarmListeners.length = 0;
  const before = calls.filter((call) =>
    call.url.endsWith("/realtime/tickets"),
  ).length;
  await server.ssrLoadModule("/src/background/haomai.ts?legacy-migration=1");
  for (let i = 0; i < 3; i++) alarmListeners[0]({ name: "haomai:reconnect" });
  const snapshot = await send({ kind: "HAOMAI_UI", operation: "snapshot" });
  await settle();
  assert.equal(snapshot.data.user.id, "user-1");
  assert.equal((await authStore.loadStoredSession()).clientId, "chrome-client");
  assert.equal(
    calls.filter((call) => call.url.endsWith("/realtime/tickets")).length,
    before + 1,
  );
  await send({
    kind: "HAOMAI_UI",
    operation: "settings",
    settings: {
      active: true,
      apiBaseUrl: "https://other.fixture.invalid/api/v1",
    },
  });
  assert.equal(await authStore.loadStoredSession(), null);
  assert.equal(session["haomai:private-session"], undefined);
  assert.ok(
    !calls.some((call) => call.url.startsWith("https://other.fixture.invalid")),
  );
});
