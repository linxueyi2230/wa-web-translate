export const MAX_PLATFORM_MEDIA_BYTES = 20 * 1024 * 1024;
const imageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const audioTypes = new Set([
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/ogg",
  "audio/webm",
]);
export interface PlatformMedia {
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  base64: string;
}
export function validatePlatformMedia(
  value: unknown,
  kind: "image" | "audio",
): PlatformMedia {
  const input = value as PlatformMedia;
  const mimeType =
    typeof input?.mimeType === "string"
      ? input.mimeType.split(";")[0].toLowerCase()
      : "";
  if (!(kind === "image" ? imageTypes : audioTypes).has(mimeType))
    throw new Error("unsupported_platform_media_type");
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_PLATFORM_MEDIA_BYTES
  )
    throw new Error("platform_media_too_large");
  if (
    typeof input.base64 !== "string" ||
    input.base64.length > Math.ceil(MAX_PLATFORM_MEDIA_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)
  )
    throw new Error("invalid_platform_media");
  const padding = input.base64.endsWith("==")
    ? 2
    : input.base64.endsWith("=")
      ? 1
      : 0;
  if (
    input.base64.length % 4 !== 0 ||
    (input.base64.length / 4) * 3 - padding !== input.sizeBytes
  )
    throw new Error("platform_media_size_mismatch");
  return {
    ...input,
    mimeType,
    originalName:
      typeof input.originalName === "string"
        ? input.originalName.slice(0, 180)
        : `message.${kind === "image" ? "jpg" : "ogg"}`,
  };
}
export function mediaBytes(media: PlatformMedia) {
  return Uint8Array.from(atob(media.base64), (char) => char.charCodeAt(0));
}
