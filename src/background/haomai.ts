import { migrateActiveFields } from "../shared/active-migration";
import { loadStoredSession, storeSession } from "./session-store";
import {
  validatePlatformMedia,
  mediaBytes,
  type PlatformMedia,
} from "../shared/haomai/media";
import { md5 } from "../shared/haomai/md5";
import { parseMessageId, normalizeChatId } from "../shared/message-history";
import {
  parseEnvelope,
  validateApiBase,
  uuidV7,
  type Session,
  type Account,
  type BackendSettings,
} from "../shared/haomai/protocol";
const SETTINGS = "haomai:backend";
const SESSION = "haomai:private-session";
let settings: BackendSettings = {
  active: true,
  apiBaseUrl:
    import.meta.env.VITE_HAOMAI_API_BASE_URL || "http://127.0.0.1:8080/api/v1",
};
let session: Session | undefined;
let authEpoch = 0;
let contextGeneration = crypto.randomUUID();
let socket: WebSocket | undefined;
let refresh: { epoch: number; promise: Promise<void> } | undefined;
let connecting: { generation: string; promise: Promise<void> } | undefined;
let sessionWrites = Promise.resolve();
let reconnect: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let stopped = false;
let retries = 0;
const observedSources = new Map<string, { userId: string; account: Account }>();
const tabSyncQueue = new Map<number, Promise<unknown>>();
const accountsByTab = new Map<
  number,
  { remoteAccountKey: string; accounts: Account[] }
>();
const reservedDispatches = new Set<string>();
let flushing = false;
let importStatus: any;
const importJobs = new Map<
  string,
  { nonce: string; userId: string; tabId: number; remoteAccountKey: string }
>();
const dispatches = new Map<
  string,
  { nonce: string; tabId: number; sourceAccountId: string }
>();
const ready = (async () => {
  if (!chrome.storage.session) {
    settings.active = false;
    return;
  }
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const [saved, auth, persisted] = await Promise.all([
    chrome.storage.local.get(SETTINGS),
    chrome.storage.session.get(SESSION),
    loadStoredSession(),
  ]);
  if (saved[SETTINGS])
    settings = { ...settings, ...migrateActiveFields(saved[SETTINGS]) };
  await chrome.storage.local.set({ [SETTINGS]: settings });
  session = persisted === undefined ? auth[SESSION] : persisted || undefined;
  if (session) await saveSession(session);
  else if (persisted === null) await chrome.storage.session.remove(SESSION);
  if (settings.active && session) void connect();
})();
function trusted(sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  const url = new URL(sender.url);
  return (
    url.origin === new URL(chrome.runtime.getURL("/")).origin &&
    /^\/src\/(options|popup)\/index\.html$/.test(url.pathname)
  );
}
function waSender(sender: chrome.runtime.MessageSender) {
  return (
    sender.id === chrome.runtime.id &&
    sender.frameId === 0 &&
    sender.tab?.id != null &&
    sender.url?.startsWith("https://web.whatsapp.com/")
  );
}
async function saveSession(next?: Session) {
  session = next;
  const write = sessionWrites
    .catch(() => {})
    .then(async () => {
      await storeSession(next);
      if (next) await chrome.storage.session.set({ [SESSION]: next });
      else await chrome.storage.session.remove(SESSION);
    });
  sessionWrites = write;
  await write;
}
function clientIdData() {
  return chrome.storage.local.get("haomai:installation").then(async (data) => {
    let installationKey = data["haomai:installation"];
    if (!installationKey) {
      installationKey = uuidV7();
      await chrome.storage.local.set({
        "haomai:installation": installationKey,
      });
    }
    return {
      type: "chrome",
      installationKey,
      name: "Chrome 好麦扩展",
      appVersion: chrome.runtime.getManifest().version,
    };
  });
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  authenticated = true,
  retry = true,
): Promise<any> {
  if (!/^\/[a-z][a-z0-9\-/]*(?:\?[^#]*)?$/.test(path) || path.includes(".."))
    throw new Error("接口路径不合法");
  if (!settings.active) throw new Error("当前为独立模式");
  const epoch = authEpoch;
  const accessToken = session?.accessToken;
  const response = await fetch(validateApiBase(settings.apiBaseUrl) + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authenticated && session
        ? { Authorization: `Bearer ${session.accessToken}` }
        : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25000),
  });
  if (authenticated && epoch !== authEpoch) throw new Error("会话已变化");
  if (response.status === 401 && authenticated && retry && session) {
    if (accessToken !== session.accessToken)
      return request(path, method, body, authenticated, false);
    if (refresh?.epoch !== epoch) {
      const epoch = authEpoch;
      const promise = request(
        "/auth/refresh",
        "POST",
        { refreshToken: session.refreshToken },
        false,
      )
        .then(async (value) => {
          if (epoch !== authEpoch) throw new Error("会话已变化");
          await saveSession(value);
        })
        .catch(async (e) => {
          if (epoch === authEpoch && e?.status === 401) await logoutLocal();
          throw e;
        })
        .finally(() => {
          if (refresh?.promise === promise) refresh = undefined;
        });
      refresh = { epoch, promise };
    }
    await refresh.promise;
    return request(path, method, body, authenticated, false);
  }
  const envelope = parseEnvelope(await response.json());
  if (!response.ok || envelope.code !== "ok")
    throw Object.assign(
      new Error(envelope.message || envelope.code || `HTTP ${response.status}`),
      { status: response.status, code: envelope.code },
    );
  return envelope.data;
}
function closeSocket() {
  if (heartbeat) clearInterval(heartbeat);
  if (reconnect) clearTimeout(reconnect);
  reconnect = undefined;
  heartbeat = undefined;
  const previous = socket;
  socket = undefined;
  previous?.close();
}
async function logoutLocal() {
  authEpoch++;
  contextGeneration = crypto.randomUUID();
  stopped = true;
  closeSocket();
  accountsByTab.clear();
  observedSources.clear();
  tabSyncQueue.clear();
  dispatches.clear();
  reservedDispatches.clear();
  importJobs.clear();
  importStatus = undefined;
  await saveSession();
  await broadcastTabs();
}
async function connect(): Promise<void> {
  if (
    !settings.active ||
    !session ||
    stopped ||
    socket?.readyState === WebSocket.OPEN ||
    socket?.readyState === WebSocket.CONNECTING
  )
    return;
  const generation = contextGeneration;
  if (connecting?.generation === generation) return connecting.promise;
  const promise = openSocket(generation);
  connecting = { generation, promise };
  try {
    await promise;
  } finally {
    if (connecting?.promise === promise) connecting = undefined;
  }
}
async function openSocket(generation: string): Promise<void> {
  try {
    const client = await clientIdData();
    const ticket = await request("/realtime/tickets", "POST", {
      client: { name: client.name, appVersion: client.appVersion },
    });
    if (generation !== contextGeneration || !session || stopped) return;
    const url = new URL(settings.apiBaseUrl + "/realtime/ws");
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("ticket", ticket.ticket);
    const ws = new WebSocket(url, "haomai.v1");
    socket = ws;
    ws.onopen = () => {
      if (generation !== contextGeneration || socket !== ws) {
        ws.close();
        return;
      }
      retries = 0;
      void flushOutbox();
      heartbeat = setInterval(() => {
        void flushOutbox();
        if (ws.readyState === WebSocket.OPEN)
          ws.send(
            JSON.stringify({
              version: 1,
              id: uuidV7(),
              requestId: null,
              type: "request",
              action: "system.ping",
              code: null,
              message: "",
              data: {},
              timestamp: new Date().toISOString(),
            }),
          );
      }, 20000);
      void broadcastTabs();
    };
    ws.onmessage = (event) => {
      if (generation !== contextGeneration || socket !== ws) {
        ws.close();
        return;
      }
      try {
        const e = parseEnvelope(JSON.parse(event.data));
        if (e.type !== "event") return;
        if (e.action === "message.dispatch") void dispatch(e.data);
        if (e.action === "session.revoked") void logoutLocal();
        void chrome.runtime
          .sendMessage({ kind: "HAOMAI_CHANGED", action: e.action })
          .catch(() => {});
      } catch {
        /* malformed frames never execute */
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = undefined;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
      scheduleReconnect();
      void broadcastTabs();
    };
    ws.onerror = () => ws.close();
  } catch {
    if (generation === contextGeneration) scheduleReconnect();
  }
}
function scheduleReconnect() {
  if (stopped || !session || !settings.active || reconnect) return;
  reconnect = setTimeout(
    () => {
      reconnect = undefined;
      void connect();
    },
    Math.min(30000, 1000 * 2 ** Math.min(retries++, 5)) + Math.random() * 500,
  );
}
async function broadcastTabs() {
  for (const tab of await chrome.tabs.query({
    url: "https://web.whatsapp.com/*",
  }))
    if (tab.id)
      void chrome.tabs
        .sendMessage(tab.id, {
          kind: "HAOMAI_MODE",
          active: settings.active && !!session,
          contextGeneration,
        })
        .catch(() => {});
}
async function syncTab(tabId: number, payload: any) {
  if (!settings.active || !session) return;
  const generation = contextGeneration;
  if (
    typeof payload.remoteAccountKey !== "string" ||
    !/^[^\s]{1,150}@[a-z.]+$/.test(payload.remoteAccountKey)
  )
    throw new Error("WhatsApp账号尚未登录");
  const data = await request("/social-accounts/sync", "POST", {
    accounts: [
      {
        platform: "whatsapp",
        remoteAccountKey: payload.remoteAccountKey,
        phone: String(payload.phone || "").slice(0, 40),
        displayName: String(payload.displayName || "").slice(0, 150),
        loginState: ["logged_in", "logged_out"].includes(payload.loginState)
          ? payload.loginState
          : "unknown",
      },
    ],
  });
  if (generation !== contextGeneration || !session) return;
  const accounts = Array.isArray(data)
    ? data
    : data.items || data.accounts || [];
  accountsByTab.set(tabId, {
    remoteAccountKey: payload.remoteAccountKey,
    accounts,
  });
  if (!accounts.length)
    observedSources.delete(`${tabId}:${payload.remoteAccountKey}`);
  if (session)
    for (const account of accounts)
      observedSources.set(`${tabId}:${account.remoteAccountKey}`, {
        userId: String(session.user.id),
        account,
      });
  void flushOutbox();
}
function sourceForTab(tabId: number, remoteAccountKey?: string) {
  if (remoteAccountKey) {
    const observed = observedSources.get(`${tabId}:${remoteAccountKey}`);
    if (
      observed &&
      session &&
      observed.userId === session.user.id &&
      observed.account.connectorClientId === session.clientId
    )
      return observed.account;
    return undefined;
  }
  return undefined;
}
function failureKey(userId: string, sourceId: string, remoteKey: string) {
  return `haomai:sync-failure:${userId}:${sourceId}:${remoteKey}`;
}
async function recordSyncFailure(tabId: number, payload: any) {
  const account = sourceForTab(tabId, payload?.remoteAccountKey);
  if (!account || !session) return;
  const parsed = parseMessageId(payload?.remoteMessageKey || "");
  if (
    !parsed ||
    parsed.chatId !== normalizeChatId(payload.remoteConversationKey || "")
  )
    return;
  const key = failureKey(session.user.id, account.id, payload.remoteMessageKey);
  await chrome.storage.local.set({
    [key]: {
      sourceAccountId: account.id,
      remoteMessageKey: payload.remoteMessageKey,
      remoteConversationKey: payload.remoteConversationKey,
      kind: payload.kind,
      errorCode: String(
        payload.errorCode || "platform_media_sync_failed",
      ).slice(0, 100),
      at: Date.now(),
    },
  });
  void chrome.runtime
    .sendMessage({ kind: "HAOMAI_CHANGED", action: "sync.error" })
    .catch(() => {});
}
async function uploadObserved(media: PlatformMedia): Promise<string> {
  const bytes = mediaBytes(media);
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const path = media.mimeType.startsWith("image/")
    ? "/media/images/upload-intents"
    : "/media/audio/upload-intents";
  const intent = await request(path, "POST", {
    originalName: media.originalName,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    md5Base64: md5(bytes),
    sha256,
    purpose: "message",
  });
  const url = new URL(intent.url);
  if (
    url.protocol !== "https:" &&
    !["127.0.0.1", "localhost"].includes(url.hostname)
  )
    throw new Error("invalid_upload_grant");
  const response = await fetch(intent.url, {
    method: intent.method || "PUT",
    headers: intent.headers,
    body: bytes,
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error("platform_media_upload_failed");
  const complete = await request(
    `/media/${intent.mediaId}/complete`,
    "POST",
    {},
  );
  return complete.id || complete.mediaId;
}
async function ingest(tabId: number, payload: any) {
  const account = sourceForTab(tabId, payload?.remoteAccountKey);
  if (!account || !session || !settings.active) return;
  if (
    typeof payload.remoteMessageKey !== "string" ||
    typeof payload.remoteConversationKey !== "string"
  )
    return;
  const parsed = parseMessageId(payload.remoteMessageKey);
  if (
    !parsed ||
    parsed.chatId !== normalizeChatId(payload.remoteConversationKey) ||
    parsed.fromMe !== (payload.direction === "outgoing")
  )
    return;
  const kind = payload.kind || "text";
  if (!["text", "image", "audio"].includes(kind)) return;
  if (
    typeof payload.text !== "string" ||
    (kind === "text" && !payload.text.trim()) ||
    !Number.isFinite(Date.parse(payload.occurredAt))
  )
    return;
  const linked =
    payload.direction === "outgoing" &&
    typeof payload.idempotencyKey === "string";
  const media =
    kind !== "text" && !linked
      ? validatePlatformMedia(payload.media, kind)
      : undefined;
  const owner = String(session.user.id);
  const body = {
    sourceAccountId: account.id,
    remoteConversationKey: payload.remoteConversationKey,
    remoteMessageKey: payload.remoteMessageKey,
    remoteCustomerKey: payload.remoteConversationKey,
    customerName: String(payload.customerName || "").slice(0, 150),
    text: [...payload.text].slice(0, 10000).join(""),
    kind,
    direction: payload.direction === "outgoing" ? "outgoing" : "incoming",
    ...(linked ? { idempotencyKey: payload.idempotencyKey } : {}),
    occurredAt: payload.occurredAt,
    historical: payload.historical === true,
  };
  const key = `haomai:outbox:${owner}:ingest:${account.id}:${payload.remoteMessageKey}`;
  if (!(await chrome.storage.local.get(key))[key]) {
    if (media) {
      const pending = await chrome.storage.local.get(null);
      const bytes = Object.entries(pending)
        .filter(([name]) => name.startsWith(`haomai:outbox:${owner}:`))
        .reduce(
          (sum, [, item]) => sum + Number(item?.media?.sizeBytes || 0),
          0,
        );
      if (bytes + media.sizeBytes > 100 * 1024 * 1024) {
        await recordSyncFailure(tabId, {
          ...payload,
          errorCode: "platform_media_queue_full",
        });
        throw new Error("待同步媒体较多，请连接服务器后重试");
      }
    }
    await chrome.storage.local.set({
      [key]: {
        path: "/messages/ingest",
        body,
        media,
        userId: owner,
        failureKey: failureKey(owner, account.id, payload.remoteMessageKey),
      },
    });
  }
  await flushOutbox();
}
async function flushOutbox() {
  if (flushing || !session || !settings.active) return;
  flushing = true;
  try {
    const owner = String(session.user.id);
    const all = await chrome.storage.local.get(null);
    for (const [key, raw] of Object.entries(all)) {
      const item = raw as any;
      if (
        !key.startsWith(`haomai:outbox:${owner}:`) ||
        item?.userId !== owner ||
        item.failed
      )
        continue;
      if (session?.user.id !== owner) return;
      try {
        if (item.media) {
          const id = await uploadObserved(
            validatePlatformMedia(item.media, item.body.kind),
          );
          item.body.mediaIds = [id];
          delete item.media;
          await chrome.storage.local.set({ [key]: item });
        }
        await request(item.path, "POST", item.body);
        await chrome.storage.local.remove(key);
        if (item.failureKey) await chrome.storage.local.remove(item.failureKey);
      } catch (error) {
        const e = error as any;
        if (item.failureKey) {
          await chrome.storage.local.set({
            [item.failureKey]: {
              sourceAccountId: item.body.sourceAccountId,
              remoteMessageKey: item.body.remoteMessageKey,
              remoteConversationKey: item.body.remoteConversationKey,
              kind: item.body.kind,
              errorCode: e?.code || e?.message || "platform_media_sync_failed",
              at: Date.now(),
            },
          });
          void chrome.runtime
            .sendMessage({ kind: "HAOMAI_CHANGED", action: "sync.error" })
            .catch(() => {});
        }
        if (
          e?.status >= 400 &&
          e.status < 500 &&
          e.status !== 401 &&
          e.status !== 429
        ) {
          item.failed = true;
          await chrome.storage.local.set({ [key]: item });
          continue;
        }
        break;
      }
    }
  } finally {
    flushing = false;
  }
}
async function persistResult(id: string, body: any) {
  if (!session) return;
  const key = `haomai:outbox:${session.user.id}:result:${id}`;
  await chrome.storage.local.set({
    [key]: { path: `/messages/${id}/result`, body, userId: session.user.id },
    [`haomai:dispatch:${session.user.id}:${id}`]: {
      state: body.state,
      result: body,
      at: Date.now(),
    },
  });
  await flushOutbox();
}
async function dispatch(data: any) {
  const generation = contextGeneration;
  const id = data?.id || data?.messageId;
  if (typeof id !== "string" || !session || reservedDispatches.has(id)) return;
  reservedDispatches.add(id);
  const storageKey = `haomai:dispatch:${session.user.id}:${id}`;
  const previous = (await chrome.storage.local.get(storageKey))[storageKey];
  if (previous) {
    await persistResult(
      id,
      previous.result || {
        state: "failed",
        errorCode: "platform_confirmation_uncertain",
      },
    );
    return;
  }
  const entry = [...accountsByTab].find(([, s]) =>
    s.accounts.some(
      (a) =>
        a.id === data.sourceAccountId &&
        a.remoteAccountKey === s.remoteAccountKey &&
        a.connectorClientId === session?.clientId,
    ),
  );
  if (!entry) {
    await request(`/messages/${id}/result`, "POST", {
      state: "failed",
      errorCode: "source_account_unavailable",
    });
    return;
  }
  const [tabId] = entry;
  const nonce = crypto.randomUUID();
  // Persist before touching WA: uncertain sends are never repeated after a worker restart.
  await chrome.storage.local.set({
    [storageKey]: { state: "dispatching", at: Date.now() },
  });
  dispatches.set(id, { nonce, tabId, sourceAccountId: data.sourceAccountId });
  try {
    if (data.kind === "image" || data.kind === "audio") {
      const attachments = [];
      for (const a of data.attachments || []) {
        if (!a.url || !/^https?:/.test(a.url))
          throw new Error("Invalid attachment URL");
        const response = await fetch(a.url, {
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error("Image download failed");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (
          bytes.length > 10 * 1024 * 1024 ||
          !/^(image|audio)\//.test(a.mimeType)
        )
          throw new Error("Unsupported image");
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        attachments.push({
          ...a,
          url: undefined,
          dataUrl: `data:${a.mimeType};base64,${btoa(binary)}`,
        });
      }
      data = { ...data, attachments };
    }
    if (generation !== contextGeneration || !session || !settings.active)
      return;
    await chrome.tabs.sendMessage(tabId, {
      kind: "HAOMAI_DISPATCH",
      contextGeneration: generation,
      nonce,
      remoteAccountKey: entry[1].remoteAccountKey,
      data: { ...data, id },
    });
  } catch {
    dispatches.delete(id);
    if (generation !== contextGeneration) return;
    await request(`/messages/${id}/result`, "POST", {
      state: "failed",
      errorCode: "browser_tab_unavailable",
    });
  }
}
async function ui(operation: string, msg: any) {
  if (operation === "snapshot") {
    const stored = await chrome.storage.local.get(null);
    const failures = session
      ? Object.entries(stored)
          .filter(([key]) =>
            key.startsWith(`haomai:sync-failure:${session!.user.id}:`),
          )
          .map(([, v]) => v)
      : [];
    return {
      settings,
      user: session?.user || null,
      clientId: session?.clientId || null,
      connected: socket?.readyState === WebSocket.OPEN,
      syncFailures: failures,
      importStatus:
        importStatus?.userId === session?.user.id ? importStatus : null,
    };
  }
  if (operation === "importRecent") {
    if (!session) throw new Error("请先登录");
    const entry = [...accountsByTab].find(([, source]) =>
      source.accounts.some(
        (a) =>
          a.id === msg.sourceAccountId &&
          a.connectorClientId === session?.clientId &&
          a.remoteAccountKey === source.remoteAccountKey &&
          a.loginState === "logged_in",
      ),
    );
    if (!entry) throw new Error("请在此浏览器登录对应 WhatsApp 来源账号后导入");
    if (importStatus?.state === "reading")
      throw new Error("正在读取最近消息，请稍候");
    const jobId = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const [tabId, source] = entry;
    importJobs.set(jobId, {
      nonce,
      userId: String(session.user.id),
      tabId,
      remoteAccountKey: source.remoteAccountKey,
    });
    importStatus = {
      userId: String(session.user.id),
      sourceAccountId: msg.sourceAccountId,
      state: "reading",
      readCount: 0,
      failedCount: 0,
    };
    try {
      await chrome.tabs.sendMessage(tabId, {
        kind: "HAOMAI_IMPORT_RECENT",
        jobId,
        nonce,
        remoteAccountKey: source.remoteAccountKey,
        contextGeneration,
        limit: 100,
      });
    } catch {
      importJobs.delete(jobId);
      importStatus.state = "failed";
      throw new Error("WhatsApp 页面尚未准备好，请刷新后重试");
    }
    return { started: true };
  }
  if (operation === "retrySync") {
    if (!session) throw new Error("请先登录");
    const owner = String(session.user.id);
    const all = await chrome.storage.local.get(null);
    for (const [key, item] of Object.entries(all))
      if (key.startsWith(`haomai:outbox:${owner}:`) && item?.failed) {
        item.failed = false;
        await chrome.storage.local.set({ [key]: item });
      }
    for (const [tabId, source] of accountsByTab) {
      const sourceIds = source.accounts.map((a) => a.id);
      const ids = Object.entries(all)
        .filter(
          ([key, v]) =>
            key.startsWith(`haomai:sync-failure:${owner}:`) &&
            sourceIds.includes(v.sourceAccountId),
        )
        .map(([, v]) => v.remoteMessageKey);
      if (ids.length)
        void chrome.tabs
          .sendMessage(tabId, { kind: "HAOMAI_RETRY_SYNC", ids })
          .catch(() => {});
    }
    void flushOutbox();
    return { retrying: true };
  }
  if (operation === "settings") {
    const next = migrateActiveFields(msg.settings) as BackendSettings;
    const apiBaseUrl = validateApiBase(next.apiBaseUrl);
    if (apiBaseUrl !== settings.apiBaseUrl) await logoutLocal();
    else contextGeneration = crypto.randomUUID();
    settings = { active: !!next.active, apiBaseUrl };
    await chrome.storage.local.set({ [SETTINGS]: settings });
    stopped = false;
    closeSocket();
    if (settings.active) void connect();
    await broadcastTabs();
    return settings;
  }
  if (operation === "login" || operation === "register") {
    // Retire the old connection before the server revokes its session. Its late
    // session.revoked/close callbacks must never log out the replacement.
    contextGeneration = crypto.randomUUID();
    closeSocket();
    const epoch = ++authEpoch;
    let result;
    try {
      result = await request(
        `/auth/${operation}`,
        "POST",
        { ...msg.body, client: await clientIdData() },
        false,
      );
    } catch (error) {
      if (epoch === authEpoch) void connect();
      throw error;
    }
    if (epoch !== authEpoch) throw new Error("会话已变化");
    contextGeneration = crypto.randomUUID();
    await saveSession(result);
    stopped = false;
    void connect();
    await broadcastTabs();
    return { user: result.user };
  }
  if (operation === "logout") {
    try {
      await request("/auth/logout", "POST", {
        refreshToken: session?.refreshToken,
      });
    } finally {
      await logoutLocal();
    }
    return { loggedOut: true };
  }
  if (operation === "api") {
    const path = String(msg.path);
    if (
      path.startsWith("/admin") ||
      path.startsWith("/auth/login") ||
      path.startsWith("/auth/register") ||
      path.startsWith("/auth/refresh")
    )
      throw new Error("接口不可通过通用代理访问");
    const result = await request(
      path,
      msg.method,
      msg.body,
      !["/auth/challenges", "/auth/password/reset", "/public/config"].includes(
        path,
      ),
    );
    if (path === "/me" && session && result?.id === session.user.id)
      await saveSession({ ...session, user: result });
    return result;
  }
  throw new Error("不支持的操作");
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.kind === "HAOMAI_UI") {
    if (!trusted(sender)) {
      respond({ ok: false, error: "仅扩展页面可访问账户接口" });
      return false;
    }
    void ready
      .then(() => ui(msg.operation, msg))
      .then(
        (data) => respond({ ok: true, data }),
        (error) =>
          respond({
            ok: false,
            error: error instanceof Error ? error.message : "请求失败",
          }),
      );
    return true;
  }
  if (msg?.kind === "HAOMAI_CONTENT") {
    if (!waSender(sender)) return false;
    void ready
      .then(async () => {
        const tabId = sender.tab!.id!;
        if (msg.operation === "mode")
          return { active: settings.active && !!session, contextGeneration };
        if (
          ["sync", "ingest", "sync_error"].includes(msg.operation) &&
          msg.payload?.contextGeneration !== contextGeneration
        )
          throw new Error("平台观察所属登录会话已变化");
        if (msg.operation === "sync") {
          const task = (tabSyncQueue.get(tabId) || Promise.resolve())
            .catch(() => {})
            .then(() => syncTab(tabId, msg.payload));
          tabSyncQueue.set(tabId, task);
          return task;
        }
        if (msg.operation === "ingest" || msg.operation === "sync_error")
          await tabSyncQueue.get(tabId);
        if (msg.operation === "ingest") return ingest(tabId, msg.payload);
        if (msg.operation === "sync_error")
          return recordSyncFailure(tabId, msg.payload);
        if (msg.operation === "import_result") {
          const job = importJobs.get(msg.payload?.jobId);
          if (
            !job ||
            job.nonce !== msg.payload.nonce ||
            job.tabId !== tabId ||
            job.userId !== session?.user.id ||
            job.remoteAccountKey !== msg.payload.remoteAccountKey
          )
            throw new Error("历史导入归属无效");
          importJobs.delete(msg.payload.jobId);
          importStatus = {
            ...importStatus,
            state: msg.payload.errorCode ? "failed" : "queued",
            readCount: Math.min(
              100,
              Math.max(0, Number(msg.payload.readCount) || 0),
            ),
            failedCount: Math.min(
              100,
              Math.max(0, Number(msg.payload.failedCount) || 0),
            ),
            errorCode: msg.payload.errorCode,
          };
          void chrome.runtime
            .sendMessage({ kind: "HAOMAI_CHANGED", action: "history.imported" })
            .catch(() => {});
          return { recorded: true };
        }
        if (msg.operation === "result") {
          const pending = dispatches.get(msg.payload?.id);
          if (
            !pending ||
            pending.nonce !== msg.payload.nonce ||
            pending.tabId !== tabId
          )
            throw new Error("发送结果归属无效");
          dispatches.delete(msg.payload.id);
          return persistResult(msg.payload.id, {
            state: msg.payload.ok ? "sent" : "failed",
            remoteMessageKey: msg.payload.remoteMessageKey,
            errorCode: msg.payload.ok ? undefined : "platform_send_failed",
          });
        }
        throw new Error("不支持的桥接操作");
      })
      .then(
        (data) => respond({ ok: true, data }),
        () => respond({ ok: false, error: "平台同步失败，请检查好麦连接" }),
      );
    return true;
  }
  return false;
});
chrome.runtime.onStartup?.addListener(() => void ready.then(() => connect()));
chrome.runtime.onInstalled?.addListener(() => void ready.then(() => connect()));
// Timers disappear when an idle worker is suspended during a network outage.
// A Chrome alarm wakes it to restore the existing authenticated connection.
chrome.alarms.create("haomai:reconnect", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "haomai:reconnect") void ready.then(() => connect());
});
