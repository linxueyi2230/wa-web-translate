import { getConfig } from './store';
import { installSendHook, isTextSendHookReady } from './hooks/send';
import { installBusinessMediaSendHook } from './hooks/media-send';
import { showSendNotice } from './send-notice';

const EDITOR = '[contenteditable="true"][role="textbox"]';
const COMPOSER = '#main footer [contenteditable="true"], #main footer [data-testid="conversation-compose-box-input"]';
const SEND_ICON = '[data-icon="send"], [data-icon="wds-ic-send-filled"], [data-testid="send"], [data-testid="send-button"]';
function mediaCaption(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(EDITOR)).find((element) =>
    !element.closest('#main footer, header, #side, [data-wa-business]') && element.getBoundingClientRect().width > 0) ?? null;
}
function containsSend(button: HTMLElement): boolean {
  const child = button.querySelector('[aria-label], [title]');
  const label = button.getAttribute('aria-label') || button.getAttribute('title') || child?.getAttribute('aria-label') || child?.getAttribute('title') || '';
  return button.matches(SEND_ICON) || !!button.querySelector(SEND_ICON)
    || /^(?:Send(?: message)?|Enviar(?: mensaje)?|发送(?:消息)?|發送(?:訊息)?|傳送(?:訊息)?)$/i.test(label.trim());
}
function samePreview(button: Element, caption: HTMLElement): boolean {
  for (let root = caption.parentElement; root && root !== document.body; root = root.parentElement) {
    if (root.querySelector('#side, #main footer')) break;
    if (root.contains(button)) return true;
  }
  return false;
}

// Block sends while WhatsApp's private send API is unavailable. Install before
// waiting for WA's lazy modules, and recheck on each native user action.
export function installSendGuard(): void {
  let mediaReadyBeforePreview = false;
  const prepareMedia = () => {
    // A newly installed hook cannot retroactively wrap an open preview's files.
    if (!mediaCaption()) mediaReadyBeforePreview = installBusinessMediaSendHook();
  };
  prepareMedia();
  const timer = window.setInterval(prepareMedia, 1000);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
  document.addEventListener('pointerdown', prepareMedia, true);
  document.addEventListener('paste', prepareMedia, true);
  document.addEventListener('change', prepareMedia, true);

  const check = (event: Event, composer: HTMLElement | null, media: boolean) => {
    if (!getConfig().enabled || !composer?.textContent?.trim()) return;
    let ready: boolean;
    if (media) ready = mediaReadyBeforePreview && installBusinessMediaSendHook();
    else { installSendHook(); ready = isTextSendHookReady(); }
    if (ready) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showSendNotice(media ? '翻译发送接口尚未就绪，消息未发送。请关闭图片预览并重新选择图片，或刷新 WhatsApp 页面后重试。' : '翻译发送接口尚未就绪，消息未发送。请稍候重试；如持续出现，请刷新 WhatsApp 页面。');
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const composer = target.closest<HTMLElement>(COMPOSER);
    const caption = mediaCaption();
    if (composer) check(event, composer, false);
    else if (caption && (caption === target || caption.contains(target))) check(event, caption, true);
  }, true);
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>('button, [role="button"]');
    if (!button || !containsSend(button)) return;
    const caption = mediaCaption();
    if (caption && samePreview(button, caption)) check(event, caption, true);
    else if (button.closest('#main footer')) check(event, document.querySelector<HTMLElement>(COMPOSER), false);
  }, true);
}
