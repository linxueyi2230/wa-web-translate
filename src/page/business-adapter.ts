import { getActiveChatId, getActiveChatIdFromDom, nativeChatNavigationAvailable, tryRequire } from './wa';
import { chatKey, messageKey, modelField } from '@/shared/whatsapp-keys';
import { comparableText, normalizeChatId, parseMessageId } from '@/shared/message-history';
import { messageRows, readBubble } from '@/shared/message-dom';
import { registerBusinessDraft, registerBusinessMediaDraft, clearBusinessMediaDraft, clearBusinessDraft, notifyBusinessMessageSent, notifyBusinessDraftSendStarted, isBusinessDraftSending, isBusinessDraftFinished, isBusinessDraft, businessDraftMessageId, isNativeBusinessSend } from './business-drafts';
import { installBusinessMediaSendHook } from './hooks/media-send';
import type { BusinessDraftSnapshot, IncomingBusinessMessage } from '@/shared/business-replies';
import type { ProductImage, ReplyLanguage } from '@/shared/types';
import { DEFAULT_WHATSAPP_IMAGE_LIMIT_BYTES, formatImageLimit, validImageLimit } from '@/shared/product-config';
import { NativeAutoReply } from './native-auto-reply';
import { isTextSendHookReady } from './hooks/send';
import type { NativeAutoRequest } from '@/shared/business-auto';

export const BUSINESS_TAG = '__waBusiness';

interface Collection {
  on?: (event: string, callback: (...args: any[]) => void) => void;
  getModelsArray?: () => any[];
  models?: any[];
}
interface ManualDraft { messageId?: string; text: string; registeredAt: number; before: Set<string> }
interface RestoredDraft { messageId: string; chatId: string; text: string; receivedAt: number; draftLanguage?: ReplyLanguage }
interface DraftComposer { chatId: string; element: HTMLElement; messageId?: string }
interface MediaPreview extends DraftComposer { existingEditors: Set<HTMLElement>; imageIds: string[] }

export function installBusinessAdapter(): void {
  const page = window as Window & { __waBusinessAdapterInstalled?: boolean };
  if (page.__waBusinessAdapterInstalled) return;
  page.__waBusinessAdapterInstalled = true;
  const startedAt = Date.now();
  const seen = new Set<string>();
  const freshMessages = new Set<string>();
  const bound = new WeakSet<object>();
  const manualDrafts = new Map<string, ManualDraft>();
  const outgoingObserved = new Map<string, number>();
  const restoredDrafts = new Map<string, RestoredDraft>();
  const actions = new Map<string, Promise<BusinessDraftSnapshot | void>>();
  const insertingChats = new Set<string>();
  const synchronizingChats = new Set<string>();
  let initializing = true;
  let activeChat: string | null = null;
  let eventCollectionReady = false;
  let preparedComposer: DraftComposer | null = null;
  let mediaPreview: MediaPreview | null = null;
  let nativeAuto: NativeAutoReply | undefined;
  const mutate = <T>(callback: () => T): T => nativeAuto ? nativeAuto.mutate(callback) : callback();
  const authorizations = new Map<string, (allowed: boolean) => void>();
  const emit = (kind: string, payload: Record<string, unknown> = {}) => window.postMessage({ [BUSINESS_TAG]: true, kind, ...payload }, '*');
  const verifySend = (actionId: string, messageId: string, queueToken: string, finalCheck: boolean): Promise<boolean> => new Promise((resolve) => {
    const timer = window.setTimeout(() => { authorizations.delete(actionId); resolve(false); }, 4000);
    authorizations.set(actionId, (allowed) => { clearTimeout(timer); resolve(allowed); });
    emit('VERIFY_SEND', { id: actionId, messageId, queueToken, finalCheck });
  });

  const reportMediaPreview = () => {
    if (!mediaPreview?.messageId) return;
    if (isBusinessDraftSending(mediaPreview.chatId, mediaPreview.messageId) || isBusinessDraftFinished(mediaPreview.chatId, mediaPreview.messageId)) return;
    const root = mediaPreviewControls(mediaPreview.element)?.root ?? document.querySelector('#main');
    const rect = root?.getBoundingClientRect();
    emit('DRAFT_PREVIEW', { chatId: mediaPreview.chatId, messageId: mediaPreview.messageId, open: true, imageIds: mediaPreview.imageIds,
      bounds: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined });
  };
  const setMediaPreview = (next: typeof mediaPreview) => {
    if (mediaPreview?.messageId && (!next || next.messageId !== mediaPreview.messageId)) {
      // The native sender can close the preview before preparing/sending its
      // media. Keep ownership until confirmed sent or explicitly cancelled.
      emit('DRAFT_PREVIEW', { chatId: mediaPreview.chatId, messageId: mediaPreview.messageId, open: false });
    }
    mediaPreview = next;
    reportMediaPreview();
  };
  const reportInsertedDraft = () => {
    if (!preparedComposer?.messageId) return;
    if (isBusinessDraftSending(preparedComposer.chatId, preparedComposer.messageId) || isBusinessDraftFinished(preparedComposer.chatId, preparedComposer.messageId)) return;
    const text = composerText(preparedComposer.element);
    if (text.trim()) emit('DRAFT_INSERTED', { chatId: preparedComposer.chatId, messageId: preparedComposer.messageId, text });
  };
  const registerManualDraft = (chatId: string, text: string, messageId?: string, language?: ReplyLanguage) => {
    if (messageId && (isBusinessDraftSending(chatId, messageId) || isBusinessDraftFinished(chatId, messageId))) return;
    const chat = normalizeChatId(chatId);
    const current = manualDrafts.get(chat);
    if (!current || current.messageId !== messageId) {
      const before = new Set(chatMessages(chat).map((model) => messageKey(modelField(model, 'id'))).filter((id): id is string => Boolean(id)));
      for (const row of messageRows()) { const bubble = readBubble(row); if (bubble?.outgoing && bubble.chatId === chat) before.add(bubble.id); }
      manualDrafts.set(chat, { messageId, text, registeredAt: Date.now(), before });
    } else current.text = text;
    registerBusinessDraft(chat, text, messageId, language);
  };
  const assertDraftEditable = (chatId: string, messageId: string) => {
    if (isBusinessDraftSending(chatId)) throw new Error('草稿正在发送，停止编辑和插入');
    if (isBusinessDraftFinished(chatId, messageId)) throw new Error('本条草稿已发送，停止编辑和插入');
  };
  const draftTarget = (chatId: string, messageId: string): HTMLElement => {
    assertActiveChat(chatId);
    assertDraftEditable(chatId, messageId);
    if (manualDrafts.get(normalizeChatId(chatId))?.messageId !== messageId) throw new Error('本条草稿已发送或关闭，请重新打开待处理草稿');
    if (mediaPreview?.chatId === chatId && mediaPreview.messageId === messageId) {
      const caption = findMediaCaption(mediaPreview.existingEditors);
      if (caption) { mediaPreview.element = caption; preparedComposer = { chatId, messageId, element: caption }; return caption; }
      throw new Error('原生图片预览已关闭，请先恢复草稿');
    }
    if (preparedComposer?.chatId === chatId && preparedComposer.messageId === messageId && preparedComposer.element.isConnected) return preparedComposer.element;
    const composer = nativeComposer();
    if (composer && businessDraftMessageId(chatId, composerText(composer)) === messageId) return composer;
    throw new Error('未找到本条草稿的原生编辑框');
  };
  const draftSnapshot = (chatId: string, messageId: string): BusinessDraftSnapshot => {
    const element = draftTarget(chatId, messageId);
    const text = composerText(element).trim() ? composerText(element) : manualDrafts.get(normalizeChatId(chatId))!.text;
    const preview = mediaPreview?.messageId === messageId ? mediaPreview : null;
    const root = preview ? mediaPreviewControls(preview.element)?.root ?? document.querySelector('#main') : document.querySelector('#main');
    const rect = root?.getBoundingClientRect();
    return { text, imageIds: preview?.imageIds ?? [], mediaOpen: Boolean(preview), bounds: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined };
  };
  const openMediaDraft = async (chatId: string, messageId: string, text: string, images: ProductImage[], files: File[], language: ReplyLanguage, validate: () => void = () => {}) => {
    validate();
    assertActiveChat(chatId);
    assertDraftEditable(chatId, messageId);
    const composer = nativeComposer();
    if (!composer || composerText(composer).trim()) throw new Error('输入框已有内容，未覆盖；请先清空后恢复图片草稿');
    const mediaHookReady = installBusinessMediaSendHook();
    if (language === 'zh-CN' && !mediaHookReady) throw new Error('当前 WhatsApp 图片说明翻译接口不可用，请先使用中文文字草稿，发送后再手动附图');
    // Media preparation can run synchronously inside the paste handler. Register
    // its source language and owner before dispatching the complete file batch.
    registerManualDraft(chatId, text, messageId, language);
    registerBusinessMediaDraft(chatId, messageId);
    const existingEditors = new Set(Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"][role="textbox"]')).filter((element) => element.getBoundingClientRect().width > 0));
    const transfer = new DataTransfer(); files.forEach((file) => transfer.items.add(file));
    try {
      mutate(() => composer.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })));
      const caption = await waitForCaption(existingEditors, chatId, validate);
      validate();
      assertDraftEditable(chatId, messageId);
      preparedComposer = { chatId, messageId, element: caption };
      setMediaPreview({ ...preparedComposer, existingEditors, imageIds: images.map((image) => image.id) });
      await setComposerText(caption, text, validate, mutate);
    } catch (error) { if (!isBusinessDraftSending(chatId, messageId)) clearBusinessMediaDraft(chatId); throw error; }
  };
  const placeDraft = async (data: { chatId: string; messageId: string; text: string; images?: ProductImage[]; draftLanguage?: ReplyLanguage; replaceText?: string }, validate: () => void = () => {}) => {
    validate(); assertActiveChat(data.chatId);
    if (preparedComposer && preparedComposer.chatId === data.chatId && preparedComposer.element.isConnected
      && preparedComposer.element.getBoundingClientRect().width > 0 && composerText(preparedComposer.element).trim()) {
      if (preparedComposer.messageId === data.messageId) { reportInsertedDraft(); return; }
      throw new Error('请先发送或清空当前草稿，再插入下一条草稿');
    }
    if (insertingChats.has(data.chatId)) throw new Error('正在放入草稿，请稍候');
    if (mediaPreview && mediaPreview.chatId === data.chatId && mediaPreview.element.isConnected && mediaPreview.element.getBoundingClientRect().width > 0) throw new Error('请先发送或关闭当前图片预览，再插入下一条草稿');
    const composer = nativeComposer();
    if (!composer) throw new Error('未找到 WhatsApp 输入框，请打开客户聊天');
    const current = composerText(composer);
    if (current.trim() && current !== data.replaceText) throw new Error('输入框已有内容，未覆盖');
    insertingChats.add(data.chatId);
    try {
      validate();
      if (data.images?.length) {
        if (data.images.length > 6) throw new Error('商品草稿最多附加 6 张图片');
        const files = data.images.map(imageFile);
        if (current.trim()) await clearComposerText(composer, validate, mutate);
        await openMediaDraft(data.chatId, data.messageId, data.text, data.images, files, data.draftLanguage === 'zh-CN' ? 'zh-CN' : 'es-MX', validate);
      } else {
        preparedComposer = { chatId: data.chatId, element: composer, messageId: data.messageId };
        registerManualDraft(data.chatId, data.text, data.messageId, data.draftLanguage === 'zh-CN' ? 'zh-CN' : 'es-MX');
        await setComposerText(composer, data.text, validate, mutate);
      }
      validate(); assertDraftEditable(data.chatId, data.messageId);
      if (!preparedComposer) throw new Error('原生草稿已关闭，停止插入');
      const insertedText = composerText(preparedComposer.element);
      registerManualDraft(data.chatId, insertedText, data.messageId);
      reportInsertedDraft();
      if (insertedText.trim() && insertedText !== data.text) emit('DRAFT_EDITED', { messageId: data.messageId, chatId: data.chatId, text: insertedText });
    } finally { insertingChats.delete(data.chatId); }
  };
  nativeAuto = new NativeAutoReply({
    busy: (owned) => {
      const composer = nativeComposer();
      const chatId = getActiveChatId();
      if (chatId && isBusinessDraftSending(chatId)) return '上一条消息正在发送，请稍候';
      const ownsText = owned && preparedComposer?.messageId === owned.messageId && preparedComposer.chatId === owned.chatId;
      if (composer && composerText(composer).trim() && !ownsText) return '输入框有未发送内容，请先发送或清空';
      const ownsMedia = owned && mediaPreview?.messageId === owned.messageId && mediaPreview.chatId === owned.chatId;
      if (mediaPreview?.element.isConnected && mediaPreview.element.getBoundingClientRect().width && !ownsMedia) return '图片预览尚未结束，请先发送或关闭';
      const editors = Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"][role="textbox"]'))
        .filter((element) => element.getBoundingClientRect().width > 0 && !element.closest('#main footer, #side, header, [data-wa-business]'));
      if (editors.some((element) => element !== (ownsMedia ? mediaPreview?.element : undefined))) return '图片或其他编辑页面尚未结束';
      if (!document.querySelector('#side') && !composer) return '请打开并登录 WhatsApp 网页';
      return '';
    },
    insert: async (request, validate) => {
      if (!isTextSendHookReady()) throw new Error('原生发送监听未准备就绪，请手动处理草稿');
      if (request.images.length > 1) throw new Error('自动回复只允许发送商品封面图');
      if (request.images.length && !installBusinessMediaSendHook()) throw new Error('原生图片发送监听不可用，请手动处理草稿');
      await placeDraft(request, validate);
    },
    validateDraft: (request) => {
      const snapshot = draftSnapshot(request.chatId, request.messageId);
      const actualText = composerText(draftTarget(request.chatId, request.messageId));
      if (comparableText(actualText) !== comparableText(request.text)
        || snapshot.mediaOpen !== Boolean(request.images.length)
        || snapshot.imageIds.join(',') !== request.images.map((image) => image.id).join(',')) throw new Error('原生草稿或附件已变化，本条转为人工确认');
    },
    isDraftInput: (target, request) => {
      if (getActiveChatId() !== request.chatId) return false;
      const editor = mediaPreview?.messageId === request.messageId ? mediaPreview.element
        : preparedComposer?.messageId === request.messageId ? preparedComposer.element : nativeComposer();
      return Boolean(editor && (target === editor || editor.contains(target)));
    },
    sendButton: (request) => {
      const caption = mediaPreview?.messageId === request.messageId ? mediaPreview.element : null;
      const footer = document.querySelector('#main footer');
      const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]')).filter(nativeSendButton)
        .filter((button) => caption ? withinMediaPreview(button, caption) : Boolean(footer?.contains(button)));
      // WA can nest its action button inside an equally-labelled wrapper. They
      // are one action, not two send targets; choose its innermost control.
      const actions = buttons.filter((button) => !buttons.some((other) => other !== button && button.contains(other)));
      return actions.length === 1 ? actions[0] : null;
    },
    authorize: (request, finalCheck) => verifySend(request.id, request.messageId, request.queueToken, finalCheck),
    customer: (chatId) => {
      const chat = findChat(chatId);
      const name = modelField(chat, 'formattedTitle') ?? modelField(chat?.contact, 'name') ?? modelField(chat?.contact, 'formattedName');
      return typeof name === 'string' && name.trim() ? name.slice(0, 80) : getActiveChatId() === chatId ? document.querySelector('#main header [title]')?.getAttribute('title')?.slice(0, 80) ?? '当前客户' : '待回复客户';
    },
    state: (status) => emit('NATIVE_AUTO_STATE', status),
  });
  const observeManualSend = (model: any) => {
    const id = messageKey(modelField(model, 'id'));
    const key = id ? parseMessageId(id) : null;
    if (!id || !key?.fromMe || seen.has(id)) return;
    const firstObserved = outgoingObserved.get(id) ?? Date.now();
    outgoingObserved.set(id, firstObserved);
    const draft = manualDrafts.get(key.chatId);
    if (draft?.messageId && isNativeBusinessSend(key.chatId, draft.messageId)) return; // Native automatic tasks await the actual sender result.
    const timestamp = modelField(model, 't');
    const ack = modelField(model, 'ack');
    if (!draft?.messageId || draft.before.has(id) || firstObserved < draft.registeredAt
      || typeof timestamp !== 'number' || timestamp * 1000 < draft.registeredAt - 1000
      || typeof ack === 'number' && ack < 0) return;
    // Media models can arrive before their caption is assigned. Some builds put
    // that caption in body instead; use the keyed rendered caption as a fallback.
    const texts = [modelField(model, 'caption'), modelField(model, 'body')];
    if (!texts.some((text) => typeof text === 'string' && sameDraftText(text, draft.text))) {
      const bubble = messageRows().map(readBubble).find((item) => item?.id === id);
      if (!bubble?.outgoing || !sameDraftText(bubble.text, draft.text)) return;
    }
    seen.add(id);
    manualDrafts.delete(key.chatId);
    notifyBusinessMessageSent(key.chatId, draft.messageId);
  };
  const reconcileRestoredDrafts = () => {
    for (const draft of restoredDrafts.values()) {
      const messages = chatMessages(draft.chatId);
      const source = messages.find((model) => messageKey(modelField(model, 'id')) === draft.messageId);
      if (!source) continue; // Do not infer a send from an unrelated old caption.
      const sourceTime = modelField(source, 't');
      if (typeof sourceTime !== 'number') continue;
      const sent = messages.find((model) => {
        const id = messageKey(modelField(model, 'id'));
        const key = id ? parseMessageId(id) : null;
        const time = modelField(model, 't'), ack = modelField(model, 'ack');
        return key?.fromMe && key.chatId === draft.chatId && typeof time === 'number'
          && time > sourceTime && time * 1000 <= startedAt && !(typeof ack === 'number' && ack < 0)
          && [modelField(model, 'caption'), modelField(model, 'body')].some((text) => typeof text === 'string' && sameDraftText(text, draft.text));
      });
      if (sent) {
        restoredDrafts.delete(draft.messageId);
        notifyBusinessMessageSent(draft.chatId, draft.messageId);
      }
    }
  };

  const incoming = (model: any) => {
    const id = messageKey(modelField(model, 'id'));
    const key = id ? parseMessageId(id) : null;
    if (!id || !key || seen.has(id)) return;
    if (key.fromMe) {
      observeManualSend(model);
      return;
    }
    if (!/^(?:c\.us|s\.whatsapp\.net|lid)$/.test(key.chatId.split('@')[1] ?? '')) return;
    const body = messageText(model);
    const timestamp = modelField(model, 't');
    // Model add events also occur for history loads; only newly received models qualify.
    if (modelField(model, 'isNewMsg') === true || modelField(model, 'recvFresh') === true) freshMessages.add(id);
    const fresh = freshMessages.has(id);
    if (!fresh || typeof timestamp !== 'number' || timestamp * 1000 < startedAt - 2000 || typeof body !== 'string' || !body.trim()) return;
    seen.add(id);
    freshMessages.delete(id);
    const message: IncomingBusinessMessage = { id, chatId: key.chatId, text: body, receivedAt: Date.now() };
    emit('INCOMING', { message });
  };

  const attach = (collection: Collection | undefined) => {
    if (!collection || typeof collection.on !== 'function' || bound.has(collection)) return;
    bound.add(collection);
    for (const model of models(collection)) {
      const id = messageKey(modelField(model, 'id'));
      if (id && initializing) seen.add(id); // Never trigger existing history on installation.
      else incoming(model); // Later chat collections can already contain fresh queued messages.
    }
    for (const event of ['add', 'change:id', 'change:t', 'change:body', 'change:caption', 'change:isNewMsg', 'change:recvFresh', 'change:ack']) collection.on(event, incoming);
    eventCollectionReady = true;
  };

  const tick = () => {
    try {
      installBusinessMediaSendHook();
      const chatCollection = tryRequire('WAWebChatCollection')?.ChatCollection;
      attach(tryRequire('WAWebMsgCollection')?.MsgCollection);
      for (const chat of models(chatCollection)) attach(chat?.msgs);
      reconcileRestoredDrafts();
      for (const chatId of manualDrafts.keys()) for (const model of chatMessages(chatId)) observeManualSend(model);
      if (mediaPreview && !synchronizingChats.has(mediaPreview.chatId) && (!mediaPreview.element.isConnected || mediaPreview.element.getBoundingClientRect().width === 0)) {
        // Switching photos can replace the caption editor without closing the
        // native album preview. Keep the plugin panel hidden throughout it.
        const caption = getActiveChatId() === mediaPreview.chatId ? findMediaCaption(mediaPreview.existingEditors) : null;
        if (caption) {
          mediaPreview.element = caption;
          if (manualDrafts.get(mediaPreview.chatId)?.messageId === mediaPreview.messageId) {
            preparedComposer = { chatId: mediaPreview.chatId, element: caption, messageId: mediaPreview.messageId };
          }
        } else setMediaPreview(null);
      }
      if (mediaPreview && !synchronizingChats.has(mediaPreview.chatId)) reportMediaPreview();
      const next = getActiveChatId();
      if (next !== activeChat) {
        nativeAuto?.chatChanged(next);
        preparedComposer = null;
        activeChat = next;
        const composer = nativeComposer();
        if (next && composer && isBusinessDraft(next, composerText(composer))) preparedComposer = { chatId: next, element: composer, messageId: businessDraftMessageId(next, composerText(composer)) };
        emit('ACTIVE_CHAT', { chatId: next });
        reportInsertedDraft();
      }
      emit('CAPABILITIES', { incomingReady: eventCollectionReady, mediaReady: Boolean(mediaModules()), nativeNavigationReady: nativeChatNavigationAvailable(), imageLimitBytes: currentWhatsAppImageLimit() });
    } catch { emit('CAPABILITIES', { incomingReady: false, mediaReady: false }); }
  };
  tick();
  initializing = false;
  const interval = window.setInterval(tick, 1000);
  window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
  const cancelMediaOwnership = (event: Event) => {
    if (!mediaPreview || synchronizingChats.has(mediaPreview.chatId)) return;
    const controls = mediaPreviewControls(mediaPreview.element);
    const target = event.target instanceof Element ? event.target : null;
    if (!controls || !target) return;
    const closed = event.type === 'click' && target.closest('button, [role="button"]') === controls.close;
    const escaped = event instanceof KeyboardEvent && event.key === 'Escape' && controls.root.contains(target);
    if (closed || escaped) clearBusinessMediaDraft(mediaPreview.chatId);
  };
  window.addEventListener('click', cancelMediaOwnership, true);
  window.addEventListener('keydown', cancelMediaOwnership, true);
  window.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLElement>('button, [role="button"]');
    if (!button || !nativeSendButton(button)) return;
    const owner = mediaPreview ?? preparedComposer;
    if (!owner?.messageId || getActiveChatId() !== owner.chatId || synchronizingChats.has(owner.chatId)) return;
    const footer = document.querySelector('#main footer');
    const inComposer = !mediaPreview && footer?.contains(owner.element) && footer.contains(button);
    const inPreview = mediaPreview && withinMediaPreview(button, mediaPreview.element);
    if (!inComposer && !inPreview) return;
    if (manualDrafts.get(normalizeChatId(owner.chatId))?.messageId !== owner.messageId) return;
    const text = composerText(owner.element);
    // Capture the confirmed native text before WhatsApp clears its editor. The
    // sender hook remains responsible for translation and send success/failure.
    if (text.trim()) registerManualDraft(owner.chatId, text, owner.messageId);
    notifyBusinessDraftSendStarted(owner.chatId, owner.messageId, text.trim() ? text : undefined);
  }, true);
  document.addEventListener('input', (event) => {
    if (!preparedComposer || (event.target !== preparedComposer.element && !preparedComposer.element.contains(event.target as Node))) return;
    if (insertingChats.has(preparedComposer.chatId) || synchronizingChats.has(preparedComposer.chatId) || isBusinessDraftSending(preparedComposer.chatId)
      || preparedComposer.messageId && isBusinessDraftFinished(preparedComposer.chatId, preparedComposer.messageId)) return;
    const text = composerText(preparedComposer.element);
    const messageId = preparedComposer.messageId;
    // A native send can clear its caption before the outgoing model is added.
    // Keep the exact-text marker until that model/send hook confirms the send.
    if (!text.trim()) {
      // An uncaptioned photo in the same album is still part of the draft.
      if (!mediaPreview || mediaPreview.messageId !== messageId) {
        if (messageId) emit('DRAFT_CLEARED', { chatId: preparedComposer.chatId, messageId });
        preparedComposer = null;
      }
    }
    else {
      registerManualDraft(preparedComposer.chatId, text, messageId);
      if (messageId) emit('DRAFT_EDITED', { messageId, chatId: preparedComposer.chatId, text });
    }
  });

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.[BUSINESS_TAG] !== true) return;
    if (data.kind === 'SEND_AUTHORIZED') {
      const resolve = authorizations.get(data.id);
      authorizations.delete(data.id);
      resolve?.(data.allowed === true);
      return;
    }
    if (data.kind === 'AUTO_CONTROL') { nativeAuto?.sync(data.control); return; }
    if (data.kind === 'CANCEL_AUTO_ACTION') { nativeAuto?.cancelAction(data.id); return; }
    if (data.kind === 'REQUEST_STATE') {
      for (const draft of Array.isArray(data.drafts) ? data.drafts : []) {
        const key = typeof draft.messageId === 'string' ? parseMessageId(draft.messageId) : null;
        if (key && !key.fromMe && key.chatId === draft.chatId && typeof draft.text === 'string' && draft.text.trim()
          && typeof draft.receivedAt === 'number' && !isBusinessDraftFinished(draft.chatId, draft.messageId)) restoredDrafts.set(draft.messageId, draft);
      }
      const composer = nativeComposer();
      const chatId = getActiveChatId();
      if (composer && chatId && !preparedComposer) {
        const candidates = [...restoredDrafts.values()].filter((draft) => draft.chatId === chatId && comparableText(draft.text) === comparableText(composerText(composer)));
        if (candidates.length === 1) {
          const draft = candidates[0];
          registerManualDraft(chatId, composerText(composer), draft.messageId, draft.draftLanguage === 'zh-CN' ? 'zh-CN' : 'es-MX');
          preparedComposer = { chatId, messageId: draft.messageId, element: composer };
        }
      }
      tick(); emit('ACTIVE_CHAT', { chatId: activeChat }); reportInsertedDraft(); emit('STATE_READY'); return;
    }
    if (data.kind === 'DRAFT_SENT' && typeof data.messageId === 'string' && typeof data.chatId === 'string') {
      const chat = normalizeChatId(data.chatId);
      if (manualDrafts.get(chat)?.messageId === data.messageId) manualDrafts.delete(chat);
      restoredDrafts.delete(data.messageId);
      if (preparedComposer?.messageId === data.messageId) preparedComposer = null;
      // WA can add the outgoing model just before React closes the preview.
      // Keep guarding that preview until it really disappears.
      if (mediaPreview && mediaPreview.messageId === data.messageId && (!mediaPreview.element.isConnected || mediaPreview.element.getBoundingClientRect().width === 0)) setMediaPreview(null);
      return;
    }
    if (data.kind === 'CLEAR_DRAFT' && typeof data.chatId === 'string') {
      const chat = normalizeChatId(data.chatId);
      // Completion of an older draft must not clear a newer draft in this chat.
      if (!data.messageId || manualDrafts.get(chat)?.messageId === data.messageId) { clearBusinessDraft(chat); manualDrafts.delete(chat); }
      if (preparedComposer?.chatId === chat && (!data.messageId || preparedComposer.messageId === data.messageId)) preparedComposer = null;
      return;
    }
    if (data.kind === 'REGISTER_DRAFT' && typeof data.chatId === 'string' && typeof data.text === 'string') {
      if (isBusinessDraftSending(data.chatId) || typeof data.messageId === 'string' && isBusinessDraftFinished(data.chatId, data.messageId)) return;
      const composer = nativeComposer();
      if (composer && getActiveChatId() === data.chatId && composerText(composer) === data.text) {
        const existing = manualDrafts.get(normalizeChatId(data.chatId));
        if (existing?.messageId && existing.messageId !== data.messageId) return;
        registerManualDraft(data.chatId, data.text, data.messageId, data.draftLanguage === 'zh-CN' ? 'zh-CN' : 'es-MX');
        preparedComposer = { chatId: data.chatId, element: composer, messageId: data.messageId };
        reportInsertedDraft();
      }
      return;
    }
    if (!['INSERT_DRAFT', 'SEND_REPLY', 'READ_DRAFT', 'UPDATE_DRAFT_TEXT', 'UPDATE_DRAFT_IMAGES'].includes(data.kind)) return;
    if (typeof data.id !== 'string' || typeof data.chatId !== 'string' || typeof data.text !== 'string' || !data.text.trim()) return;
    const action = async (): Promise<BusinessDraftSnapshot | void> => {
      if (data.kind !== 'SEND_REPLY') assertDraftEditable(data.chatId, data.messageId);
      if (data.kind === 'READ_DRAFT') return draftSnapshot(data.chatId, data.messageId);
      if (data.kind === 'UPDATE_DRAFT_TEXT' || data.kind === 'UPDATE_DRAFT_IMAGES') {
        assertActiveChat(data.chatId);
        const emptyComposer = nativeComposer();
        const target = data.kind === 'UPDATE_DRAFT_IMAGES' && !mediaPreview && emptyComposer && !composerText(emptyComposer).trim()
          && manualDrafts.get(normalizeChatId(data.chatId))?.messageId === data.messageId ? emptyComposer : draftTarget(data.chatId, data.messageId);
        if (insertingChats.has(data.chatId)) throw new Error('正在同步草稿，请稍候');
        const previous = manualDrafts.get(normalizeChatId(data.chatId))!;
        if (typeof data.expectedText !== 'string' || comparableText(previous.text) !== comparableText(data.expectedText)) throw new Error('WhatsApp 草稿已有新的修改，请收起后重新打开草稿再同步');
        const images: ProductImage[] = Array.isArray(data.images) ? data.images : [];
        if (images.length > 6) throw new Error('商品草稿最多附加 6 张图片');
        const files = data.kind === 'UPDATE_DRAFT_IMAGES' ? images.map(imageFile) : [];
        insertingChats.add(data.chatId); synchronizingChats.add(data.chatId);
        try {
          if (data.kind === 'UPDATE_DRAFT_TEXT') {
            if (comparableText(composerText(target)) !== comparableText(data.expectedText)) throw new Error(mediaPreview ? '请在原生预览中选中带商品说明的图片，再同步文字' : '原生草稿已变化，请重新打开草稿后同步');
            await replaceComposerText(target, data.text, () => {
              assertActiveChat(data.chatId);
              assertDraftEditable(data.chatId, data.messageId);
              if (manualDrafts.get(normalizeChatId(data.chatId))?.messageId !== data.messageId) throw new Error('草稿已发送，停止同步');
            }, mutate);
          } else {
            if (mediaPreview && mediaPreview.messageId === data.messageId) {
              const preview = mediaPreview;
              await closeMediaPreview(preview, () => { assertActiveChat(data.chatId); assertDraftEditable(data.chatId, data.messageId); }, mutate);
              // Preserve the open state for the same message until replacement
              // is ready, so the optional editor does not disappear midway.
              preparedComposer = null;
            } else if (composerText(target).trim()) await replaceComposerText(target, '', () => { assertActiveChat(data.chatId); assertDraftEditable(data.chatId, data.messageId); }, mutate);
            assertDraftEditable(data.chatId, data.messageId);
            if (manualDrafts.get(normalizeChatId(data.chatId))?.messageId !== data.messageId) throw new Error('草稿已发送，停止同步');
            if (images.length) await openMediaDraft(data.chatId, data.messageId, data.text, images, files, data.draftLanguage === 'zh-CN' ? 'zh-CN' : 'es-MX');
            else {
              clearBusinessMediaDraft(data.chatId);
              setMediaPreview(null);
              const composer = nativeComposer();
              if (!composer) throw new Error('未找到 WhatsApp 输入框');
              preparedComposer = { chatId: data.chatId, messageId: data.messageId, element: composer };
              await setComposerText(composer, data.text, () => { assertActiveChat(data.chatId); assertDraftEditable(data.chatId, data.messageId); }, mutate);
            }
          }
          assertDraftEditable(data.chatId, data.messageId);
          registerManualDraft(data.chatId, data.text, data.messageId);
          reportInsertedDraft();
          emit('DRAFT_EDITED', { chatId: data.chatId, messageId: data.messageId, text: data.text, origin: 'plugin' });
          return draftSnapshot(data.chatId, data.messageId);
        } catch (error) {
          if (mediaPreview && !findMediaCaption(mediaPreview.existingEditors)) setMediaPreview(null);
          throw error;
        } finally { insertingChats.delete(data.chatId); synchronizingChats.delete(data.chatId); }
      }
      if (data.kind === 'INSERT_DRAFT') {
        await placeDraft(data);
        return;
      }
      await nativeAuto!.send(data as NativeAutoRequest);

    };
    // A repeated RPC must acknowledge the original result without pasting or
    // sending its contents a second time.
    const request = actions.get(data.id) ?? action();
    actions.set(data.id, request);
    void request.then((result) => emit('ACTION_RESULT', { id: data.id, ok: true, result }), (error) => emit('ACTION_RESULT', { id: data.id, ok: false, error: error instanceof Error ? error.message : '操作失败', deferred: Boolean((error as { deferred?: boolean })?.deferred) }))
      .finally(() => { if (actions.size > 256) actions.delete(actions.keys().next().value!); });
  });
}

function models(collection: Collection | undefined): any[] {
  const result = collection?.getModelsArray?.() ?? collection?.models;
  return Array.isArray(result) ? result : [];
}
function messageText(model: any): string | null {
  const caption = modelField(model, 'caption');
  if (typeof caption === 'string' && caption.trim()) return caption;
  const type = modelField(model, 'type');
  if (type && type !== 'chat') return null;
  const body = modelField(model, 'body');
  return typeof body === 'string' && body.trim() ? body : null;
}
function findChat(id: string): any | undefined {
  return models(tryRequire('WAWebChatCollection')?.ChatCollection).find((chat) => chatKey(modelField(chat, 'id')) === id);
}
function chatMessages(chatId: string): any[] {
  const messages = new Map<string, any>();
  for (const model of [...models(tryRequire('WAWebMsgCollection')?.MsgCollection), ...models(findChat(chatId)?.msgs)]) {
    const id = messageKey(modelField(model, 'id'));
    if (id && parseMessageId(id)?.chatId === chatId) messages.set(id, model);
  }
  return [...messages.values()];
}
function sameDraftText(left: string, right: string): boolean {
  const first = comparableText(left), second = comparableText(right);
  // Native media editors can join paragraph boundaries. This is only used to
  // confirm a new outgoing MessageKey captured after insertion in its own chat.
  return Boolean(first && second) && (first === second || first.replace(/\s/g, '') === second.replace(/\s/g, ''));
}
function nativeComposer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#main footer [contenteditable="true"][role="textbox"], #main footer [contenteditable="true"], [data-testid="conversation-compose-box-input"]');
}
function composerText(element: HTMLElement): string { return element.innerText ?? element.textContent ?? ''; }
function selectComposerContents(element: HTMLElement): void {
  element.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges(); selection?.addRange(range);
}
async function waitForComposerText(element: HTMLElement, text: string, validate: () => void): Promise<void> {
  const expected = comparableText(text);
  const deadline = Date.now() + 3000;
  // Lexical cancels native editing commands and commits the corresponding
  // editor update asynchronously. Its DOM text, not execCommand's boolean,
  // determines whether the one requested insertion/deletion has succeeded.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  while (true) {
    validate();
    if (!element.isConnected || !element.getBoundingClientRect().width) throw new Error('原生编辑框已关闭');
    if (comparableText(composerText(element)) === expected) return;
    if (Date.now() >= deadline) {
      console.warn('[wa-translate][business] native editor did not commit', { expectedLength: text.length, actualLength: composerText(element).length });
      throw new Error('原生编辑框未完成写入');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}
async function clearComposerText(element: HTMLElement, validate: () => void, mutate: <T>(callback: () => T) => T): Promise<void> {
  validate();
  mutate(() => { selectComposerContents(element); document.execCommand('delete', false); });
  await waitForComposerText(element, '', validate);
}
async function replaceComposerText(element: HTMLElement, text: string, validate: () => void, mutate: <T>(callback: () => T) => T): Promise<void> {
  let focused = document.activeElement as HTMLElement | null;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement as HTMLElement;
  const selection = focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement
    ? { start: focused.selectionStart, end: focused.selectionEnd } : null;
  const original = composerText(element);
  try {
    validate();
    if (comparableText(original) === comparableText(text)) return;
    mutate(() => element.focus({ preventScroll: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    mutate(() => selectComposerContents(element));
    // Give WA's editor time to observe selectionchange before deleting. A
    // failed delete stops here; a full reply is never appended over old text.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    validate();
    if (!element.isConnected || !element.getBoundingClientRect().width || composerText(element) !== original) throw new Error('原生草稿已变化，停止同步');
    const range = window.getSelection();
    if (!range?.anchorNode || !range.focusNode || !element.contains(range.anchorNode) || !element.contains(range.focusNode)) throw new Error('未能选中原生草稿，请重新同步');
    if (original.trim()) await clearComposerText(element, validate, mutate);
    if (text.trim()) await setComposerText(element, text, validate, mutate);
  } finally {
    if (focused?.isConnected && (document.activeElement === element || element.contains(document.activeElement))) {
      focused.focus({ preventScroll: true });
      if (selection && (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement)) focused.setSelectionRange(selection.start, selection.end);
    }
  }
}
async function setComposerText(element: HTMLElement, text: string, validate: () => void, mutate: <T>(callback: () => T) => T): Promise<void> {
  validate();
  if (!element.isConnected || !element.getBoundingClientRect().width) throw new Error('原生编辑框已关闭，停止写入');
  const current = composerText(element);
  if (comparableText(current) === comparableText(text)) return;
  if (current.trim()) throw new Error('原生输入框已有内容，未追加或覆盖，请先手动清空');
  // Let WA's Lexical editor process its own paste command, including its
  // internal selection and React state. A handled paste can return false and
  // commit later. Never append a second copy after a handled insertion.
  mutate(() => {
    selectComposerContents(element);
    if (element.hasAttribute('data-lexical-editor')) {
      const transfer = new DataTransfer(); transfer.setData('text/plain', text);
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
      return;
    }
    document.execCommand('insertText', false, text);
  });
  await waitForComposerText(element, text, validate);
}
function nativeSendButton(button: HTMLElement): boolean {
  if (!button.getBoundingClientRect().width || button.getAttribute('aria-disabled') === 'true'
    || button instanceof HTMLButtonElement && button.disabled) return false;
  const iconSelector = '[data-icon="send"], [data-icon="wds-ic-send-filled"], [data-testid="send"], [data-testid="send-button"]';
  if (button.matches(iconSelector) || button.querySelector(iconSelector)) return true;
  const child = button.querySelector('[aria-label], [title]');
  const label = button.getAttribute('aria-label') || button.getAttribute('title') || child?.getAttribute('aria-label') || child?.getAttribute('title') || '';
  return /^(?:Send(?: message)?|Enviar(?: mensaje)?|发送(?:消息)?|發送(?:訊息)?|傳送(?:訊息)?)$/i.test(label.trim());
}
function withinMediaPreview(button: HTMLElement, caption: HTMLElement): boolean {
  for (let root = caption.parentElement; root && root !== document.body; root = root.parentElement) {
    if (root.querySelector('#side, #main footer')) break;
    if (root.contains(button)) return true;
  }
  return false;
}
function mediaPreviewControls(caption: HTMLElement): { root: HTMLElement; close: HTMLElement } | null {
  for (let root = caption.parentElement; root && root !== document.body; root = root.parentElement) {
    // Do not reach the underlying chat/sidebar or use its unrelated close buttons.
    if (root.querySelector('#side, #main footer')) break;
    const close = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]')).find((button) => {
      const icon = button.querySelector('[aria-label], [title]');
      const label = button.getAttribute('aria-label') || button.getAttribute('title') || icon?.getAttribute('aria-label') || icon?.getAttribute('title') || button.textContent?.trim() || '';
      return /^(?:Close(?: preview)?|Cerrar(?: vista previa)?|关闭(?:预览)?|關閉(?:預覽)?)$/i.test(label) && button.getBoundingClientRect().width > 0;
    });
    if (close) return { root, close };
  }
  return null;
}
async function closeMediaPreview(preview: MediaPreview, validate: () => void, mutate: <T>(callback: () => T) => T): Promise<void> {
  validate();
  const controls = mediaPreviewControls(preview.element);
  if (!controls) throw new Error('未找到原生图片预览的关闭按钮，请手动关闭预览后再同步图片');
  mutate(() => controls.close.click());
  for (let attempt = 0; attempt < 30; attempt++) {
    validate();
    const composer = nativeComposer();
    if (!findMediaCaption(preview.existingEditors) && (!controls.close.isConnected || !controls.close.getBoundingClientRect().width)
      && composer && composer.getBoundingClientRect().width > 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('图片预览尚未关闭，请先处理原生页面提示，再同步图片');
}
function imageFile(image: ProductImage): File {
  if (typeof image?.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(image.dataUrl)) throw new Error('图片格式不支持');
  const [prefix, encoded] = image.dataUrl.split(',');
  const byteLength = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  const limit = currentWhatsAppImageLimit() ?? DEFAULT_WHATSAPP_IMAGE_LIMIT_BYTES;
  if (byteLength > limit) throw new Error(`${image.name || '商品图片'} 超过当前 WhatsApp 图片大小限制（${formatImageLimit(limit)}），请压缩后重试`);
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  return new File([bytes], image.name || 'product.jpg', { type: prefix.slice(5).split(';')[0] });
}
function currentWhatsAppImageLimit(): number | null {
  try {
    const limit = tryRequire('WAWebMediaGatingUtils')?.getUploadLimit?.('image', null);
    return validImageLimit(limit) ? limit : null;
  } catch { return null; }
}
function findMediaCaption(existingEditors: Set<HTMLElement>): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"][role="textbox"]'))
    .find((element) => !existingEditors.has(element) && !element.closest('#main footer, header, #side, [data-wa-business]') && element.getBoundingClientRect().width > 0);
}
async function waitForCaption(existingEditors: Set<HTMLElement>, chatId: string, validate: () => void = () => {}): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 100; attempt++) {
    validate(); assertActiveChat(chatId);
    const caption = findMediaCaption(existingEditors);
    if (caption) return caption;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('未能打开原生图片预览，请手动附图；草稿文字仍保留在辅助栏');
}
function assertActiveChat(chatId: string): void {
  const visibleChat = getActiveChatIdFromDom();
  if (getActiveChatId() !== chatId || visibleChat && visibleChat !== chatId) throw new Error('聊天已切换，请回到来源客户聊天后插入');
}
function mediaModules(): { prep: any; opaque: any } | null {
  const rawPrep = tryRequire('WAWebPrepRawMedia');
  const prep = typeof rawPrep?.prepRawMedia === 'function' ? rawPrep : tryRequire('WAWebMediaPrep')?.MediaPrep;
  const rawOpaque = tryRequire('WAWebMediaOpaqueData');
  const opaque = typeof rawOpaque?.createFromData === 'function' ? rawOpaque : rawOpaque?.default ?? tryRequire('WAWebOpaqueData')?.default;
  return typeof prep?.prepRawMedia === 'function' && typeof opaque?.createFromData === 'function' ? { prep, opaque } : null;
}
