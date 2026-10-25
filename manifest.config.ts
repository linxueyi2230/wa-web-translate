import { defineManifest } from '@crxjs/vite-plugin';
import { version } from './package.json';

export default defineManifest({
  manifest_version: 3,
  minimum_chrome_version: '116',
  name: '好麦',
  version,
  description: '好麦，让跨语言沟通更简单',
  icons: {
    16: 'public/icons/16.png',
    32: 'public/icons/32.png',
    48: 'public/icons/48.png',
    128: 'public/icons/128.png',
  },
  permissions: ['alarms', 'storage', 'unlimitedStorage', 'clipboardRead', 'clipboardWrite'],
  optional_permissions: ['audioCapture'],
  optional_host_permissions: ['http://localhost/*', 'http://127.0.0.1/*', 'https://*/*'],
  host_permissions: [
    'http://127.0.0.1/*',
    'http://localhost/*',
    'https://web.whatsapp.com/*',
    'https://api.deepseek.com/*',
    'https://api.anthropic.com/*',
    'https://api.openai.com/*',
    'https://generativelanguage.googleapis.com/*',
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  action: {
    default_title: '好麦',
    default_popup: 'src/popup/index.html',
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
  content_scripts: [
    {
      matches: ['https://web.whatsapp.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_end',
    },
    {
      matches: ['https://web.whatsapp.com/*'],
      js: ['src/page/index.ts'],
      run_at: 'document_end',
      world: 'MAIN',
    },
  ],
  web_accessible_resources: [
    {
      resources: ['assets/*'],
      matches: ['https://web.whatsapp.com/*'],
    },
  ],
});
