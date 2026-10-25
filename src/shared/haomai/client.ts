import { friendlyError } from "./errors";
import type { BackendSettings } from "./protocol";
export async function rpc<T = any>(
  operation: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await chrome.runtime.sendMessage({
    kind: "HAOMAI_UI",
    operation,
    ...payload,
  });
  if (!response?.ok)
    throw new Error(friendlyError(response?.error || "无法连接扩展后台"));
  return response.data as T;
}
export const api = <T = any>(path: string, method = "GET", body?: unknown) =>
  rpc<T>("api", { path, method, body });
export function openWorkspace(page = "messages") {
  return chrome.tabs.create({
    url: chrome.runtime.getURL(
      `src/options/index.html#${encodeURIComponent(page)}`,
    ),
  });
}
export async function saveBackend(settings: BackendSettings) {
  const origin = new URL(settings.apiBaseUrl).origin;
  if (
    settings.active &&
    !(await chrome.permissions.request({ origins: [`${origin}/*`] }))
  )
    throw new Error("需要服务器访问权限");
  return rpc("settings", { settings });
}
