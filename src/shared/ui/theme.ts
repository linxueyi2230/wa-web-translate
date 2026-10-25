import type { ThemeMode } from '../generated/haomai';
const THEME_KEY = 'haomai:theme-mode';
export function initializeTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let mode: ThemeMode = 'system';
  const apply = () => { document.documentElement.dataset.theme = mode === 'system' ? media.matches ? 'dark' : 'light' : mode; };
  apply(); media.addEventListener('change', apply);
  void chrome.storage.local.get(THEME_KEY).then((data) => {
    const saved = data[THEME_KEY]; if (saved === 'light' || saved === 'dark' || saved === 'system') mode = saved;
    apply();
  }).catch(() => apply());
  return { set: async (next: ThemeMode) => { await chrome.storage.local.set({[THEME_KEY]: next}); mode = next; apply(); }, dispose: () => media.removeEventListener('change', apply) };
}
