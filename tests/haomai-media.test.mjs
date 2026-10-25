import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createServer } from "vite";
import { createServer as httpServer } from "node:http";
import { fileURLToPath } from "node:url";
const server = await createServer({
  configFile: false,
  resolve: {
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  },
  server: { middlewareMode: true, hmr: { server: httpServer() }, watch: null },
  appType: "custom",
});
after(() => server.close());
globalThis.window = {
  require() {
    throw new Error("module missing");
  },
};
const { downloadPlatformMedia } = await server.ssrLoadModule(
  "/src/page/media-download.ts",
);
const { MAX_PLATFORM_MEDIA_BYTES, validatePlatformMedia, mediaBytes } =
  await server.ssrLoadModule("/src/shared/haomai/media.ts");
test("native media downloader decrypts via MsgModel and only returns bounded bytes", async () => {
  let downloads = 0;
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const model = {
    size: bytes.length,
    filename: "customer.png",
    mediaData: { mimetype: "image/png" },
    async downloadMedia(options) {
      downloads++;
      assert.equal(options.downloadEvenIfExpensive, true);
      this.mediaData.mediaBlob = {
        forceToBlob: () => new Blob([bytes], { type: "image/png" }),
      };
    },
  };
  const result = await downloadPlatformMedia(model, "image");
  assert.equal(downloads, 1);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.sizeBytes, bytes.length);
  assert.deepEqual(mediaBytes(result), bytes);
  assert.equal(result.originalName, "customer.png");
  assert.deepEqual(Object.keys(result).sort(), [
    "base64",
    "mimeType",
    "originalName",
    "sizeBytes",
  ]);
  await downloadPlatformMedia(model, "image");
  assert.equal(downloads, 1, "cached blob should not be downloaded again");
});
test("native voice media stays audio and unavailable modules fail explicitly", async () => {
  const bytes = new Uint8Array([
    79, 103, 103, 83, 0, 0, 79, 112, 117, 115, 72, 101, 97, 100,
  ]);
  const model = {
    mediaData: {
      mediaBlob: {
        forceToBlob: () => new Blob([bytes], { type: "audio/ogg" }),
      },
    },
  };
  const result = await downloadPlatformMedia(model, "audio");
  assert.equal(result.mimeType, "audio/ogg");
  assert.deepEqual(mediaBytes(result), bytes);
  await assert.rejects(
    () => downloadPlatformMedia({ mediaData: {} }, "image"),
    /platform_media_module_unavailable/,
  );
});
test("platform media rejects oversized declarations, content type confusion and corrupt base64 before relaying", async () => {
  let downloads = 0;
  await assert.rejects(
    () =>
      downloadPlatformMedia(
        {
          size: MAX_PLATFORM_MEDIA_BYTES + 1,
          downloadMedia() {
            downloads++;
          },
        },
        "image",
      ),
    /platform_media_too_large/,
  );
  assert.equal(downloads, 0);
  assert.throws(
    () =>
      validatePlatformMedia(
        { mimeType: "text/html", sizeBytes: 4, base64: "YWJjZA==" },
        "image",
      ),
    /unsupported_platform_media_type/,
  );
  assert.throws(
    () =>
      validatePlatformMedia(
        { mimeType: "image/png", sizeBytes: 8, base64: "YWJjZA==" },
        "image",
      ),
    /size_mismatch/,
  );
  assert.throws(
    () =>
      validatePlatformMedia(
        { mimeType: "audio/ogg", sizeBytes: 4, base64: "../../??" },
        "audio",
      ),
    /invalid_platform_media/,
  );
});

test("new WA persistent LRU media cache is read after native decryption without exposing keys", async () => {
  const previous = window.require;
  const bytes = new Uint8Array([
    79, 103, 103, 83, 79, 112, 117, 115, 72, 101, 97, 100,
  ]);
  let available = false;
  window.require = (name) => {
    if (name === "__debug")
      return { modulesMap: { WAWebFixtureMediaStore: {} } };
    if (name === "WAWebFixtureMediaStore")
      return {
        LruMediaStore: {
          get: async (hash) => {
            assert.equal(hash, "native-file-hash");
            return available ? bytes.buffer : null;
          },
        },
      };
    throw new Error("missing");
  };
  try {
    const model = {
      mediaData: { mimetype: "audio/ogg", filehash: "native-file-hash" },
      async downloadMedia() {
        available = true;
      },
    };
    const value = await downloadPlatformMedia(model, "audio");
    assert.deepEqual(mediaBytes(value), bytes);
  } finally {
    window.require = previous;
  }
});
