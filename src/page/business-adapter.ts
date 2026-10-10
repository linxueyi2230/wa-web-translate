import { getActiveChatId, getActiveChatIdFromDom, tryRequire } from './wa';
import { chatKey, messageKey, modelField } from '@/shared/whatsapp-keys';
import { parseMessageId } from '@/shared/message-history';
import { registerBusinessDraft, clearBusinessDraft, notifyBusinessDraftSent, isBusinessDraft, businessDraftMessageId, registerAutomaticBusinessReply, clearAutomaticBusinessReply } from './business-drafts';
import type { IncomingBusinessMessage } from '@/shared/business-replies';
import type { ProductImage } from '@/shared/types';

export const BUSINESS_TAG = '__waBusiness';

interface Collection {
  on?: (event: string, callback: (...args: any[]) => void) => void;
  getModelsArray?: () => any[];
  models?: any[];
}

export function installBusinessAdapter(): void {
  const startedAt = Date.now();
  const seen = new Set<string>();
  const bound = new WeakSet<object>();
  let activeChat: string | null = null;
  let eventCollectionReady = false;
  let preparedComposer: { chatId: string; element: HTMLElement; messageId?: string } | null = null;
  const authorizations = new Map<string, (allowed: boolean) => void>();
  const emit = (kind: string, payload: Record<string, unknown> = {}) => window.postMessage({ [BUSINESS_TAG]: true, kind, ...payload }, '*');
  const verifySend = (actionId: string, messageId: string): Promise<boolean> => new Promise((resolve) => {
    const timer = window.setTimeout(() => { authorizations.delete(actionId); resolve(false); }, 4000);
    authorizations.set(actionId, (allowed) => { clearTimeout(timer); resolve(allowed); });
    emit('VERIFY_SEND', { id: actionId, messageId });
  });

  const incoming = (model: any) => {
    const id = messageKey(modelField(model, 'id'));
    const key = id ? parseMessageId(id) : null;
    if (!id || !key || seen.has(id)) return;
    if (key.fromMe) {
      const sentText = messageText(model);
      if (typeof sentText === 'string') notifyBusinessDraftSent(key.chatId, sentText);
      return;
    }
    if (!/^(?:c\.us|s\.whatsapp\.net|lid)$/.test(key.chatId.split('@')[1] ?? '')) return;
    const body = messageText(model);
    const timestamp = modelField(model, 't');
    // Model add events also occur for history loads; only newly received models qualify.
    const fresh = modelField(model, 'isNewMsg') === true || modelField(model, 'recvFresh') === true;
    if (!fresh || typeof timestamp !== 'number' || timestamp * 1000 < startedAt - 2000 || typeof body !== 'string' || !body.trim()) return;
    seen.add(id);
    const message: IncomingBusinessMessage = { id, chatId: key.chatId, text: body, receivedAt: timestamp * 1000 };
    emit('INCOMING', { message });
  };

  const attach = (collection: Collection | undefined) => {
    if (!collection || typeof collection.on !== 'function' || bound.has(collection)) return;
    bound.add(collection);
    for (const model of models(collection)) {
      const id = messageKey(modelField(model, 'id'));
      if (id) seen.add(id); // Never trigger existing history on installation.
    }
    collection.on('add', incoming);
    eventCollectionReady = true;
  };

  const tick = () => {
    try {
      const chatCollection = tryRequire('WAWebChatCollection')?.ChatCollection;
      attach(tryRequire('WAWebMsgCollection')?.MsgCollection);
      for (const chat of models(chatCollection)) attach(chat?.msgs);
      const next = getActiveChatId();
      if (next !== activeChat) {
        preparedComposer = null;
        activeChat = next;
        const composer = nativeComposer();
        if (next && composer && isBusinessDraft(next, composerText(composer))) preparedComposer = { chatId: next, element: composer, messageId: businessDraftMessageId(next, composerText(composer)) };
        emit('ACTIVE_CHAT', { chatId: next });
      }
      emit('CAPABILITIES', { incomingReady: eventCollectionReady, mediaReady: Boolean(mediaModules()) });
    } catch { emit('CAPABILITIES', { incomingReady: false, mediaReady: false }); }
  };
  tick();
  const interval = window.setInterval(tick, 1000);
  window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
  document.addEventListener('input', (event) => {
    if (!preparedComposer || (event.target !== preparedComposer.element && !preparedComposer.element.contains(event.target as Node))) return;
    const text = composerText(preparedComposer.element);
    const messageId = preparedComposer.messageId;
    // A native send can clear its caption before the outgoing model is added.
    // Keep the exact-text marker until that model/send hook confirms the send.
    if (!text.trim()) { preparedComposer = null; }
    else {
      registerBusinessDraft(preparedComposer.chatId, text, messageId);
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
    if (data.kind === 'REQUEST_STATE') { tick(); emit('ACTIVE_CHAT', { chatId: activeChat }); return; }
    if (data.kind === 'CLEAR_DRAFT' && typeof data.chatId === 'string') {
      clearBusinessDraft(data.chatId); preparedComposer = null; return;
    }
    if (data.kind === 'REGISTER_DRAFT' && typeof data.chatId === 'string' && typeof data.text === 'string') {
      const composer = nativeComposer();
      if (composer && getActiveChatId() === data.chatId && composerText(composer) === data.text) {
        registerBusinessDraft(data.chatId, data.text, data.messageId);
        preparedComposer = { chatId: data.chatId, element: composer, messageId: data.messageId };
      }
      return;
    }
    if (data.kind !== 'INSERT_DRAFT' && data.kind !== 'SEND_REPLY') return;
    if (typeof data.id !== 'string' || typeof data.chatId !== 'string' || typeof data.text !== 'string' || !data.text.trim()) return;
    const action = async () => {
      if (data.kind === 'INSERT_DRAFT') {
        assertActiveChat(data.chatId);
        const composer = nativeComposer();
        if (!composer) throw new Error('未找到 WhatsApp 输入框，请打开客户聊天');
        const current = composerText(composer);
        if (current.trim() && current !== data.replaceText) throw new Error('输入框已有内容，未覆盖');
        if (Array.isArray(data.images) && data.images.length) {
          const files = data.images.map(imageFile);
          const transfer = new DataTransfer();
          files.forEach((file: File) => transfer.items.add(file));
          // Native paste opens WhatsApp's own media preview without sending anything.
          try {
            setComposerText(composer, '');
            const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
            composer.dispatchEvent(paste);
            const caption = await waitForCaption(composer, data.chatId);
            setComposerText(caption, data.text);
            preparedComposer = { chatId: data.chatId, element: caption, messageId: data.messageId };
          } catch (error) {
            if (getActiveChatId() === data.chatId && composer.isConnected && !composerText(composer).trim()) {
              const restored = current || data.text;
              setComposerText(composer, restored);
              registerBusinessDraft(data.chatId, restored, data.messageId);
              preparedComposer = { chatId: data.chatId, element: composer, messageId: data.messageId };
            }
            throw error;
          }
        } else {
          setComposerText(composer, data.text);
          preparedComposer = { chatId: data.chatId, element: composer, messageId: data.messageId };
        }
        registerBusinessDraft(data.chatId, data.text, data.messageId);
        return;
      }
      const chat = findChat(data.chatId);
      if (!chat) throw new Error('无法确认收件聊天，已停止自动发送');
      if (Array.isArray(data.images) && data.images.length) {
        const media = mediaModules();
        if (!media) throw new Error('当前 WhatsApp 图片接口不可用，请手动附图');
        if (data.images.length !== 1) throw new Error('自动回复只允许发送商品封面图');
        const file = imageFile(data.images[0]);
        const opaque = await media.opaque.createFromData(file, file.type);
        const preparation = media.prep.prepRawMedia(opaque, { maxDimension: 1600 });
        await preparation.waitForPrep();
        if (!await verifySend(data.id, data.messageId)) throw new Error('自动回复已暂停或配置已变化，未发送');
        const options = { caption: data.text, addEvenWhilePreparing: false };
        // Calling conventions vary; choose once, never retry a send after rejection.
        await (preparation.sendToChat.length === 1
          ? preparation.sendToChat({ chat, options }) : preparation.sendToChat(chat, options));
      } else {
        const send = tryRequire('WAWebSendTextMsgChatAction');
        if (typeof send?.sendTextMsgToChat !== 'function') throw new Error('当前 WhatsApp 发送接口不可用');
        if (!await verifySend(data.id, data.messageId)) throw new Error('自动回复已暂停或配置已变化，未发送');
        registerAutomaticBusinessReply(data.chatId, data.text, data.messageId);
        try { await send.sendTextMsgToChat(chat, data.text, {}); }
        finally { clearAutomaticBusinessReply(data.chatId, data.text); }
      }
    };
    void action().then(() => emit('ACTION_RESULT', { id: data.id, ok: true }), (error) => emit('ACTION_RESULT', { id: data.id, ok: false, error: error instanceof Error ? error.message : '操作失败' }));
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
function nativeComposer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#main footer [contenteditable="true"][role="textbox"], #main footer [contenteditable="true"], [data-testid="conversation-compose-box-input"]');
}
function composerText(element: HTMLElement): string { return element.innerText ?? element.textContent ?? ''; }
function setComposerText(element: HTMLElement, text: string): void {
  element.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges(); selection?.addRange(range);
  if (!document.execCommand('insertText', false, text)) throw new Error('无法写入原生输入框，请复制草稿后手动粘贴');
}
function imageFile(image: ProductImage): File {
  if (typeof image?.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(image.dataUrl)) throw new Error('图片格式不支持');
  const [prefix, encoded] = image.dataUrl.split(',');
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  return new File([bytes], image.name || 'product.jpg', { type: prefix.slice(5).split(';')[0] });
}
async function waitForCaption(original: HTMLElement, chatId: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 30; attempt++) {
    assertActiveChat(chatId);
    const caption = Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"][role="textbox"]'))
      .find((element) => element !== original && !element.closest('#main footer, header, #side, [data-wa-business]') && element.getBoundingClientRect().width > 0);
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
