import { automaticCategoriesEnabled, hasAutomaticReplies, simpleGreetingChinese, productReplyImages, buildReplyPlan, businessSettingsSignature, compareBusinessArrival, BUSINESS_RUNTIME_PREFIX, CATEGORY_NAMES, formatReplyParts, type BusinessDraftSnapshot, type BusinessRuntimeRecord, type IncomingBusinessMessage, type ReplyPlan } from '@/shared/business-replies';
import { loadBusinessData, loadConfig, watchBusinessData, watchConfig } from '@/shared/storage';
import { newRpcId } from '@/shared/messages';
import { translationContext } from '@/shared/message-history';
import type { BusinessData, Config, ProductImage, ReplyCategory, ReplyLanguage, TranslateRequest, TranslateResult } from '@/shared/types';
import { HistoryStorage } from './history-storage';
import { WHATSAPP_IMAGE_LIMIT_KEY, validImageLimit, type WhatsAppImageLimit } from '@/shared/product-config';
import { createBusinessDraftBar, positionBusinessDraftBar } from './business-reply-ui';
import { BusinessDraftEditor } from './business-draft-editor';
import { TRANSLATION_POLICY_VERSION } from '@/shared/translation-policy';
import { type BusinessAutoLease, type BusinessAutoStatus } from '@/shared/business-auto';

const TAG = '__waBusiness';
type Translator = (request: TranslateRequest) => Promise<TranslateResult>;
interface EditorSession {
  messageId: string;
  text: string;
  expectedText: string;
  selected: Set<string>;
  open: boolean;
  busy: boolean;
  rebuilding: boolean;
  status: string;
  error: boolean;
}

export class BusinessReplies {
  private data: BusinessData | null = null;
  private config: Config | null = null;
  private chatId: string | null = null;
  private records = new Map<string, BusinessRuntimeRecord>();
  private active = new Set<string>();
  private inserted = new Set<string>();
  private inserting = new Set<string>();
  private insertionErrors = new Map<string, string>();
  private autoInsertAttempted = new Set<string>();
  private owner = newRpcId();
  private pendingActions = new Map<string, { messageId: string; kind: string; resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  private imageSelections = new Map<string, Set<string>>();
  private banner: HTMLElement | null = null;
  private rendered = '';
  private ready: Promise<void>;
  private history = new HistoryStorage();
  private capabilityReady = false;
  private lastImageLimit: WhatsAppImageLimit | null = null;
  private generation = 0;
  private editTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private finishing = new Set<string>();
  private completed = new Map<string, 'sent' | 'dismissed'>();
  private manualSending = new Map<string, string>();
  private mediaPreviews = new Map<string, string>();
  private focusedDraftId: string | null = null;
  private recordsLoaded = false;
  private adapterStateReady = false;
  private translationsInFlight = new Map<string, Promise<string>>();
  private previewSnapshots = new Map<string, BusinessDraftSnapshot>();
  private draftEditor: BusinessDraftEditor | null = null;
  private editorSession: EditorSession | null = null;
  private editorTimer: ReturnType<typeof setTimeout> | null = null;
  private autoLease: BusinessAutoLease | null = null;
  private autoBusy = false;
  private autoMessageId: string | null = null;
  private autoState: Pick<BusinessAutoStatus, 'phase' | 'reason' | 'customer'> = { phase: 'paused', reason: '正在连接 WhatsApp', customer: '' };
  private readonly startedAt = Date.now();
  private lastStatusAt = 0;
  private pageGone = false;
  private downgrading = new Set<string>();

  constructor(private readonly translate: Translator) {
    this.ready = Promise.all([loadConfig(), loadBusinessData()]).then(([config, data]) => { this.config = config; this.data = data; });
  }

  start(): void {
    document.querySelectorAll('wa-business-auto-status').forEach((element) => element.remove());
    window.addEventListener('message', this.onMessage);
    watchBusinessData((data) => {
      if (!this.data || businessSettingsSignature(this.data) !== businessSettingsSignature(data)) this.generation++;
      this.data = data; this.syncAutoControl(); this.drain(); this.render();
    });
    watchConfig((config) => { this.config = config; this.generation++; this.syncAutoControl(); this.drain(); this.render(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(BUSINESS_RUNTIME_PREFIX)) continue;
        const record = change.newValue as BusinessRuntimeRecord | undefined;
        if (!record || this.finishing.has(record.message.id)) continue;
        this.rememberRecord(record);
        if (['sent', 'dismissed', 'no-match'].includes(record.status)) this.forgetDraftUI(record.message.id);
      }
      this.render(); this.drain();
    });
    const interval = window.setInterval(() => { this.render(); this.drain(); this.publishAutoStatus(); }, 500);
    window.addEventListener('resize', this.positionBanner);
    window.addEventListener('pagehide', () => {
      this.pageGone = true; clearInterval(interval); window.removeEventListener('resize', this.positionBanner); this.banner?.remove(); this.disposeEditor();
      if (this.autoLease) void this.runtime('QUEUE_RELEASE', { owner: this.owner, token: this.autoLease.token }).catch(() => {});
    }, { once: true });
    void this.ready.then(async () => {
      if (typeof chrome.runtime.sendMessage !== 'function') return;
      const records = await this.runtime<BusinessRuntimeRecord[]>('LIST');
      for (const record of records) {
        this.rememberRecord(record);
        if (record.status === 'sending' && Date.now() - record.updatedAt > 120_000) await this.update(record, { status: 'ready', manualOnly: true, error: '上次发送状态不确定，请先检查聊天记录再处理。' });
      }
      this.recordsLoaded = true;
      this.syncAutoControl();
      this.requestAdapterState();
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
      if (data.ok) pending.resolve(data.result); else pending.reject(Object.assign(new Error(data.error || 'WhatsApp 操作失败'), { deferred: Boolean(data.deferred) }));
    } else if (data.kind === 'NATIVE_AUTO_STATE') {
      this.autoState = { phase: data.phase, reason: data.reason ?? '', customer: data.customer ?? '' };
      this.publishAutoStatus();
    } else if (data.kind === 'VERIFY_SEND') {
      const pending = this.pendingActions.get(data.id);
      const record = this.records.get(data.messageId);
      if (!pending || pending.kind !== 'SEND_REPLY' || pending.messageId !== data.messageId || !record) return;
      if (!this.autoLease || this.autoLease.token !== data.queueToken || this.autoMessageId !== data.messageId) return;
      void this.runtime<boolean>(data.finalCheck ? 'CHECK_SEND' : 'CAN_SEND', { messageId: record.message.id, owner: this.owner, queueToken: data.queueToken })
        .catch(() => false).then((allowed) => {
          if (allowed && !this.completed.has(record.message.id)) this.rememberRecord({ ...record, status: 'sending' });
          window.postMessage({ [TAG]: true, kind: 'SEND_AUTHORIZED', id: data.id, allowed }, '*');
        });
    } else if (data.kind === 'ACTIVE_CHAT') {
      const next = typeof data.chatId === 'string' ? data.chatId : null;
      if (this.chatId !== next) { this.disposeEditor(); this.inserted.clear(); this.autoInsertAttempted.clear(); this.focusedDraftId = null; this.rendered = ''; }
      this.chatId = next;
      this.drain(); this.render();
    } else if (data.kind === 'CAPABILITIES') {
      const becameReady = !this.capabilityReady && Boolean(data.incomingReady);
      if (this.capabilityReady !== Boolean(data.incomingReady)) console.info('[wa-translate][business] incoming adapter', { ready: Boolean(data.incomingReady), mediaReady: Boolean(data.mediaReady) });
      this.capabilityReady = Boolean(data.incomingReady);
      if (becameReady) this.requestAdapterState(); // The initial request may precede the lazy-loaded MAIN adapter.
      const bytes = validImageLimit(data.imageLimitBytes) ? data.imageLimitBytes : null;
      if (bytes !== this.lastImageLimit?.bytes || Date.now() - (this.lastImageLimit?.checkedAt ?? 0) >= 5 * 60_000) {
        this.lastImageLimit = { bytes, checkedAt: Date.now() };
        void chrome.storage.local.set({ [WHATSAPP_IMAGE_LIMIT_KEY]: this.lastImageLimit })
          .catch((error) => console.warn('[wa-translate][business] image limit cache failed', error));
      }
    } else if (data.kind === 'STATE_READY') {
      this.adapterStateReady = true;
      this.render(); this.drain();
    } else if (data.kind === 'DRAFT_SEND_STARTED') {
      const record = this.records.get(data.messageId);
      if (!record || record.status !== 'ready' || record.message.chatId !== data.chatId) return;
      this.manualSending.set(record.message.id, record.message.chatId);
      this.autoInsertAttempted.add(record.message.id);
      // Sending can clear the native editor before translation completes. Keep
      // this chat's draft UI hidden until the send succeeds or reports failure.
      const timer = this.editTimers.get(record.message.id);
      if (timer) clearTimeout(timer);
      this.editTimers.delete(record.message.id);
      this.cancelEditorTimer();
      if (typeof data.text === 'string' && data.text.trim()) {
        this.rememberRecord({ ...record, reply: data.text });
        void this.update(record, { reply: data.text }).catch((error) => console.warn('[wa-translate][business] sending draft save failed', error));
      }
      this.rendered = ''; this.render();
    } else if (data.kind === 'DRAFT_SENT') {
      const record = this.records.get(data.messageId);
      if (record && ['queued', 'ready', 'sending'].includes(record.status) && record.message.chatId === data.chatId) void this.finishDraft(record, 'sent')
        .catch((error) => console.warn('[wa-translate][business] sent draft status failed', error));
    } else if (data.kind === 'DRAFT_SEND_FAILED') {
      const record = this.records.get(data.messageId);
      if (!record || record.status !== 'ready' || record.message.chatId !== data.chatId) return;
      this.manualSending.delete(record.message.id);
      this.inserted.delete(record.message.id);
      this.mediaPreviews.delete(record.message.id);
      this.previewSnapshots.delete(record.message.id);
      this.autoInsertAttempted.add(record.message.id);
      this.insertionErrors.set(record.message.id, typeof data.error === 'string' ? data.error : '翻译失败，未发送，请恢复草稿后重试');
      this.disposeEditor(); this.rendered = ''; this.render();
    } else if (data.kind === 'DRAFT_INSERTED') {
      const record = this.records.get(data.messageId);
      if (!record || record.status !== 'ready' || this.manualSending.has(data.messageId) || record.message.chatId !== data.chatId || typeof data.text !== 'string' || !data.text.trim()) return;
      this.inserted.add(record.message.id);
      this.insertionErrors.delete(record.message.id);
      this.render();
    } else if (data.kind === 'DRAFT_CLEARED') {
      // Native sends can clear an editor just before the sent event arrives.
      // If the user instead cleared it manually, expose recovery controls once.
      window.setTimeout(() => {
        const record = this.records.get(data.messageId);
        if (record?.status === 'ready' && record.message.chatId === data.chatId && !this.manualSending.has(data.messageId) && !this.mediaPreviews.has(data.messageId) && !this.inserting.has(data.messageId)) {
          this.inserted.delete(data.messageId);
          this.rendered = ''; this.render();
        }
      }, 300);
    } else if (data.kind === 'DRAFT_PREVIEW' && typeof data.messageId === 'string' && typeof data.chatId === 'string') {
      if (data.open) {
        const record = this.records.get(data.messageId);
        if (!record || record.status !== 'ready' || record.message.chatId !== data.chatId || this.manualSending.has(data.messageId)) return;
        this.mediaPreviews.set(data.messageId, data.chatId);
        this.previewSnapshots.set(data.messageId, { text: this.records.get(data.messageId)?.reply ?? '', imageIds: Array.isArray(data.imageIds) ? data.imageIds : [], mediaOpen: true, bounds: data.bounds });
      }
      else {
        this.mediaPreviews.delete(data.messageId);
        this.previewSnapshots.delete(data.messageId);
        if (this.editorSession && this.editorSession.messageId === data.messageId && !this.editorSession.busy) this.disposeEditor();
        if (this.records.get(data.messageId)?.status === 'ready') this.inserted.delete(data.messageId);
        for (const next of this.records.values()) if (next.status === 'ready' && next.message.chatId === data.chatId && next.message.id !== data.messageId && !this.inserted.has(next.message.id)) this.autoInsertAttempted.delete(next.message.id);
        this.rendered = '';
      }
      this.render();
    } else if (data.kind === 'DRAFT_EDITED') {
      const record = this.records.get(data.messageId);
      if (!record || record.status !== 'ready' || this.manualSending.has(data.messageId) || record.message.chatId !== data.chatId || typeof data.text !== 'string') return;
      this.rememberRecord({ ...record, reply: data.text });
      const session = this.editorSession;
      if (session?.messageId === record.message.id) {
        if (session.text === session.expectedText) session.text = data.text;
        else if (data.origin !== 'plugin' && session.text !== data.text) {
          this.cancelEditorTimer(); session.status = 'WhatsApp 草稿已有新修改，保留你的文字，请检查后同步。'; session.error = true;
        }
        session.expectedText = data.text;
      }
      this.render();
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
        this.rememberRecord(record);
        this.drain();
      }).catch((error) => console.warn('[wa-translate][business] incoming storage failed', error));
    }
  };

  private async runtime<T>(operation: string, payload: Record<string, unknown> = {}): Promise<T> {
    const result = await chrome.runtime.sendMessage({ kind: `BUSINESS_RUNTIME_${operation}`, ...payload });
    if (!result?.ok) throw new Error(result?.error || '无法保存回复状态');
    return result.result as T;
  }
  private requestAdapterState(): void {
    if (!this.recordsLoaded) return;
    this.adapterStateReady = false;
    // Repair drafts left ready by an older build that missed native image sends.
    const drafts = [...this.records.values()].filter((record) => record.status === 'ready' && record.reply)
      .map((record) => ({ messageId: record.message.id, chatId: record.message.chatId, text: record.reply, draftLanguage: record.draftLanguage, receivedAt: record.message.receivedAt }));
    window.postMessage({ [TAG]: true, kind: 'REQUEST_STATE', drafts }, '*');
  }
  private async update(record: BusinessRuntimeRecord, patch: Partial<BusinessRuntimeRecord>): Promise<BusinessRuntimeRecord> {
    const next = await this.runtime<BusinessRuntimeRecord>('UPDATE', { messageId: record.message.id, owner: record.owner, patch });
    return this.rememberRecord(next);
  }
  private rememberRecord(record: BusinessRuntimeRecord): BusinessRuntimeRecord {
    const id = record.message.id;
    const completed = this.completed.get(id);
    // A delayed edit/storage/RPC response cannot resurrect a completed draft,
    // even if persisting its final status failed after WhatsApp sent it.
    if (completed && record.status !== completed) return this.records.get(id) ?? { ...record, status: completed };
    this.records.set(id, record);
    if (record.status === 'sent' || record.status === 'dismissed') {
      this.completed.set(id, record.status);
      this.forgetDraftUI(id);
    }
    return record;
  }

  private forgetDraftUI(messageId: string): void {
    this.manualSending.delete(messageId);
    const timer = this.editTimers.get(messageId);
    if (timer) clearTimeout(timer);
    this.editTimers.delete(messageId);
    this.inserted.delete(messageId);
    this.insertionErrors.delete(messageId);
    this.autoInsertAttempted.delete(messageId);
    this.imageSelections.delete(messageId);
    this.mediaPreviews.delete(messageId);
    this.previewSnapshots.delete(messageId);
    if (this.editorSession?.messageId === messageId) this.disposeEditor();
    if (this.focusedDraftId === messageId) this.focusedDraftId = null;
  }

  private async finishDraft(record: BusinessRuntimeRecord, status: 'sent' | 'dismissed'): Promise<void> {
    if (this.finishing.has(record.message.id)) return;
    this.finishing.add(record.message.id);
    this.rememberRecord({ ...record, status });
    this.forgetDraftUI(record.message.id);
    if (status === 'sent') {
      window.postMessage({ [TAG]: true, kind: 'CLEAR_DRAFT', chatId: record.message.chatId, messageId: record.message.id }, '*');
      // A later draft may have waited for this one's native media preview/input.
      for (const next of this.records.values()) if (next.status === 'ready' && next.message.chatId === record.message.chatId && !this.inserted.has(next.message.id)) this.autoInsertAttempted.delete(next.message.id);
    }
    this.render(); // Remove the sent/closed bar without waiting for storage I/O.
    try { await this.update(record, { status, error: '' }); }
    catch (error) {
      if (status === 'dismissed') { this.completed.delete(record.message.id); this.rememberRecord({ ...record, error: '关闭草稿失败，请重试' }); }
      // A confirmed send must never be reinserted or sent again after a save error.
      throw error;
    } finally { this.finishing.delete(record.message.id); this.render(); this.drain(); }
  }

  private positionBanner = (): void => {
    const preview = this.editorSession ? this.previewSnapshots.get(this.editorSession.messageId) : undefined;
    this.draftEditor?.position(preview?.bounds, preview?.mediaOpen ?? false);
    if (!this.banner) return;
    const footer = document.querySelector<HTMLElement>('#main footer');
    if (!footer) { this.banner.hidden = true; return; }
    positionBusinessDraftBar(this.banner, footer, [...this.mediaPreviews.values()].includes(this.chatId ?? ''));
  };

  private drain(): void {
    this.downgradeQueued();
    if (this.pageGone || !this.config?.enabled || !this.data || !this.capabilityReady || !this.recordsLoaded) return;
    void this.pumpAuto();
    for (const record of this.records.values()) {
      if (record.status === 'sending' && record.message.id !== this.autoMessageId && Date.now() - record.updatedAt > 120_000) {
        void this.update(record, { status: 'ready', manualOnly: true, error: '上次发送状态不确定，请先检查聊天记录，勿重复发送' }).catch(() => {});
      }
    }
    for (const record of [...this.records.values()].sort(compareBusinessArrival)) {
      if (this.active.size >= 2) return;
      if (this.active.has(record.message.id)) continue;
      if (record.status !== 'pending' && !(record.status === 'processing' && Date.now() - record.updatedAt > 120_000)) continue;
      this.active.add(record.message.id);
      void this.process(record).finally(() => { this.active.delete(record.message.id); this.render(); this.drain(); });
    }
  }

  private downgradeQueued(): void {
    if (!this.data || !this.config || this.pageGone) return;
    for (const record of this.records.values()) {
      if (record.status !== 'queued' || record.message.id === this.autoMessageId || this.downgrading.has(record.message.id)) continue;
      const enabled = this.config.enabled && automaticCategoriesEnabled(this.data, record.categories, record.phraseIds);
      if (enabled && record.settingsSignature === businessSettingsSignature(this.data) && record.translationContext === translationContext(this.config)) continue;
      this.downgrading.add(record.message.id);
      void this.runtime<BusinessRuntimeRecord>('UPDATE', { messageId: record.message.id, owner: record.owner, expectedStatus: 'queued',
        patch: { status: 'ready', manualOnly: true, error: enabled ? '配置已变化，请检查或重新生成草稿' : '自动回复已关闭，本条请人工确认' } })
        .then((next) => this.rememberRecord(next)).catch(() => {}).finally(() => { this.downgrading.delete(record.message.id); this.render(); });
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
      const promptContext = translationContext(this.config);
      const translated = record.translationContext === promptContext && record.translated
        ? record.translated : await this.incomingChinese(record.message);
      const context = await this.runtime<ReplyCategory | null>('CONTEXT', { chatId: record.message.chatId });
      const plan = buildReplyPlan(translated, this.data, context ?? undefined, selectedProductId, record.message.text);
      if (!plan.categories.length) { await this.update(record, { status: 'no-match', translated, translationPolicyVersion: TRANSLATION_POLICY_VERSION, translationContext: promptContext }); return; }
      const patch: Partial<BusinessRuntimeRecord> = { translated, translationPolicyVersion: TRANSLATION_POLICY_VERSION, translationContext: promptContext, categories: plan.categories, productIds: plan.products.map((product) => product.id), phraseIds: plan.phrases.map((phrase) => phrase.id), productPriceOnly: plan.productPriceOnly, settingsSignature: businessSettingsSignature(this.data) };
      if (plan.needsProductSelection || plan.missing.length) {
        await this.update(record, { ...patch, status: 'ready', error: plan.needsProductSelection ? '命中多个商品，请选择后生成草稿' : plan.missing.join('；'), manualOnly: true });
        return;
      }
      const automaticCandidate = plan.autoAllowed && !record.manualOnly && !selectedProductId && generation === this.generation
        && this.config.enabled;
      // Every manual Chinese reply is reviewed in Chinese before translation.
      // For a mixed-language plan, show the complete draft in Chinese so the
      // seller can review it; only already-Spanish parts need back-translation.
      const manualLanguage: ReplyLanguage = plan.parts.some((part) => part.language === 'zh-CN') ? 'zh-CN' : 'es-MX';
      let manualReply: string | undefined;
      const prepareManual = async () => manualReply ??= await this.prepareText(plan, manualLanguage);
      const reply = await prepareManual();
      const preparedReply = automaticCandidate ? await this.prepareText(plan, 'es-MX') : undefined;
      const automatic = automaticCandidate && generation === this.generation && this.config.enabled;
      if (!reply.trim()) throw new Error('回复内容为空');
      record = await this.update(record, { ...patch, reply, preparedReply, draftLanguage: manualLanguage, status: automatic ? 'queued' : 'ready', error: '', manualOnly: record.manualOnly || Boolean(selectedProductId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : '回复生成失败';
      try { await this.update(record, { status: 'ready', error: message, manualOnly: true }); }
      catch (storageError) { console.warn('[wa-translate][business] status save failed', storageError); }
    }
  }

  private syncAutoControl(): void {
    window.postMessage({ [TAG]: true, kind: 'AUTO_CONTROL', control: {
      enabled: Boolean(this.config?.enabled && (this.data && hasAutomaticReplies(this.data)) && !this.pageGone),
      epoch: this.generation, token: this.autoLease?.token ?? '', expiresAt: this.autoLease?.expiresAt ?? 0,
      editorBusy: Boolean(this.editorSession?.open || this.editorSession?.busy || this.manualSending.size),
    } }, '*');
  }
  private publishAutoStatus(): void {
    if (!this.data || !this.config || this.pageGone) return;
    const pending = [...this.records.values()].filter((record) => ['pending', 'processing', 'queued', 'sending'].includes(record.status)).length;
    const manual = [...this.records.values()].filter((record) => record.status === 'ready').length;
    const status: BusinessAutoStatus = { ...this.autoState, owner: this.owner, pending, manual, updatedAt: Date.now() };
    if (!hasAutomaticReplies(this.data) || !this.config.enabled) { status.phase = 'paused'; status.reason = '未启用自动回复，请开启对应分类或常用语'; }
    else if (status.phase === 'idle' && pending) { status.phase = 'waiting'; status.reason = '正在按到达顺序准备回复'; }
    const issue = [...this.records.values()].filter((record) => record.status === 'ready' && record.error)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (issue && hasAutomaticReplies(this.data) && this.config.enabled) status.reason = [status.reason, `待人工检查：${issue.error}`].filter(Boolean).join('；');
    // Runtime diagnostics stay in storage. Automatic customer service does not
    // add a queue counter, pause button or status panel to the chat window.
    if (Date.now() - this.lastStatusAt >= 1000) {
      this.lastStatusAt = Date.now();
      void this.runtime('QUEUE_STATUS', { owner: this.owner, token: this.autoLease?.token, status }).catch(() => {});
    }
  }
  private async pumpAuto(): Promise<void> {
    if (this.autoBusy || this.pageGone || !this.adapterStateReady || !(this.data && hasAutomaticReplies(this.data))
      || !this.config?.enabled || this.autoState.phase !== 'idle' || this.editorSession?.open || this.editorSession?.busy || this.manualSending.size) return;
    // Preparation may run concurrently, but the oldest incoming record must
    // finish preparation before a later one can take the native interface.
    const next = [...this.records.values()].filter((record) => ['pending', 'processing', 'queued', 'sending'].includes(record.status))
      .sort(compareBusinessArrival)[0];
    if (!next || next.status !== 'queued') return;
    this.autoBusy = true;
    let record: BusinessRuntimeRecord | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const lease = await this.runtime<BusinessAutoLease | null>('QUEUE_ACQUIRE', { owner: this.owner });
      if (!lease) { this.autoState = { phase: 'blocked', reason: '另一 WhatsApp 页面正在处理自动队列', customer: '' }; return; }
      this.autoLease = lease; this.syncAutoControl();
      heartbeat = setInterval(() => {
        void this.runtime<BusinessAutoLease | null>('QUEUE_RENEW', { owner: this.owner, token: lease.token }).then((renewed) => {
          if (!this.autoBusy || this.autoLease?.token !== lease.token || this.pageGone) return;
          this.autoLease = renewed; this.syncAutoControl();
        }).catch(() => {
          if (!this.autoBusy || this.autoLease?.token !== lease.token || this.pageGone) return;
          this.autoLease = null; this.syncAutoControl();
        });
      }, 5000);
      record = await this.runtime<BusinessRuntimeRecord | null>('TAKE_QUEUED', { owner: this.owner, queueToken: lease.token, messageId: next.message.id });
      if (!record) return;
      this.rememberRecord(record);
      if (record.settingsSignature !== businessSettingsSignature(this.data) || record.translationContext !== translationContext(this.config) || record.manualOnly) {
        await this.update(record, { status: 'ready', manualOnly: true, error: '回复配置已变化，请检查草稿或重新生成' }); return;
      }
      this.autoMessageId = record.message.id;
      await this.action('SEND_REPLY', record, this.draftImages(record), undefined, { queueToken: lease.token, preparedReply: record.preparedReply });
      await this.finishDraft(record, 'sent');
    } catch (error) {
      if (record && !this.completed.has(record.message.id)) {
        if ((error as { deferred?: boolean })?.deferred) {
          await this.update(record, { status: 'queued', error: '' }).catch(() => {});
        } else {
          const message = error instanceof Error ? error.message : '自动发送失败，请人工检查';
          console.warn('[wa-translate][business] native automatic reply stopped', { messageId: record.message.id, error: message });
          this.autoInsertAttempted.add(record.message.id);
          let text = record.reply;
          try {
            const snapshot = await this.action<BusinessDraftSnapshot>('READ_DRAFT', record);
            text = snapshot.text; this.inserted.add(record.message.id);
            if (snapshot.mediaOpen) { this.mediaPreviews.set(record.message.id, record.message.chatId); this.previewSnapshots.set(record.message.id, snapshot); }
          } catch { /* No current owned editor: preserve the review draft. */ }
          await this.update(record, { status: 'ready', reply: text, manualOnly: true, error: message }).catch(() => {});
        }
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      const lease = this.autoLease;
      this.autoLease = null; this.autoMessageId = null; this.syncAutoControl();
      if (lease) await this.runtime('QUEUE_RELEASE', { owner: this.owner, token: lease.token }).catch(() => {});
      this.autoBusy = false; this.render(); this.publishAutoStatus();
    }
  }

  private async incomingChinese(message: IncomingBusinessMessage): Promise<string> {
    const greeting = simpleGreetingChinese(message.text);
    if (greeting) return greeting;
    const config = this.config!;
    if (config.nativeLang === 'zh-CN') {
      const cached = await this.history.translation(message.id, message.text, translationContext(config));
      if (cached?.translated) return cached.translated;
    }
    return this.translateCached(message.text, 'auto', 'zh-CN');
  }
  private async prepareText(plan: ReplyPlan, language: ReplyLanguage): Promise<string> {
    const parts = await Promise.all(plan.parts.map((part) => part.verbatim || part.language === language
      ? Promise.resolve(part.text) : this.translateCached(part.text, part.language === 'zh-CN' ? 'zh-CN' : 'es', language === 'zh-CN' ? 'zh-CN' : 'es')));
    return formatReplyParts(plan.parts.map((part, index) => ({ ...part, text: parts[index] })), language);
  }
  private async translateCached(text: string, source: string, target: string): Promise<string> {
    const config = this.config!;
    const bytes = new TextEncoder().encode(JSON.stringify([text, source, target, translationContext(config)]));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const key = `waTranslate:business:translation:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    const existing = this.translationsInFlight.get(key);
    if (existing) return existing;
    const request = (async () => {
      const cached = (await chrome.storage.local.get(key))[key];
      if (typeof cached === 'string' && cached.trim()) return cached;
      const result = await this.translate({ text, source, target });
      if (!result.translated.trim()) throw new Error('翻译结果为空，未发送');
      await chrome.storage.local.set({ [key]: result.translated });
      return result.translated;
    })();
    this.translationsInFlight.set(key, request);
    try { return await request; }
    finally { if (this.translationsInFlight.get(key) === request) this.translationsInFlight.delete(key); }
  }
  private draftImages(record: BusinessRuntimeRecord): ProductImage[] {
    const product = this.data?.products.find((item) => item.id === record.productIds?.[0]);
    return productReplyImages(product, record.productPriceOnly);
  }
  private async action<T = void>(kind: string, record: BusinessRuntimeRecord, images: ProductImage[] = [], replaceText?: string, extra: Record<string, unknown> = {}): Promise<T> {
    const id = newRpcId();
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingActions.delete(id);
        if (kind === 'SEND_REPLY') window.postMessage({ [TAG]: true, kind: 'CANCEL_AUTO_ACTION', id }, '*');
        reject(new Error(kind === 'SEND_REPLY' ? '发送状态不确定，请先检查客户聊天，勿重复发送' : '草稿插入超时，请先检查原生预览，勿重复附图'));
      }, kind === 'SEND_REPLY' ? 150_000 : images.length ? 20_000 : 6000);
      this.pendingActions.set(id, { messageId: record.message.id, kind, resolve: (result) => { clearTimeout(timer); resolve(result as T); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      window.postMessage({ [TAG]: true, kind, id, chatId: record.message.chatId, messageId: record.message.id, text: record.reply, draftLanguage: record.draftLanguage ?? 'es-MX', images, replaceText, ...extra }, '*');
    });
  }
  private async insert(record: BusinessRuntimeRecord, withImages: boolean): Promise<void> {
    if ([...this.manualSending.values()].includes(record.message.chatId)) return;
    if (!record.reply || record.message.chatId !== this.chatId || this.inserted.has(record.message.id) || this.inserting.has(record.message.id)) return;
    if ([...this.records.values()].some((item) => item.message.chatId === this.chatId && (this.inserted.has(item.message.id) || this.inserting.has(item.message.id)))) return;
    const composer = document.querySelector<HTMLElement>('#main footer [contenteditable="true"][role="textbox"], #main footer [contenteditable="true"]');
    const current = composer?.innerText ?? composer?.textContent ?? '';
    if (current.trim() && !withImages) return;
    const selection = this.imageSelections.get(record.message.id);
    const images = withImages ? this.draftImages(record).filter((image) => !selection || selection.has(image.id)) : [];
    if (withImages && current.trim() && current !== record.reply) throw new Error('输入框内容已修改，请先发送或清空后附图');
    this.inserting.add(record.message.id);
    this.insertionErrors.delete(record.message.id);
    this.render();
    try {
      await this.action('INSERT_DRAFT', record, images, withImages ? current : undefined);
      if (this.records.get(record.message.id)?.status === 'ready' && !this.manualSending.has(record.message.id)) this.inserted.add(record.message.id);
    } catch (error) {
      if (this.records.get(record.message.id)?.status === 'ready' && !this.manualSending.has(record.message.id)) this.insertionErrors.set(record.message.id, error instanceof Error ? error.message : '请手动插入草稿');
      throw error;
    } finally { this.inserting.delete(record.message.id); }
  }

  private async regenerate(record: BusinessRuntimeRecord): Promise<void> {
    if (this.active.has(record.message.id) || this.inserting.has(record.message.id) || this.manualSending.has(record.message.id)) return;
    this.forgetDraftUI(record.message.id);
    await this.update(record, { status: 'pending', reply: '', manualOnly: true, error: '' });
    this.drain(); this.render();
  }

  private cancelEditorTimer(): void {
    if (this.editorTimer) clearTimeout(this.editorTimer);
    this.editorTimer = null;
  }
  private disposeEditor(): void {
    this.cancelEditorTimer(); this.draftEditor?.destroy(); this.draftEditor = null; this.editorSession = null;
  }
  private renderEditor(record?: BusinessRuntimeRecord): void {
    if (!record?.reply || record.status !== 'ready' || this.manualSending.has(record.message.id) || !record.categories?.includes('product')) { this.disposeEditor(); return; }
    if (this.editorSession?.messageId !== record.message.id) {
      this.disposeEditor();
      const snapshot = this.previewSnapshots.get(record.message.id);
      this.editorSession = { messageId: record.message.id, text: record.reply, expectedText: record.reply,
        selected: new Set(snapshot?.imageIds ?? this.imageSelections.get(record.message.id) ?? this.draftImages(record).map((image) => image.id)),
        open: false, busy: false, rebuilding: false, status: record.error || (record.productPriceOnly ? '仅回复价格，请确认或修改金额后手动发送；文字修改后自动同步。' : '文字修改后自动同步；勾选图片后点击同步所选图片。'), error: Boolean(record.error) };
      this.draftEditor = new BusinessDraftEditor({
        toggle: (open) => {
          const session = this.editorSession;
          if (!session) return;
          session.open = open; this.render();
          if (open && !session.busy) void this.readEditorDraft();
        },
        text: (text) => {
          const session = this.editorSession; if (!session) return;
          session.text = text; session.error = false; session.status = '等待同步文字…';
          this.cancelEditorTimer(); this.editorTimer = setTimeout(() => { this.editorTimer = null; void this.syncEditor(false); }, 450);
          this.render();
        },
        images: (ids) => {
          const session = this.editorSession; if (!session) return;
          session.selected = ids; session.status = `已选择 ${ids.size} 张，点击同步所选图片更新预览。`; session.error = false; this.render();
        },
        applyImages: () => { void this.syncEditor(true); },
        applyText: () => { void this.syncEditor(false); },
      });
    }
    const session = this.editorSession!;
    this.draftEditor!.update({ ...session, language: record.draftLanguage ?? 'es-MX', images: this.draftImages(record) });
    const preview = this.previewSnapshots.get(record.message.id);
    this.draftEditor!.position(preview?.bounds, preview?.mediaOpen ?? false);
  }
  private async readEditorDraft(): Promise<void> {
    const session = this.editorSession; const record = session && this.records.get(session.messageId);
    if (!session || !record) return;
    try {
      const snapshot = await this.action<BusinessDraftSnapshot>('READ_DRAFT', record);
      if (this.editorSession !== session) return;
      if (session.text === session.expectedText) session.text = snapshot.text;
      session.expectedText = snapshot.text;
      this.previewSnapshots.set(session.messageId, snapshot);
      session.status = '已读取原生草稿，文字修改后自动同步。'; session.error = false;
    } catch (error) {
      if (this.editorSession === session) { session.status = error instanceof Error ? error.message : '读取草稿失败'; session.error = true; }
    } finally { this.render(); }
  }
  private async syncEditor(withImages: boolean): Promise<void> {
    const session = this.editorSession; const record = session && this.records.get(session.messageId);
    if (!session || !record || record.status !== 'ready' || this.manualSending.has(record.message.id) || record.message.chatId !== this.chatId) return;
    if (session.busy) return;
    this.cancelEditorTimer();
    if (!session.text.trim()) { session.status = '请填写回复文字后再同步。'; session.error = true; this.render(); return; }
    if (!withImages && session.text === session.expectedText) return;
    const text = session.text;
    const images = withImages ? this.draftImages(record).filter((image) => session.selected.has(image.id)) : [];
    session.busy = true; session.rebuilding = withImages; session.error = false;
    session.status = withImages ? '正在更新原生预览的图片和文字…' : '正在同步文字…'; this.render();
    let succeeded = false;
    try {
      const snapshot = await this.action<BusinessDraftSnapshot>(withImages ? 'UPDATE_DRAFT_IMAGES' : 'UPDATE_DRAFT_TEXT', record, images, undefined, { text, expectedText: session.expectedText });
      if (this.editorSession !== session) return;
      session.expectedText = snapshot.text; this.previewSnapshots.set(session.messageId, snapshot);
      if (withImages) { session.selected = new Set(snapshot.imageIds); this.imageSelections.set(session.messageId, session.selected); }
      session.status = withImages ? `已同步 ${snapshot.imageIds.length} 张图片和文字。` : '文字已同步到 WhatsApp。'; session.error = false; succeeded = true;
      await this.update(record, { reply: snapshot.text });
    } catch (error) {
      if (this.editorSession === session) { session.status = error instanceof Error ? error.message : '同步失败，请检查原生草稿'; session.error = true; }
    } finally {
      if (this.editorSession === session) {
        session.busy = false; session.rebuilding = false;
        if (succeeded && session.text !== session.expectedText) this.editorTimer = setTimeout(() => { this.editorTimer = null; void this.syncEditor(false); }, 450);
      }
      this.render();
    }
  }

  private render(): void {
    this.syncAutoControl(); this.publishAutoStatus();
    if (this.autoBusy && !this.editorSession?.open && !this.editorSession?.busy) {
      this.disposeEditor(); this.banner?.remove(); this.banner = null; this.rendered = ''; return;
    }
    if ([...this.manualSending.values()].includes(this.chatId ?? '')) {
      this.disposeEditor(); this.banner?.remove(); this.banner = null; this.rendered = ''; return;
    }
    const footer = document.querySelector<HTMLElement>('#main footer');
    const queue = [...this.records.values()].filter((item) => item.message.chatId === this.chatId && item.status === 'ready'
      // Old manual records must not fill the editor and block new automatic
      // tasks. A failed automatic attempt is never reinserted as a manual job.
      && (!(this.data && hasAutomaticReplies(this.data)) || item.message.receivedAt >= this.startedAt && !item.preparedReply))
      .sort(compareBusinessArrival);
    const record = queue.find((item) => item.message.id === this.focusedDraftId) ?? queue[0];
    const editorRecord = queue.find((item) => this.mediaPreviews.has(item.message.id) || this.inserted.has(item.message.id))
      ?? queue.find((item) => item.message.id === this.editorSession?.messageId && (this.editorSession.open || this.editorSession.busy));
    this.renderEditor(editorRecord);
    // The WhatsApp composer/media preview is the only editor once a draft has
    // been placed there. Keep later queued drafts dormant until it is handled.
    const nativeDraftActive = [...this.mediaPreviews.values()].includes(this.chatId ?? '')
      || queue.some((item) => this.inserted.has(item.message.id) || this.inserting.has(item.message.id));
    if (!footer || !record || nativeDraftActive || this.editorSession?.open) { this.banner?.remove(); this.banner = null; this.rendered = ''; return; }
    const insertionError = this.insertionErrors.get(record.message.id);
    const signature = JSON.stringify([record, queue.map((item) => item.message.id), this.data?.products.map((product) => [product.id, product.updatedAt]), insertionError]);
    if (signature === this.rendered && this.banner?.isConnected) { this.positionBanner(); this.insertAutomatically(record); return; }
    this.banner?.remove();
    const { host, body: bar } = createBusinessDraftBar();
    const header = document.createElement('div'); header.className = 'wa-business-header';
    const title = document.createElement('strong');
    title.textContent = `${record.categories?.map((category) => category === 'product' && record.productPriceOnly ? '报价' : CATEGORY_NAMES[category]).join(' · ') || '回复'}草稿${record.productPriceOnly || record.translated && /价格|多少钱|报价|优惠|折扣/.test(record.translated) ? '（请确认价格）' : ''}`;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'wa-business-close'; close.textContent = '×';
    close.title = '关闭此条草稿提示'; close.setAttribute('aria-label', '关闭此条草稿提示');
    close.addEventListener('click', () => { void this.finishDraft(record, 'dismissed').catch((error) => console.warn('[wa-translate][business] dismiss failed', error)); });
    header.append(title, close); bar.appendChild(header);
    if (queue.length > 1) {
      const queueInfo = document.createElement('small'); queueInfo.textContent = `待处理 ${queue.length} 条 · 当前消息 ${new Date(record.message.receivedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`; bar.appendChild(queueInfo);
      this.button(bar, '查看下一条草稿', async () => { const index = queue.indexOf(record); this.focusedDraftId = queue[(index + 1) % queue.length].message.id; this.render(); });
    }
    if (record.error) { const error = document.createElement('p'); error.className = 'wa-business-error'; error.textContent = record.error; bar.appendChild(error); }
    if (insertionError) { const error = document.createElement('p'); error.className = 'wa-business-error'; error.textContent = insertionError; bar.appendChild(error); }
    if (!record.reply && (record.productIds?.length ?? 0) > 1) {
      for (const product of this.data?.products.filter((item) => record.productIds?.includes(item.id)) ?? []) this.button(bar, product.name, async () => {
        if (this.active.has(record.message.id)) return;
        this.active.add(record.message.id);
        try { await this.process(record, product.id); }
        finally { this.active.delete(record.message.id); this.render(); }
      });
    }
    if (record.reply) {
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = record.draftLanguage === 'zh-CN' ? '查看中文草稿（确认发送时翻译）' : '查看已生成的西语草稿';
      const text = document.createElement('pre'); text.textContent = record.reply; details.append(summary, text); bar.appendChild(details);
      this.button(bar, '插入空输入框', () => this.insert(record, false));
      this.button(bar, '复制草稿', () => navigator.clipboard.writeText(record.reply!).then(() => {}));
      const images = this.draftImages(record);
      if (images.length) {
        let selected = this.imageSelections.get(record.message.id);
        if (!selected) { selected = new Set(images.map((image) => image.id)); this.imageSelections.set(record.message.id, selected); }
        const imageRow = document.createElement('div'); imageRow.className = 'wa-business-images';
        for (const image of images) {
          const label = document.createElement('label'); const imageElement = document.createElement('img'); imageElement.src = image.dataUrl; imageElement.alt = image.name;
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(image.id);
          checkbox.addEventListener('change', () => { if (checkbox.checked) selected!.add(image.id); else selected!.delete(image.id); });
          label.append(checkbox, imageElement); imageRow.appendChild(label);
        }
        bar.appendChild(imageRow); this.button(bar, '将所选图片放入原生预览', () => this.insert(record, true));
        const imageHelp = document.createElement('small'); imageHelp.textContent = '默认带上商品全部图片（最多 6 张），可在 WhatsApp 原生预览中检查、删减后一起发送。'; bar.appendChild(imageHelp);
      }
      const help = document.createElement('small'); help.textContent = record.draftLanguage === 'zh-CN'
        ? '先在 WhatsApp 输入框确认或修改中文，点击发送时翻译成西语；中文原文仅在本地显示。'
        : '发送前可在 WhatsApp 输入框编辑西语草稿。已生成的草稿不会重复翻译。'; bar.appendChild(help);
      this.button(bar, '重新生成草稿', () => this.regenerate(record));
    } else this.button(bar, '重新生成草稿', () => this.regenerate(record));
    this.button(bar, '忽略此条', () => this.finishDraft(record, 'dismissed'));
    document.body.appendChild(host);
    this.banner = host; this.rendered = signature; this.positionBanner();
    this.insertAutomatically(record);
  }
  private insertAutomatically(record: BusinessRuntimeRecord): void {
    if ([...this.manualSending.values()].includes(record.message.chatId)) return;
    if (!this.adapterStateReady || !this.recordsLoaded) return;
    if ([...this.mediaPreviews.values()].includes(record.message.chatId)) return;
    if (record.reply && !this.inserted.has(record.message.id) && !this.autoInsertAttempted.has(record.message.id)) {
      this.autoInsertAttempted.add(record.message.id);
      void this.insert(record, this.draftImages(record).length > 0).catch(() => {}).finally(() => this.render());
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
