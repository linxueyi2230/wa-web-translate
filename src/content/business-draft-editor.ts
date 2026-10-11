import type { ProductImage, ReplyLanguage } from '@/shared/types';
import type { BusinessDraftSnapshot } from '@/shared/business-replies';

interface EditorCallbacks {
  toggle: (open: boolean) => void;
  text: (text: string) => void;
  images: (ids: Set<string>) => void;
  applyImages: () => void;
  applyText: () => void;
}
export interface DraftEditorState {
  text: string;
  language: ReplyLanguage;
  images: ProductImage[];
  selected: Set<string>;
  open: boolean;
  busy: boolean;
  rebuilding: boolean;
  status: string;
  error: boolean;
}

const CSS = `
:host { color-scheme: light dark; position: fixed; z-index: 10000; display: block;
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #20352d; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; cursor: pointer; border: 1px solid #b8cec3; border-radius: 7px;
  padding: 6px 10px; background: #edf7f0; color: #244638; }
button:hover { background: #dceee2; }
button:disabled { opacity: .5; cursor: default; }
.launcher { box-shadow: 0 3px 15px #0003; background: #fff; }
.panel { width: min(380px, calc(100vw - 32px)); max-width: 100%; max-height: min(520px, calc(100vh - 100px));
  overflow: auto; padding: 14px; margin-bottom: 8px; background: #fff;
  border: 1px solid #c8d8d0; border-radius: 12px; box-shadow: 0 6px 25px #0003; }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.close { border: 0; background: transparent; font-size: 21px; padding: 0 5px; }
label.caption { display: block; margin-bottom: 5px; font-weight: 600; }
textarea { width: 100%; min-height: 112px; max-height: 220px; resize: vertical; font: inherit;
  color: inherit; padding: 9px; border: 1px solid #bdd0c5; border-radius: 7px; background: #f8faf9; }
.images { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 8px 0; }
.images label { padding: 5px; border: 1px solid #dce6e0; border-radius: 7px; cursor: pointer; }
.images label:has(input:checked) { border-color: #219761; background: #edf7f0; }
.images img { display: block; width: 100%; height: 72px; object-fit: cover; border-radius: 4px; }
.images span { display: block; font-size: 11px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 7px 0; }
small { display: block; color: #65766f; }
.status { margin: 8px 0 0; font-size: 12px; }
.error { color: #9a4a18; }
@media (prefers-color-scheme: dark) {
  :host { color: #e9edef; }
  .panel, .launcher { background: #17252d; border-color: #355348; color: #e9edef; }
  button { background: #223a32; color: #d2ecdf; border-color: #3c5751; }
  textarea { background: #101c22; border-color: #355348; }
  .images label { border-color: #355348; }
  .images label:has(input:checked) { background: #223a32; }
  small { color: #a0b2a9; }
  .error { color: #f5bd86; }
}
`;

export class BusinessDraftEditor {
  readonly host = document.createElement('wa-business-draft-editor');
  private panel = document.createElement('section');
  private launcher = document.createElement('button');
  private textarea = document.createElement('textarea');
  private caption = document.createElement('label');
  private gallery = document.createElement('div');
  private imageSection = document.createElement('div');
  private apply = document.createElement('button');
  private applyText = document.createElement('button');
  private status = document.createElement('p');
  private imageSignature = '';
  private composing = false;
  private current: DraftEditorState | null = null;

  constructor(private callbacks: EditorCallbacks) {
    this.host.dataset.waBusiness = 'true'; this.host.setAttribute('translate', 'no');
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = CSS;
    this.panel.className = 'panel'; this.panel.id = 'draft-panel'; this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-label', '查看和编辑草稿');
    const header = document.createElement('div'); header.className = 'header';
    const title = document.createElement('strong'); title.textContent = '商品回复草稿';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'close'; close.textContent = '×'; close.setAttribute('aria-label', '收起草稿');
    close.addEventListener('click', () => callbacks.toggle(false)); header.append(title, close);
    this.caption.className = 'caption'; this.caption.htmlFor = 'draft-text';
    this.textarea.id = 'draft-text'; this.textarea.rows = 5;
    this.textarea.addEventListener('compositionstart', () => { this.composing = true; });
    this.textarea.addEventListener('compositionend', () => { this.composing = false; callbacks.text(this.textarea.value); });
    this.textarea.addEventListener('input', () => { if (!this.composing) callbacks.text(this.textarea.value); });
    this.applyText.type = 'button'; this.applyText.textContent = '立即同步文字'; this.applyText.addEventListener('click', callbacks.applyText);
    const imageTitle = document.createElement('strong'); imageTitle.textContent = '商品图片';
    this.gallery.className = 'images';
    const actions = document.createElement('div'); actions.className = 'actions';
    const all = document.createElement('button'); all.type = 'button'; all.textContent = '全选';
    all.addEventListener('click', () => { if (this.current && !this.current.rebuilding) callbacks.images(new Set(this.current.images.map((image) => image.id))); });
    const cover = document.createElement('button'); cover.type = 'button'; cover.textContent = '只选封面';
    cover.addEventListener('click', () => { if (this.current && !this.current.rebuilding) callbacks.images(new Set(this.current.images.slice(0, 1).map((image) => image.id))); });
    this.apply.type = 'button'; this.apply.addEventListener('click', callbacks.applyImages);
    actions.append(all, cover, this.apply);
    const imageHelp = document.createElement('small'); imageHelp.textContent = '勾选完成后同步所选图片，原生预览会显示这次选择的附件。';
    this.imageSection.append(imageTitle, this.gallery, actions, imageHelp);
    this.status.className = 'status'; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.panel.append(header, this.caption, this.textarea, this.applyText, this.imageSection, this.status);
    this.launcher.type = 'button'; this.launcher.className = 'launcher'; this.launcher.textContent = '查看草稿'; this.launcher.setAttribute('aria-controls', 'draft-panel');
    this.launcher.addEventListener('click', () => callbacks.toggle(!this.current?.open));
    shadow.append(style, this.panel, this.launcher);
    document.body.appendChild(this.host);
  }

  update(state: DraftEditorState): void {
    this.current = state;
    this.caption.textContent = state.language === 'zh-CN' ? '中文草稿（确认发送时翻译，修改后自动同步）' : '西语草稿（修改后自动同步）';
    this.panel.hidden = !state.open; this.launcher.textContent = state.open ? '收起草稿' : '查看草稿';
    this.launcher.setAttribute('aria-expanded', String(state.open));
    if (!this.composing && this.textarea.value !== state.text) this.textarea.value = state.text;
    this.textarea.readOnly = state.rebuilding;
    this.applyText.disabled = state.busy;
    this.status.textContent = state.status; this.status.classList.toggle('error', state.error);
    this.imageSection.hidden = !state.images.length;
    const signature = JSON.stringify(state.images.map((image) => [image.id, image.name]));
    if (signature !== this.imageSignature) {
      this.gallery.replaceChildren();
      for (const image of state.images) {
        const label = document.createElement('label'); const img = document.createElement('img'); img.src = image.dataUrl; img.alt = image.name;
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.imageId = image.id; checkbox.setAttribute('aria-label', `选择 ${image.name}`);
        checkbox.addEventListener('change', () => {
          const ids = new Set(this.current?.selected); if (checkbox.checked) ids.add(image.id); else ids.delete(image.id); this.callbacks.images(ids);
        });
        const name = document.createElement('span'); name.textContent = image.name; label.append(img, checkbox, name); this.gallery.appendChild(label);
      }
      this.imageSignature = signature;
    }
    for (const checkbox of this.gallery.querySelectorAll<HTMLInputElement>('input')) {
      checkbox.checked = state.selected.has(checkbox.dataset.imageId!); checkbox.disabled = state.rebuilding;
    }
    this.apply.textContent = `同步所选图片（${state.selected.size} 张）`; this.apply.disabled = state.busy;
  }

  position(bounds?: BusinessDraftSnapshot['bounds'], mediaOpen = true): void {
    const area = bounds ?? document.querySelector('#main')?.getBoundingClientRect();
    const left = Math.max(12, Math.min((area?.left ?? 0) + 12, window.innerWidth - 140));
    this.host.style.left = `${left}px`;
    const footerTop = document.querySelector('#main footer')?.getBoundingClientRect().top;
    this.host.style.bottom = `${!mediaOpen && footerTop !== undefined ? Math.max(12, window.innerHeight - footerTop + 8) : Math.max(12, area ? window.innerHeight - area.top - area.height + 12 : 12)}px`;
    this.host.style.maxWidth = `${Math.max(140, window.innerWidth - left - 12)}px`;
  }
  destroy(): void { this.host.remove(); }
}
