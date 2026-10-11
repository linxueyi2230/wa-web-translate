// Bump when built-in translation rules change so old cached translations are
// not reused with a different meaning policy. Saved sent originals stay intact.
export const TRANSLATION_POLICY_VERSION = 'trade-v4';

export const DEFAULT_TRANSLATION_PROMPT = [
  '使用场景：WhatsApp 外贸客户沟通。卖家主要使用中文，客户主要来自墨西哥。',
  '围绕商品介绍、型号尺码、报价、付款、银行转账、OXXO、物流、发货时间和交易信任，使用自然、清楚、礼貌的商业聊天表达。',
  '翻译到西班牙语时，使用墨西哥客户容易理解的西班牙语；翻译到英语时，使用自然简洁的商务英语。始终以本次请求的目标语言为准，不自行更换语言。',
  '只翻译原文，保留说话人的身份、意图、否定、时间和原因，不替卖家回答问题，不补充价格、收款信息或保障承诺。',
  '区分付款操作障碍与经济能力：无法支付、转账失败、账号太长、不支持某支付方式等，不等于付不起或没钱。只有原文明确涉及余额不足或负担不起时，才表达资金困难；原因不明确时保持中性。',
].join('\n');

// Older saved configurations inherit the scene. An explicitly empty scene is
// respected; the core translation/output rules still apply.
export function translationScenePrompt(config: { translationPrompt?: string }): string {
  return (typeof config.translationPrompt === 'string' ? config.translationPrompt : DEFAULT_TRANSLATION_PROMPT).trim();
}

export const TRANSLATION_MEANING_GUIDANCE = [
  'Preserve the precise meaning, negation, time qualifiers, and stated reasons. Meaning takes priority over style and tone guidance. Do not invent a cause or omit a stated obstacle.',
  'For payments, distinguish inability to complete a payment from inability to afford it. Account-number length, bank/app errors, rejected transfers, unavailable payment methods, and temporary inability to pay are operational obstacles, not evidence of insufficient money.',
  'When the reason is unspecified, use neutral wording such as “无法付款” or “no puedo realizar el pago”. Use “付不起 / 没钱付款 / cannot afford” only when the source explicitly describes affordability or insufficient funds; preserve financial difficulty when it is actually stated.',
  'Meaning examples: “现在无法支付” → “Ahora no puedo realizar el pago.”; “账号太长，支付不了” → “No puedo realizar el pago porque el número de cuenta es demasiado largo.”; “No puedo pagar” without a financial reason → “我无法付款”; “No tengo suficiente dinero para pagar” → “我没有足够的钱付款”. Apply the distinction in both translation directions and translate into the requested target language.',
  'Keep account numbers, payment references, amounts, currencies, and links exactly as written. Do not shorten, reformat, or invent payment details.',
  'Use readable target-language punctuation and spacing between sentences, product fields, labels, and payment options. Keep paragraph and field boundaries clear; never run a name, model, description, price, or following sentence together. Preserve line breaks and existing separators while using appropriate commas and sentence-ending punctuation. Do not insert punctuation inside numbers, model codes, account details, or URLs.',
].join('\n');
