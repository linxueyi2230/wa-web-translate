import type { BusinessData, CommonPhrase, Product, ReplyCategory, ReplyKeyword, ReplyLanguage } from './types';

export interface IncomingBusinessMessage { id: string; chatId: string; text: string; receivedAt: number }
export interface BusinessDraftSnapshot {
  text: string;
  imageIds: string[];
  mediaOpen: boolean;
  bounds?: { left: number; top: number; width: number; height: number };
}
export interface BusinessRuntimeRecord {
  message: IncomingBusinessMessage;
  status: 'pending' | 'processing' | 'queued' | 'ready' | 'sending' | 'sent' | 'dismissed' | 'no-match';
  owner?: string;
  updatedAt: number;
  queueOrder?: number;
  translated?: string;
  translationPolicyVersion?: string;
  translationContext?: string;
  reply?: string;
  preparedReply?: string;
  draftLanguage?: ReplyLanguage;
  categories?: ReplyCategory[];
  productIds?: string[];
  phraseIds?: string[];
  productPriceOnly?: boolean;
  error?: string;
  manualOnly?: boolean;
  settingsSignature?: string;
}
export const BUSINESS_RUNTIME_PREFIX = 'waTranslate:business:message:';
export const BUSINESS_CONTEXT_PREFIX = 'waTranslate:business:context:';
export const compareBusinessArrival = (a: BusinessRuntimeRecord, b: BusinessRuntimeRecord): number =>
  (a.queueOrder ?? a.message.receivedAt) - (b.queueOrder ?? b.message.receivedAt);
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
export interface ReplyPart {
  text: string;
  language: ReplyLanguage;
  label?: 'model' | 'price' | 'description';
  verbatim?: boolean;
  preserveText?: boolean;
  separatorBefore?: '\n' | '\n\n' | ', ';
}
export const REPLY_LABELS: Record<ReplyLanguage, Record<NonNullable<ReplyPart['label']>, string>> = {
  'zh-CN': { model: '型号：', price: '价格：', description: '描述：' },
  'es-MX': { model: 'Modelo: ', price: 'Precio: ', description: 'Descripción: ' },
};

const SENTENCE_END = /[。！？.!?…]["'”’」』）)\]]*$/u;
const FIELD_END = /[，,。.!！?？；;：:、…]["'”’」』）)\]]*$/u;
const endsWithUrl = (text: string) => /https?:\/\/\S+$/iu.test(text);

function replySentence(text: string, language: ReplyLanguage): string {
  const value = text.trim().replace(/[，,；;、]+$/u, '');
  if (!value || SENTENCE_END.test(value) || endsWithUrl(value)) return value;
  return `${value}${language === 'zh-CN' ? '。' : '.'}`;
}

function joinReplyFields(first: string, second: string, language: ReplyLanguage): string {
  const left = first.trim(); const right = second.trim();
  if (!left) return right;
  if (!right) return left;
  const comma = language === 'zh-CN' ? '，' : ', ';
  if (endsWithUrl(left)) return `${left} ${right}`; // Keep punctuation out of URLs.
  if (/[，,]+$/u.test(left)) return `${left.replace(/[，,]+$/u, '')}${comma}${right}`;
  if (FIELD_END.test(left)) return `${left}${language === 'zh-CN' ? '' : ' '}${right}`;
  return `${left}${comma}${right}`;
}

export function joinReplyParagraphs(parts: readonly string[], language: ReplyLanguage, separator: '\n' | '\n\n' = '\n\n'): string {
  return parts.map((part) => part.trim()).filter(Boolean).reduce((reply, part) => {
    if (!reply) return part;
    // The punctuation remains even if the native editor removes line breaks.
    // A URL instead needs a literal space so its address stays unchanged.
    const previous = replySentence(reply, language);
    return `${previous}${language === 'es-MX' || endsWithUrl(previous) ? ' ' : ''}${separator}${part}`;
  }, '');
}

export function formatReplyParts(parts: readonly Pick<ReplyPart, 'text' | 'label' | 'separatorBefore' | 'preserveText'>[], language: ReplyLanguage): string {
  let previousPreserved = false;
  return parts.reduce((reply, part) => {
    const value = part.text.replace(/\r\n?/g, '\n').trim();
    const inline = part.separatorBefore === ', ';
    const text = inline ? value.split(/\n+/).reduce((field, line) => joinReplyFields(field, line, language), '') : value;
    if (!text) return reply;
    const field = `${part.label ? REPLY_LABELS[language][part.label] : ''}${text}`;
    const result = previousPreserved ? `${reply}\n\n${field}` : inline ? joinReplyFields(reply, field, language)
      : joinReplyParagraphs([reply, field], language, part.separatorBefore === '\n' ? '\n' : '\n\n');
    previousPreserved = Boolean(part.preserveText);
    return result;
  }, '');
}

export function usablePhrase(phrase: CommonPhrase): boolean {
  return phrase.enabled && Boolean(phrase.title.trim() && phrase.content.trim())
    && phrase.keywords.some((keyword) => keyword.enabled && keyword.text.trim());
}

export function hasAutomaticReplies(data: BusinessData): boolean {
  return Object.values(data.autoReply).some(Boolean) || data.phrases.some(usablePhrase);
}

export function automaticCategoriesEnabled(data: BusinessData, categories: readonly ReplyCategory[] | undefined, phraseIds: readonly string[] = []): boolean {
  if (!categories?.length) return false;
  return categories.every((category) => category === 'phrase'
    ? phraseIds.length > 0 && phraseIds.every((id) => data.phrases.some((phrase) => phrase.id === id && usablePhrase(phrase)))
    : data.autoReply[category] === true);
}

export function isNumericProductPrice(price: string): boolean {
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(price.trim());
}

export function productReplyImages(product: Product | undefined, priceOnly = false): Product['images'] {
  if (!product || priceOnly) return [];
  const cover = product.images.find((image) => image.id === product.coverImageId) ?? product.images[0];
  return (cover ? [cover, ...product.images.filter((image) => image.id !== cover.id)] : []).slice(0, 6);
}
export interface ReplyPlan {
  categories: ReplyCategory[];
  products: Product[];
  phrases: CommonPhrase[];
  parts: ReplyPart[];
  priceRequested: boolean;
  productPriceOnly: boolean;
  needsProductSelection: boolean;
  missing: string[];
  autoAllowed: boolean;
  paymentOptions: boolean;
}

export const CATEGORY_NAMES: Record<ReplyCategory, string> = {
  product: '商品信息', payment: '支付方式', shipping: '物流与时效', trust: '信任与保障', phrase: '常用语',
};
const PRICE_TERMS = ['多少钱', '价格', '价钱', '价位', '单价', '最低价', '总价', '售价', '报价', '优惠', '折扣', '便宜', '贵吗', '费用', '运费', '邮费', '手续费'];
const PRODUCT_INFORMATION_TERMS = ['信息', '详情', '介绍', '描述', '图片', '照片', '相片', '规格', '尺码', '尺寸', '颜色', '材质', '面料', '参数', '功能'];
const NON_PRODUCT_PRICE_TERMS = ['运费', '邮费', '手续费', '物流费'];
const ALTERNATIVE_TERMS = ['其他支付方式', '其他付款方式', '无法付款', '不方便付款', '不能转账', '没有银行账户'];
const CONTEXT_PAYMENT_TERMS = ['不方便', '其他方式', '不能付款', '无法支付'];

function normalized(text: string): string { return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim(); }

export function matchesKeyword(text: string, keyword: string): boolean {
  const source = normalized(text);
  const term = normalized(keyword);
  if (!term) return false;
  if (/[\u3400-\u9fff]/.test(term)) {
    if (source.includes(term)) return true;
    if (term === '发货方式' && /(?:怎么|如何)发货/.test(source)) return true;
    const information = /^(商品|产品)(信息|详情)$/.exec(term);
    if (information) {
      // Translation can produce “产品的信息” or “产品的更多信息”. Keep the
      // user's enabled phrase, allowing only these narrow grammatical variants.
      return new RegExp(`${information[1]}(?:的)?(?:(?:更多|详细|全部|所有|基本|相关|一些)(?:的)?){0,2}${information[2]}`).test(source);
    }
    return false;
  }
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'u').test(source);
}
export function matchesKeywords(text: string, keywords: ReplyKeyword[]): boolean {
  return keywords.some((keyword) => keyword.enabled && matchesKeyword(text, keyword.text));
}

const GREETING_WORDS = new Set(['你好', '您好', '嗨', '哈喽', 'hola', 'hello', 'hi']);

export function simpleGreetingChinese(text: string): string | undefined {
  const greeting = normalized(text).replace(/^[\p{P}\p{S}\s\uFE0F\u200D]+|[\p{P}\p{S}\s\uFE0F\u200D]+$/gu, '');
  if (!GREETING_WORDS.has(greeting)) return undefined;
  return /[\u3400-\u9fff]/u.test(greeting) ? greeting : '你好';
}

export function matchesPhraseKeywords(text: string, keywords: ReplyKeyword[]): boolean {
  return keywords.some((keyword) => {
    if (!keyword.enabled) return false;
    if (matchesKeyword(text, keyword.text)) return true;
    if (!GREETING_WORDS.has(normalized(keyword.text))) return false;
    // Greeting translations vary between “你好”, “您好” and “嗨”. Match
    // whole Latin words and Chinese greetings at the beginning of a message.
    return ['hola', 'hello', 'hi'].some((word) => matchesKeyword(text, word))
      || /^(?:你好|您好|嗨|哈喽)(?:[\s\p{P}\p{S}]|$)/u.test(normalized(text));
  });
}
export function hasPriceIntent(text: string): boolean { return PRICE_TERMS.some((term) => matchesKeyword(text, term)); }
function hasProductInformationIntent(text: string): boolean {
  if (PRODUCT_INFORMATION_TERMS.some((term) => matchesKeyword(text, term))) return true;
  // A reference such as “这个型号多少钱” asks only for a price. Requests for
  // model details, or “型号和价格”, should still include the product information.
  return /(?:什么|哪些|哪种|所有|全部|各个)型号|型号\s*(?:[、,，和及与]|是什么|有哪些|有哪|有几|介绍|信息|参数|列表)|[、,，和及与]\s*型号|(?:提供|告诉(?:我)?|发送|发给(?:我)?|查看|看看|了解|要看|想看)(?:一下|下|商品的|产品的|它的)?型号/.test(normalized(text));
}
export function containsPriceContent(text: string): boolean {
  return hasPriceIntent(text) || /\b(?:precio|precios|descuento|cotización|costo|costos)\b/iu.test(text)
    || /(?:[$€¥￥]\s*\d|(?<!\d)\d{1,7}(?:[.,]\d{1,2})?\s*(?:USD|MXN|CNY|EUR)\b|\b(?:USD|MXN|CNY|EUR)\s*\d{1,7}(?!\d))/iu.test(text);
}

export function groupInvitationText(language: ReplyLanguage, url: string): string {
  const invitation = language === 'zh-CN'
    ? '你可以加入我们的 WhatsApp 客户体验群，查看其他客户的购买体验。加入后，群成员可以看到你的电话号码和群内发言，请确认愿意后再加入。'
    : 'Puedes visitar nuestro grupo de WhatsApp para conocer las experiencias de otros clientes. Al unirte, los miembros pueden ver tu número de teléfono y tus mensajes en el grupo. Únete solo si estás de acuerdo.';
  return `${invitation}\n${url.trim()}`;
}

export function shippingReplyText(data: Pick<BusinessData, 'shippingLanguage' | 'shippingDays' | 'shippingMethod' | 'dispatchText'>): string {
  const days = data.shippingDays.trim();
  const method = data.shippingMethod.trim();
  const dispatch = data.dispatchText.trim();
  if (data.shippingLanguage === 'zh-CN') {
    return joinReplyParagraphs([
      '您付款后，我会与财务核实，确认到账后为您安排发货。',
      '发货后，我会把订单号和截图发送给您。',
      replySentence(`发货后预计送达时间：${days}`, 'zh-CN'),
      '请您耐心等待。您也可以通过订单号实时查看物流信息。',
      replySentence(`物流方式：${method}`, 'zh-CN'),
      replySentence(`发货安排：${dispatch}`, 'zh-CN'),
    ], 'zh-CN', '\n');
  }
  return joinReplyParagraphs([
    'Después de que realices el pago, lo verificaré con el departamento de finanzas y procederé al envío.',
    'Después del envío te enviaré el número de seguimiento y una captura de pantalla.',
    replySentence(`Tiempo estimado de entrega tras el envío: ${days}`, 'es-MX'),
    'Por favor, ten paciencia. También puedes consultar el estado del envío en tiempo real con el número de seguimiento.',
    replySentence(`Método de envío: ${method}`, 'es-MX'),
    replySentence(`Preparación del envío: ${dispatch}`, 'es-MX'),
  ], 'es-MX', '\n');
}

export function buildReplyPlan(text: string, data: BusinessData, lastCategory?: ReplyCategory, selectedProductId?: string, originalText?: string): ReplyPlan {
  const enabledProducts = data.products.filter((product) => product.enabled);
  let products = enabledProducts.filter((product) => matchesKeywords(text, product.keywords));
  const priceRequested = hasPriceIntent(text);
  const showProductPrice = priceRequested && !NON_PRODUCT_PRICE_TERMS.some((term) => matchesKeyword(text, term));
  if (selectedProductId) products = enabledProducts.filter((product) => product.id === selectedProductId);
  const productPriceOnly = products.length > 0 && showProductPrice && !hasProductInformationIntent(text);
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
  const phrases = data.phrases.filter((phrase) => usablePhrase(phrase)
    && (matchesPhraseKeywords(text, phrase.keywords) || Boolean(originalText && matchesPhraseKeywords(originalText, phrase.keywords))));
  if (phrases.length) categories.push('phrase');
  const parts: ReplyPart[] = [];
  const missing: string[] = [];
  const needsProductSelection = products.length > 1;
  if (categories.includes('product')) {
    if (!products.length) missing.push('未找到对应商品，请选择或启用商品');
    if (products.length === 1) {
      const product = products[0];
      if (!productPriceOnly) {
        parts.push({ text: product.name.trim(), language: data.productLanguage, separatorBefore: ', ' });
        if (product.model.trim()) parts.push({ text: product.model.trim(), language: data.productLanguage, label: 'model', verbatim: true, separatorBefore: ', ' });
      }
      const price = product.price.trim();
      if (showProductPrice && !price) missing.push('请填写商品价格或报价说明');
      if (showProductPrice && isNumericProductPrice(price)) parts.push({ text: `${price} ${product.currency}`, language: data.productLanguage, label: 'price', verbatim: true, separatorBefore: ', ' });
      if (!productPriceOnly && product.description.trim()) {
        parts.push({ text: product.description.trim(), language: data.productLanguage, label: 'description', separatorBefore: ', ' });
      }
      if (showProductPrice && price && !isNumericProductPrice(price)) {
        parts.push({ text: price, language: 'es-MX', verbatim: true, preserveText: true, separatorBefore: '\n\n' });
      }
    }
  }
  if (categories.includes('payment')) {
    const chosen = explicitMethod ?? paymentMethods.find((method) => method.isDefault);
    if (paymentOptions && !explicitMethod) {
      const alternatives = paymentMethods.filter((method) => !method.isDefault);
      if (!alternatives.length) missing.push('尚未填写可用的备用收款方式');
      else {
        // Use the configured source language for generated payment text too.
        // Chinese manual drafts are translated only after the seller sends.
        const names = alternatives.map((method) => data.paymentLanguage === 'es-MX' && method.id === 'bank-transfer'
          ? 'Transferencia bancaria' : method.name.trim()).join(data.paymentLanguage === 'zh-CN' ? '、' : ', ');
        parts.push({ text: data.paymentLanguage === 'zh-CN'
          ? joinReplyFields(`你也可以使用以下方式付款：${names}`, '你想选择哪一种？', 'zh-CN')
          : `${replySentence(`También puedes pagar con: ${names}`, 'es-MX')} ¿Qué opción prefieres?`, language: data.paymentLanguage });
      }
    } else if (chosen) parts.push({ text: chosen.content, language: data.paymentLanguage });
    else missing.push('请先填写并启用默认收款方式');
  }
  if (categories.includes('shipping')) {
    if (!data.shippingDays.trim() || !data.shippingMethod.trim() || !data.dispatchText.trim()) missing.push('请补齐物流时间、方式和发货安排');
    else parts.push({ text: shippingReplyText(data), language: data.shippingLanguage });
  }
  if (categories.includes('trust')) {
    if (!data.trustText.trim()) missing.push('请填写信任与保障说明');
    else parts.push({ text: data.trustText, language: data.trustLanguage });
    if (data.includeGroupInvite) {
      if (!validGroupUrl(data.customerGroupUrl)) missing.push('客户群邀请链接无效');
      else parts.push({ text: groupInvitationText(data.trustLanguage, data.customerGroupUrl), language: data.trustLanguage });
    }
  }
  for (const phrase of phrases) parts.push({ text: phrase.content, language: phrase.language, separatorBefore: '\n\n' });
  return { categories, products, phrases, parts, priceRequested, productPriceOnly, needsProductSelection, missing, paymentOptions,
    autoAllowed: automaticCategoriesEnabled(data, categories, phrases.map((phrase) => phrase.id)) && !needsProductSelection && !missing.length };
}

export function validGroupUrl(text: string): boolean {
  try { const url = new URL(text.trim()); return url.protocol === 'https:' && url.hostname === 'chat.whatsapp.com' && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname); }
  catch { return false; }
}
