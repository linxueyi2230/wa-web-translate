import { DEFAULT_BUSINESS_DATA, DEFAULT_CONFIG, type BusinessData, type Config } from './types';
import { LEGACY_DEFAULT_TRANSLATION_STYLE } from './translation-policy';

const KEY_CONFIG = 'config';
const KEY_BUSINESS = 'businessData:v1';

export async function loadConfig(): Promise<Config> {
  const got = await chrome.storage.local.get(KEY_CONFIG);
  const stored = (got[KEY_CONFIG] ?? {}) as Partial<Config>;
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    personality: stored.personality === LEGACY_DEFAULT_TRANSLATION_STYLE ? DEFAULT_CONFIG.personality : stored.personality ?? DEFAULT_CONFIG.personality,
    translationPrompt: typeof stored.translationPrompt === 'string' ? stored.translationPrompt : DEFAULT_CONFIG.translationPrompt,
    apiKeys: { ...DEFAULT_CONFIG.apiKeys, ...(stored.apiKeys ?? {}) },
    model: { ...DEFAULT_CONFIG.model, ...(stored.model ?? {}) },
  };
}

let configSaveQueue: Promise<unknown> = Promise.resolve();
export function saveConfig(patch: Partial<Config>): Promise<Config> {
  const operation = configSaveQueue.then(async () => {
    const current = await loadConfig();
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ [KEY_CONFIG]: next });
    return next;
  });
  configSaveQueue = operation.catch(() => {});
  return operation;
}

export async function loadBusinessData(): Promise<BusinessData> {
  const got = await chrome.storage.local.get(KEY_BUSINESS);
  const { globalAutoReply: _global, riskConfirmed: _risk, ...stored } = (got[KEY_BUSINESS] ?? {}) as
    Partial<BusinessData> & { globalAutoReply?: unknown; riskConfirmed?: unknown };
  return {
    ...DEFAULT_BUSINESS_DATA,
    ...stored,
    activeTab: stored.activeTab === 'auto' ? 'settings' : stored.activeTab ?? DEFAULT_BUSINESS_DATA.activeTab,
    phrases: Array.isArray(stored.phrases) ? stored.phrases : [],
    // Upgrade the old built-in schedule without replacing custom dispatch text.
    dispatchText: stored.dispatchText === '通常当天下午安排发货，节假日可能顺延。'
      ? DEFAULT_BUSINESS_DATA.dispatchText : stored.dispatchText ?? DEFAULT_BUSINESS_DATA.dispatchText,
    autoReply: { ...DEFAULT_BUSINESS_DATA.autoReply, ...(stored.autoReply ?? {}) },
    products: Array.isArray(stored.products) ? stored.products : DEFAULT_BUSINESS_DATA.products,
    paymentMethods: Array.isArray(stored.paymentMethods) ? stored.paymentMethods : DEFAULT_BUSINESS_DATA.paymentMethods,
    paymentKeywords: Array.isArray(stored.paymentKeywords) ? stored.paymentKeywords : DEFAULT_BUSINESS_DATA.paymentKeywords,
    shippingKeywords: Array.isArray(stored.shippingKeywords) ? stored.shippingKeywords : DEFAULT_BUSINESS_DATA.shippingKeywords,
    trustKeywords: Array.isArray(stored.trustKeywords) ? stored.trustKeywords : DEFAULT_BUSINESS_DATA.trustKeywords,
  };
}

export async function saveBusinessData(next: BusinessData): Promise<void> {
  await chrome.storage.local.set({ [KEY_BUSINESS]: next });
}

export function watchBusinessData(cb: (data: BusinessData) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[KEY_BUSINESS]) void loadBusinessData().then(cb);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export function watchConfig(cb: (cfg: Config) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[KEY_CONFIG]) return;
    loadConfig().then(cb);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
