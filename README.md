# 好麦 Chrome 扩展

启动和发布请先看：[本地调试](docs/LOCAL_DEBUG.md) · [上线部署与商店发布](docs/DEPLOYMENT.md) · [少量同事试用打包](docs/packaging.md)。四仓库公共入口见[好麦工程指南](../haomai-go/docs/guides/README.md)。

当前使用好麦后台业务模式：扩展连接 Go API，完成登录、来源账号关联、消息同步与工作台操作。API 地址由维护者在构建时统一设置，当前登录、注册、找回密码和设置页不提供服务器配置或独立模式切换入口。旧版直接连接 AI 供应商的代码与存储保留兼容；下面的旧版翻译说明用于理解历史功能与数据，不是当前工作台的操作步骤。

A hilariously vibe-coded Chrome extension that adds **two-way AI translation** and **local foreign-trade reply assistance** to WhatsApp Web. Configure both participants' native languages once — outgoing messages are translated before they're sent, incoming messages are translated as they arrive. Originals remain visible locally for verification and are not included in outgoing messages.

> If this saves you time talking to people across languages, please consider [sponsoring my work](https://purpshell.dev/sponsor) so I can keep maintaining it.

## What it does

- **Outgoing**: type in your native language → click WhatsApp's send button or press Enter → translate once and send only the translation. Typing does not call the AI. Your exact typed original appears beneath the sent message, locally. It is never added to the WhatsApp message body. Translation/local-original storage failures stop the send instead of silently sending untranslated text. Chinese business drafts, including product media captions, stay in Chinese for manual review and translate the final edits only on Send. Business drafts already prepared in Spanish are sent without a second translation.
- **Incoming**: each received original remains unchanged, with your native-language translation displayed beneath it. Text messages and media captions are handled when their bubbles become visible; media without captions and quoted snippets are skipped. Translation errors have a local retry button.
- **Copy local text**: select the translation or saved original below a message, then use the browser's Copy command or the usual keyboard shortcut. The selected local text is copied directly; no extra copy button is shown.
- **Payment meaning**: translation preserves payment obstacles and their stated causes. An unspecified inability to pay is kept neutral; it is not turned into an inability to afford the product. Explicit insufficient funds are still translated faithfully. Built-in rule changes invalidate translation caches while preserving saved sent originals.
- **Message appearance**: the original message keeps WhatsApp's native styling. A thin solid horizontal line separates the local native-language text below it, rendered in wine red (`#800020` in light mode; a lighter wine shade in dark mode). There are no visible language headings, arrow annotations or extra message bubbles. Hover/accessibility text distinguishes saved originals from reverse translations.
- **Revisit history**: sent originals and received translations persist in extension-local storage, keyed by WhatsApp message ID. Refreshing, switching chats or scrolling history restores the local annotations. Edited text and language/provider/prompt changes invalidate translation cache entries. Already-sent messages without a saved original get a reverse translation, identified in the hover/accessibility text, not a claimed reconstruction of your input.
- **Global language settings**: configure **My native language** and **Other person's native language** once in the extension options. Outgoing and incoming messages use the two saved languages automatically.
- **Configurable AI**: DeepSeek, Anthropic Claude, OpenAI GPT, or Google Gemini. Bring your own API key.
- **Configurable translation context**: Options → 设置 → 翻译场景与提示词 includes an editable foreign-trade scene for Chinese sellers and Mexican customers, plus the existing style guidance. The scene applies to the selected target language, including Mexican Spanish or business English. Save scene edits explicitly to apply them; typing does not request translations. Existing installations inherit the default scene without replacing their style guidance or language settings.

独立模式的供应商 API Key 保存在 `chrome.storage.local`，翻译直接请求所选供应商。好麦后台模式将账号、消息及业务操作提交已配置的 Go API，媒体通过服务端授权上传 OSS，AI 凭据留在服务端；登录令牌持久保存在扩展 Origin 的 IndexedDB，仅在可信扩展上下文缓存于 `chrome.storage.session`。

## 旧版外贸回复功能（兼容说明）

设置页采用六个顶部标签：设置、商品、支付方式、物流、信任与保障、常用语。设置页的标题、语言列表和帮助说明使用中文；首次配置默认我的母语为简体中文、对方母语为西班牙语。已保存的自定义语言和翻译风格继续保留，旧英文默认风格说明自动改为中文。支持逐条维护本地商品、多图和封面、中文关键词的启停与 AI 建议、默认/备用支付方式、物流说明和可选客户群邀请。业务回复目标固定为墨西哥西班牙语。人工草稿按模块所选语言展示：选中文时先用中文放入输入框或图片说明，确认发送后才翻成西语；数字报价同样适用。价格可填写英文或西语多行报价说明，自动回复保留报价原文和换行，不添加币种。多类别合并含中文时整份草稿以中文确认，全西语配置则直接提供西语草稿。自动回复按源语言填入原生编辑框，提前缓存西语内容，点击原生发送时复用缓存译文并保留准确中文原文。

草稿默认放入来源客户的空 WhatsApp 输入框，不覆盖正在输入的文字。商品、支付、物流和信任保障的分类开关默认关闭；开启对应分类即可自动发送，没有独立的自动回复 Tab 或总开关。报价与多类别回复也可自动发送，合并回复需开启全部命中类别的开关；无法确定对应商品或内容不完整时仍要求人工确认。商品信息回复一次发送全部已保存图片（最多 6 张），封面在前，说明只附在第一张；仅询价时只发报价文字。整组图片确认成功后才处理下一位客户。人工草稿等待打开来源客户聊天后处理；自动模式按客户新消息到达顺序逐个切换来源聊天，填入原生编辑框并点击发送，确认发送结果后再处理下一位；队列结束保留最后聊天。人工操作期间暂停，连续空闲五秒后继续；输入框有未发送文字、图片预览或草稿编辑时保持暂停。关闭分类开关或禁用常用语不会自行恢复。

常用语列表首次为空，可添加、编辑、删除多条规则，每条有管理标题、回复内容、中文／西语内容语言、启用状态和可编辑触发关键词。启用且命中任一关键词时自动回复；禁用条目和停用关键词不参与匹配，也不产生草稿。关键词同时匹配客户原文及中文译文；“你好”等问候关键词也匹配 Hola、您好、嗨等常见问候，单独的问候无需先翻译来信；多条命中按保存顺序拼接，每条只加入一次，标题不发送。与商品、支付、物流或信任同时命中时合并为一份回复，继续遵循相关分类开关。

自动客服在聊天中静默工作，不显示左下角状态框、排队数、待确认数量或暂停按钮。设置页在各分类管理开关，常用语逐条启停，开启时直接保存。多个标签页共享任务占用权；发送前复核收件人、内容、附件与配置，状态不确定时转人工检查，不重复点击。原生导航或发送不可用时转人工，不回退到直接发送 API。

插件、分类、商品、支付方式、群邀请、常用语及关键词的启停统一使用显眼的滑动开关，显示“已开启／已关闭”；分类开关开启即生效；旧总开关字段不再影响发送。普通自动回复通过原生编辑器的粘贴处理写入，等待编辑器异步提交内容、发送控件渲染就绪即自动点击，不额外增加五秒等待；嵌套控件按一次发送操作处理。移除同客户、同类别六十秒内强制转人工的限制，新消息独立触发，同一消息仍只发送一次。人工操作仍遵循五秒空闲保护；物流、含运费的物流说明和信任保障也遵循对应自动开关，不因金额或多类别被强制拦截。旧人工记录及失败的自动发送不再自动插入来阻塞新任务，不重发旧消息。

所有类别的草稿点击发送后立即隐藏插件辅助栏、编辑面板和“查看草稿”入口，中文、西语、纯文字与图片草稿采用同一规则。确认发送成功后结束本条草稿，延迟的编辑和预览事件不会再次弹出旧面板；失败时提供错误提示与人工恢复入口。后续客户新消息仍独立生成新草稿。

完整页面、存储、发送规则与验收步骤见 [外贸回复开发说明](docs/foreign-trade-replies.md)。WhatsApp 的图片预览和后台消息接口仍需在实际账号页面验收。构建后重新加载现有 `dist/` 扩展并刷新 WhatsApp；保留原扩展安装即可保留本地配置和历史。

## Install (developer mode)

1. Clone this repo.
2. 推荐安装 Node.js 26（本轮使用 26.4.0 验证），通过 Corepack 使用 Yarn 4.18.0，执行 `yarn install --immutable`，然后执行 `VITE_HAOMAI_API_BASE_URL=http://127.0.0.1:8080/api/v1 yarn build`。其他受支持版本、Corepack 准备、完整服务端配置及扩展来源白名单见[本地调试](docs/LOCAL_DEBUG.md)。
3. In Chrome, go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `dist/` folder.
4. 点击工具栏弹窗的“登录好麦”，或右键扩展图标 → **Options** 打开完整工作台。提交登录或点击“获取验证码”时，允许 Chrome 提示的 API 主机访问权限；服务器地址已由维护者在构建时设置。
5. 打开并登录 `https://web.whatsapp.com`，在自有测试账号中手动验证；扩展更新后还需刷新这个标签页。后台模式由 Go 统一处理工作台/APP 发出的消息翻译，旧版本地翻译规则不作为当前登录流程的配置项。

## How it works

WhatsApp Web ships a Metro-style module bundle that exposes `window.require("ModuleName")` once `Debug.VERSION ≥ 2.3000`. Outgoing translation uses that module hook, while bilingual message display uses an independent DOM observer and local storage:

| Layer | Module | What we do |
| --- | --- | --- |
| Anti-ban | `WAWebWamCodegenUtils.defineEvents` | Blank the `extentionIds`/`externalSources` fields of the `WebcFingerprint` WAM event so our presence isn't reported back to WhatsApp's telemetry. |
| Outbound | `WAWebSendTextMsgChatAction.sendTextMsgToChat` (+ `WAWebNewsletterSendMsgAction.sendNewsletterTextMsg`) | Preserve the exact input locally before sending; send only the translated body. Bind the original to the sent model's MessageKey; new-bubble matching is a compatibility fallback. Only one function per module is hooked to avoid double translation. |
| Message display | Content script `MutationObserver` + MAIN-world metadata adapter | Read message keys from DOM attributes or the rendered body's React message props, append a separate local-only DOM annotation under each bubble, and restore it after WhatsApp's virtualized list re-renders. Incoming protobuf/message models are NOT modified. |
| History | `chrome.storage.local`, separate per-message records | Persist originals and cache translations. Include message text and native-language/provider/model/prompt context in cache keys to detect edits and setting changes. Deduplicate in-flight requests and limit concurrent bubble translations to two. |
| UI | Local elements inside existing message bubbles; separate business draft helper | Append wine-red local text below a thin solid divider. Matched business replies can fill the empty native composer or open a native media preview for manual review. |

Typing does not trigger translation requests. Bilingual history annotations stay inside existing message bubbles. The separate business assistant listens for newly received customer messages and preserves edits to its prepared Spanish drafts in the native composer.

These annotations are not part of WhatsApp's synced data, search index, quoted replies or forwarded messages. They are available in the same Chrome profile while the extension's data is retained, not automatically on another computer or phone. Uninstalling the extension or clearing its storage removes this local history. Storage quota failures are reported instead of being treated as successfully saved records; originals are not silently evicted after a fixed number of messages. The DOM selectors and internal send hook are unofficial WhatsApp interfaces and may need updating when WhatsApp changes its UI.

## Architecture

```
┌────────────────────────────────────┐
│ web.whatsapp.com (MAIN world)      │
│  ─ Module hooks via window.require │
│  ─ Translate only when sending    │
└─────────────┬──────────────────────┘
        postMessage
┌─────────────┴──────────────────────┐
│ Content script (ISOLATED world)    │
│  ─ Bridges page ↔ service worker   │
│  ─ Proxies chrome.storage          │
│  ─ Local bilingual bubble display │
│  ─ Persistent per-message history │
└─────────────┬──────────────────────┘
        chrome.runtime.connect
┌─────────────┴──────────────────────┐
│ Service worker (MV3)               │
│  ─ Holds API keys                  │
│  ─ Direct fetch to provider APIs   │
│    (DeepSeek / Anthropic / OpenAI) │
│    (Google)                        │
└────────────────────────────────────┘
```

Built with **Vite** + **@crxjs/vite-plugin** + **React 18** + **TypeScript**. The page-world entry is bundled separately and injected via a `<script src=chrome.runtime.getURL(...)>` tag from the isolated content script — that way Chrome gives the script a real base URL, so the bundle's relative dynamic imports resolve into `chrome-extension://` URLs that are reachable through `web_accessible_resources`.

## Privacy

- **后台业务模式**会将账号、消息和工作台操作发送给用户配置的好麦 API，并按服务端配置处理存储、AI 翻译和自动回复。图片与语音使用 OSS 短时授权上传，长期云凭据不进入客户端。
- **旧独立模式 API keys** 的兼容存储保留在 `chrome.storage.local`；旧版相关请求面向用户配置的 AI 供应商，当前工作台不提供切换到该模式的入口。
- **登录令牌**持久保存在扩展 Origin 的 IndexedDB，在 `chrome.storage.session` 中保留可信上下文缓存；同一扩展更新或浏览器重启可恢复有效会话。退出、撤销或凭据失效后仍须重新登录。服务端访问日志与业务数据留存由部署者配置，发布隐私政策需反映实际行为。
- **Local history contains message text.** Exact sent originals and cached translations are saved in this Chrome profile's extension storage (not encrypted by this extension). They are not sent to the chat recipient or synced to another device. Console diagnostics log IDs/counts/status, not complete message bodies or API keys.
- **Anti-ban hook** zeroes out the WAM `extentionIds`/`externalSources` fields so WhatsApp's telemetry doesn't enumerate your installed extensions.

This is **unofficial** and not affiliated with WhatsApp / Meta. Use it at your own risk; modifying WhatsApp Web's internals can technically violate the ToS.

## Develop

开发与完整测试推荐 Node.js `26`，本轮使用 `26.4.0`。包管理与 Web 后台统一使用 Yarn `4.18.0`，由各自 `package.json` 的 `packageManager` 固定；扩展独立维护自己的 `yarn.lock`。`.yarnrc.yml` 使用 `nodeLinker: node-modules`。若未安装 Corepack，可先执行 `npm install --global corepack@0.34.5`，该工具版本兼容推荐的 Node 26；npm 仅用于安装该工具，扩展依赖和脚本均由 Yarn 管理，已有兼容的 Corepack 无需重装或降级。

```bash
corepack enable
yarn --version  # 应为 4.18.0
yarn install --immutable
yarn dev --host localhost --port 5174 --strictPort  # UI HMR，避免与 Vue 的 5173 冲突
yarn test     # simulated WhatsApp DOM + persistent storage + send-hook regression tests
VITE_HAOMAI_API_BASE_URL=http://127.0.0.1:8080/api/v1 yarn build # 完整联调用 dist/
```

`yarn dev` 和 `yarn build` 不要同时写同一个 `dist`。项目有 build 专用 WhatsApp MAIN-world 入口重写，原生消息链路请使用正式构建加载验收，详见[调试指南](docs/LOCAL_DEBUG.md)。发布构建需把 API 地址改为实际 HTTPS 域名，不能直接沿用本机地址。

旧安装的临时兼容输出位于 `../wa-web-translate/dist`，其父目录是真实的、带 `.haomai-extension-bundle-only` 标记的发布目录，只存旧路径下的构建副本，不是源码仓库或符号链接。需要继续供旧实例使用时，先在本仓库构建，再显式执行 `python3 tools/sync_legacy_bundle.py --target ../wa-web-translate/dist`。工具校验目录和 SHA256、失败时恢复旧包，不读取浏览器存储、不重载扩展，也不是常规 build/test 的前置。详情见[本地调试](docs/LOCAL_DEBUG.md)。

### Verify translation in Chrome

After rebuilding and reloading the unpacked extension, configure **我的母语** and **对方的母语** in Options, then open WhatsApp Web. Open DevTools with `F12` or `⌘⌥I`, then filter the Console for `wa-translate`.

Typing alone should produce no translation request. Sending a message should show `send translation start`, followed by `bridge response ok` and `send body rewritten`. The service worker console should show `sw request received`, `provider request start`, `DeepSeek response` with `ok: true`, `provider request success`, `output parsed`, and `sw response ready`. Receiving an uncached message produces its own history translation request; cached history does not.

To inspect service-worker logs, open `chrome://extensions`, find **好麦**, click its **Service worker** link, and use the DevTools Console there. In standalone mode, a successful provider request should have HTTP status `200`; an API or permission problem will appear as `provider request failed` with its status/error. 后台业务模式请同时检查 Go API、WebSocket 和来源账号状态，不能只看供应商请求日志。

### 验证聊天记录中的双语显示

1. `yarn build` 后，在 `chrome://extensions` 点击扩展的重新加载，然后刷新 WhatsApp 网页（否则旧 hook 仍然在运行）。保持加载同一个 `dist/` 扩展，不要卸载后重装，以免丢失本地历史。
2. 配置“我的母语”为中文、“对方的母语”为英语。连续输入、修改文字时，不应出现预览弹窗，也不应产生输入翻译请求；点击原发送按钮或按回车后，才翻译一次并发送。对方只收到英文；本机英文气泡下方用一条细实线分隔，再显示酒红色的准确中文原文。
3. 对方发英文后，保留原来的英文气泡，用细实线分隔，下面显示酒红色中文译文。没有额外的语言标题或截图中的红色箭头/说明；原文/译文类型只在悬停提示中区分。重试按钮只影响本地翻译，不会发送消息。
4. 切换聊天、滚动到历史消息，再刷新页面。对应的双语行应恢复；已缓存的入站消息日志应显示 `cacheHit: true`，不再重复调用 AI。
5. 网页控制台过滤 `[wa-translate][history]`：
   - `outgoing original saved before send`：输入原文已本地保存。
   - `outgoing original bound by send result`（或 `outgoing original bound`）：已和 WhatsApp 消息 ID 关联。
   - `outgoing original displayed`：发送气泡下已显示原文。
   - `send result has no message ID; waiting for new bubble`：WhatsApp 发送函数没有返回消息 ID，并不是翻译失败。插件会根据新气泡的 `data-id`、聊天 ID 和译文关联原文；随后应出现 `outgoing original bound` 和 `outgoing original displayed`。
   - `message scan`：气泡识别诊断。`root` 是扫描区域，`rowsSeen` 是识别到的消息 ID 数量，`readable` 是可读取正文的数量，`outgoing` 是发送消息数量，`pendingOriginals` 是待关联原文数量。若原文没有显示，提供这一行和 `original awaiting matching message` 的日志；日志不包含完整消息正文或 API key。
   - `idFormats` / `idShapes`（在 `message scan` 内）：分别统计 DOM 完整消息键、裸消息编号和其他 ID；形状样本隐藏实际联系人和消息编号，只保留分隔符/已知服务器名，便于定位格式不兼容。
   - `page message metadata`：页面内备用定位诊断。`bodies` 是聊天正文候选数量，`reactBodies` 是找到 React 关联的数量，`mapped` 是成功映射的数量。`keyCandidates` / `serializedKeys` 分别是找到的模型键与成功序列化的数量，`domKeyMismatches` / `textMismatches` 用于区分 ID 和正文校验失败。`mappedByDom` 是通过裸消息编号、明确收发方向与模型支持的当前聊天 ID 组合定位的数量。DOM 没有完整消息键时，通过这个适配器暴露本地的 `data-wa-trans-message-id`。若 `bodies > 0` 但 `mapped: 0`，说明仍未识别当前消息对象，不能认为双语显示成功。
   - `bilingual bubble displayed`：本地译文已显示，检查 `persistent: true`。
   - `... save failed` / `bubble translation failed`：缓存或翻译失败，需要检查配额、配置和网络；不能仅凭接口 HTTP 200 判断气泡已经显示。

启用此功能之前已发送的内容，或者从其他设备发送且本机没有保留原文的消息，只能生成“译文”，不能恢复当时的准确原文。未加载到网页中的历史消息不会被批量扫描；滚动到它们时自动显示/翻译。

气泡识别支持序列化消息 `data-id` 和 `data-message-id`，不要求旧版 `.message-in` / `.message-out` 类名。扫描区域按聊天正文选择，不会仅因 `#main` 存在就固定使用它，也不会把输入框当作聊天正文。MAIN-world 适配器只读正文对应的 React 消息对象，优先将 DOM 的裸消息编号与模型键对应；没有 DOM 编号时才使用正文校验。如果裸编号缺少可读 React 消息模型，只有在同时确认收发方向和模型支持的当前聊天 ID 时才定位，不用联系人显示名称猜测归属。不修改 React props、WhatsApp 消息模型或发送内容。

发送、当前聊天和气泡定位共用消息键兼容适配器：支持旧版 `_serialized`、新版键对象的 `toString()` 及字段明确的普通消息键对象，不修改 WhatsApp 的原型。新版键不再暴露 `_serialized` 的变化已记录在 [WA-JS 的 MsgKey 适配](https://github.com/wppconnect-team/wa-js/blob/main/src/whatsapp/misc/MsgKey.ts)。兼容正文的 `data-testid` 和外层正文元数据容器。WhatsApp 仍可能改变这些非官方接口，真实页面需要按上述日志验证。

Project layout:

```
src/
  background/      service worker — translation API calls
  content/         isolated-world bridge, bubble observer, history-storage.ts
  page/
    index.ts       MAIN-world entry, orchestrates hooks
    bridge.ts      promise-based RPC over postMessage
    wa.ts          window.require helpers
    store.ts       page-side wrapper for chrome.storage
    hooks/
      wam-scrub.ts          anti-ban
      send.ts               outgoing send-hook
    ui/
      styles.ts             chat-history divider and wine-red local text
  options/         options page (React)
  popup/           toolbar popup (React)
  shared/          types, language list, RPC shapes
```

## Sponsor

I build and maintain this in my spare time. If it makes your life easier, please consider sponsoring at **[purpshell.dev/sponsor](https://purpshell.dev/sponsor)**. Sponsorship lets me keep the extension working through WhatsApp Web's frequent module renames, add new providers, and answer issues.

## License

MIT.


## 好麦公共工程基础

2026-10-23：扩展界面名称改为好麦，popup 与 options 接入统一生成的主题和通用文案，默认跟随系统。现有 WhatsApp 消息桥、自动回复及本地配置行为继续保留。

公共设计与协议源位于 `haomai-go/shared`；设计或协议更新时，由公共工程维护者同步生成结果到本仓库。`src/shared/generated` 随本仓库提交，正常安装、测试和构建只使用本仓库文件，不访问任何相邻仓库；不要手动修改生成文件。新后端环境与协议边界位于 `src/shared/haomai`，公共 UI 文案与主题位于 `src/shared/ui`。

账号登录、注册、找回密码和服务器绑定已接入真实扩展工作台。后台业务模式由服务器保存供应商凭据；旧版直连 AI 配置与数据保留兼容，当前工作台已移除独立模式切换入口，后台模式不会启用端侧旧翻译和自动回复规则。

本工程真正的工具栏 popup 使用 `src/popup/index.html`；完整设置由 `options_ui.open_in_tab=true` 打开。界面原型、框架选择与服务端部署配置见同级 `haomai-go/docs/TECHNICAL.md`。

## 好麦后台业务模式

默认进入好麦工作台，工具栏弹窗固定 360px 宽，提供来源状态、用量、消息、常用内容与手机入口；未登录入口统一为“登录好麦”。登录、注册、忘记密码和全部业务在独立扩展标签页完成，不显示 API 地址输入或独立模式切换。原来的商品、支付、物流、信任和常用语数据保持兼容。后台模式由服务器统一翻译、自动回复，端侧旧规则暂停，避免重复处理。

1. 维护者在构建时传入公开 `VITE_HAOMAI_API_BASE_URL`（见[调试](docs/LOCAL_DEBUG.md)与[部署](docs/DEPLOYMENT.md)），统一设置当前包的 API 地址。`.env.example` 只是示例，不会自动加载。默认本机 `http://127.0.0.1:8080/api/v1`；远程地址必须 HTTPS。浏览器已保存的服务器地址仍优先于构建默认值；升级不自动覆盖，维护者需核对旧配置。
2. 服务器 `http.allowed_origins` 必须填写实际 `chrome-extension://扩展ID`，包含 WebSocket origin。用户提交登录或点击“获取验证码”时，扩展沿用已配置地址启用后台模式，并申请对应 API 主机的访问权限；按 Chrome 提示允许即可。
3. 使用 Chrome 116 或更新版本，执行 `yarn install --immutable`、`yarn build`，在 Chrome 扩展管理中加载 `dist/`。
4. 登录好麦后打开 WhatsApp Web 并登录，真实账号标识同步到服务器。APP 使用相同好麦账号；手机入口生成有效期三分钟的真实绑定二维码，二维码令牌来自服务端。
5. 图片、语音使用 OSS 上传授权、直传及完成校验；需先填写服务器 OSS 配置和 Bucket CORS（允许扩展来源及 PUT 所需签名请求头）。语音录制只在点击录音时请求麦克风权限，最长一分钟，可预听后发送。

HTTP/WS 共用 camelCase 封装，WebSocket 使用一次性票据、`haomai.v1`、心跳、退避重连和 alarm 唤醒恢复。HTTP 401 进行单次合并刷新，暂时断网/503 不清除登录。访问令牌和刷新令牌保存在扩展 Origin 的 IndexedDB 及可信 `chrome.storage.session` 缓存，不交给 WhatsApp MAIN 世界、任意 content script 或 localStorage；主动退出会清除持久会话，避免重新启动后恢复旧登录。旧版仅在 session 中的凭据若在首次升级时已被 Chrome 清空，需重新登录一次，详见[升级说明](docs/LOCAL_DEBUG.md)。来自网页的中继仅允许固定平台观察与已关联发送结果，不接受任意 API 路径或 userId。

平台入站和原生出站文字根据真实消息键同步；服务端分发与普通同步分开处理。发送前写入防重记录，WA 明确发送确认后回报；确认不确定时不会自动重发。采集及结果回报有按用户隔离的本地 outbox，重连后重试；重复分发只重报已保存的结果。历史加载不会触发新消息自动回复。

工作台业务包括社交账号、会话与文字/单图/语音发送、类别拖拽排序、内容图文与关键词/自动回复、客户标签与跟进、AI 角色、反馈多图、套餐/订单、用量、设备会话、个人资料、修改密码与主题。服务器未填写的官网/下载地址明确提示未配置，支付渠道未配置时订单停在待支付，不制造成功状态。

登录、注册、找回和修改密码统一不设最小长度，允许 `123456` 等短密码；拒绝空值或全为空白，实际密码不裁剪前后空格，按 UTF-8 编码限制为最多 72 字节。

本地 `development` 可通过后端 `sms.development_code: '123456'` 使用固定验证码，不发送真实短信。注册或找回密码仍需先点击“获取验证码”，由服务端创建 `challengeId` 后再填写 `123456`；不能跳过获取步骤。该配置仅开发环境有效，生产仍使用真实阿里云短信。

### 验证与实际联调边界

`yarn test` 覆盖既有 75 项 WhatsApp/翻译/自动回复测试以及新增后台安全、协议、派发防重、账号输入和类别/反馈页面操作；`yarn build` 做 TypeScript 与生产打包。测试使用隔离 fixture，不向真实联系人发消息，不发送真实短信，不付款。

真实 WhatsApp 的内部模块随版本可能变化；适配器找不到模块或未得到明确 ACK 时返回失败。实时采集覆盖文字、图片和语音；媒体使用 MsgModel 原生下载解密及已解密 Blob，最大20MiB，经隔离中继与后台重复验证后上传 OSS。模块不可用、下载失败、类型或大小不符会保留失败记录和重试入口；不改成假文本。APP/工作台主动发送的单图和语音已接到平台媒体适配器。实际账号、OSS、短信和 DeepSeek 联调需要用户填入外部配置后执行。

媒体下载接口对照来源：[WA-JS v4.7.1 downloadMedia](https://github.com/wppconnect-team/wa-js/blob/v4.7.1/src/chat/functions/downloadMedia.ts)、[原生媒体发送签名](https://github.com/wppconnect-team/wa-js/blob/v4.7.1/src/chat/functions/sendFileMessage.ts)。项目保留自有适配层，没有注入整个第三方运行时。

账号详情提供显式“导入最近消息”：最多读取当前登录来源账号最近100条加载到WhatsApp Store的消息，全部标记 historical=true，仅保留原文，不触发自动翻译、计费或自动回复；登录时不会自动执行导入。媒体导入同样有下载失败记录和重试。

聊天媒体按 mediaId 重新签发下载链接：语音播放前校验有效期并刷新，图片失败可重新加载，避免页面长时间停留后沿用过期OSS地址。后台模式下，好麦工作台/APP发出的消息由服务器统一翻译；WhatsApp原生输入框直接发送的内容按原文发送并同步记录，独立模式保留原有原生发送翻译。

好麦后端业务及本地启停偏好统一使用 `active`。升级读取旧 `enabled` 字段时保留开关状态和自定义数据；若两者同时存在，以 `active`（包括 `false`）为准。第三方供应商 API 仍使用其规定字段。消息接口保留每条消息独立的 `sourceLanguage`，缺失或 `null` 表示未知，不从会话语言推断历史记录；可选审计字段也随服务器响应透传。聊天正文和译文继续由服务端 MySQL 保存。
