// Keep the assistant out of WhatsApp's React layout and isolate its styles from
// page resets. It is anchored above the composer, never inserted into chat rows.
const CSS = `
:host { color-scheme: light dark; }
:host([hidden]) { display: none !important; }
* { box-sizing: border-box; }
.wa-business-bar {
  color: #20352d; background: #fff; border: 1px solid #c8d8d0; border-radius: 10px;
  box-shadow: 0 4px 18px #0002; padding: 10px 12px;
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  max-height: inherit; overflow: auto; overflow-wrap: anywhere;
}
.wa-business-header { display: flex; align-items: center; gap: 8px; }
strong { flex: 1; font-size: 13px; }
button { font: inherit; border: 1px solid #bdd0c5; border-radius: 5px; padding: 4px 8px;
  margin: 4px 7px 4px 0; background: #edf7f0; color: #244638; cursor: pointer; }
button:hover { background: #dceee2; }
button:disabled { opacity: .5; cursor: default; }
.wa-business-close { margin: 0; font-size: 20px; line-height: 1; padding: 3px 7px;
  background: transparent; border: 0; }
small { display: block; color: #5f7269; }
details { margin-top: 4px; }
summary { cursor: pointer; }
pre { white-space: pre-wrap; font: inherit; padding: 8px; background: #f3f6f4;
  border-radius: 5px; max-height: 120px; overflow: auto; }
.wa-business-error { color: #9a4a18; margin: 5px 0; }
.wa-business-images { display: flex; gap: 10px; margin: 5px 0; overflow-x: auto; }
.wa-business-images label { display: flex; align-items: center; gap: 3px; cursor: pointer; }
.wa-business-images img { width: 42px; height: 42px; object-fit: cover; border-radius: 4px; }
@media (prefers-color-scheme: dark) {
  .wa-business-bar { background: #17252d; color: #e9edef; border-color: #355348; }
  button { background: #223a32; color: #d2ecdf; border-color: #3c5751; }
  button:hover { background: #2e4e41; }
  small { color: #9dafa7; }
  pre { background: #101c22; }
  .wa-business-error { color: #f5bd86; }
}
`;

export function createBusinessDraftBar(): { host: HTMLElement; body: HTMLElement } {
  const host = document.createElement('wa-business-draft');
  host.dataset.waBusiness = 'true';
  host.setAttribute('translate', 'no');
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', '客户回复草稿');
  host.style.cssText = 'position:fixed;display:block;z-index:100;max-height:240px;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = CSS;
  const body = document.createElement('div'); body.className = 'wa-business-bar';
  shadow.append(style, body);
  return { host, body };
}

export function positionBusinessDraftBar(host: HTMLElement, footer: HTMLElement, hidden: boolean): void {
  const rect = footer.getBoundingClientRect();
  const top = document.querySelector('#main header')?.getBoundingClientRect().bottom ?? 0;
  const available = Math.max(0, rect.top - top - 16);
  host.hidden = hidden || rect.width < 100 || rect.height === 0 || available < 60;
  host.style.left = `${rect.left + 8}px`;
  host.style.width = `${Math.max(0, rect.width - 16)}px`;
  host.style.bottom = `${Math.max(0, window.innerHeight - rect.top) + 8}px`;
  host.style.maxHeight = `${Math.min(240, available)}px`;
}
