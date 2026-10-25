import assert from "node:assert/strict";
import { test, after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer as httpServer } from "node:http";
import { createServer } from "vite";
import { JSDOM } from "jsdom";
const fixture = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: "https://extension.test/src/options/index.html",
});
for (const name of [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "FormData",
  "location",
])
  globalThis[name] = name === "window" ? fixture.window : fixture.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const requests = [];
let signedIn = false;
globalThis.chrome = {
  runtime: {
    getManifest: () => ({ version: "0.1.0" }),
    onMessage: { addListener() {}, removeListener() {} },
    async sendMessage(msg) {
      requests.push(msg);
      let data = {};
      if (msg.operation === "snapshot")
        data = {
          settings: {
            active: true,
            apiBaseUrl: "http://127.0.0.1:8080/api/v1",
          },
          user: signedIn ? { id: "user-1", displayName: "我的工作区" } : null,
          connected: true,
          clientId: "client-1",
        };
      if (msg.operation === "login") {
        signedIn = true;
        data = { user: { id: "user-1" } };
      }
      if (msg.operation === "api") {
        if (msg.path === "/auth/challenges")
          data = { challengeId: "challenge-1" };
        else if (msg.path === "/public/config")
          data = { websiteUrl: "", appDownloadUrl: "" };
        else if (/^\/media\/[^/]+\/download$/.test(msg.path))
          data = {
            url: `https://media.fixture.invalid/${msg.path.split("/")[2]}?grant=fresh`,
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          };
        else if (msg.path.startsWith("/categories?"))
          data = {
            items: [
              {
                id: "category-1",
                name: "常用语",
                sortOrder: 0,
                definitionId: null,
              },
            ],
            total: 1,
          };
        else if (msg.path === "/categories/category-1/contents")
          data = {
            items: [
              {
                id: "content-1",
                title: "欢迎语",
                text: "您好，欢迎咨询",
                autoReply: false,
                keywords: [{ id: "keyword-1", text: "你好", active: true }],
              },
            ],
            total: 1,
          };
        else data = { items: [], total: 0 };
      }
      return { ok: true, data };
    },
  },
  storage: {
    local: {
      async get() {
        return {};
      },
      async set() {},
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  tabs: { create: async () => {} },
  permissions: { request: async () => true },
};
const server = await createServer({
  configFile: false,
  resolve: {
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  },
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { server: httpServer() }, watch: null },
  appType: "custom",
});
const { HaomaiApp } = await server.ssrLoadModule("/src/options/HaomaiApp.tsx");
const { MediaAttachment } = await server.ssrLoadModule(
  "/src/shared/ui/MediaAttachment.tsx",
);
const root = createRoot(document.querySelector("#root"));
after(async () => {
  await act(async () => root.unmount());
  fixture.window.close();
  await server.close();
});
const click = async (text) => {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  assert.ok(button, `Missing button ${text}`);
  await act(async () => button.click());
};
const fill = async (label, value) => {
  const input = document.querySelector(`input[aria-label="${label}"]`);
  assert.ok(input, label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};
test("connected login inputs implement clear and visibility rules; verification code stays plain", async () => {
  await act(async () => root.render(createElement(HaomaiApp)));
  await fill("手机号", "13800000001");
  assert.ok(document.querySelector('[aria-label="清空手机号"]'));
  await act(async () =>
    document.querySelector('[aria-label="清空手机号"]').click(),
  );
  assert.equal(document.querySelector('[aria-label="手机号"]').value, "");
  await fill("密码", "Fixture123");
  assert.equal(document.querySelector('[aria-label="密码"]').type, "password");
  await act(async () =>
    document.querySelector('[aria-label="显示密码"]').click(),
  );
  assert.equal(document.querySelector('[aria-label="密码"]').type, "text");
  await click("还没账号？注册账号");
  await fill("验证码", "123456");
  assert.equal(document.querySelector('[aria-label="清空验证码"]'), null);
  assert.ok(document.querySelector('[aria-label="清空密码"]'));
  assert.ok(document.querySelector('[aria-label="确认密码"]'));
  await click("已有账号？登录");
  await fill("手机号", "13800000001");
  await act(async () =>
    document
      .querySelector("form")
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      ),
  );
  const login = requests.find((r) => r.operation === "login");
  assert.equal(login.body.phone, "13800000001");
  assert.equal(login.body.password, "Fixture123");
  assert.match(document.body.textContent, /我的工作区/);
});
test("categories follow view-detail-edit with actual API mutations and no order/count labels", async () => {
  await click("类别与内容");
  assert.ok(
    !document.querySelector(".hm-main").textContent.includes("显示顺序"),
  );
  assert.ok(!document.querySelector(".hm-main").textContent.includes("1 条"));
  await click("常用语›");
  assert.ok(document.querySelector('[aria-label="新增内容"]'));
  await click("欢迎语›");
  assert.match(
    document.querySelector(".hm-dialog").textContent,
    /您好，欢迎咨询/,
  );
  assert.ok(
    !document.querySelector(".hm-dialog").textContent.includes("查看详情"),
  );
  await act(async () =>
    document.querySelector(".hm-dialog .hm-switch input").click(),
  );
  const toggle = requests.find(
    (r) =>
      r.operation === "api" &&
      r.path === "/contents/content-1" &&
      r.method === "PATCH",
  );
  assert.deepEqual(toggle.body, { autoReply: true });
});
test("feedback creation uses one submit action and a close button", async () => {
  await click("意见反馈");
  await act(async () =>
    document.querySelector('[aria-label="添加反馈"]').click(),
  );
  assert.ok(document.querySelector('[aria-label="关闭"]'));
  assert.ok(document.querySelector('.hm-upload input[type="file"]'));
  assert.deepEqual(
    [...document.querySelectorAll(".hm-dialog form button")].map(
      (b) => b.textContent,
    ),
    ["提交反馈"],
  );
});

test("media playback refreshes expired grants and images recover with an explicit retry", async () => {
  let paused = 0;
  let loaded = 0;
  fixture.window.HTMLMediaElement.prototype.pause = function () {
    paused++;
  };
  fixture.window.HTMLMediaElement.prototype.load = function () {
    loaded++;
  };
  fixture.window.HTMLMediaElement.prototype.play = async function () {
    this.dispatchEvent(new window.Event("play"));
  };
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(MediaAttachment, {
          key: "audio",
          media: {
            mediaId: "voice-1",
            mimeType: "audio/webm",
            url: "https://media.fixture.invalid/voice-1?grant=expired",
          },
        }),
        createElement(MediaAttachment, {
          key: "image",
          media: {
            mediaId: "image-1",
            mimeType: "image/png",
            url: "https://media.fixture.invalid/image-1?grant=expired",
          },
        }),
      ),
    ),
  );
  const audio = document.querySelector("audio");
  await act(async () => audio.play());
  assert.equal(paused, 1);
  assert.equal(loaded, 1);
  assert.match(audio.src, /grant=fresh/);
  assert.equal(
    requests.filter((r) => r.path === "/media/voice-1/download").length,
    1,
  );
  await act(async () => audio.play());
  assert.equal(
    requests.filter((r) => r.path === "/media/voice-1/download").length,
    1,
    "a valid grant must not cause a recursive playback refresh",
  );
  const image = document.querySelector("img");
  await act(async () => image.dispatchEvent(new window.Event("error")));
  assert.match(image.src, /grant=fresh/);
  await act(async () => image.dispatchEvent(new window.Event("error")));
  assert.match(document.body.textContent, /链接已失效/);
  await click("重新加载图片");
  assert.equal(
    requests.filter((r) => r.path === "/media/image-1/download").length,
    2,
  );
  assert.ok(!document.body.textContent.includes("链接已失效"));
});
