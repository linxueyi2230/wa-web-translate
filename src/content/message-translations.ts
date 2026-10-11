import type { Config, TranslateRequest, TranslateResult } from '@/shared/types';
import {
  HISTORY_TAG, PENDING_TTL_MS, matchesPending, normalizeChatId, parseMessageId,
  translationContext, validDraft,
  type OriginalRecord, type PendingOutgoing,
} from '@/shared/message-history';
import { languageLabel } from '@/shared/languages';
import { HistoryStorage } from './history-storage';
import { LOCAL_MESSAGE as LOCAL, MESSAGE_KEY_ATTRIBUTES, elementMessageId, messageDomDiagnostics, messageRows, readBubble, type BubbleMessage } from '@/shared/message-dom';
export { readBubble } from '@/shared/message-dom';

interface Entry {
  message: BubbleMessage;
  generation: number;
  status: 'queued' | 'loading' | 'done' | 'error';
  addon: HTMLElement;
}

type Translator = (request: TranslateRequest) => Promise<TranslateResult>;

export class MessageTranslations {
  private config: Config | null = null;
  private generation = 0;
  private entries = new WeakMap<HTMLElement, Entry>();
  private drafts = new Map<string, PendingOutgoing>();
  private boundDrafts = new Map<string, PendingOutgoing>();
  private claiming = new Set<string>();
  private cancelled = new Set<string>();
  private queue: Array<{ bubble: HTMLElement; entry: Entry }> = [];
  private active = 0;
  private inflight = new Map<string, Promise<{ translated: string; persistent: boolean }>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private observer: MutationObserver | null = null;
  private stopped = false;
  private lastScanSummary = '';
  private waitingReports = new Map<string, string>();
  private readonly pendingReady: Promise<void>;

  constructor(private readonly translate: Translator, private readonly storage = new HistoryStorage()) {
    this.pendingReady = storage.loadPending().then((drafts) => {
      for (const draft of drafts) {
        if (validDraft(draft) && Array.isArray(draft.baselineIds)) this.drafts.set(draft.token, draft);
      }
    }).catch((error) => console.error('[wa-translate][history] pending load failed', error));
  }

  start(): void {
    window.addEventListener('message', this.onHistoryMessage);
    // Handle only selected local text before document/message copy handlers.
    // Native copy uses ClipboardEvent data and needs no Clipboard API permission.
    window.addEventListener('copy', this.onCopy, true);
    window.addEventListener('scroll', this.schedule, true);
    window.addEventListener('resize', this.schedule);
    this.observer = new MutationObserver((changes) => {
      // Ignore OUR annotations. Otherwise adding a translation retriggers the observer forever.
      if (changes.some((change) => !this.ownMutation(change))) this.schedule();
    });
    this.observer.observe(document.body, {
      childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: [...MESSAGE_KEY_ATTRIBUTES, 'class', 'data-testid', 'data-pre-plain-text', 'dir'],
    });
    console.info('[wa-translate][history] bubble observer installed');
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    window.removeEventListener('message', this.onHistoryMessage);
    window.removeEventListener('copy', this.onCopy, true);
    window.removeEventListener('scroll', this.schedule, true);
    window.removeEventListener('resize', this.schedule);
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
    document.querySelectorAll(LOCAL).forEach((node) => node.remove());
  }

  setConfig(config: Config): void {
    if (this.config && this.config.enabled === config.enabled
      && translationContext(this.config) === translationContext(config)) {
      this.config = config;
      return;
    }
    this.config = config;
    this.generation++;
    this.entries = new WeakMap();
    this.queue = [];
    document.querySelectorAll(LOCAL).forEach((node) => node.remove());
    this.schedule();
  }

  private ownMutation(change: MutationRecord): boolean {
    const target = change.target instanceof Element ? change.target : change.target.parentElement;
    if (target?.closest(LOCAL)) return true;
    const nodes = [...change.addedNodes, ...change.removedNodes];
    return change.type === 'childList' && nodes.length > 0
      && nodes.every((node) => node instanceof Element && node.matches(LOCAL));
  }

  private schedule = (): void => {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.scan(); }, 100);
  };

  private visible(bubble: HTMLElement): boolean {
    const rect = bubble.getBoundingClientRect();
    return rect.bottom >= -300 && rect.top <= window.innerHeight + 300;
  }

  scan(): void {
    if (this.stopped || !this.config?.enabled || !this.config.nativeLang) return;
    const rows = messageRows();
    const messages: BubbleMessage[] = [];
    for (const bubble of rows) {
      const message = readBubble(bubble);
      const previous = this.entries.get(bubble);
      if (!message) {
        previous?.addon.remove();
        this.entries.delete(bubble);
        continue;
      }
      messages.push(message);
      if (previous && previous.message.id === message.id && previous.message.text === message.text
        && previous.generation === this.generation) {
        // WhatsApp can replace an inner text node without replacing the message row.
        if (!message.host.contains(previous.addon)) message.host.appendChild(previous.addon);
        continue;
      }
      previous?.addon.remove();
      if (!this.visible(bubble)) continue;
      const addon = document.createElement('div');
      addon.dataset.waTransLocal = 'true';
      addon.className = 'wa-translate-message-local';
      addon.setAttribute('translate', 'no');
      addon.setAttribute('contenteditable', 'false');
      // Let the browser select our text, without WhatsApp handling this gesture
      // as a click/selection on the surrounding original message.
      for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'keydown']) {
        addon.addEventListener(type, (event) => event.stopPropagation());
      }
      const entry: Entry = { message, generation: this.generation, status: 'queued', addon };
      this.entries.set(bubble, entry);
      message.host.appendChild(addon);
      this.render(entry, '我的母语（仅本地）', '翻译加载中…');
      this.queue.push({ bubble, entry });
    }
    this.reportScan(rows.length, messages);
    this.drain();
  }

  private reportScan(rowsSeen: number, messages: BubbleMessage[]): void {
    const summary = { ...messageDomDiagnostics(), rowsSeen, readable: messages.length,
      outgoing: messages.filter((message) => message.outgoing).length,
      pendingOriginals: this.drafts.size };
    const signature = JSON.stringify(summary);
    if (signature !== this.lastScanSummary) {
      this.lastScanSummary = signature;
      console.info('[wa-translate][history] message scan', summary);
    }
    for (const draft of this.drafts.values()) {
      if (!draft.ready || this.claiming.has(draft.token)) continue;
      const outgoing = messages.filter((message) => message.outgoing);
      const sameChat = outgoing.filter((message) => message.chatId === normalizeChatId(draft.chatId));
      const matched = sameChat.some((message) => matchesPending(draft, message.id, message.text));
      if (matched) { this.waitingReports.delete(draft.token); continue; }
      const state = { token: draft.token, rowsSeen, readable: messages.length, sameChat: sameChat.length,
        expired: Date.now() - draft.createdAt > PENDING_TTL_MS };
      const current = JSON.stringify(state);
      if (this.waitingReports.get(draft.token) !== current) {
        this.waitingReports.set(draft.token, current);
        console.warn('[wa-translate][history] original awaiting matching message', state);
      }
    }
  }

  private current(bubble: HTMLElement, entry: Entry): boolean {
    const message = readBubble(bubble);
    return !this.stopped && bubble.isConnected && this.entries.get(bubble) === entry
      && entry.generation === this.generation && message?.id === entry.message.id
      && message.text === entry.message.text;
  }

  private render(entry: Entry, label: string, text: string, kind = 'status'): void {
    entry.addon.replaceChildren();
    // The screenshot has just the text below a separator, no language heading.
    // Keep the original-vs-backtranslation distinction available to screen readers
    // and on hover without adding a visible label to every bubble.
    entry.addon.setAttribute('aria-label', label);
    entry.addon.title = label;
    entry.addon.dataset.kind = kind;
    const body = document.createElement('div');
    body.className = 'wa-translate-message-body';
    body.dir = 'auto';
    body.textContent = text; // NEVER innerHTML: model output / message text is untrusted.
    entry.addon.appendChild(body);
    if (kind === 'translation' || kind === 'original') {
      body.tabIndex = 0;
    }
  }

  private onCopy = (event: ClipboardEvent): void => {
    if (!event.clipboardData || document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
    const range = selection.getRangeAt(0);
    const bodyFor = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('.wa-translate-message-body');
    const body = bodyFor(range.startContainer);
    if (!body || body !== bodyFor(range.endContainer) || !body.closest(LOCAL)) return;
    const text = selection.toString();
    if (!text) return;
    // Copy exactly the selected local text instead of letting a parent handler
    // replace it with the surrounding WhatsApp message's original text.
    event.clipboardData.setData('text/plain', text);
    event.preventDefault(); event.stopImmediatePropagation();
  };

  private showOriginal(entry: Entry, original: OriginalRecord): void {
    entry.status = 'done';
    this.render(entry, `我的母语原文 · ${languageLabel(original.source)}（仅本地）`, original.original, 'original');
  }

  private drain(): void {
    while (this.active < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      if (!this.current(job.bubble, job.entry)) continue;
      this.active++;
      void this.process(job.bubble, job.entry).finally(() => { this.active--; this.drain(); });
    }
  }

  private async findOriginal(message: BubbleMessage): Promise<OriginalRecord | null> {
    const saved = await this.storage.original(message.id, message.text);
    if (saved) return saved;
    await this.pendingReady;
    for (const draft of this.drafts.values()) {
      if (!draft.ready || this.claiming.has(draft.token) || !matchesPending(draft, message.id, message.text)) continue;
      this.claiming.add(draft.token);
      try {
        const record = await this.storage.bind(draft, message.id);
        this.drafts.delete(draft.token);
        this.waitingReports.delete(draft.token);
        this.rememberBound(draft);
        console.info('[wa-translate][history] outgoing original bound', {
          messageId: message.id, originalChars: draft.original.length, persistent: true,
        });
        return record;
      } finally { this.claiming.delete(draft.token); }
    }
    return null;
  }

  private async process(bubble: HTMLElement, entry: Entry): Promise<void> {
    const config = this.config!;
    const context = translationContext(config);
    const message = entry.message;
    entry.status = 'loading';
    try {
      if (message.outgoing) {
        const original = await this.findOriginal(message);
        if (!this.current(bubble, entry)) return;
        if (original) {
          this.showOriginal(entry, original);
          console.info('[wa-translate][history] outgoing original displayed', {
            messageId: message.id, originalChars: original.original.length,
          });
          return;
        }
        if (Array.from(this.drafts.values()).some((draft) => !draft.ready && matchesPending(draft, message.id, message.text))) {
          // Do not guess at a text match before send returns its actual MessageKey.
          entry.status = 'done';
          this.render(entry, '我的母语原文（仅本地）', '正在关联发送记录…');
          return;
        }
      }
      const cached = await this.storage.translation(message.id, message.text, context);
      if (!this.current(bubble, entry)) return;
      let translated = cached?.translated;
      let persistent = !!cached;
      if (!translated) {
        const key = JSON.stringify([message.id, message.text, context]);
        let request = this.inflight.get(key);
        if (!request) {
          request = this.fetchTranslation(message, config, context);
          this.inflight.set(key, request);
        }
        try { ({ translated, persistent } = await request); }
        finally { if (this.inflight.get(key) === request) this.inflight.delete(key); }
      }
      if (!this.current(bubble, entry)) return;
      entry.status = 'done';
      const label = `我的母语译文 · ${languageLabel(config.nativeLang)}（仅本地${persistent ? '' : '，未保存'}）`;
      this.render(entry, label, translated, 'translation');
      console.info('[wa-translate][history] bilingual bubble displayed', {
        messageId: message.id, direction: message.outgoing ? 'outgoing-history' : 'incoming',
        translatedChars: translated.length, cacheHit: !!cached, persistent,
      });
    } catch (error) {
      if (!this.current(bubble, entry)) return;
      entry.status = 'error';
      this.render(entry, '我的母语（仅本地）', '翻译或本地保存失败，请检查扩展配置。');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'wa-translate-message-retry';
      retry.textContent = '重试';
      retry.addEventListener('click', (event) => {
        event.stopPropagation();
        if (entry.status !== 'error' || !this.current(bubble, entry)) return;
        entry.status = 'queued';
        this.render(entry, '我的母语（仅本地）', '翻译加载中…');
        this.queue.push({ bubble, entry });
        this.drain();
      });
      entry.addon.appendChild(retry);
      console.error('[wa-translate][history] bubble translation failed', { messageId: message.id, error });
    }
  }

  private async fetchTranslation(message: BubbleMessage, config: Config, context: string) {
    console.info('[wa-translate][history] bubble translation start', {
      messageId: message.id, direction: message.outgoing ? 'outgoing-history' : 'incoming',
      textChars: message.text.length, target: config.nativeLang,
    });
    const result = await this.translate({ text: message.text, source: 'auto', target: config.nativeLang });
    if (!result.translated?.trim()) throw new Error('翻译结果为空');
    let persistent = false;
    // Even if this chat was closed, cache the result for the next visit.
    try {
      await this.storage.saveTranslation({
        messageId: message.id, text: message.text, translated: result.translated, target: config.nativeLang,
        context, createdAt: Date.now(),
      });
      persistent = true;
    } catch (error) {
      console.error('[wa-translate][history] translation cache save failed', { messageId: message.id, error });
    }
    return { translated: result.translated, persistent };
  }

  private onHistoryMessage = (event: MessageEvent): void => {
    const data = event.data;
    if (event.source !== window || data?.[HISTORY_TAG] !== true) return;
    if (data.kind === 'CANCEL_OUTGOING' && typeof data.token === 'string') {
      this.cancelled.add(data.token);
      this.drafts.delete(data.token);
      void this.storage.cancel(data.token).catch((error) => console.error('[wa-translate][history] cancel failed', error));
      this.refreshOutgoing();
      return;
    }
    if (!['PREPARE_OUTGOING', 'BIND_OUTGOING', 'SENT_OUTGOING'].includes(data.kind)) return;
    const operation = data.kind === 'PREPARE_OUTGOING'
      ? this.prepare(data.draft) : data.kind === 'BIND_OUTGOING' || typeof data.messageId === 'string'
        ? this.bind(data.token, data.messageId) : this.finishWithoutId(data.token);
    void operation.then(() => {
      window.postMessage({ [HISTORY_TAG]: true, kind: 'HISTORY_RESULT', id: data.id, ok: true }, '*');
    }).catch((error) => {
      window.postMessage({ [HISTORY_TAG]: true, kind: 'HISTORY_RESULT', id: data.id, ok: false,
        error: error instanceof Error ? error.message : String(error) }, '*');
      console.error('[wa-translate][history] outgoing original save failed', error);
    });
  };

  private refreshOutgoing(messageId?: string): void {
    for (const bubble of messageRows()) {
      const message = readBubble(bubble);
      if (message?.outgoing && (!messageId || message.id === messageId)) {
        this.entries.get(bubble)?.addon.remove();
        this.entries.delete(bubble);
      }
    }
    this.scan(); // A void send result must not leave the saved original waiting for another DOM mutation.
  }

  private rememberBound(draft: PendingOutgoing): void {
    // This is only short-lived RPC correlation, NOT the persistent history.
    this.boundDrafts.set(draft.token, draft);
    if (this.boundDrafts.size > 200) this.boundDrafts.delete(this.boundDrafts.keys().next().value!);
  }

  private async finishWithoutId(token: unknown): Promise<void> {
    await this.pendingReady;
    if (typeof token !== 'string') throw new Error('发送记录无效');
    const draft = this.drafts.get(token);
    if (!draft) throw new Error('找不到待关联原文');
    draft.ready = true;
    await this.storage.prepare(draft);
    this.refreshOutgoing();
    console.info('[wa-translate][history] send result has no message ID; waiting for new bubble', { token });
  }

  private async bind(token: unknown, messageId: unknown): Promise<void> {
    if (typeof token !== 'string' || typeof messageId !== 'string') throw new Error('消息 ID 无效');
    await this.pendingReady;
    const draft = this.drafts.get(token) ?? this.boundDrafts.get(token);
    const key = parseMessageId(messageId);
    if (!draft || !key?.fromMe || key.chatId !== normalizeChatId(draft.chatId)) {
      throw new Error('消息 ID 与聊天不匹配');
    }
    await this.storage.bind(draft, messageId);
    this.drafts.delete(token);
    this.waitingReports.delete(token);
    this.rememberBound(draft);
    // If a fallback translation was already displayed, replace it with the real input.
    this.refreshOutgoing(messageId);
    console.info('[wa-translate][history] outgoing original bound by send result', { messageId, persistent: true });
  }

  private async prepare(value: unknown): Promise<void> {
    if (!validDraft(value)) throw new Error('消息原文参数无效：无法确认聊天 ID');
    await this.pendingReady;
    if (this.cancelled.has(value.token)) throw new Error('原文保存请求已取消');
    // Capture keys even before a row's text has rendered; otherwise a late old
    // bubble can be mistaken for the newly sent message with identical text.
    const baselineIds = messageRows().map((row) => elementMessageId(row)!)
      .filter((id) => !!parseMessageId(id)?.fromMe);
    const draft: PendingOutgoing = { ...value, baselineIds, ready: false };
    await this.storage.prepare(draft);
    if (this.cancelled.has(value.token)) {
      await this.storage.cancel(value.token);
      throw new Error('原文保存请求已取消');
    }
    this.drafts.set(draft.token, draft);
    console.info('[wa-translate][history] outgoing original saved before send', {
      token: draft.token, originalChars: draft.original.length, translatedChars: draft.translated.length,
    });
  }
}
