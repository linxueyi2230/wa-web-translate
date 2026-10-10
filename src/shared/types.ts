import type { LanguageCode } from './languages';

export type Provider = 'deepseek' | 'anthropic' | 'openai' | 'google';

export interface Config {
  nativeLang: LanguageCode;
  targetLang: LanguageCode;
  provider: Provider;
  apiKeys: Partial<Record<Provider, string>>;
  model: Partial<Record<Provider, string>>;
  personality: string;
  enabled: boolean;
}

export type ReplyCategory = 'product' | 'payment' | 'shipping' | 'trust';
export type ReplyLanguage = 'zh-CN' | 'es-MX';

export interface ReplyKeyword {
  id: string;
  text: string;
  enabled: boolean;
  source: 'default' | 'manual' | 'ai';
}

export interface ProductImage {
  id: string;
  name: string;
  dataUrl: string;
}

export interface Product {
  id: string;
  name: string;
  model: string;
  description: string;
  price: string;
  currency: string;
  images: ProductImage[];
  coverImageId: string;
  keywords: ReplyKeyword[];
  enabled: boolean;
  updatedAt: number;
}

export interface PaymentMethod {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  enabled: boolean;
}

export interface BusinessData {
  version: 1;
  activeTab: string;
  productLanguage: ReplyLanguage;
  products: Product[];
  paymentLanguage: ReplyLanguage;
  paymentKeywords: ReplyKeyword[];
  paymentMethods: PaymentMethod[];
  shippingLanguage: ReplyLanguage;
  shippingKeywords: ReplyKeyword[];
  shippingDays: string;
  shippingMethod: string;
  dispatchText: string;
  trustLanguage: ReplyLanguage;
  trustKeywords: ReplyKeyword[];
  trustText: string;
  customerGroupUrl: string;
  includeGroupInvite: boolean;
  globalAutoReply: boolean;
  riskConfirmed: boolean;
  autoReply: Record<ReplyCategory, boolean>;
}

export function newKeyword(text: string, source: ReplyKeyword['source'] = 'manual'): ReplyKeyword {
  return { id: crypto.randomUUID(), text: text.trim(), enabled: true, source };
}

export const DEFAULT_PRODUCT_KEYWORDS = ['商品信息', '产品信息', '全部信息', '商品详情', '产品详情', '图片', '型号', '多少钱', '价格', '价钱', '报价', '优惠', '折扣'];

export const DEFAULT_BUSINESS_DATA: BusinessData = {
  version: 1,
  activeTab: 'settings',
  productLanguage: 'zh-CN',
  products: [],
  paymentLanguage: 'es-MX',
  paymentKeywords: ['怎么付款', '怎么支付', '如何支付', '付款方式', '支付方式', '其他支付方式', '其他付款方式', '无法付款', '不方便付款', '不能转账', '没有银行账户', '不方便', '其他方式', '不能付款', '无法支付', 'OXXO', '银行转账'].map((text, index) => ({ id: `payment-${index}`, text, enabled: true, source: 'default' as const })),
  paymentMethods: [
    { id: 'bank-transfer', name: '银行转账', content: '', isDefault: true, enabled: true },
    { id: 'oxxo', name: 'OXXO', content: '', isDefault: false, enabled: true },
  ],
  shippingLanguage: 'zh-CN',
  shippingKeywords: ['多久能收到', '几天到', '什么时候发货', '多久发货', '物流方式', '发货方式'].map((text, index) => ({ id: `shipping-${index}`, text, enabled: true, source: 'default' as const })),
  shippingDays: '9–12 天',
  shippingMethod: '中国物流',
  dispatchText: '通常当天下午安排发货，节假日可能顺延。',
  trustLanguage: 'zh-CN',
  trustKeywords: ['交易安全吗', '可靠吗', '付款安全吗', '客户评价', '真实反馈'].map((text, index) => ({ id: `trust-${index}`, text, enabled: true, source: 'default' as const })),
  trustText: '收到付款后我们会先核实，确认到账后才会安排发货。',
  customerGroupUrl: '',
  includeGroupInvite: false,
  globalAutoReply: false,
  riskConfirmed: false,
  autoReply: { product: false, payment: false, shipping: false, trust: false },
};

export const DEFAULT_CONFIG: Config = {
  nativeLang: 'en',
  targetLang: 'zh-CN',
  provider: 'deepseek',
  apiKeys: {},
  model: {
    deepseek: 'deepseek-flash',
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o-mini',
    google: 'gemini-2.0-flash',
  },
  personality: 'Translate naturally and idiomatically. Match the tone of the original message (casual chat stays casual, formal stays formal). Preserve emojis. Do not add explanations.',
  enabled: true,
};

export interface TranslateRequest {
  text: string;
  source?: LanguageCode | 'auto';
  target: LanguageCode;
}

export interface TranslateResult {
  translated: string;
  source: LanguageCode | 'unknown';
  target: LanguageCode;
}
