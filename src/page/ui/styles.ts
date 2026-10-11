// Chat-history decoration only. No composer popup, picker, or typing preview.
const STYLE_ID = 'wa-translate-styles';

const CSS = `
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
  user-select: text !important;
  -webkit-user-select: text !important;
  pointer-events: auto !important;
}
.wa-translate-message-local .wa-translate-message-body {
  color: inherit;
  white-space: pre-wrap;
  user-select: text !important;
  -webkit-user-select: text !important;
  pointer-events: auto !important;
  cursor: text;
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
