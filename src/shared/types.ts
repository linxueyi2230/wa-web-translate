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
