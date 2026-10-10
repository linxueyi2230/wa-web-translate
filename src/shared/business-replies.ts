import type { BusinessData, Product, ReplyCategory, ReplyKeyword, ReplyLanguage } from './types';

export interface IncomingBusinessMessage { id: string; chatId: string; text: string; receivedAt: number }
export interface BusinessRuntimeRecord {
  message: IncomingBusinessMessage;
  status: 'pending' | 'processing' | 'ready' | 'sending' | 'sent' | 'dismissed' | 'no-match';
  owner?: string;
  updatedAt: number;
  translated?: string;
  reply?: string;
  categories?: ReplyCategory[];
  productIds?: string[];
  error?: string;
  manualOnly?: boolean;
  settingsSignature?: string;
}
export const BUSINESS_RUNTIME_PREFIX = 'waTranslate:business:message:';
export const BUSINESS_CONTEXT_PREFIX = 'waTranslate:business:context:';
export function businessSettingsSignature(data: BusinessData): string {
  // Image IDs change on replacement; do not duplicate the whole image catalog in
  // every message record just to detect configuration changes during preparation.
  const text = JSON.stringify({ ...data, activeTab: '', products: data.products.map(({ images, ...product }) => ({ ...product, images: images.map(({ id, name }) => ({ id, name })) })) });
  let first = 2166136261; let second = 5381;
  for (let index = 0; index < text.length; index++) {
    first = Math.imul(first ^ text.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ text.charCodeAt(index);
  }
  return `${text.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}
export interface ReplyPart { text: string; language: ReplyLanguage }
export interface ReplyPlan {
  categories: ReplyCategory[];
  products: Product[];
  parts: ReplyPart[];
  priceRequested: boolean;
  needsProductSelection: boolean;
  missing: string[];
  autoAllowed: boolean;
  paymentOptions: boolean;
}

export const CATEGORY_NAMES: Record<ReplyCategory, string> = {
  product: '商品信息', payment: '支付方式', shipping: '物流与时效', trust: '信任与保障',
};
const PRICE_TERMS = ['多少钱', '价格', '价钱', '价位', '单价', '最低价', '总价', '售价', '报价', '优惠', '折扣', '便宜', '贵吗', '费用', '运费', '邮费', '手续费'];
const ALTERNATIVE_TERMS = ['其他支付方式', '其他付款方式', '无法付款', '不方便付款', '不能转账', '没有银行账户'];
const CONTEXT_PAYMENT_TERMS = ['不方便', '其他方式', '不能付款', '无法支付'];

function normalized(text: string): string { return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim(); }

export function matchesKeyword(text: string, keyword: string): boolean {
  const source = normalized(text);
  const term = normalized(keyword);
  if (!term) return false;
  if (/[\u3400-\u9fff]/.test(term)) return source.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'u').test(source);
}
export function matchesKeywords(text: string, keywords: ReplyKeyword[]): boolean {
  return keywords.some((keyword) => keyword.enabled && matchesKeyword(text, keyword.text));
}
export function hasPriceIntent(text: string): boolean { return PRICE_TERMS.some((term) => matchesKeyword(text, term)); }
export function containsPriceContent(text: string): boolean {
  return hasPriceIntent(text) || /\b(?:precio|precios|descuento|cotización|costo|costos)\b/iu.test(text)
    || /(?:[$€¥￥]\s*\d|(?<!\d)\d{1,7}(?:[.,]\d{1,2})?\s*(?:USD|MXN|CNY|EUR)\b|\b(?:USD|MXN|CNY|EUR)\s*\d{1,7}(?!\d))/iu.test(text);
}

export function buildReplyPlan(text: string, data: BusinessData, lastCategory?: ReplyCategory, selectedProductId?: string): ReplyPlan {
  const enabledProducts = data.products.filter((product) => product.enabled);
  let products = enabledProducts.filter((product) => matchesKeywords(text, product.keywords));
  const priceRequested = hasPriceIntent(text);
  if (selectedProductId) products = enabledProducts.filter((product) => product.id === selectedProductId);
  const paymentMatched = matchesKeywords(text, data.paymentKeywords.filter((keyword) => lastCategory === 'payment' || !CONTEXT_PAYMENT_TERMS.includes(keyword.text)));
  const paymentOptions = paymentMatched && [...ALTERNATIVE_TERMS, ...CONTEXT_PAYMENT_TERMS].some((term) => matchesKeyword(text, term));
  const paymentMethods = data.paymentMethods.filter((method) => method.enabled && method.name.trim() && method.content.trim());
  const explicitMethod = paymentMethods.find((method) => matchesKeyword(text, method.name)
    && (paymentMatched || lastCategory === 'payment' && data.paymentKeywords.some((keyword) => keyword.enabled))
    && !data.paymentKeywords.some((keyword) => !keyword.enabled && normalized(keyword.text) === normalized(method.name)));
  const categories: ReplyCategory[] = [];
  if (products.length) categories.push('product');
  if (paymentMatched || explicitMethod) categories.push('payment');
  if (matchesKeywords(text, data.shippingKeywords)) categories.push('shipping');
  if (matchesKeywords(text, data.trustKeywords)) categories.push('trust');
  const parts: ReplyPart[] = [];
  const missing: string[] = [];
  const needsProductSelection = products.length > 1;
  if (categories.includes('product')) {
    if (!products.length) missing.push('未找到对应商品，请选择或启用商品');
    if (products.length === 1) {
      const product = products[0];
      const showProductPrice = priceRequested && !['运费', '邮费', '手续费', '物流费'].some((term) => matchesKeyword(text, term));
      parts.push({ text: `${product.name}${product.model ? `\nModelo: ${product.model}` : ''}${showProductPrice ? `\nPrecio: ${product.price} ${product.currency}` : ''}`, language: 'es-MX' });
      if (product.description.trim()) parts.push({ text: product.description, language: data.productLanguage });
    }
  }
  if (categories.includes('payment')) {
    const chosen = explicitMethod ?? paymentMethods.find((method) => method.isDefault);
    if (paymentOptions && !explicitMethod) {
      const alternatives = paymentMethods.filter((method) => !method.isDefault);
      if (!alternatives.length) missing.push('尚未填写可用的备用收款方式');
      else parts.push({ text: `También puedes pagar con:\n${alternatives.map((method) => method.id === 'bank-transfer' ? 'Transferencia bancaria' : method.name).join('\n')}\n¿Qué opción prefieres?`, language: 'es-MX' });
    } else if (chosen) parts.push({ text: chosen.content, language: data.paymentLanguage });
    else missing.push('请先填写并启用默认收款方式');
  }
  if (categories.includes('shipping')) {
    if (!data.shippingDays.trim() || !data.shippingMethod.trim() || !data.dispatchText.trim()) missing.push('请补齐物流时间、方式和发货安排');
    else parts.push({ text: data.shippingLanguage === 'zh-CN'
      ? `发货后预计送达时间：${data.shippingDays}\n物流方式：${data.shippingMethod}\n发货安排：${data.dispatchText}`
      : `Entrega estimada tras el envío: ${data.shippingDays}\nEnvío: ${data.shippingMethod}\n${data.dispatchText}`, language: data.shippingLanguage });
  }
  if (categories.includes('trust')) {
    if (!data.trustText.trim()) missing.push('请填写信任与保障说明');
    else parts.push({ text: data.trustText, language: data.trustLanguage });
    if (data.includeGroupInvite) {
      if (!validGroupUrl(data.customerGroupUrl)) missing.push('客户群邀请链接无效');
      else parts.push({ text: `Puedes visitar nuestro grupo de WhatsApp para conocer las experiencias de otros clientes. Al unirte, los miembros pueden ver tu número de teléfono y tus mensajes en el grupo. Únete solo si estás de acuerdo.\n${data.customerGroupUrl.trim()}`, language: 'es-MX' });
    }
  }
  return { categories, products, parts, priceRequested, needsProductSelection, missing, paymentOptions,
    autoAllowed: data.globalAutoReply && data.riskConfirmed && categories.length === 1 && !priceRequested
      && !needsProductSelection && !missing.length && categories.every((category) => data.autoReply[category]) };
}

export function validGroupUrl(text: string): boolean {
  try { const url = new URL(text.trim()); return url.protocol === 'https:' && url.hostname === 'chat.whatsapp.com' && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname); }
  catch { return false; }
}
