import "../shared/generated/haomai.css";
import "../shared/ui/theme.css";
import { initializeTheme } from "../shared/ui/theme";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, openWorkspace, rpc } from "../shared/haomai/client";
import type { Account } from "../shared/haomai/protocol";
import "./styles.css";
initializeTheme();
function PopupApp() {
  const [state, setState] = useState<any>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [usage, setUsage] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void rpc("snapshot")
      .then(async (s) => {
        if (!active) return;
        setState(s);
        if (s.user && s.settings.active) {
          const results = await Promise.allSettled([
            api("/social-accounts"),
            api("/usage"),
          ]);
          if (!active) return;
          if (results[0].status === "fulfilled") {
            const v = results[0].value;
            setAccounts(Array.isArray(v) ? v : v.items || []);
          } else setError(results[0].reason?.message || "账号读取失败");
          if (results[1].status === "fulfilled") setUsage(results[1].value);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, []);
  const open = (page: string) => void openWorkspace(page);
  return (
    <div className="popup-shell">
      <header className="popup-row">
        <strong>好麦</strong>
        <button
          className="popup-icon"
          aria-label="设置"
          onClick={() => open("settings")}
        >
          ⚙
        </button>
      </header>
      {error && (
        <p className="popup-error" role="alert">
          {error}
        </p>
      )}
      {!state ? (
        <p>正在连接…</p>
      ) : !state.user || !state.settings.active ? (
        <>
          <div className="popup-welcome">
            <div className="popup-symbol">麦</div>
            <h2>沟通，从这里开始</h2>
            <p>在电脑接入社交账号，在手机继续对话。</p>
          </div>
          <button className="popup-btn" onClick={() => open("messages")}>
            登录好麦
          </button>
          <button className="popup-secondary" onClick={() => open("mobile")}>
            获取手机 APP
          </button>
        </>
      ) : (
        <>
          <section className="popup-profile">
            <span className="popup-avatar">
              {(state.user.displayName || state.user.phone || "麦").slice(0, 1)}
              <i className={state.connected ? "online" : ""} />
            </span>
            <div>
              <b>{state.user.displayName || state.user.phone}</b>
              <small>{state.connected ? "实时连接正常" : "正在恢复连接"}</small>
            </div>
          </section>
          <section className="popup-accounts">
            {accounts.length ? (
              accounts.slice(0, 2).map((a) => (
                <div className="popup-account" key={a.id}>
                  <span className={`popup-dot ${a.online ? "online" : ""}`} />
                  <div>
                    <b>{a.displayName || a.phone || a.remoteAccountKey}</b>
                    {!a.online && (
                      <small>
                        {a.offlineReason ||
                          "请打开 WhatsApp Web 或检查登录状态"}
                      </small>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <button
                className="popup-link"
                onClick={() =>
                  void chrome.tabs.create({ url: "https://web.whatsapp.com/" })
                }
              >
                打开 WhatsApp，关联社交账号 ›
              </button>
            )}
          </section>
          <div className="popup-grid">
            <button onClick={() => open("messages")}>
              ▤ <span>打开聊天</span>
            </button>
            <button onClick={() => open("categories")}>
              ▦ <span>常用内容</span>
            </button>
            <button onClick={() => open("accounts")}>
              ◎ <span>社交账号</span>
            </button>
            <button onClick={() => open("mobile")}>
              ▯ <span>手机收发</span>
            </button>
          </div>
          <button className="popup-quota" onClick={() => open("plans")}>
            <span>剩余字符</span>
            <strong>{usage?.balance ?? "—"}</strong>
            <span>›</span>
          </button>
          <button className="popup-btn" onClick={() => open("messages")}>
            进入工作台
          </button>
        </>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);
