import { AUTO_IDLE_MS, type NativeAutoRequest, type BusinessAutoStatus } from '@/shared/business-auto';
import { normalizeChatId } from '@/shared/message-history';
import { getActiveChatId, getActiveChatIdFromDom, openNativeChat } from './wa';
import { armNativeBusinessSend, clearNativeBusinessSend, isBusinessDraftFinished, registerNativeBusinessSend, notifyBusinessDraftSendFailed } from './business-drafts';

interface Control { enabled: boolean; epoch: number; token: string; expiresAt: number; editorBusy: boolean }
interface Callbacks {
  busy: (owned?: NativeAutoRequest) => string;
  insert: (request: NativeAutoRequest, validate: () => void) => Promise<void>;
  validateDraft: (request: NativeAutoRequest) => void;
  isDraftInput: (target: Element, request: NativeAutoRequest) => boolean;
  sendButton: (request: NativeAutoRequest) => HTMLElement | null;
  authorize: (request: NativeAutoRequest, finalCheck: boolean) => Promise<boolean>;
  customer: (chatId: string) => string;
  state: (status: Pick<BusinessAutoStatus, 'phase' | 'reason' | 'customer'>) => void;
}
interface Task {
  request: NativeAutoRequest;
  epoch: number;
  inserted: boolean;
  writing: boolean;
  clicked: boolean;
  navigating: boolean;
  cancelled: string;
  complete?: (error?: Error) => void;
}
export class NativeReplyError extends Error {
  constructor(message: string, readonly deferred = false) { super(message); }
}

export class NativeAutoReply {
  private control: Control = { enabled: false, epoch: 0, token: '', expiresAt: 0, editorBusy: false };
  private lastActivity = Date.now();
  private lastScrollIntent = 0;
  private composing = false;
  private ownMutationDepth = 0;
  private task: Task | null = null;
  private interval: ReturnType<typeof setInterval>;

  constructor(private callbacks: Callbacks) {
    for (const type of ['pointerdown', 'click', 'keydown', 'beforeinput', 'input', 'paste', 'touchstart', 'touchmove', 'wheel', 'compositionstart', 'compositionend']) {
      window.addEventListener(type, this.activity, true);
    }
    window.addEventListener('scroll', this.scrolled, true);
    window.addEventListener('message', this.message);
    this.interval = setInterval(() => this.report(), 250);
    window.addEventListener('pagehide', () => {
      this.cancel('页面已关闭'); clearInterval(this.interval);
      for (const type of ['pointerdown', 'click', 'keydown', 'beforeinput', 'input', 'paste', 'touchstart', 'touchmove', 'wheel', 'compositionstart', 'compositionend']) window.removeEventListener(type, this.activity, true);
      window.removeEventListener('scroll', this.scrolled, true); window.removeEventListener('message', this.message);
    }, { once: true });
  }

  // execCommand/paste/navigation can produce browser-generated events. Exclude
  // only the synchronous operation, never an entire asynchronous wait.
  mutate<T>(callback: () => T): T {
    this.ownMutationDepth++;
    try { return callback(); } finally { this.ownMutationDepth--; }
  }
  sync(control: Control): void {
    this.control = control;
    if (this.task && (!control.enabled || control.epoch !== this.task.epoch || control.token !== this.task.request.queueToken)) this.cancel('自动回复已暂停或配置已变化');
    this.report();
  }
  cancel(reason: string): void {
    if (!this.task || this.task.clicked) return;
    this.task.cancelled = reason;
    if (this.task.inserted) clearNativeBusinessSend(this.task.request.chatId, this.task.request.messageId);
  }
  cancelAction(id: string): void { if (this.task?.request.id === id) this.cancel('自动回复操作超时，请检查草稿'); }
  chatChanged(chatId: string | null): void {
    const task = this.task;
    if (task && !task.clicked && !task.navigating && chatId !== task.request.chatId) task.cancelled = '你已切换聊天，本条转为人工草稿';
  }
  private activity = (event: Event): void => {
    if (!event.isTrusted || this.ownMutationDepth) return;
    const task = this.task;
    const target = event.composedPath().find((node): node is Element => node instanceof Element);
    // Some native editors emit input after execCommand has returned. An exact,
    // unchanged owned draft is still our insertion. Real edits have preceding
    // key/beforeinput/paste activity, or fail this content/attachment check.
    if (event.type === 'input' && task?.inserted && !task.cancelled && target && this.callbacks.isDraftInput(target, task.request)) {
      if (task.writing || task.clicked) return;
      try { this.callbacks.validateDraft(task.request); return; } catch { /* A genuine content change below transfers to manual review. */ }
    }
    this.lastActivity = Date.now();
    if (['wheel', 'touchmove', 'pointerdown', 'keydown'].includes(event.type)) this.lastScrollIntent = Date.now();
    if (event.type === 'compositionstart') this.composing = true;
    if (event.type === 'compositionend') this.composing = false;
    if (task && !task.clicked) {
      if (task.navigating && target?.closest('#side')) this.cancel('你正在操作聊天列表，已停止自动切换');
      if (task.inserted && (target?.closest('[contenteditable="true"], wa-business-draft-editor')
        || event.type === 'click' && !target?.closest('#side, #main footer, #main header'))) {
        this.cancel('你已操作原生草稿，本条转为人工确认');
      }
    }
    this.report();
  };
  private scrolled = (event: Event): void => {
    // Native navigation scrolls the transcript itself. Wheel/touch/keyboard
    // events above cover user scrolls during that operation.
    if (event.isTrusted && !this.ownMutationDepth && Date.now() - this.lastScrollIntent < 750) {
      this.lastActivity = Date.now(); this.lastScrollIntent = Date.now(); this.report();
    }
  };
  private message = (event: MessageEvent): void => {
    const data = event.data; const task = this.task;
    if (event.source !== window || data?.__waBusiness !== true || !task || data.messageId !== task.request.messageId
      || normalizeChatId(data.chatId ?? '') !== normalizeChatId(task.request.chatId)) return;
    if (data.kind === 'NATIVE_SEND_CONFIRMED' && isBusinessDraftFinished(task.request.chatId, task.request.messageId)) task.complete?.();
    else if (data.kind === 'DRAFT_SEND_FAILED') task.complete?.(new NativeReplyError(data.error || '发送状态不确定，请检查聊天记录'));
  };
  private pauseReason(owned?: NativeAutoRequest): string {
    if (this.composing) return '正在使用输入法，请完成输入';
    if (this.control.editorBusy) return '草稿编辑尚未结束';
    const busy = this.callbacks.busy(owned);
    if (busy) return busy;
    const remaining = AUTO_IDLE_MS - (Date.now() - this.lastActivity);
    return remaining > 0 ? `等待空闲 ${Math.ceil(remaining / 1000)} 秒后继续` : '';
  }
  private report(): void {
    const task = this.task;
    const reason = !this.control.enabled ? '自动回复已关闭，开启后才会继续'
      : task?.cancelled || (task?.clicked ? '' : this.pauseReason(task?.inserted ? task.request : undefined));
    this.callbacks.state({ phase: !this.control.enabled ? 'paused' : reason ? 'paused'
      : task?.clicked ? 'sending' : task?.navigating ? 'switching' : task?.inserted ? 'composing' : 'idle',
    reason, customer: task ? this.callbacks.customer(task.request.chatId) : '' });
  }
  private valid(task: Task): boolean {
    return !task.cancelled && this.control.enabled && this.control.epoch === task.epoch
      && this.control.token === task.request.queueToken && this.control.expiresAt > Date.now();
  }
  private guard(task: Task, requireChat = true): void {
    if (!this.valid(task)) throw new NativeReplyError(task.cancelled || '自动队列所属页面已变化，已停止发送', !task.inserted);
    if (requireChat) {
      const domChat = getActiveChatIdFromDom();
      if (getActiveChatId() !== task.request.chatId || domChat && domChat !== task.request.chatId) throw new NativeReplyError('聊天已切换，本条转为人工草稿', !task.inserted);
    }
  }
  private async idle(task: Task, owned = false): Promise<void> {
    while (true) {
      this.guard(task, owned);
      if (owned) this.callbacks.validateDraft(task.request);
      const reason = this.pauseReason(owned ? task.request : undefined);
      if (!reason) return;
      this.report(); await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  private async waitForSendButton(task: Task): Promise<HTMLElement> {
    const deadline = Date.now() + 5000;
    while (true) {
      await this.idle(task, true);
      this.guard(task); this.callbacks.validateDraft(task.request);
      const button = this.callbacks.sendButton(task.request);
      if (button) return button;
      if (Date.now() >= deadline) throw new NativeReplyError('原生发送按钮未准备就绪，请检查输入框并手动发送');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async send(request: NativeAutoRequest): Promise<void> {
    if (this.task) throw new NativeReplyError('原生界面正在处理另一条回复', true);
    const task: Task = { request, epoch: this.control.epoch, inserted: false, writing: false, clicked: false, navigating: false, cancelled: '' };
    this.task = task;
    try {
      await this.idle(task);
      this.guard(task, false);
      if (getActiveChatId() !== request.chatId) {
        task.navigating = true; this.report();
        // Resolve by stable chat identity. A display name is never a recipient.
        const opening = this.mutate(() => openNativeChat(request.chatId));
        const end = Date.now() + 10_000;
        let openError: unknown;
        void opening.catch((error) => { openError = error; });
        while (getActiveChatId() !== request.chatId || getActiveChatIdFromDom() && getActiveChatIdFromDom() !== request.chatId) {
          this.guard(task, false);
          if (openError) throw openError;
          if (Date.now() > end) throw new NativeReplyError('打开客户聊天超时，请手动打开后处理草稿');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        task.navigating = false;
      }
      this.guard(task);
      await this.idle(task);
      this.guard(task);
      // The hook consumes the cached Spanish output only after native Send,
      // retaining the exact Chinese text as the local original.
      registerNativeBusinessSend(request.chatId, request.messageId, request.text, request.preparedReply, Boolean(request.images.length), () => this.valid(task));
      task.inserted = true; this.report();
      task.writing = true;
      try { await this.callbacks.insert(request, () => this.guard(task)); }
      finally { task.writing = false; }
      await this.idle(task, true);
      this.guard(task); this.callbacks.validateDraft(request);
      // Filling the editor triggers a React update: Send may replace the mic
      // button on the next frame. Wait for that control, then send immediately.
      await this.waitForSendButton(task);
      if (!await this.callbacks.authorize(request, false)) throw new NativeReplyError('自动回复已暂停或配置已变化，本条请人工确认');
      while (true) {
        await this.idle(task, true);
        if (!await this.callbacks.authorize(request, true)) throw new NativeReplyError('发送前核验未通过，本条请人工确认');
        if (!this.pauseReason(request)) break;
      }
      this.guard(task); this.callbacks.validateDraft(request);
      const button = this.callbacks.sendButton(request);
      if (!button) throw new NativeReplyError('未找到本条回复的原生发送按钮，请手动发送');
      armNativeBusinessSend(request.chatId, request.messageId);
      const completion = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { task.complete = undefined; reject(new NativeReplyError('发送状态不确定，请先检查聊天记录，勿重复发送')); }, 45_000);
        task.complete = (error) => { clearTimeout(timer); task.complete = undefined; error ? reject(error) : resolve(); };
      });
      task.clicked = true; this.report();
      // Exactly one native click; never fall back to a programmatic send API.
      try { this.mutate(() => button.click()); }
      catch (error) { task.complete?.(error instanceof Error ? error : new NativeReplyError('原生发送失败')); }
      await completion;
    } catch (error) {
      if (task.clicked && !isBusinessDraftFinished(request.chatId, request.messageId)) notifyBusinessDraftSendFailed(request.chatId, request.messageId,
        error instanceof Error ? error.message : '发送状态不确定，请检查聊天记录');
      throw error;
    } finally {
      clearNativeBusinessSend(request.chatId, request.messageId);
      this.task = null; this.report();
    }
  }
}
