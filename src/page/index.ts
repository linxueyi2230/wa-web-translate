// Main-world entry point. Loaded into web.whatsapp.com as a module via the content script.
// Order matters: the WAM scrub must be installed before WhatsApp builds its event registry.

import { waitTillReady, waitForModules } from './wa';
import { installWamScrub } from './hooks/wam-scrub';
import { installSendHook } from './hooks/send';
import { requestSnapshot } from './store';
import { installMessageMetadata } from './message-metadata';
import { installBusinessAdapter } from './business-adapter';

// Modules our hooks depend on. Most of these are lazy-loaded by WhatsApp after the user
// authenticates and opens a chat for the first time, so we wait for them before binding
// the hooks (otherwise window.require returns undefined and the hooks no-op).
const REQUIRED_MODULES = [
  'WAWebSendTextMsgChatAction',
];

console.info('[wa-translate] page-world script booted');

(async () => {
  // Typing must NOT trigger translations or mount a composer preview. The content
  // script decorates message history; this hook translates only when WA sends.
  requestSnapshot();
  installMessageMetadata();
  console.info('[wa-translate] translation mode: send and message history only');

  // Try the scrub as early as possible; retry until WhatsApp's WAM module is loaded.
  let scrubbed = installWamScrub();

  await waitTillReady();
  console.info('[wa-translate] WhatsApp bundle ready');

  // Wait for the lazy-loaded chat/composer modules before installing module-level hooks.
  const missing = await waitForModules(REQUIRED_MODULES);
  if (missing.length) {
    console.warn('[wa-translate] some modules never loaded after 60s:', missing);
  } else {
    console.info('[wa-translate] all required modules loaded');
  }

  if (!scrubbed) scrubbed = installWamScrub();
  if (!scrubbed) console.warn('[wa-translate] wam scrub could not install (module not found)');

  installSendHook();
  installBusinessAdapter();
  console.info('[wa-translate] ready');
})();
