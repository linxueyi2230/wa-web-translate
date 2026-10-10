import { buildReplyPlan, businessSettingsSignature, BUSINESS_RUNTIME_PREFIX, CATEGORY_NAMES, type BusinessRuntimeRecord, type IncomingBusinessMessage, type ReplyPlan } from '@/shared/business-replies';
import { loadBusinessData, loadConfig, watchBusinessData, watchConfig } from '@/shared/storage';
import { newRpcId } from '@/shared/messages';
import { translationContext } from '@/shared/message-history';
import type { BusinessData, Config, ProductImage, ReplyCategory, TranslateRequest, TranslateResult } from '@/shared/types';
import { HistoryStorage } from './history-storage';

const TAG = '__waBusiness';
type Translator = (request: TranslateRequest) => Promise<TranslateResult>;

export class BusinessReplies {
  private data: BusinessData | null = null;
  private config: Config | null = null;
  private chatId: string | null = null;
  private records = new Map<string, BusinessRuntimeRecord>();
  private active = new Set<string>();
  private inserted = new Set<string>();
  private inserting = new Set<string>();
  private autoInsertAttempted = new Set<string>();
  private owner = newRpcId();
  private pendingActions = new Map<string, { messageId: string; kind: string; resolve: () => void; reject: (error: Error) => void }>();
  private cooldown = new Map<string, number>();
  private imageSelections = new Map<string, Set<string>>();
  private banner: HTMLElement | null = null;
  private rendered = '';
  private ready: Promise<void>;
  private history = new HistoryStorage();
  private capabilityReady = false;
  private generation = 0;
  private editTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly translate: Translator) {
    this.ready = Promise.all([loadConfig(), loadBusinessData()]).then(([config, data]) => { this.config = config; this.data = data; });
  }

  start(): void {
    window.addEventListener('message', this.onMessage);
    watchBusinessData((data) => {
      if (!this.data || businessSettingsSignature(this.data) !== businessSettingsSignature(data)) this.generation++;
      this.data = data; this.drain(); this.render();
    });
    watchConfig((config) => { this.config = config; this.generation++; this.drain(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(BUSINESS_RUNTIME_PREFIX)) continue;
        const record = change.newValue as BusinessRuntimeRecord | undefined;
        if (record) this.records.set(record.message.id, record);
      }
      this.render();
    });
    const interval = window.setInterval(() => { this.render(); this.drain(); }, 1500);
    window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
    void this.ready.then(async () => {
      if (typeof chrome.runtime.sendMessage !== 'function') return;
      const records = await this.runtime<BusinessRuntimeRecord[]>('LIST');
      for (const record of records) {
        this.records.set(record.message.id, record);
        if (record.status === 'sending' && Date.now() - record.updatedAt > 120_000) await this.update(record, { status: 'ready', manualOnly: true, error: '上次发送状态不确定，请先检查聊天记录再处理。' });
      }
      window.postMessage({ [TAG]: true, kind: 'REQUEST_STATE' }, '*');
      this.drain();
    }).catch((error) => console.warn('[wa-translate][business] initialization failed', error));
  }

  private onMessage = (event: MessageEvent): void => {
    const data = event.data;
    if (event.source !== window || data?.[TAG] !== true) return;
    if (data.kind === 'ACTION_RESULT') {
      const pending = this.pendingActions.get(data.id);
      if (!pending) return;
      this.pendingActions.delete(data.id);
      if (data.ok) pending.resolve(); else pending.reject(new Error(data.error || 'WhatsApp 操作失败'));
    } else if (data.kind === 'VERIFY_SEND') {
      const pending = this.pendingActions.get(data.id);
      const record = this.records.get(data.messageId);
      if (!pending || pending.kind !== 'SEND_REPLY' || pending.messageId !== data.messageId || !record) return;
      void this.runtime<boolean>('CHECK_SEND', { messageId: record.message.id, owner: record.owner })
        .catch(() => false).then((allowed) => window.postMessage({ [TAG]: true, kind: 'SEND_AUTHORIZED', id: data.id, allowed }, '*'));
    } else if (data.kind === 'ACTIVE_CHAT') {
      const next = typeof data.chatId === 'string' ? data.chatId : null;
      if (this.chatId !== next) { this.inserted.clear(); this.autoInsertAttempted.clear(); this.rendered = ''; }
      this.chatId = next;
      this.drain(); this.render();
    } else if (data.kind === 'CAPABILITIES') {
      if (this.capabilityReady !== Boolean(data.incomingReady)) console.info('[wa-translate][business] incoming adapter', { ready: Boolean(data.incomingReady), mediaReady: Boolean(data.mediaReady) });
      this.capabilityReady = Boolean(data.incomingReady);
    } else if (data.kind === 'DRAFT_SENT') {
      const record = this.records.get(data.messageId);
      if (record?.status === 'ready' && record.message.chatId === data.chatId) void this.update(record, { status: 'sent' }).then(() => this.render()).catch((error) => console.warn('[wa-translate][business] sent draft status failed', error));
    } else if (data.kind === 'DRAFT_EDITED') {
      const record = this.records.get(data.messageId);
      if (!record || record.status !== 'ready' || record.message.chatId !== data.chatId || typeof data.text !== 'string') return;
      const pending = this.editTimers.get(record.message.id);
      if (pending) clearTimeout(pending);
      this.editTimers.set(record.message.id, setTimeout(() => {
        this.editTimers.delete(record.message.id);
        void this.update(record, { reply: data.text }).catch((error) => console.warn('[wa-translate][business] edited draft storage failed', error));
      }, 300));
    } else if (data.kind === 'INCOMING') {
      const message = data.message as IncomingBusinessMessage;
      if (!message || typeof message.id !== 'string' || typeof message.text !== 'string') return;
      void this.ready.then(async () => {
        const record = await this.runtime<BusinessRuntimeRecord>('ACCEPT', { message });
        this.records.set(message.id, record);
        this.drain();
      }).catch((error) => console.warn('[wa-translate][business] incoming storage failed', error));
    }
  };

  private async runtime<T>(operation: string, payload: Record<string, unknown> = {}): Promise<T> {
    const result = await chrome.runtime.sendMessage({ kind: `BUSINESS_RUNTIME_${operation}`, ...payload });
    if (!result?.ok) throw new Error(result?.error || '无法保存回复状态');
    return result.result as T;
  }
  private async update(record: BusinessRuntimeRecord, patch: Partial<BusinessRuntimeRecord>): Promise<BusinessRuntimeRecord> {
    const next = await this.runtime<BusinessRuntimeRecord>('UPDATE', { messageId: record.message.id, owner: record.owner, patch });
    this.records.set(next.message.id, next);
    return next;
  }

  private drain(): void {
    if (!this.config?.enabled || !this.data || !this.capabilityReady) return;
    for (const record of [...this.records.values()].sort((a, b) => a.message.receivedAt - b.message.receivedAt)) {
      if (this.active.size >= 2) return;
      if (this.active.has(record.message.id)) continue;
      if (record.status !== 'pending' && !(record.status === 'processing' && Date.now() - record.updatedAt > 120_000)) continue;
      if (!this.data.globalAutoReply && record.message.chatId !== this.chatId) continue;
      this.active.add(record.message.id);
      void this.process(record).finally(() => { this.active.delete(record.message.id); this.render(); this.drain(); });
    }
  }

  private async process(input: BusinessRuntimeRecord, selectedProductId?: string): Promise<void> {
    let record = input;
    try {
      if (!selectedProductId) {
        const claimed = await this.runtime<BusinessRuntimeRecord | null>('CLAIM', { messageId: record.message.id, owner: this.owner });
        if (!claimed) return;
        record = claimed;
      }
      if (!this.config || !this.data) return;
      const generation = this.generation;
      const translated = record.translated || await this.incomingChinese(record.message);
      const context = await this.runtime<ReplyCategory | null>('CONTEXT', { chatId: record.message.chatId });
      const plan = buildReplyPlan(translated, this.data, context ?? undefined, selectedProductId);
      if (!plan.categories.length) { await this.update(record, { status: 'no-match', translated }); return; }
      const patch: Partial<BusinessRuntimeRecord> = { translated, categories: plan.categories, productIds: plan.products.map((product) => product.id), settingsSignature: businessSettingsSignature(this.data) };
      if (plan.needsProductSelection || plan.missing.length) {
        await this.update(record, { ...patch, status: 'ready', error: plan.needsProductSelection ? '命中多个商品，请选择后生成草稿' : plan.missing.join('；'), manualOnly: true });
        return;
      }
      const reply = await this.prepareText(plan);
      if (!reply.trim()) throw new Error('回复内容为空');
      const category = plan.categories[0];
      const cooldownKey = `${record.message.chatId}:${category}`;
      const automatic = plan.autoAllowed && !record.manualOnly && !selectedProductId && generation === this.generation
        && this.config.enabled && Date.now() - (this.cooldown.get(cooldownKey) ?? 0) >= 60_000;
      record = await this.update(record, { ...patch, reply, status: automatic ? 'processing' : 'ready', error: '', manualOnly: record.manualOnly || Boolean(selectedProductId) });
      if (automatic) {
        const allowed = await this.runtime<boolean>('CAN_SEND', { messageId: record.message.id, owner: record.owner });
        if (!allowed) { await this.update(record, { status: 'ready' }); return; }
        record.status = 'sending';
        await this.action('SEND_REPLY', record, this.coverImages(record));
        this.cooldown.set(cooldownKey, Date.now());
        await this.update(record, { status: 'sent' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '回复生成失败';
      try { await this.update(record, { status: 'ready', error: message, manualOnly: true }); }
      catch (storageError) { console.warn('[wa-translate][business] status save failed', storageError); }
    }
  }

  private async incomingChinese(message: IncomingBusinessMessage): Promise<string> {
    const config = this.config!;
    if (config.nativeLang === 'zh-CN') {
      const cached = await this.history.translation(message.id, message.text, translationContext(config));
      if (cached?.translated) return cached.translated;
    }
    return this.translateCached(message.text, 'auto', 'zh-CN');
  }
  private async prepareText(plan: ReplyPlan): Promise<string> {
    const parts = await Promise.all(plan.parts.map((part) => part.language === 'es-MX'
      ? Promise.resolve(part.text) : this.translateCached(part.text, 'zh-CN', 'es')));
    return parts.filter(Boolean).join('\n\n');
  }
  private async translateCached(text: string, source: string, target: string): Promise<string> {
    const config = this.config!;
    const bytes = new TextEncoder().encode(JSON.stringify([text, source, target, config.provider, config.model[config.provider], config.personality]));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const key = `waTranslate:business:translation:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    const cached = (await chrome.storage.local.get(key))[key];
    if (typeof cached === 'string' && cached.trim()) return cached;
    const result = await this.translate({ text, source, target });
    if (!result.translated.trim()) throw new Error('翻译结果为空，未发送');
    await chrome.storage.local.set({ [key]: result.translated });
    return result.translated;
  }
  private coverImages(record: BusinessRuntimeRecord): ProductImage[] {
    const product = this.data?.products.find((item) => item.id === record.productIds?.[0]);
    const image = product?.images.find((item) => item.id === product.coverImageId) ?? product?.images[0];
    return image ? [image] : [];
  }
  private async action(kind: string, record: BusinessRuntimeRecord, images: ProductImage[] = [], replaceText?: string): Promise<void> {
    const id = newRpcId();
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pendingActions.delete(id); reject(new Error(kind === 'SEND_REPLY' ? '发送状态不确定，请先检查客户聊天，勿重复发送' : '草稿插入超时，请手动复制草稿')); }, kind === 'SEND_REPLY' ? 45_000 : 6000);
      this.pendingActions.set(id, { messageId: record.message.id, kind, resolve: () => { clearTimeout(timer); resolve(); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      window.postMessage({ [TAG]: true, kind, id, chatId: record.message.chatId, messageId: record.message.id, text: record.reply, images, replaceText }, '*');
    });
  }
  private async insert(record: BusinessRuntimeRecord, withImages: boolean): Promise<void> {
    if (!record.reply || record.message.chatId !== this.chatId || this.inserting.has(record.message.id)) return;
    const composer = document.querySelector<HTMLElement>('#main footer [contenteditable="true"][role="textbox"], #main footer [contenteditable="true"]');
    const current = composer?.innerText ?? composer?.textContent ?? '';
    if (!withImages && current.trim() === record.reply.trim()) {
      window.postMessage({ [TAG]: true, kind: 'REGISTER_DRAFT', chatId: record.message.chatId, messageId: record.message.id, text: current }, '*');
      this.inserted.add(record.message.id);
      return;
    }
    if (current.trim() && !withImages) return;
    const product = this.data?.products.find((item) => item.id === record.productIds?.[0]);
    const selection = this.imageSelections.get(record.message.id);
    const images = withImages ? selection ? product?.images.filter((image) => selection.has(image.id)) ?? [] : this.coverImages(record) : [];
    if (withImages && current.trim() && current !== record.reply) throw new Error('输入框内容已修改，请先发送或清空后附图');
    this.inserting.add(record.message.id);
    try {
      await this.action('INSERT_DRAFT', record, images, withImages ? current : undefined);
      this.inserted.add(record.message.id);
    } finally { this.inserting.delete(record.message.id); }
  }

  private render(): void {
    const parent = document.querySelector('#main footer')?.parentElement;
    const record = [...this.records.values()].filter((item) => item.message.chatId === this.chatId && item.status === 'ready')
      .sort((a, b) => a.message.receivedAt - b.message.receivedAt)[0];
    if (!parent || !record) { this.banner?.remove(); this.banner = null; this.rendered = ''; return; }
    const signature = JSON.stringify([record, this.data?.products.map((product) => [product.id, product.updatedAt]), this.inserted.has(record.message.id)]);
    if (signature === this.rendered && this.banner?.isConnected) return;
    this.banner?.remove();
    const bar = document.createElement('div');
    bar.dataset.waBusiness = 'true'; bar.className = 'wa-business-bar'; bar.setAttribute('translate', 'no');
    const title = document.createElement('strong');
    title.textContent = `${record.categories?.map((category) => CATEGORY_NAMES[category]).join(' · ') || '回复'}草稿${record.translated && /价格|多少钱|报价|优惠|折扣/.test(record.translated) ? '（请确认价格）' : ''}`;
    bar.appendChild(title);
    if (record.error) { const error = document.createElement('p'); error.className = 'wa-business-error'; error.textContent = record.error; bar.appendChild(error); }
    if (!record.reply && (record.productIds?.length ?? 0) > 1) {
      for (const product of this.data?.products.filter((item) => record.productIds?.includes(item.id)) ?? []) this.button(bar, product.name, async () => {
        if (this.active.has(record.message.id)) return;
        this.active.add(record.message.id);
        try { await this.process(record, product.id); }
        finally { this.active.delete(record.message.id); this.render(); }
      });
    }
    if (record.reply) {
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '查看已生成的西语草稿';
      const text = document.createElement('pre'); text.textContent = record.reply; details.append(summary, text); bar.appendChild(details);
      this.button(bar, this.inserted.has(record.message.id) ? '草稿已放入输入框' : '插入空输入框', () => this.insert(record, false));
      this.button(bar, '复制草稿', () => navigator.clipboard.writeText(record.reply!).then(() => {}));
      const product = this.data?.products.find((item) => item.id === record.productIds?.[0]);
      if (product?.images.length) {
        let selected = this.imageSelections.get(record.message.id);
        if (!selected) { selected = new Set(this.coverImages(record).map((image) => image.id)); this.imageSelections.set(record.message.id, selected); }
        const imageRow = document.createElement('div'); imageRow.className = 'wa-business-images';
        for (const image of product.images) {
          const label = document.createElement('label'); const imageElement = document.createElement('img'); imageElement.src = image.dataUrl; imageElement.alt = image.name;
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(image.id);
          checkbox.addEventListener('change', () => { if (checkbox.checked) selected!.add(image.id); else selected!.delete(image.id); });
          label.append(checkbox, imageElement); imageRow.appendChild(label);
        }
        bar.appendChild(imageRow); this.button(bar, '将所选图片放入原生预览', () => this.insert(record, true));
      }
      const help = document.createElement('small'); help.textContent = '发送前可在 WhatsApp 输入框编辑西语草稿。已生成的草稿不会重复翻译。'; bar.appendChild(help);
    } else this.button(bar, '重新生成草稿', async () => { const next = await this.update(record, { status: 'pending', manualOnly: true, error: '' }); this.records.set(next.message.id, next); this.drain(); });
    this.button(bar, '忽略此条', async () => { await this.update(record, { status: 'dismissed' }); this.render(); });
    const footer = parent.querySelector('footer'); parent.insertBefore(bar, footer);
    this.banner = bar; this.rendered = signature;
    if (record.reply && !this.inserted.has(record.message.id) && !this.autoInsertAttempted.has(record.message.id)) {
      this.autoInsertAttempted.add(record.message.id);
      void this.insert(record, this.coverImages(record).length > 0).catch((error) => {
        const notice = document.createElement('p'); notice.className = 'wa-business-error'; notice.textContent = error instanceof Error ? error.message : '请手动插入草稿'; bar.appendChild(notice);
      }).finally(() => this.render());
    }
  }
  private button(parent: HTMLElement, text: string, callback: () => Promise<void>): void {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.addEventListener('click', () => { button.disabled = true; void callback().catch((error) => {
      const notice = document.createElement('p'); notice.className = 'wa-business-error'; notice.textContent = error instanceof Error ? error.message : '操作失败'; parent.appendChild(notice);
    }).finally(() => { button.disabled = false; this.render(); }); });
    parent.appendChild(button);
  }
}
