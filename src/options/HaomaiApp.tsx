import { MediaAttachment } from "../shared/ui/MediaAttachment";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AccountField as Field } from "../shared/ui/AccountField";
import { QRCodeImage as QR } from "../shared/ui/QRCodeImage";
import { api, rpc, saveBackend } from "../shared/haomai/client";
import { passwordError } from "../shared/haomai/password";
import {
  uuidV7,
  type PageResult,
  type ChatMessage,
} from "../shared/haomai/protocol";
import { initializeTheme } from "../shared/ui/theme";
import "./haomai.css";
type Row = Record<string, any>;
async function all(path: string): Promise<PageResult> {
  const items: Row[] = [];
  let total = 0;
  for (let page = 1; page <= 20; page++) {
    const value = await api<any>(
      `${path}${path.includes("?") ? "&" : "?"}page=${page}&pageSize=100`,
    );
    const batch = Array.isArray(value) ? value : value.items || [];
    const fresh = batch.filter((r: Row) => !items.some((x) => x.id === r.id));
    items.push(...fresh);
    total = value.total ?? items.length;
    if (
      !fresh.length ||
      Array.isArray(value) ||
      batch.length < 100 ||
      items.length >= total
    )
      break;
  }
  return { items, total, nextCursor: null };
}

const names: Record<string, string> = {
  messages: "消息",
  accounts: "社交账号",
  categories: "类别与内容",
  customers: "客户",
  roles: "AI 角色",
  plans: "套餐与用量",
  orders: "订单",
  feedback: "意见反馈",
  devices: "在线设备",
  settings: "设置",
  mobile: "手机收发",
  about: "关于好麦",
};
function errorText(e: unknown) {
  return e instanceof Error ? e.message : "操作失败";
}
export function HaomaiApp() {
  const [page, setPage] = useState(
    decodeURIComponent(location.hash.slice(1)) || "messages",
  );
  const [snapshot, setSnapshot] = useState<Row | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Row>({});
  const [selection, setSelection] = useState<Row | null>(null);
  const [modal, setModal] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [publicConfig, setPublicConfig] = useState<Row>({});
  const [sendMediaId, setSendMediaId] = useState("");
  const [sendMediaName, setSendMediaName] = useState("");
  const [sendMediaUrl, setSendMediaUrl] = useState("");
  const [sendMediaKind, setSendMediaKind] = useState<"image" | "audio">(
    "image",
  );
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder>();
  const recordingTimer = useRef<ReturnType<typeof setTimeout>>();
  const currentConversation = useRef<string | null>(null);
  currentConversation.current =
    page === "messages" ? selection?.id || null : null;
  const [auth, setAuth] = useState("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [theme, setTheme] = useState(false);
  const [planType, setPlanType] = useState("monthly");
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const run = async (
    operation: () => Promise<any>,
    after?: (v: any) => void,
  ) => {
    setBusy(true);
    setError("");
    try {
      const v = await operation();
      after?.(v);
      refresh();
      return v;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const navigate = (next: string) => {
    setPage(next);
    location.hash = next;
    setSelection(null);
    setError("");
    setData({});
  };
  useEffect(() => {
    const cb = () => {
      setPage(decodeURIComponent(location.hash.slice(1)) || "messages");
      setSelection(null);
    };
    window.addEventListener("hashchange", cb);
    return () => window.removeEventListener("hashchange", cb);
  }, []);
  useEffect(() => {
    void rpc<Row>("snapshot")
      .then(setSnapshot)
      .catch((e) => setError(errorText(e)));
  }, [version]);
  useEffect(() => {
    void api("/public/config")
      .then(setPublicConfig)
      .catch(() => {});
  }, [snapshot?.settings?.apiBaseUrl]);
  useEffect(() => {
    const listener = (m: any) => {
      if (m?.kind === "HAOMAI_CHANGED") {
        if (m.action === "binding.confirmed")
          setData((current) =>
            current.binding
              ? {
                  ...current,
                  binding: { ...current.binding, status: "confirmed" },
                }
              : current,
          );
        if (m.action === "sync.error")
          setError("部分平台消息同步失败，请稍后重试");
        refresh();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  useEffect(() => {
    if (
      !snapshot?.user ||
      !snapshot.settings.active ||
      ["mobile", "about"].includes(page)
    )
      return;
    let live = true;
    const load = async () => {
      let result: Row = {};
      if (page === "messages") {
        result.conversations = await all("/conversations");
        if (selection)
          result.messages = await api<PageResult<ChatMessage>>(
            `/conversations/${selection.id}/messages?limit=50`,
          );
      } else if (page === "accounts")
        result.list = await all("/social-accounts");
      else if (page === "categories") {
        result.list = await all("/categories");
        if (selection)
          result.contents = await api(`/categories/${selection.id}/contents`);
      } else if (page === "customers") {
        result.list = await all("/customers");
        result.tags = await all("/customer-tags");
        if (selection) {
          result.detail = await api(`/customers/${selection.id}`);
          result.followups = await api(`/customers/${selection.id}/followups`);
        }
      } else if (page === "roles") {
        result.list = await all("/ai-roles");
        result.models = await all("/ai-models");
      } else if (page === "plans") {
        result.list = await all("/plans");
        result.usage = await api("/usage");
      } else if (page === "orders") result.list = await all("/orders");
      else if (page === "feedback") {
        result.list = await all("/feedback");
        if (selection) result.detail = await api(`/feedback/${selection.id}`);
      } else if (page === "devices") result.list = await all("/clients");
      else if (page === "settings") result.me = await api("/me");
      if (live) setData(result);
    };
    void load().catch((e) => {
      if (live) setError(errorText(e));
    });
    return () => {
      live = false;
    };
  }, [page, selection?.id, version, snapshot?.user?.id]);
  const rows = (v: any): Row[] => (Array.isArray(v) ? v : v?.items || []);
  const remove = (path: string, title: string) =>
    setConfirm({ title, operation: () => api(path, "DELETE") });
  const openLink = (value: string) => {
    if (!value) {
      setError("正式地址尚未配置");
      return;
    }
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(url.hostname)
      )
        throw 0;
      void chrome.tabs.create({ url: url.href });
    } catch {
      setError("链接地址无效");
    }
  };
  const submitAuth = (event: FormEvent) => {
    event.preventDefault();
    const passwordValidation = passwordError(password);
    if (passwordValidation) {
      setError(passwordValidation);
      return;
    }
    if (auth !== "login" && password !== repeat) {
      setError("两次密码不一致");
      return;
    }
    void run(async () => {
      await saveBackend({
        active: true,
        apiBaseUrl: snapshot!.settings.apiBaseUrl,
      });
      if (auth === "forgot") {
        await api("/auth/password/reset", "POST", {
          phone,
          password,
          challengeId: challenge,
          code,
        });
        setAuth("login");
        setError("密码已重置，请登录");
      } else
        await rpc(auth, {
          body: {
            phone,
            password,
            ...(auth === "register" ? { challengeId: challenge, code } : {}),
          },
        });
    });
  };
  const showEditor = (kind: string, row: Row = {}) =>
    setModal({ kind, values: { ...row }, new: !row.id });
  const updateModal = (key: string, value: any) =>
    setModal((m: Row | null) =>
      m ? { ...m, values: { ...m.values, [key]: value } } : m,
    );
  const saveEditor = () =>
    void run(async () => {
      if (!modal) return;
      const v = modal.values;
      const kind = modal.kind;
      if (kind === "password") {
        const passwordValidation =
          passwordError(v.oldPassword || "", "当前密码") ||
          passwordError(v.password || "", "新密码");
        if (passwordValidation) throw new Error(passwordValidation);
      }
      if (kind === "category")
        await api(
          v.id ? `/categories/${v.id}` : "/categories",
          v.id ? "PATCH" : "POST",
          { name: v.name },
        );
      if (kind === "content") {
        const keywords = Array.isArray(v.keywords) ? v.keywords : [];
        await api(
          v.id ? `/contents/${v.id}` : "/contents",
          v.id ? "PATCH" : "POST",
          {
            categoryId: selection?.id,
            title: v.title,
            text: v.text,
            imageMediaId: v.imageMediaId || undefined,
            autoReply: !!v.autoReply,
            keywords,
          },
        );
      }
      if (kind === "customer")
        await api(`/customers/${v.id}`, "PATCH", {
          name: v.name,
          notes: v.notes,
          phone: v.phone,
          country: v.country,
          language: v.language,
        });
      if (kind === "followup")
        await api(`/customers/${selection?.id}/followups`, "POST", {
          content: v.content,
          nextContactAt: v.nextContactAt || undefined,
        });
      if (kind === "tag")
        await api("/customer-tags", "POST", {
          name: v.name,
          color: v.color || "#25D366",
        });
      if (kind === "role")
        await api(
          v.id ? `/ai-roles/${v.id}` : "/ai-roles",
          v.id ? "PATCH" : "POST",
          {
            name: v.name,
            systemPrompt: v.systemPrompt,
            modelId: v.modelId,
            active: !!v.active,
          },
        );
      if (kind === "feedback")
        await api("/feedback", "POST", {
          module: v.module || "chrome",
          content: v.content,
          mediaIds: v.mediaIds || [],
        });
      if (kind === "profile") {
        const profile = await api("/me", "PATCH", {
          displayName: v.displayName,
          email: v.email,
          gender: v.gender,
          industry: v.industry,
        });
        setSnapshot((s) => (s ? { ...s, user: profile } : s));
      }
      if (kind === "password")
        await api("/me/password", "PUT", {
          oldPassword: v.oldPassword,
          password: v.password,
        });
      setModal(null);
    });
  const upload = async (file: File, purpose = "content") => {
    const raw = new Uint8Array(await file.arrayBuffer());
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    const { md5 } = await import("../shared/haomai/md5");
    const intent = await api(
      file.type.startsWith("audio/")
        ? "/media/audio/upload-intents"
        : "/media/images/upload-intents",
      "POST",
      {
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        md5Base64: md5(raw),
        sha256: sha,
        purpose: modal?.kind === "feedback" ? "feedback" : purpose,
      },
    );
    const response = await fetch(intent.url, {
      method: intent.method || "PUT",
      headers: intent.headers,
      body: file,
    });
    if (!response.ok) throw new Error("OSS 上传失败");
    return api(`/media/${intent.mediaId}/complete`, "POST", {});
  };
  const toggleRecording = async () => {
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      return;
    }
    const targetConversation = currentConversation.current;
    try {
      if (
        !(await chrome.permissions.request({ permissions: ["audioCapture"] }))
      )
        throw new Error("需要麦克风权限");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (currentConversation.current !== targetConversation) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("会话已切换，录音已取消");
      }
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/webm",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const record = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      recorder.current = record;
      const chunks: BlobPart[] = [];
      record.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      record.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordingTimer.current) clearTimeout(recordingTimer.current);
        setRecording(false);
        if (currentConversation.current !== targetConversation) {
          setError("会话已切换，录音已取消");
          return;
        }
        const blob = new Blob(chunks, { type: record.mimeType.split(";")[0] });
        const file = new File([blob], `voice-${Date.now()}.webm`, {
          type: blob.type,
        });
        void run(
          () => upload(file, "message"),
          (m) => {
            if (currentConversation.current !== targetConversation) {
              setError("会话已切换，录音未附加");
              return;
            }
            setSendMediaId(m.id);
            setSendMediaName("语音消息");
            setSendMediaKind("audio");
            setSendMediaUrl(URL.createObjectURL(blob));
          },
        );
      };
      record.start();
      setRecording(true);
      recordingTimer.current = setTimeout(() => {
        if (record.state === "recording") record.stop();
      }, 60000);
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(
    () => () => {
      const active = recorder.current;
      if (active) {
        active.onstop = null;
        if (active.state === "recording") active.stop();
        active.stream.getTracks().forEach((t) => t.stop());
      }
      if (recordingTimer.current) clearTimeout(recordingTimer.current);
    },
    [],
  );
  useEffect(
    () => () => {
      if (sendMediaUrl.startsWith("blob:")) URL.revokeObjectURL(sendMediaUrl);
    },
    [sendMediaUrl],
  );
  if (!snapshot)
    return (
      <main className="hm-auth">
        正在连接扩展后台…{error && <p role="alert">{error}</p>}
      </main>
    );
  if (!snapshot.user && page === "mobile")
    return (
      <main className="hm-auth">
        <div className="hm-brand">好麦</div>
        <section className="hm-card hm-mobile">
          <h2>在手机上继续沟通</h2>
          <p>下载好麦 APP，登录同一账号，即可统一收发消息。</p>
          <button onClick={() => openLink(publicConfig.websiteUrl)}>
            访问官网
          </button>
          <button
            className="hm-primary hm-wide"
            onClick={() => openLink(publicConfig.appDownloadUrl)}
          >
            下载 APP
          </button>
          <button className="hm-link" onClick={() => navigate("messages")}>
            登录好麦
          </button>
          {error && <p className="hm-error">{error}</p>}
        </section>
      </main>
    );
  if (!snapshot.user || !snapshot.settings.active)
    return (
      <main className="hm-auth">
        <div className="hm-brand">
          好麦<span>让沟通更简单</span>
        </div>
        <section className="hm-card">
          <h1>
            {auth === "login"
              ? "欢迎回来"
              : auth === "register"
                ? "注册账号"
                : "重置密码"}
          </h1>
          {error && (
            <p role="alert" className="hm-error">
              {error}
            </p>
          )}
          <form onSubmit={submitAuth}>
            <Field label="手机号" value={phone} onChange={setPhone} />
            <Field
              label="密码"
              value={password}
              onChange={setPassword}
              password
            />
            {auth !== "login" && (
              <>
                <Field
                  label="确认密码"
                  value={repeat}
                  onChange={setRepeat}
                  password
                />
                <div className="hm-inline">
                  <Field label="验证码" value={code} onChange={setCode} code />
                  <button
                    type="button"
                    disabled={busy || !phone}
                    onClick={() =>
                      void run(
                        async () => {
                          await saveBackend({
                            active: true,
                            apiBaseUrl: snapshot.settings.apiBaseUrl,
                          });
                          return api("/auth/challenges", "POST", {
                            phone,
                            purpose:
                              auth === "register"
                                ? "register"
                                : "reset_password",
                          });
                        },
                        (r) => setChallenge(r.challengeId),
                      )
                    }
                  >
                    获取验证码
                  </button>
                </div>
              </>
            )}
            <button className="hm-primary hm-wide" disabled={busy}>
              {busy
                ? "处理中…"
                : auth === "login"
                  ? "登录"
                  : auth === "register"
                    ? "注册并登录"
                    : "重置密码"}
            </button>
            <div className="hm-between">
              <button
                type="button"
                className="hm-link"
                onClick={() => {
                  setAuth(auth === "login" ? "forgot" : "login");
                  setError("");
                }}
              >
                {auth === "login" ? "忘记密码" : "返回登录"}
              </button>
              <button
                type="button"
                className="hm-link"
                onClick={() => {
                  setAuth(auth === "register" ? "login" : "register");
                  setError("");
                }}
              >
                {auth === "register" ? "已有账号？登录" : "还没账号？注册账号"}
              </button>
            </div>
          </form>
        </section>
      </main>
    );
  return (
    <div className="hm-layout">
      <aside className="hm-sidebar">
        <div className="hm-brand">
          好麦<small>{snapshot.user.displayName || snapshot.user.phone}</small>
        </div>
        <nav>
          {Object.entries(names).map(([key, name]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => navigate(key)}
            >
              {name}
            </button>
          ))}
        </nav>
        <small>
          <span className={`hm-dot ${snapshot.connected ? "online" : ""}`} />{" "}
          {snapshot.connected ? "实时连接正常" : "正在恢复连接"}
        </small>
      </aside>
      <main className="hm-main">
        <header>
          <div>
            <h1>{names[page] || "好麦"}</h1>
          </div>
          <button className="hm-icon" title="刷新" onClick={refresh}>
            ↻
          </button>
        </header>
        {error && (
          <p className="hm-error" role="alert">
            {error}
          </p>
        )}
        {!!snapshot.syncFailures?.length && (
          <section className="hm-error">
            <span>
              {snapshot.syncFailures.length} 条媒体消息待同步。请打开对应
              WhatsApp 会话后重试。
            </span>
            <button
              disabled={busy}
              onClick={() => void run(() => rpc("retrySync"))}
            >
              重试同步
            </button>
          </section>
        )}
        {page === "accounts" && (
          <>
            {!rows(data.list).length && (
              <div className="hm-empty">
                在此浏览器打开 WhatsApp Web，登录后账号会自动关联。
                <button
                  onClick={() =>
                    void chrome.tabs.create({
                      url: "https://web.whatsapp.com/",
                    })
                  }
                >
                  打开 WhatsApp
                </button>
              </div>
            )}
            {rows(data.list).map((a) => (
              <section className="hm-card hm-between" key={a.id}>
                <div>
                  <strong>
                    <span className={`hm-dot ${a.online ? "online" : ""}`} />
                    {a.displayName || a.phone || a.remoteAccountKey}
                  </strong>
                  <p>{a.platform}</p>
                  {!a.online && (
                    <small>
                      {a.offlineReason || "请打开 WhatsApp Web 并检查登录状态"}
                    </small>
                  )}
                </div>
                <div>
                  <button
                    onClick={() =>
                      setModal({ kind: "account-detail", values: a })
                    }
                  >
                    详情
                  </button>
                  <button
                    onClick={() =>
                      remove(`/social-accounts/${a.id}`, "解绑此社交账号？")
                    }
                  >
                    解绑
                  </button>
                </div>
              </section>
            ))}
          </>
        )}
        {page === "messages" && (
          <div className="hm-split">
            <section>
              {rows(data.conversations).map((c) => (
                <button
                  className={`hm-row ${selection?.id === c.id ? "selected" : ""}`}
                  key={c.id}
                  onClick={() => {
                    setSelection(c);
                    setSendMediaId("");
                    setSendMediaName("");
                    setSendMediaUrl("");
                    void api(`/conversations/${c.id}/read`, "POST", {}).catch(
                      () => {},
                    );
                  }}
                >
                  <strong>{c.title || "未命名客户"}</strong>
                  <small>
                    {c.lastMessage?.originalText || c.lastMessage?.text || ""}
                  </small>
                  {c.unreadCount > 0 && <b>{c.unreadCount}</b>}
                </button>
              ))}
              {!rows(data.conversations).length && (
                <div className="hm-empty">
                  暂无会话
                  <button onClick={() => navigate("accounts")}>
                    连接社交账号
                  </button>
                </div>
              )}
            </section>
            <section>
              {selection ? (
                <>
                  <h3>{selection.title}</h3>
                  {data.messages?.nextCursor && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          setBusy(true);
                          try {
                            const older = await api(
                              `/conversations/${selection.id}/messages?limit=50&cursor=${encodeURIComponent(data.messages.nextCursor)}`,
                            );
                            setData((current) => ({
                              ...current,
                              messages: {
                                ...older,
                                items: [
                                  ...rows(current.messages),
                                  ...rows(older),
                                ].filter(
                                  (row, index, all) =>
                                    all.findIndex(
                                      (item) => item.id === row.id,
                                    ) === index,
                                ),
                              },
                            }));
                          } catch (e) {
                            setError(errorText(e));
                          } finally {
                            setBusy(false);
                          }
                        })()
                      }
                    >
                      更早的消息
                    </button>
                  )}
                  <div className="hm-chat">
                    {rows(data.messages)
                      .slice()
                      .reverse()
                      .map((m) => (
                        <article
                          className={`hm-bubble ${["outgoing", "outbound"].includes(m.direction) ? "outbound" : ""}`}
                          key={m.id}
                        >
                          {m.originalText || m.text}
                          {m.translatedText && <p>{m.translatedText}</p>}
                          {m.attachments?.map((a: Row) => (
                            <MediaAttachment key={a.id} media={a} />
                          ))}
                          <small>{m.sendState}</small>
                        </article>
                      ))}
                  </div>
                  <form
                    className="hm-composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const text = String(f.get("text") || "");
                      const submittedConversation = selection.id;
                      if (!text.trim() && !sendMediaId) return;
                      void run(
                        () =>
                          api("/messages", "POST", {
                            conversationId: selection.id,
                            sourceAccountId: selection.sourceAccountId,
                            kind: sendMediaId ? sendMediaKind : "text",
                            text,
                            mediaIds: sendMediaId ? [sendMediaId] : undefined,
                            targetLanguage: f.get("language"),
                            idempotencyKey: uuidV7(),
                          }),
                        () => {
                          if (
                            currentConversation.current !==
                            submittedConversation
                          )
                            return;
                          (
                            document.getElementById(
                              "hm-reply",
                            ) as HTMLTextAreaElement
                          ).value = "";
                          setSendMediaId("");
                          setSendMediaName("");
                          setSendMediaUrl("");
                        },
                      );
                    }}
                  >
                    <textarea
                      key={selection.id}
                      id="hm-reply"
                      name="text"
                      placeholder="输入消息"
                    />
                    {sendMediaId && (
                      <div className="hm-between">
                        <small>
                          {sendMediaName}
                          {sendMediaKind === "audio" && sendMediaUrl && (
                            <audio controls src={sendMediaUrl} />
                          )}
                        </small>
                        <button
                          type="button"
                          onClick={() => {
                            setSendMediaId("");
                            setSendMediaName("");
                            setSendMediaUrl("");
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                    <div className="hm-between">
                      <label
                        className="hm-upload hm-upload-small"
                        aria-label="附加图片"
                      >
                        ＋
                        <input
                          disabled={busy}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            const targetConversation =
                              currentConversation.current;
                            if (file)
                              void run(
                                () => upload(file, "message"),
                                (m) => {
                                  if (
                                    currentConversation.current !==
                                    targetConversation
                                  ) {
                                    setError("会话已切换，图片未附加");
                                    return;
                                  }
                                  setSendMediaId(m.id);
                                  setSendMediaName(file.name);
                                  setSendMediaKind("image");
                                  setSendMediaUrl(URL.createObjectURL(file));
                                },
                              );
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={recording ? "结束录音" : "录音"}
                        onClick={() => void toggleRecording()}
                      >
                        {recording ? "■" : "♩"}
                      </button>
                      <select
                        name="language"
                        key={selection.id}
                        defaultValue={selection.replyLanguage || "es"}
                      >
                        <option value="original">原文</option>
                        <option value="es">西班牙语</option>
                        <option value="en">英语</option>
                        <option value="zh-CN">中文</option>
                      </select>
                      <button className="hm-primary" disabled={busy}>
                        发送
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="hm-empty">选择会话</div>
              )}
            </section>
          </div>
        )}
        {page === "categories" && (
          <>
            {!selection ? (
              <>
                <div className="hm-actions">
                  <button
                    className="hm-icon"
                    aria-label="新增类别"
                    onClick={() => showEditor("category")}
                  >
                    ＋
                  </button>
                </div>
                {rows(data.list).map((c, i) => (
                  <div
                    className="hm-row hm-between"
                    draggable
                    key={c.id}
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", c.id)
                    }
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const list = rows(data.list).map((r) => r.id);
                      const from = list.indexOf(
                        e.dataTransfer.getData("text/plain"),
                      );
                      if (from < 0) return;
                      const [id] = list.splice(from, 1);
                      list.splice(i, 0, id);
                      void run(() =>
                        api("/categories/reorder", "POST", { ids: list }),
                      );
                    }}
                  >
                    <button
                      className="hm-link hm-grow"
                      onClick={() => setSelection(c)}
                    >
                      {c.name}
                      <span>›</span>
                    </button>
                    <button
                      className="hm-grab"
                      aria-label={`移动${c.name}`}
                      onKeyDown={(e) => {
                        if (e.key !== "ArrowUp" && e.key !== "ArrowDown")
                          return;
                        e.preventDefault();
                        const list = rows(data.list).map((r) => r.id);
                        const next = Math.max(
                          0,
                          Math.min(
                            list.length - 1,
                            i + (e.key === "ArrowUp" ? -1 : 1),
                          ),
                        );
                        [list[i], list[next]] = [list[next], list[i]];
                        void run(() =>
                          api("/categories/reorder", "POST", { ids: list }),
                        );
                      }}
                    >
                      ⠿
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <>
                <div className="hm-between">
                  <button onClick={() => setSelection(null)}>
                    ‹ {selection.name}
                  </button>
                  <div>
                    {!selection.definitionId && (
                      <button onClick={() => showEditor("category", selection)}>
                        编辑类别
                      </button>
                    )}
                    <button
                      className="hm-icon"
                      aria-label="新增内容"
                      onClick={() =>
                        showEditor("content", {
                          categoryId: selection.id,
                          keywords: [],
                          autoReply: false,
                        })
                      }
                    >
                      ＋
                    </button>
                    {!selection.definitionId && (
                      <button
                        onClick={() =>
                          remove(`/categories/${selection.id}`, "删除此类别？")
                        }
                      >
                        删除类别
                      </button>
                    )}
                  </div>
                </div>
                {rows(data.contents).map((c) => (
                  <button
                    className="hm-row hm-between"
                    key={c.id}
                    onClick={() =>
                      setModal({ kind: "content-detail", values: c })
                    }
                  >
                    <strong>{c.title}</strong>
                    <span>›</span>
                  </button>
                ))}
              </>
            )}
          </>
        )}
        {page === "customers" && (
          <>
            {!selection ? (
              <>
                <div className="hm-actions">
                  <button onClick={() => showEditor("tag")}>新建标签</button>
                </div>
                {rows(data.list).map((c) => (
                  <button
                    className="hm-row"
                    key={c.id}
                    onClick={() => setSelection(c)}
                  >
                    <strong>
                      {c.displayName || c.name || c.phone || "客户"}
                    </strong>
                    <small>{c.notes}</small>
                  </button>
                ))}
              </>
            ) : (
              <>
                <button onClick={() => setSelection(null)}>‹ 客户列表</button>
                <section className="hm-card">
                  <div className="hm-between">
                    <h3>
                      {data.detail?.displayName ||
                        data.detail?.name ||
                        selection.displayName}
                    </h3>
                    <button
                      onClick={() =>
                        showEditor("customer", data.detail || selection)
                      }
                    >
                      编辑
                    </button>
                  </div>
                  <p>{data.detail?.notes}</p>
                  <div className="hm-tags">
                    {rows(data.tags).map((t) => (
                      <label key={t.id}>
                        <input
                          type="checkbox"
                          checked={(data.detail?.tagIds || []).some(
                            (a: any) => (a.id || a) === t.id,
                          )}
                          onChange={(e) => {
                            const ids = (data.detail?.tagIds || [])
                              .map((a: any) => a.id || a)
                              .filter((id: string) => id !== t.id);
                            if (e.target.checked) ids.push(t.id);
                            void run(() =>
                              api(`/customers/${selection.id}/tags`, "PUT", {
                                tagIds: ids,
                              }),
                            );
                          }}
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </section>
                <div className="hm-between">
                  <h3>跟进记录</h3>
                  <button onClick={() => showEditor("followup")}>＋</button>
                </div>
                {rows(data.followups).map((f) => (
                  <article className="hm-card" key={f.id}>
                    {f.content}
                    <small>{f.nextContactAt || f.createdAt}</small>
                  </article>
                ))}
              </>
            )}
          </>
        )}
        {page === "roles" && (
          <>
            <div className="hm-actions">
              <button onClick={() => showEditor("role", { active: true })}>
                ＋
              </button>
            </div>
            {rows(data.list).map((r) => (
              <section className="hm-card" key={r.id}>
                <div className="hm-between">
                  <strong>{r.name}</strong>
                  <div>
                    <button onClick={() => showEditor("role", r)}>编辑</button>
                    <button
                      onClick={() =>
                        remove(`/ai-roles/${r.id}`, "删除此 AI 角色？")
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>
                <p>{r.systemPrompt}</p>
              </section>
            ))}
          </>
        )}
        {page === "plans" && (
          <>
            <section className="hm-card">
              <h3>剩余额度</h3>
              <div className="hm-stat">{data.usage?.balance ?? "—"}</div>
              <small>已使用 {data.usage?.usedCharacters ?? 0} 字符</small>
            </section>
            <div className="hm-segment" role="tablist" aria-label="套餐类型">
              {[
                ["monthly", "月付"],
                ["yearly", "年付"],
                ["pack", "字符包"],
              ].map(([type, label]) => (
                <button
                  key={type}
                  role="tab"
                  aria-selected={planType === type}
                  onClick={() => setPlanType(type)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="hm-plan-grid">
              {rows(data.list)
                .filter((p) => p.billingType === planType)
                .map((p) => (
                  <section className="hm-card" key={p.id}>
                    <h3>{p.name}</h3>
                    <strong className="hm-stat">
                      ¥ {p.discountPrice || p.originalPrice || p.price}
                    </strong>
                    <p>
                      {p.characters || p.grantedCharacters || p.characterQuota}{" "}
                      字符
                    </p>
                    {p.grantMonths === 12 && <small>按月发放额度</small>}
                    <button
                      className="hm-primary"
                      onClick={() =>
                        setConfirm({
                          title: `确认订购 ${p.name}？`,
                          operation: () =>
                            api("/orders", "POST", {
                              planId: p.id,
                              idempotencyKey: uuidV7(),
                            }),
                          after: () => navigate("orders"),
                        })
                      }
                    >
                      选择套餐
                    </button>
                  </section>
                ))}
            </div>
            {!rows(data.list).filter((p) => p.billingType === planType)
              .length && <div className="hm-empty">暂无已上架套餐</div>}
            {!!data.usage?.subscriptions?.length && (
              <section className="hm-card">
                <h3>我的订阅</h3>
                {data.usage.subscriptions.map((subscription: Row) => (
                  <div className="hm-row hm-between" key={subscription.id}>
                    <span>{subscription.planSnapshot?.name}</span>
                    <small>
                      {subscription.status} ·{" "}
                      {new Date(subscription.endsAt).toLocaleDateString()}
                    </small>
                  </div>
                ))}
              </section>
            )}
            {!!data.usage?.ledgers?.length && (
              <details className="hm-card">
                <summary>用量明细</summary>
                {data.usage.ledgers.map((entry: Row) => (
                  <div className="hm-row hm-between" key={entry.id}>
                    <small>{new Date(entry.createdAt).toLocaleString()}</small>
                    <span>
                      {entry.entryType} {entry.characterDelta > 0 ? "+" : ""}
                      {entry.characterDelta}
                    </span>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
        {page === "orders" &&
          rows(data.list).map((o) => (
            <section className="hm-card" key={o.id}>
              <div className="hm-between">
                <strong>
                  {o.planName || o.planSnapshot?.name || o.orderNumber || o.id}
                </strong>
                <b>{o.status}</b>
              </div>
              <p>¥ {o.payableAmount || o.amount || o.totalAmount}</p>
              {o.status === "pending" && (
                <>
                  <small>等待支付。支付渠道未配置时请联系管理员。</small>
                  <button
                    onClick={() =>
                      void run(() => api(`/orders/${o.id}/cancel`, "POST", {}))
                    }
                  >
                    取消订单
                  </button>
                </>
              )}
            </section>
          ))}
        {page === "feedback" && (
          <>
            {!selection ? (
              <>
                <div className="hm-actions">
                  <button
                    className="hm-icon"
                    aria-label="添加反馈"
                    onClick={() => showEditor("feedback", { module: "chrome" })}
                  >
                    ＋
                  </button>
                </div>
                {rows(data.list).map((f) => (
                  <button
                    className="hm-row"
                    key={f.id}
                    onClick={() => setSelection(f)}
                  >
                    <strong>{f.content}</strong>
                    <small>{f.status}</small>
                  </button>
                ))}
              </>
            ) : (
              <section className="hm-card">
                <button onClick={() => setSelection(null)}>‹ 返回</button>
                <p>{data.detail?.content}</p>
                {data.detail?.images?.map((m: Row) => (
                  <img
                    key={m.id}
                    className="hm-thumb"
                    src={m.url}
                    alt="反馈图片"
                  />
                ))}
                {data.detail?.replies?.map((r: Row) => (
                  <article className="hm-reply" key={r.id}>
                    {r.content}
                  </article>
                ))}
              </section>
            )}
          </>
        )}
        {page === "devices" &&
          rows(data.list).map((c) => (
            <section key={c.id} className="hm-card hm-between">
              <div>
                <strong>{c.name || c.platform || c.type}</strong>
                <small>{c.lastSeenAt || c.lastActiveAt}</small>
              </div>
              <button
                disabled={c.id === snapshot.clientId}
                onClick={() => remove(`/clients/${c.id}`, "退出此设备？")}
              >
                退出设备
              </button>
            </section>
          ))}
        {page === "settings" && (
          <>
            <section className="hm-card">
              <button
                className="hm-row"
                onClick={() => showEditor("profile", data.me || snapshot.user)}
              >
                个人资料 <span>›</span>
              </button>
              <button className="hm-row" onClick={() => showEditor("password")}>
                修改密码 <span>›</span>
              </button>
              <button className="hm-row" onClick={() => setTheme(true)}>
                深色模式 <span>›</span>
              </button>
              <button className="hm-row" onClick={() => navigate("about")}>
                关于好麦 <span>›</span>
              </button>
            </section>
            <button
              className="hm-danger hm-wide"
              onClick={() =>
                setConfirm({
                  title: "退出好麦账号？",
                  operation: () => rpc("logout"),
                })
              }
            >
              退出登录
            </button>
          </>
        )}
        {page === "mobile" && (
          <section className="hm-card hm-mobile">
            <h2>在手机上继续沟通</h2>
            <p>下载好麦 APP，登录同一账号，即可统一收发消息。</p>
            <div className="hm-inline">
              <button onClick={() => openLink(publicConfig.websiteUrl)}>
                访问官网
              </button>
              <button
                className="hm-primary"
                onClick={() => openLink(publicConfig.appDownloadUrl)}
              >
                下载 APP
              </button>
            </div>
            <hr />
            <button
              onClick={() =>
                void run(
                  () => api("/bindings/challenges", "POST", {}),
                  (r) => setData((d) => ({ ...d, binding: r })),
                )
              }
            >
              显示绑定二维码
            </button>
            {data.binding && (
              <>
                <QR content={data.binding.qrContent} />
                <small>
                  有效期至{" "}
                  {new Date(data.binding.expiresAt).toLocaleTimeString()}
                </small>
                <button
                  onClick={() =>
                    void run(
                      () => api(`/bindings/challenges/${data.binding.id}`),
                      (r) =>
                        setData((d) => ({
                          ...d,
                          binding: { ...d.binding, ...r },
                        })),
                    )
                  }
                >
                  检查绑定状态
                </button>
                <p>
                  {data.binding.status === "confirmed"
                    ? "绑定成功"
                    : data.binding.status === "expired"
                      ? "二维码已过期，请重新生成"
                      : "使用同一好麦账号的 APP 扫码"}
                </p>
              </>
            )}
          </section>
        )}
        {page === "about" && (
          <section className="hm-card hm-mobile">
            <div className="hm-logo">麦</div>
            <h2>好麦</h2>
            <p>版本 {chrome.runtime.getManifest().version}</p>
            <button
              onClick={() =>
                void run(
                  () => api("/public/config"),
                  (r) =>
                    setError(
                      r.latestAppVersion
                        ? `服务端发布版本 ${r.latestAppVersion}`
                        : "更新服务尚未配置",
                    ),
                )
              }
            >
              检查更新
            </button>
          </section>
        )}
      </main>
      {confirm && (
        <div className="hm-overlay">
          <section className="hm-dialog">
            <h3>{confirm.title}</h3>
            <div className="hm-actions">
              <button onClick={() => setConfirm(null)}>取消</button>
              <button
                className="hm-primary"
                disabled={busy}
                onClick={() =>
                  void run(confirm.operation, () => {
                    confirm.after?.();
                    setConfirm(null);
                  })
                }
              >
                确认
              </button>
            </div>
          </section>
        </div>
      )}
      {theme && (
        <div className="hm-overlay" onClick={() => setTheme(false)}>
          <section className="hm-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>深色模式</h3>
            {[
              ["dark", "深色模式"],
              ["light", "浅色模式"],
              ["system", "跟随系统"],
            ].map(([mode, label]) => (
              <button
                key={mode}
                className="hm-row"
                onClick={() => {
                  void initializeTheme().set(mode as any);
                  setTheme(false);
                }}
              >
                {label}
              </button>
            ))}
          </section>
        </div>
      )}
      {modal && (
        <div className="hm-overlay">
          <section className="hm-dialog">
            <div className="hm-between">
              <h3>
                {modal.kind === "content-detail"
                  ? modal.values.title
                  : modal.kind === "account-detail"
                    ? "社交账号详情"
                    : "编辑"}
              </h3>
              <button
                className="hm-icon"
                aria-label="关闭"
                onClick={() => setModal(null)}
              >
                ×
              </button>
            </div>
            {modal.kind === "content-detail" ? (
              <>
                <p>{modal.values.text}</p>
                {modal.values.imageUrl && (
                  <img
                    className="hm-thumb"
                    src={modal.values.imageUrl}
                    alt="内容图片"
                  />
                )}
                <p>
                  {modal.values.keywords?.map((k: Row) => k.text).join("、")}
                </p>
                <label className="hm-switch">
                  <input
                    type="checkbox"
                    checked={!!modal.values.autoReply}
                    onChange={(e) =>
                      void run(
                        () =>
                          api(`/contents/${modal.values.id}`, "PATCH", {
                            autoReply: e.target.checked,
                          }),
                        () => setModal(null),
                      )
                    }
                  />
                  自动回复
                </label>
                <div className="hm-actions">
                  <button onClick={() => showEditor("content", modal.values)}>
                    编辑
                  </button>
                  <button
                    onClick={() => {
                      remove(`/contents/${modal.values.id}`, "删除此内容？");
                      setModal(null);
                    }}
                  >
                    删除
                  </button>
                </div>
              </>
            ) : modal.kind === "account-detail" ? (
              <section>
                <h3>
                  {modal.values.displayName ||
                    modal.values.phone ||
                    modal.values.remoteAccountKey}
                </h3>
                <p>{modal.values.platform}</p>
                <small>{modal.values.remoteAccountKey}</small>
                <p>导入最近100条消息，保留原文</p>
                <button
                  className="hm-primary"
                  disabled={busy || snapshot.importStatus?.state === "reading"}
                  onClick={() =>
                    void run(() =>
                      rpc("importRecent", { sourceAccountId: modal.values.id }),
                    )
                  }
                >
                  导入最近消息
                </button>
                {snapshot.importStatus?.sourceAccountId === modal.values.id && (
                  <p>
                    {snapshot.importStatus.state === "reading"
                      ? "正在读取 WhatsApp 最近消息…"
                      : snapshot.importStatus.state === "failed"
                        ? "读取失败，请确认登录来源账号并打开 WhatsApp 会话后重试"
                        : `已读取 ${snapshot.importStatus.readCount} 条原文${snapshot.importStatus.failedCount ? `，${snapshot.importStatus.failedCount} 条媒体待重试` : ""}`}
                  </p>
                )}
              </section>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveEditor();
                }}
              >
                {(
                  {
                    category: ["name"],
                    content: ["title", "text"],
                    customer: ["name", "phone", "country", "language", "notes"],
                    followup: ["content", "nextContactAt"],
                    tag: ["name", "color"],
                    role: ["name", "systemPrompt"],
                    feedback: ["content"],
                    profile: ["displayName", "email", "gender", "industry"],
                    password: ["oldPassword", "password"],
                  } as Record<string, string[]>
                )[modal.kind]?.map((key) =>
                  ["text", "notes", "content", "systemPrompt"].includes(key) ? (
                    <label className="hm-field" key={key}>
                      <span>
                        {
                          (
                            {
                              text: "正文",
                              notes: "备注",
                              content: "内容",
                              systemPrompt: "角色提示词",
                            } as Row
                          )[key]
                        }
                      </span>
                      <textarea
                        value={modal.values[key] || ""}
                        onChange={(e) => updateModal(key, e.target.value)}
                        required={key !== "notes"}
                      />
                    </label>
                  ) : (
                    <Field
                      key={key}
                      label={
                        (
                          {
                            name: "名称",
                            title: "标题",
                            displayName: "名称",
                            phone: "手机号",
                            email: "邮箱",
                            nextContactAt: "下次联系时间（UTC）",
                            color: "颜色",
                            gender: "性别",
                            industry: "行业",
                            country: "国家",
                            language: "语言",
                            oldPassword: "当前密码",
                            password: "新密码",
                          } as Row
                        )[key] || key
                      }
                      value={modal.values[key] || ""}
                      onChange={(value) => updateModal(key, value)}
                      password={key.toLowerCase().includes("password")}
                    />
                  ),
                )}
                {modal.kind === "content" && (
                  <>
                    <label className="hm-switch">
                      <input
                        type="checkbox"
                        checked={!!modal.values.autoReply}
                        onChange={(e) =>
                          updateModal("autoReply", e.target.checked)
                        }
                      />
                      自动回复
                    </label>
                    <label className="hm-field">
                      <span>关键词（每行一个）</span>
                      <textarea
                        value={(modal.values.keywords || [])
                          .map((k: Row) => k.text)
                          .join("\n")}
                        onChange={(e) =>
                          updateModal(
                            "keywords",
                            e.target.value
                              .split("\n")
                              .map((text) => ({ text, active: true })),
                          )
                        }
                      />
                    </label>
                    <div className="hm-tags">
                      {(modal.values.keywords || []).map(
                        (k: Row, i: number) => (
                          <label key={i}>
                            <input
                              type="checkbox"
                              checked={k.active}
                              onChange={(e) =>
                                updateModal(
                                  "keywords",
                                  modal.values.keywords.map(
                                    (kw: Row, index: number) =>
                                      index === i
                                        ? { ...kw, active: e.target.checked }
                                        : kw,
                                  ),
                                )
                              }
                            />
                            {k.text}
                          </label>
                        ),
                      )}
                    </div>
                  </>
                )}
                {modal.kind === "content" && modal.values.imageMediaId && (
                  <div className="hm-between">
                    <small>已附加图片</small>
                    <button
                      type="button"
                      onClick={() => {
                        updateModal("imageMediaId", "");
                        updateModal("imageUrl", "");
                      }}
                    >
                      移除图片
                    </button>
                  </div>
                )}
                {["content", "feedback"].includes(modal.kind) && (
                  <label className="hm-upload">
                    ＋
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void run(
                            () => upload(file),
                            (m) => {
                              updateModal(
                                modal.kind === "feedback"
                                  ? "mediaIds"
                                  : "imageMediaId",
                                modal.kind === "feedback"
                                  ? [...(modal.values.mediaIds || []), m.id]
                                  : m.id,
                              );
                            },
                          );
                      }}
                    />
                    <span>
                      {modal.values.imageMediaId
                        ? "已添加图片"
                        : modal.values.mediaIds?.length
                          ? `${modal.values.mediaIds.length} 张图片`
                          : ""}
                    </span>
                  </label>
                )}
                {modal.kind === "role" && (
                  <>
                    <label className="hm-field">
                      <span>模型</span>
                      <select
                        value={modal.values.modelId || ""}
                        onChange={(e) => updateModal("modelId", e.target.value)}
                        required
                      >
                        <option value="">请选择</option>
                        {rows(data.models).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="hm-switch">
                      <input
                        type="checkbox"
                        checked={!!modal.values.active}
                        onChange={(e) =>
                          updateModal("active", e.target.checked)
                        }
                      />
                      启用
                    </label>
                  </>
                )}
                <button className="hm-primary hm-wide" disabled={busy}>
                  {modal.kind === "feedback" ? "提交反馈" : "保存"}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
