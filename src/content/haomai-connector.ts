import { validatePlatformMedia } from "../shared/haomai/media";
// The isolated relay only exposes fixed WA observations. Authenticated API calls and
// credentials stay inside the background worker; arbitrary page URL/methods are rejected.
export function installHaomaiRelay() {
  if (
    typeof chrome.runtime.sendMessage !== "function" ||
    !chrome.runtime.onMessage
  )
    return;
  const pending = new Map<string, string>();
  let active = false;
  const call = (operation: string, payload?: unknown) =>
    chrome.runtime.sendMessage({ kind: "HAOMAI_CONTENT", operation, payload });
  const mode = (value: boolean, contextGeneration?: string) => {
    active = value;
    window.postMessage(
      { __haomaiConnector: true, kind: "MODE", active, contextGeneration },
      location.origin,
    );
  };
  void call("mode")
    .then((r) => mode(r?.data?.active === true, r?.data?.contextGeneration))
    .catch(() => {});
  const timer = setInterval(
    () =>
      void call("mode")
        .then((r) =>
          mode(r?.data?.active === true, r?.data?.contextGeneration),
        )
        .catch(() => {}),
    15000,
  );
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.kind === "HAOMAI_IMPORT_RECENT" && active)
      window.postMessage(
        { ...message, __haomaiConnector: true, kind: "IMPORT_RECENT" },
        location.origin,
      );
    if (message?.kind === "HAOMAI_RETRY_SYNC" && active)
      window.postMessage(
        { __haomaiConnector: true, kind: "RETRY_SYNC", ids: message.ids },
        location.origin,
      );
    if (message?.kind === "HAOMAI_MODE")
      mode(message.active === true, message.contextGeneration);
    if (message?.kind === "HAOMAI_DISPATCH" && active) {
      pending.set(message.data.id, message.nonce);
      window.postMessage(
        { ...message, __haomaiConnector: true, kind: "DISPATCH" },
        location.origin,
      );
      respond({ accepted: true });
    }
  });
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (
      event.source !== window ||
      message?.__haomaiPlatform !== true ||
      !active
    )
      return;
    if (message.operation === "result") {
      if (pending.get(message.payload?.id) !== message.payload?.nonce) return;
      pending.delete(message.payload.id);
    } else if (
      !["sync", "ingest", "sync_error", "import_result"].includes(
        message.operation,
      )
    )
      return;
    if (message.operation === "ingest" && message.payload?.media) {
      try {
        validatePlatformMedia(message.payload.media, message.payload.kind);
      } catch {
        void call("sync_error", {
          ...message.payload,
          media: undefined,
          errorCode: "invalid_platform_media",
        });
        return;
      }
    }
    void call(message.operation, message.payload)
      .then((response) => {
        if (message.operation === "ingest" && !response?.ok)
          void call("sync_error", {
            ...message.payload,
            media: undefined,
            errorCode: "platform_ingest_failed",
          });
      })
      .catch(() => {});
  });
  window.addEventListener("pagehide", () => clearInterval(timer), {
    once: true,
  });
}
