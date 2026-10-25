import { tryRequire } from "./wa";
import { modelField } from "../shared/whatsapp-keys";
import {
  MAX_PLATFORM_MEDIA_BYTES,
  validatePlatformMedia,
  type PlatformMedia,
} from "../shared/haomai/media";
// The native MsgModel downloader performs WA's authenticated download/decryption.
// Its cache / forceToBlob contracts are confirmed against WA-JS v4.7.1 source:
// https://github.com/wppconnect-team/wa-js/blob/v4.7.1/src/chat/functions/downloadMedia.ts
// No WhatsApp keys, signed URLs or backend credentials cross the isolated relay.
export async function downloadPlatformMedia(
  model: any,
  kind: "image" | "audio",
): Promise<PlatformMedia> {
  const initial = modelField(model, "mediaData") as any;
  const declared = initial?.size ?? modelField(model, "size");
  if (typeof declared === "number" && declared > MAX_PLATFORM_MEDIA_BYTES)
    throw new Error("platform_media_too_large");
  const attached = async (): Promise<Blob | null> => {
    const data = modelField(model, "mediaData") as any;
    const opaque = data?.mediaBlob;
    if (opaque && typeof opaque.forceToBlob === "function") {
      const blob = await opaque.forceToBlob();
      if (blob && typeof blob.arrayBuffer === "function") return blob;
    }
    if (opaque && typeof opaque.arrayBuffer === "function") return opaque;
    if (data?.filehash) {
      const debug = tryRequire("__debug")?.modulesMap || {};
      const names = new Set([
        "WAWebMediaBlobCache",
        "WAWebLruMediaStore",
        ...Object.keys(debug)
          .filter((name) =>
            /^WAWeb.*(?:LruMedia|MediaBlobCache|MediaStore)/.test(name),
          )
          .slice(0, 80),
      ]);
      for (const name of names) {
        const module = tryRequire(name);
        for (const cache of [
          module?.LruMediaStore,
          module?.InMemoryMediaBlobCache,
          module?.MediaBlobCache,
        ]) {
          if (typeof cache?.get !== "function") continue;
          try {
            const value = await cache.get(data.filehash);
            if (value && typeof value.arrayBuffer === "function") return value;
            if (value instanceof ArrayBuffer)
              return new Blob([value], { type: data.mimetype || "" });
            if (ArrayBuffer.isView(value))
              return new Blob(
                [
                  new Uint8Array(
                    value.buffer,
                    value.byteOffset,
                    value.byteLength,
                  ).slice(),
                ],
                { type: data.mimetype || "" },
              );
          } catch {
            /* The native cache can miss while a download is in progress. */
          }
        }
      }
    }
    return null;
  };
  let blob = await attached();
  if (!blob) {
    if (typeof model?.downloadMedia !== "function")
      throw new Error("platform_media_module_unavailable");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        model.downloadMedia({
          downloadEvenIfExpensive: true,
          rmrReason: 1,
          isUserInitiated: true,
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("platform_media_download_timeout")),
            45000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    blob = await attached();
  }
  if (!blob) throw new Error("platform_media_not_downloaded");
  if (blob.size <= 0 || blob.size > MAX_PLATFORM_MEDIA_BYTES)
    throw new Error("platform_media_too_large");
  const data = modelField(model, "mediaData") as any;
  const mimeType = (
    blob.type ||
    data?.mimetype ||
    modelField(model, "mimetype") ||
    ""
  )
    .split(";")[0]
    .toLowerCase();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return validatePlatformMedia(
    {
      mimeType,
      sizeBytes: bytes.length,
      originalName: String(
        modelField(model, "filename") ||
          `whatsapp-${kind}.${mimeType.split("/")[1] || "bin"}`,
      ),
      base64: btoa(binary),
    },
    kind,
  );
}
