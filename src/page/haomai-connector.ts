import { downloadPlatformMedia } from "./media-download";
import { tryRequire } from "./wa";
import { chatKey, messageKey, modelField } from "../shared/whatsapp-keys";
import { parseMessageId, normalizeChatId } from "../shared/message-history";
import {
  confirmNativeSendResult,
  nativeMessageIds,
  nativeChatMessages,
} from "./native-send-result";
let installed = false;
export function installHaomaiConnector() {
  if (installed) return;
  installed = true;
  let contextGeneration = "";
  const emit = (operation: string, payload: any) =>
    window.postMessage(
      {
        __haomaiPlatform: true,
        operation,
        payload: { contextGeneration, ...payload },
      },
      location.origin,
    );
  const observedDispatches: Array<{
    chatId: string;
    idempotencyKey: string;
    text: string;
    kind: string;
    at: number;
  }> = [];
  const seen = new Set<string>();
  const bound = new WeakSet<object>();
  let active = false;
  let lastAccount = "";
  const accountKey = () => {
    const user = tryRequire("WAWebUserPrefsInfo");
    return chatKey(
      user?.getMaybeMePnUser?.() ||
        user?.getMaybeMeUser?.() ||
        user?.getMeUser?.(),
    );
  };
  let mediaJobs = Promise.resolve();
  const failedMedia = new Map<string, any>();
  const failureAt = new Map<string, number>();
  const incoming = (model: any, force = false) => {
    if (!active) return;
    const id = messageKey(modelField(model, "id"));
    const parsed = id ? parseMessageId(id) : null;
    if (
      !id ||
      !parsed ||
      seen.has(id) ||
      (!force && Date.now() - (failureAt.get(id) || 0) < 30000)
    )
      return;
    const type = String(modelField(model, "type") || "chat");
    const kind =
      type === "image"
        ? "image"
        : ["audio", "ptt"].includes(type)
          ? "audio"
          : "text";
    if (!["chat", "image", "audio", "ptt"].includes(type)) return;
    const text = String(
      (kind === "image"
        ? modelField(model, "caption")
        : modelField(model, "body")) || "",
    );
    if (kind === "text" && !text.trim()) return;
    const timestamp = modelField(model, "t");
    if (typeof timestamp !== "number") return;
    if (!force && Date.now() - timestamp * 1000 > 120000) return;
    if (
      !force &&
      !parsed.fromMe &&
      modelField(model, "isNewMsg") !== true &&
      modelField(model, "recvFresh") !== true
    )
      return;
    if (
      parsed.fromMe &&
      !(
        typeof modelField(model, "ack") === "number" &&
        Number(modelField(model, "ack")) >= 1
      )
    )
      return;
    const dispatched = parsed.fromMe
      ? observedDispatches.find(
          (d) =>
            d.chatId === parsed.chatId &&
            d.text === text &&
            d.kind === kind &&
            Date.now() - d.at < 300000,
        )
      : undefined;
    const payload = {
      remoteAccountKey: accountKey(),
      remoteMessageKey: id,
      remoteConversationKey: parsed.chatId,
      text,
      kind,
      occurredAt: new Date(timestamp * 1000).toISOString(),
      fromMe: parsed.fromMe,
      direction: parsed.fromMe ? "outgoing" : "incoming",
      idempotencyKey: dispatched?.idempotencyKey,
      historical: force,
      contextGeneration,
    };
    seen.add(id);
    if (kind === "text" || dispatched) {
      emit("ingest", payload);
      return;
    }
    mediaJobs = mediaJobs
      .catch(() => {})
      .then(() => downloadPlatformMedia(model, kind))
      .then((media) => {
        failedMedia.delete(id);
        emit("ingest", { ...payload, media });
      })
      .catch((error) => {
        seen.delete(id);
        failedMedia.set(id, model);
        failureAt.set(id, Date.now());
        emit("sync_error", {
          ...payload,
          errorCode:
            error instanceof Error
              ? error.message
              : "platform_media_sync_failed",
        });
      });
    return mediaJobs;
  };
  const tick = () => {
    const remoteAccountKey = accountKey();
    if (active && remoteAccountKey) {
      if (lastAccount && lastAccount !== remoteAccountKey)
        emit("sync", {
          remoteAccountKey: lastAccount,
          loginState: "logged_out",
        });
      lastAccount = remoteAccountKey;
      emit("sync", {
        remoteAccountKey,
        phone: remoteAccountKey.split("@")[0],
        displayName: tryRequire("WAWebUserPrefsInfo")?.getPushname?.() || "",
        loginState: "logged_in",
      });
    } else if (active && lastAccount) {
      emit("sync", { remoteAccountKey: lastAccount, loginState: "logged_out" });
      lastAccount = "";
    }
    const collection = tryRequire("WAWebMsgCollection")?.MsgCollection;
    if (
      collection &&
      !bound.has(collection) &&
      typeof collection.on === "function"
    ) {
      bound.add(collection);
      collection.on("add", (model: any) => incoming(model));
      collection.on("change:body", (model: any) => incoming(model));
      collection.on("change:ack", (model: any) => incoming(model));
      collection.on("change:mediaData", (model: any) => incoming(model));
    }
    // Existing history is not replayed as new messages.
  };
  let operation = Promise.resolve();
  const sent = new Set<string>();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.__haomaiConnector !== true)
      return;
    const command = event.data;
    if (command.kind === "IMPORT_RECENT" && active) {
      void (async () => {
        let readCount = 0;
        let failedCount = 0;
        const generation = contextGeneration;
        try {
          if (
            typeof command.jobId !== "string" ||
            typeof command.nonce !== "string" ||
            accountKey() !== command.remoteAccountKey ||
            command.contextGeneration !== contextGeneration
          )
            throw new Error("source_account_changed");
          const collection = tryRequire("WAWebMsgCollection")?.MsgCollection;
          const chatCollection = tryRequire(
            "WAWebChatCollection",
          )?.ChatCollection;
          if (
            !collection ||
            !chatCollection ||
            !(
              typeof collection.getModelsArray === "function" ||
              Array.isArray(collection.models)
            ) ||
            !(
              typeof chatCollection.getModelsArray === "function" ||
              Array.isArray(chatCollection.models)
            )
          )
            throw new Error("platform_history_module_unavailable");
          const chats =
            chatCollection.getModelsArray?.() || chatCollection.models || [];
          const candidates = [
            ...(collection.getModelsArray?.() || collection.models || []),
          ];
          for (const chat of chats)
            candidates.push(
              ...(chat.msgs?.getModelsArray?.() || chat.msgs?.models || []),
            );
          const unique = new Map<string, any>();
          for (const model of candidates) {
            const id = messageKey(modelField(model, "id"));
            const parsed = id ? parseMessageId(id) : null;
            if (
              id &&
              parsed &&
              /^[^\s_]+@(?:c\.us|s\.whatsapp\.net|lid)$/.test(parsed.chatId) &&
              ["chat", "image", "audio", "ptt"].includes(
                String(modelField(model, "type") || "chat"),
              )
            )
              unique.set(id, model);
          }
          const models = [...unique.values()]
            .sort(
              (a, b) =>
                Number(modelField(b, "t") || 0) -
                Number(modelField(a, "t") || 0),
            )
            .slice(0, Math.min(100, Number(command.limit) || 100));
          for (const model of models) {
            if (
              accountKey() !== command.remoteAccountKey ||
              !active ||
              generation !== contextGeneration
            )
              throw new Error("source_account_changed");
            const id = messageKey(modelField(model, "id"))!;
            seen.delete(id);
            await incoming(model, true);
            readCount++;
            if (failedMedia.has(id)) failedCount++;
          }
          emit("import_result", {
            jobId: command.jobId,
            nonce: command.nonce,
            remoteAccountKey: command.remoteAccountKey,
            readCount,
            failedCount,
          });
        } catch (error) {
          emit("import_result", {
            jobId: command.jobId,
            nonce: command.nonce,
            remoteAccountKey: command.remoteAccountKey,
            readCount,
            failedCount,
            errorCode:
              error instanceof Error
                ? error.message
                : "platform_history_read_failed",
          });
        }
      })();
      return;
    }
    if (command.kind === "RETRY_SYNC" && active) {
      const collection = tryRequire("WAWebMsgCollection")?.MsgCollection;
      const models = collection?.getModelsArray?.() || collection?.models || [];
      for (const id of Array.isArray(command.ids)
        ? command.ids.slice(0, 100)
        : []) {
        const model =
          failedMedia.get(id) ||
          models.find((m: any) => messageKey(modelField(m, "id")) === id);
        if (model) {
          seen.delete(id);
          incoming(model, true);
        }
      }
      return;
    }
    if (command.kind === "MODE") {
      const changed = contextGeneration !== command.contextGeneration;
      contextGeneration = String(command.contextGeneration || "");
      active = command.active === true;
      if (changed) {
        seen.clear();
        failedMedia.clear();
        observedDispatches.length = 0;
      }
      tick();
      return;
    }
    if (
      command.kind !== "DISPATCH" ||
      !active ||
      typeof command.nonce !== "string" ||
      typeof command.data?.id !== "string" ||
      command.contextGeneration !== contextGeneration
    )
      return;
    const data = command.data;
    if (sent.has(data.id)) return;
    sent.add(data.id);
    operation = operation
      .catch(() => {})
      .then(async () => {
        try {
          const current = accountKey();
          if (
            !current ||
            current !== command.remoteAccountKey ||
            !active ||
            command.contextGeneration !== contextGeneration
          )
            throw new Error("来源账号已切换");
          const key = normalizeChatId(data.remoteConversationKey || "");
          if (!/^[^\s_]+@(?:c\.us|s\.whatsapp\.net|lid)$/.test(key))
            throw new Error("不支持的会话");
          const collection = tryRequire("WAWebChatCollection")?.ChatCollection;
          const chats =
            collection?.getModelsArray?.() || collection?.models || [];
          const chat = chats.find(
            (c: any) =>
              normalizeChatId(chatKey(modelField(c, "id")) || "") === key,
          );
          if (!chat) throw new Error("来源会话尚未加载");
          const before = nativeMessageIds(chat);
          let result: any;
          let media = false;
          observedDispatches.unshift({
            chatId: key,
            idempotencyKey: data.idempotencyKey,
            text: data.text || "",
            kind: data.kind,
            at: Date.now(),
          });
          if (observedDispatches.length > 500) observedDispatches.pop();
          if (data.kind === "text") {
            const sender = tryRequire("WAWebSendTextMsgChatAction");
            if (
              typeof sender?.sendTextMsgToChat !== "function" ||
              typeof data.text !== "string" ||
              !data.text.trim()
            )
              throw new Error("文字发送模块不可用");
            result = await sender.sendTextMsgToChat(chat, data.text, {});
          } else if (
            ["image", "audio"].includes(data.kind) &&
            Array.isArray(data.attachments) &&
            data.attachments.length === 1
          ) {
            const attachment = data.attachments[0];
            const rawPrep = tryRequire("WAWebPrepRawMedia");
            const raw =
              typeof rawPrep?.prepRawMedia === "function"
                ? rawPrep
                : tryRequire("WAWebMediaPrep")?.MediaPrep;
            const rawOpaque = tryRequire("WAWebMediaOpaqueData");
            const opaque =
              typeof rawOpaque?.createFromData === "function"
                ? rawOpaque
                : (rawOpaque?.default ??
                  tryRequire("WAWebOpaqueData")?.default);
            if (
              typeof raw?.prepRawMedia !== "function" ||
              typeof opaque?.createFromData !== "function" ||
              !attachment.dataUrl
            )
              throw new Error("图片发送模块不可用");
            const blob = await fetch(attachment.dataUrl).then((r) => r.blob());
            const prepared = await raw.prepRawMedia(
              await opaque.createFromData(blob, blob.type),
              { asDocument: false, isPtt: data.kind === "audio" },
            );
            if (typeof prepared?.sendToChat !== "function")
              throw new Error("图片预处理失败");
            await prepared.waitForPrep?.();
            if (
              !active ||
              command.contextGeneration !== contextGeneration ||
              accountKey() !== current
            )
              throw new Error("source_account_changed");
            const options = {
              caption: data.text || "",
              isPtt: data.kind === "audio",
            };
            result = await (prepared.sendToChat.length === 1
              ? prepared.sendToChat({ chat, options })
              : prepared.sendToChat(chat, options));
            media = true;
          } else throw new Error("当前平台适配器不支持该消息类型");
          await confirmNativeSendResult(
            result,
            chat,
            key,
            data.text || "",
            media,
            before,
            () => {
              if (accountKey() !== current) throw new Error("来源账号已切换");
            },
            undefined,
            data.kind === "audio" ? "audio" : "image",
          );
          const candidates = new Set(
            nativeChatMessages(chat)
              .filter((model) => {
                const id = messageKey(modelField(model, "id"));
                const parsed = id ? parseMessageId(id) : null;
                return (
                  id &&
                  !before.has(id) &&
                  parsed?.fromMe &&
                  parsed.chatId === key &&
                  [
                    modelField(model, "body"),
                    modelField(model, "caption"),
                  ].some(
                    (text) =>
                      typeof text === "string" && text === (data.text || ""),
                  )
                );
              })
              .map((model) => messageKey(modelField(model, "id")))
              .filter((id): id is string => !!id),
          );
          const remoteMessageKey =
            candidates.size === 1 ? [...candidates][0] : undefined;
          emit("result", {
            id: data.id,
            nonce: command.nonce,
            ok: true,
            remoteMessageKey,
          });
        } catch {
          emit("result", { id: data.id, nonce: command.nonce, ok: false });
        }
      });
  });
  const timer = setInterval(tick, 15000);
  window.addEventListener("pagehide", () => clearInterval(timer), {
    once: true,
  });
  tick();
}
