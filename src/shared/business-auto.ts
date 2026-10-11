export const BUSINESS_AUTO_LEASE_KEY = 'waTranslate:business:auto-lease';
export const BUSINESS_AUTO_STATUS_KEY = 'waTranslate:business:auto-status';
export const BUSINESS_AUTO_ORDER_KEY = 'waTranslate:business:arrival-order';
export const AUTO_IDLE_MS = 5000;
export const AUTO_LEASE_MS = 30_000;

export interface BusinessAutoLease {
  owner: string;
  token: string;
  tabId?: number;
  expiresAt: number;
}
export interface BusinessAutoStatus {
  owner: string;
  phase: 'idle' | 'waiting' | 'switching' | 'composing' | 'sending' | 'paused' | 'blocked';
  pending: number;
  manual: number;
  customer: string;
  reason: string;
  updatedAt: number;
}
export interface NativeAutoRequest {
  id: string;
  messageId: string;
  chatId: string;
  text: string;
  preparedReply?: string;
  draftLanguage: 'zh-CN' | 'es-MX';
  images: import('./types').ProductImage[];
  queueToken: string;
}
