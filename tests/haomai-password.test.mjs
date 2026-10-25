import assert from "node:assert/strict";
import { after, test } from "node:test";
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
  "FormData",
  "location",
])
  globalThis[name] = name === "window" ? fixture.window : fixture.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const requests = [];
let signedIn = false;
globalThis.chrome = {
  runtime: {
    getManifest: () => ({ version: "0.1.0" }),
    onMessage: { addListener() {}, removeListener() {} },
    async sendMessage(message) {
      requests.push(message);
      if (message.operation === "snapshot")
        return {
          ok: true,
          data: {
            settings: {
              active: true,
              apiBaseUrl: "http://127.0.0.1:8080/api/v1",
            },
            user: signedIn
              ? { id: "fixture-user", displayName: "测试用户" }
              : null,
          },
        };
      return {
        ok: true,
        data:
          message.path === "/auth/challenges"
            ? { challengeId: "fixture-challenge" }
            : {},
      };
    },
  },
  storage: {
    local: {
      async get() {
        return {};
      },
      async set() {},
    },
  },
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
const { passwordError } = await server.ssrLoadModule(
  "/src/shared/haomai/password.ts",
);
const { HaomaiApp } = await server.ssrLoadModule("/src/options/HaomaiApp.tsx");
const root = createRoot(document.querySelector("#root"));
let instance = 0;
const render = () =>
  act(async () => root.render(createElement(HaomaiApp, { key: ++instance })));
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
const click = async (text) => {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === text,
  );
  assert.ok(button, `Missing button ${text}`);
  await act(async () => button.click());
};
const submit = () =>
  act(async () =>
    document
      .querySelector("form")
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      ),
  );
after(async () => {
  await act(async () => root.unmount());
  fixture.window.close();
  await server.close();
});

test("password validation accepts short passwords and enforces the actual UTF-8 byte limit", () => {
  for (const value of [
    "1",
    "123456",
    "123456789012",
    "1234567890123",
    " 123456 ",
    "密".repeat(24),
  ])
    assert.equal(passwordError(value), "");
  for (const value of ["", "  ", "\t\n"])
    assert.equal(passwordError(value), "请输入密码");
  for (const value of ["a".repeat(73), "密".repeat(25), "😀".repeat(19)])
    assert.equal(passwordError(value), "密码不能超过 72 字节");
});

test("login, registration and reset preserve six-, twelve- and thirteen-character passwords", async () => {
  for (const mode of ["login", "register", "forgot"]) {
    for (const password of [
      "123456",
      "123456789012",
      "1234567890123",
      " 123456 ",
    ]) {
      await render();
      if (mode === "register") await click("还没账号？注册账号");
      if (mode === "forgot") await click("忘记密码");
      await fill("手机号", "13800138000");
      await fill("密码", password);
      if (mode !== "login") {
        await fill("确认密码", password);
        await click("获取验证码");
        await fill("验证码", "123456");
      }
      requests.length = 0;
      await submit();
      const sent = requests.find((r) =>
        mode === "forgot"
          ? r.path === "/auth/password/reset"
          : r.operation === mode,
      );
      assert.ok(sent, mode);
      assert.equal(sent.body.password, password);
    }
  }
});

test("all authentication forms reject empty and oversized passwords before sending a request", async () => {
  for (const mode of ["login", "register", "forgot"]) {
    await render();
    if (mode === "register") await click("还没账号？注册账号");
    if (mode === "forgot") await click("忘记密码");
    for (const password of ["", "  ", "密".repeat(25), "a".repeat(73)]) {
      await fill("手机号", "13800138000");
      await fill("密码", password);
      requests.length = 0;
      await submit();
      assert.ok(
        !requests.some(
          (r) =>
            ["login", "register"].includes(r.operation) ||
            r.path === "/auth/password/reset",
        ),
      );
      assert.match(
        document.querySelector('[role="alert"]').textContent,
        password.trim() ? /不能超过 72 字节/ : /请输入密码/,
      );
    }
  }
});

test("change-password uses the same rules and preserves the exact supplied passwords", async () => {
  signedIn = true;
  location.hash = "settings";
  await render();
  await click("修改密码 ›");
  await fill("当前密码", "123456");
  for (const value of ["", "  ", "密".repeat(25)]) {
    await fill("新密码", value);
    requests.length = 0;
    await submit();
    assert.ok(!requests.some((r) => r.path === "/me/password"));
  }
  await fill("新密码", " 123456 ");
  await submit();
  const sent = requests.find((r) => r.path === "/me/password");
  assert.deepEqual(sent.body, { oldPassword: "123456", password: " 123456 " });
});

test("authentication obtains backend host access without an address form and blocks requests when denied", async () => {
  signedIn = false;
  location.hash = "messages";
  const permissionRequests = [];
  let allow = false;
  const originalRequest = chrome.permissions.request;
  chrome.permissions.request = async (request) => {
    permissionRequests.push(request);
    return allow;
  };
  try {
    await render();
    assert.equal(document.querySelector('[aria-label="API 地址"]'), null);
    assert.ok(!document.body.textContent.includes("服务器配置"));
    assert.ok(!document.body.textContent.includes("使用独立模式"));
    await fill("手机号", "13800138000");
    await fill("密码", "123456");
    requests.length = 0;
    await submit();
    assert.deepEqual(permissionRequests[0], {
      origins: ["http://127.0.0.1:8080/*"],
    });
    assert.match(document.querySelector('[role="alert"]').textContent, /需要服务器访问权限/);
    assert.ok(!requests.some((r) => ["login", "settings"].includes(r.operation)));

    await click("还没账号？注册账号");
    requests.length = 0;
    await click("获取验证码");
    assert.ok(!requests.some((r) => r.path === "/auth/challenges"));
    allow = true;
    await click("获取验证码");
    const configure = requests.findIndex((r) => r.operation === "settings");
    const challenge = requests.findIndex((r) => r.path === "/auth/challenges");
    assert.ok(configure >= 0 && challenge > configure);
    assert.deepEqual(requests[configure].settings, {
      active: true,
      apiBaseUrl: "http://127.0.0.1:8080/api/v1",
    });
    assert.equal(document.querySelector('[aria-label="API 地址"]'), null);
  } finally {
    chrome.permissions.request = originalRequest;
  }
});
