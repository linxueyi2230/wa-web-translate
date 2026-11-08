// Surface failures even if WhatsApp ignores the rejected sender promise.
export function showSendNotice(message: string): void {
  let notice = document.getElementById('wa-translate-send-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'wa-translate-send-notice';
    notice.setAttribute('role', 'alert');
    notice.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;max-width:min(520px,90vw);max-height:60vh;overflow:auto;padding:14px 18px;background:#7f1d1d;color:white;border-radius:8px;box-shadow:0 4px 20px #0006;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 sans-serif;user-select:text';
    document.body.appendChild(notice);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '关闭';
  close.style.cssText = 'display:block;margin-top:8px;cursor:pointer';
  close.addEventListener('click', () => notice?.remove());
  notice.replaceChildren(document.createTextNode(message), close);
}
