export const DEFAULT_PRODUCT_CURRENCY = 'MXN';
export const PRODUCT_CURRENCIES = [
  { code: 'MXN', name: '墨西哥比索' },
  { code: 'USD', name: '美元' },
  { code: 'CNY', name: '人民币' },
  { code: 'EUR', name: '欧元' },
] as const;

// WhatsApp's published image guidance uses 16 MB. Web clients expose a
// version-dependent limit; prefer that value when it is available.
export const DEFAULT_WHATSAPP_IMAGE_LIMIT_BYTES = 16 * 1024 * 1024;
export const WHATSAPP_IMAGE_LIMIT_KEY = 'waTranslate:media:image-limit';
export const WHATSAPP_IMAGE_LIMIT_TTL_MS = 10 * 60_000;

export interface WhatsAppImageLimit {
  bytes: number | null;
  checkedAt: number;
}

export function validImageLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function formatImageLimit(bytes: number): string {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(bytes / (1024 * 1024))} MB`;
}

export async function loadWhatsAppImageLimit(): Promise<number> {
  const stored = (await chrome.storage.local.get(WHATSAPP_IMAGE_LIMIT_KEY))[WHATSAPP_IMAGE_LIMIT_KEY] as WhatsAppImageLimit | undefined;
  const age = stored ? Date.now() - stored.checkedAt : Infinity;
  return stored && validImageLimit(stored.bytes) && age >= 0 && age < WHATSAPP_IMAGE_LIMIT_TTL_MS
    ? stored.bytes : DEFAULT_WHATSAPP_IMAGE_LIMIT_BYTES;
}
