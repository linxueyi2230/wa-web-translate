export interface HaomaiEnvelope<T = unknown> {
  version: 1;
  id: string;
  requestId: string | null;
  type: "request" | "response" | "event";
  action: string;
  code: string | null;
  message: string;
  data: T;
  timestamp: string;
}
export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  clientId: string;
  user: Record<string, any>;
}
export interface BackendSettings {
  active: boolean;
  apiBaseUrl: string;
}
export interface Account {
  id: string;
  platform: string;
  remoteAccountKey: string;
  displayName: string;
  phone: string;
  loginState: string;
  connectorClientId: string;
  online: boolean;
  offlineReason?: string;
}
/** Unknown actors in imported history remain nullable; system jobs use a reserved actor UUID. */
export interface AuditMetadata {
  createdBy?: string | null;
  updatedBy?: string | null;
  deleted?: boolean;
  deletedBy?: string | null;
  deletedAt?: string | null;
}
export interface ChatMessage extends AuditMetadata {
  id: string;
  sourceAccountId: string;
  conversationId: string;
  originalText?: string | null;
  translatedText?: string | null;
  /** Missing/null means unknown; never substitute the conversation's current language. */
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  direction: "incoming" | "outgoing";
  kind: "text" | "image" | "audio";
  sendState: string;
  occurredAt: string;
}
export interface PageResult<T = any> {
  items: T[];
  total: number;
  nextCursor: string | null;
}
export function parseEnvelope(value: unknown): HaomaiEnvelope {
  const v = value as HaomaiEnvelope;
  if (
    !v ||
    v.version !== 1 ||
    typeof v.id !== "string" ||
    !["request", "response", "event"].includes(v.type) ||
    typeof v.action !== "string" ||
    !("data" in v)
  )
    throw new Error("服务器协议格式错误");
  return v;
}
export function uuidV7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let now = Date.now();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = now & 255;
    now = Math.floor(now / 256);
  }
  bytes[6] = (bytes[6] & 15) | 112;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function validateApiBase(raw: string): string {
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new Error("服务器必须使用 HTTPS；本机开发可用 HTTP");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("服务器地址不能含凭据、查询参数或片段");
  return url.href.replace(/\/$/, "");
}
