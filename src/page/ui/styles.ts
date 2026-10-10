// Chat-history decoration only. No composer popup, picker, or typing preview.
const STYLE_ID = 'wa-translate-styles';

const CSS = `
.wa-business-bar {
  background: #17252d; color: #e9edef; border-top: 1px solid #355348;
  padding: 10px 16px; font: 12px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  max-height: 280px; overflow: auto;
}
.wa-business-bar strong { display: block; font-size: 13px; margin-bottom: 5px; }
.wa-business-bar button { border: 1px solid #3c5751; border-radius: 5px; padding: 5px 9px; margin: 4px 7px 4px 0; background: #223a32; color: #d2ecdf; cursor: pointer; }
.wa-business-bar button:disabled { opacity: .5; }
.wa-business-bar small { display: block; color: #9dafa7; }
.wa-business-bar pre { white-space: pre-wrap; font: inherit; padding: 8px; background: #101c22; border-radius: 5px; max-height: 120px; overflow: auto; }
.wa-business-bar .wa-business-error { color: #f5bd86; margin: 5px 0; }
.wa-business-images { display: flex; gap: 10px; margin: 5px 0; }
.wa-business-images label { display: flex; align-items: center; gap: 3px; }
.wa-business-images img { width: 42px; height: 42px; object-fit: cover; border-radius: 4px; }
.wa-translate-message-local {
  display: block;
  margin-top: 7px;
  padding-top: 7px;
  padding-bottom: 2px;
  border-top: 1px solid rgba(128, 128, 128, 0.28);
  color: #800020;
  font-size: 13px;
  line-height: 1.45;
  white-space: normal;
  overflow-wrap: anywhere;
  user-select: text;
}
.wa-translate-message-body {
  color: inherit;
  white-space: pre-wrap;
}
/* A lighter wine shade keeps the local text readable on WhatsApp's dark bubbles. */
html.dark .wa-translate-message-local,
body.dark .wa-translate-message-local,
[data-theme="dark"] .wa-translate-message-local {
  color: #d98ca3;
}
.wa-translate-message-local[data-kind="status"] {
  font-size: 12px;
}
.wa-translate-message-retry {
  color: inherit;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 2px 6px;
  margin-top: 4px;
  cursor: pointer;
  font: inherit;
}
`;

export function injectStyles(): void {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== CSS) style.textContent = CSS;
}
