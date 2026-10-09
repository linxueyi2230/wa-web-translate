import { DEFAULT_CONFIG, type Config } from './types';

const KEY_CONFIG = 'config';

export async function loadConfig(): Promise<Config> {
  const got = await chrome.storage.local.get(KEY_CONFIG);
  const stored = (got[KEY_CONFIG] ?? {}) as Partial<Config>;
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    apiKeys: { ...DEFAULT_CONFIG.apiKeys, ...(stored.apiKeys ?? {}) },
    model: { ...DEFAULT_CONFIG.model, ...(stored.model ?? {}) },
  };
}

export async function saveConfig(patch: Partial<Config>): Promise<Config> {
  const current = await loadConfig();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEY_CONFIG]: next });
  return next;
}

export function watchConfig(cb: (cfg: Config) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[KEY_CONFIG]) return;
    loadConfig().then(cb);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
