import { useId, useRef, useState, type ChangeEvent } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  label: string;
  multiline?: boolean;
  placeholder?: string;
}

// Native copy/paste stays available. These buttons provide an explicit user
// gesture for extension clipboard access, including when shortcuts are blocked.
export function ClipboardTextField({ value, onChange, label, multiline = false, placeholder }: Props) {
  const id = useId();
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const change = useRef(onChange);
  change.current = onChange;
  const composing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  const paste = async () => {
    const input = field.current;
    if (!input || busy || composing.current) return;
    const before = input.value;
    const start = input.selectionStart ?? before.length;
    const end = input.selectionEnd ?? start;
    const focused = document.activeElement;
    setBusy(true); setMessage('');
    try {
      const text = await navigator.clipboard.readText();
      if (!text) throw new Error('剪贴板里没有可粘贴的文本。');
      if (field.current !== input || latest.current !== before || input.value !== before || composing.current
        || input.selectionStart !== start || input.selectionEnd !== end) {
        throw new Error('内容已修改，请在需要插入的位置重新点击粘贴。');
      }
      change.current(`${before.slice(0, start)}${text}${before.slice(end)}`);
      setMessage('已粘贴'); setError(false);
      requestAnimationFrame(() => {
        if (!input.isConnected || field.current !== input) return;
        if (document.activeElement !== focused && document.activeElement !== document.body && document.activeElement !== input) return;
        input.focus(); input.setSelectionRange(start + text.length, start + text.length);
      });
    } catch (reason) {
      const detail = reason instanceof Error && reason.name !== 'NotAllowedError' && reason.name !== 'TypeError' ? reason.message : '';
      setMessage(detail || '读取剪贴板失败，请在浏览器中打开插件设置页，并允许剪贴板权限后重试。'); setError(true);
    } finally { setBusy(false); }
  };
  const copy = async () => {
    const input = field.current;
    if (!input || busy) return;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    const text = end > start ? input.value.slice(start, end) : input.value;
    if (!text) return;
    setBusy(true); setMessage('');
    try {
      await navigator.clipboard.writeText(text);
      setMessage(end > start ? '已复制选中文字' : '已复制全部内容'); setError(false);
    } catch {
      setMessage('复制失败，请在浏览器中打开插件设置页，并允许剪贴板权限后重试。'); setError(true);
    } finally { setBusy(false); }
  };
  const props = {
    id, value, placeholder, 'aria-label': label,
    ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => { field.current = element; },
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setMessage(''); onChange(event.target.value); },
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: () => { composing.current = false; },
  };
  return <div className="opts-clipboard-field">
    {multiline ? <textarea {...props} /> : <input type="text" {...props} />}
    <div className="opts-clipboard-actions">
      <button type="button" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => { void paste(); }} aria-label={`粘贴到${label}`}>粘贴</button>
      <button type="button" disabled={busy || !value} onMouseDown={(event) => event.preventDefault()} onClick={() => { void copy(); }} aria-label={`复制${label}`}>复制</button>
      <small role="status" aria-live="polite" data-error={error}>{message}</small>
    </div>
  </div>;
}
