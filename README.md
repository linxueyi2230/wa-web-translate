# WA Web Translate

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

All keys live in `chrome.storage.local`. Nothing is sent anywhere except the AI provider you've chosen.

## 外贸回复首版

设置页采用六个顶部标签：设置、商品、支付方式、物流、信任与保障、常用语。设置页的标题、语言列表和帮助说明使用中文；首次配置默认我的母语为简体中文、对方母语为西班牙语。已保存的自定义语言和翻译风格继续保留，旧英文默认风格说明自动改为中文。支持逐条维护本地商品、多图和封面、中文关键词的启停与 AI 建议、默认/备用支付方式、物流说明和可选客户群邀请。业务回复目标固定为墨西哥西班牙语。人工草稿按模块所选语言展示：选中文时先用中文放入输入框或图片说明，确认发送后才翻成西语；数字报价同样适用。价格可填写英文或西语多行报价说明，自动回复保留报价原文和换行，不添加币种。多类别合并含中文时整份草稿以中文确认，全西语配置则直接提供西语草稿。自动回复按源语言填入原生编辑框，提前缓存西语内容，点击原生发送时复用缓存译文并保留准确中文原文。

草稿默认放入来源客户的空 WhatsApp 输入框，不覆盖正在输入的文字。商品、支付、物流和信任保障的分类开关默认关闭；开启对应分类即可自动发送，没有独立的自动回复 Tab 或总开关。报价与多类别回复也可自动发送，合并回复需开启全部命中类别的开关；无法确定对应商品或内容不完整时仍要求人工确认。商品信息回复一次发送全部已保存图片（最多 6 张），封面在前，说明只附在第一张；仅询价时只发报价文字。整组图片确认成功后才处理下一位客户。人工草稿等待打开来源客户聊天后处理；自动模式按客户新消息到达顺序逐个切换来源聊天，填入原生编辑框并点击发送，确认发送结果后再处理下一位；队列结束保留最后聊天。人工操作期间暂停，连续空闲五秒后继续；输入框有未发送文字、图片预览或草稿编辑时保持暂停。关闭分类开关或禁用常用语不会自行恢复。

常用语列表首次为空，可添加、编辑、删除多条规则，每条有管理标题、回复内容、中文／西语内容语言、启用状态和可编辑触发关键词。启用且命中任一关键词时自动回复；禁用条目和停用关键词不参与匹配，也不产生草稿。关键词同时匹配客户原文及中文译文；“你好”等问候关键词也匹配 Hola、您好、嗨等常见问候，单独的问候无需先翻译来信；多条命中按保存顺序拼接，每条只加入一次，标题不发送。与商品、支付、物流或信任同时命中时合并为一份回复，继续遵循相关分类开关。

自动客服在聊天中静默工作，不显示左下角状态框、排队数、待确认数量或暂停按钮。设置页在各分类管理开关，常用语逐条启停，开启时直接保存。多个标签页共享任务占用权；发送前复核收件人、内容、附件与配置，状态不确定时转人工检查，不重复点击。原生导航或发送不可用时转人工，不回退到直接发送 API。

插件、分类、商品、支付方式、群邀请、常用语及关键词的启停统一使用显眼的滑动开关，显示“已开启／已关闭”；分类开关开启即生效；旧总开关字段不再影响发送。普通自动回复通过原生编辑器的粘贴处理写入，等待编辑器异步提交内容、发送控件渲染就绪即自动点击，不额外增加五秒等待；嵌套控件按一次发送操作处理。移除同客户、同类别六十秒内强制转人工的限制，新消息独立触发，同一消息仍只发送一次。人工操作仍遵循五秒空闲保护；物流、含运费的物流说明和信任保障也遵循对应自动开关，不因金额或多类别被强制拦截。旧人工记录及失败的自动发送不再自动插入来阻塞新任务，不重发旧消息。

所有类别的草稿点击发送后立即隐藏插件辅助栏、编辑面板和“查看草稿”入口，中文、西语、纯文字与图片草稿采用同一规则。确认发送成功后结束本条草稿，延迟的编辑和预览事件不会再次弹出旧面板；失败时提供错误提示与人工恢复入口。后续客户新消息仍独立生成新草稿。

完整页面、存储、发送规则与验收步骤见 [外贸回复开发说明](docs/foreign-trade-replies.md)。WhatsApp 的图片预览和后台消息接口仍需在实际账号页面验收。构建后重新加载现有 `dist/` 扩展并刷新 WhatsApp；保留原扩展安装即可保留本地配置和历史。

## Install (developer mode)

1. Clone this repo.
2. `pnpm install && pnpm build` (Node 20.19+ or a current supported Node release).
3. In Chrome, go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `dist/` folder.
4. Right-click the extension icon → **Options**. Pick your native language, your AI provider, paste an API key, edit the personality prompt to taste.
5. Open `https://web.whatsapp.com` and send a message. The saved language settings apply when you send; typing alone never requests a translation.

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

- **No telemetry from this extension.** Nothing is logged to any server.
- **API keys are stored locally** in `chrome.storage.local` — they never leave your machine except to the AI provider you've configured.
- **Message text leaves your browser only when translated**, going directly to the provider's API endpoint you chose. WhatsApp itself doesn't see the AI provider in any way; it just sees a translated text body.
- **Local history contains message text.** Exact sent originals and cached translations are saved in this Chrome profile's extension storage (not encrypted by this extension). They are not sent to the chat recipient or synced to another device. Console diagnostics log IDs/counts/status, not complete message bodies or API keys.
- **Anti-ban hook** zeroes out the WAM `extentionIds`/`externalSources` fields so WhatsApp's telemetry doesn't enumerate your installed extensions.

This is **unofficial** and not affiliated with WhatsApp / Meta. Use it at your own risk; modifying WhatsApp Web's internals can technically violate the ToS.

## Develop

```bash
pnpm install
pnpm dev      # Vite dev server with HMR
pnpm test     # simulated WhatsApp DOM + persistent storage + send-hook regression tests
pnpm build    # production build into dist/
```

### Verify translation in Chrome

After rebuilding and reloading the unpacked extension, configure **我的母语** and **对方的母语** in Options, then open WhatsApp Web. Open DevTools with `F12` or `⌘⌥I`, then filter the Console for `wa-translate`.

Typing alone should produce no translation request. Sending a message should show `send translation start`, followed by `bridge response ok` and `send body rewritten`. The service worker console should show `sw request received`, `provider request start`, `DeepSeek response` with `ok: true`, `provider request success`, `output parsed`, and `sw response ready`. Receiving an uncached message produces its own history translation request; cached history does not.

To inspect service-worker logs, open `chrome://extensions`, find **WA Web Translate**, click its **Service worker** link, and use the DevTools Console there. A successful request should have HTTP status `200`; an API or permission problem will appear as `provider request failed` with its status/error.

### 验证聊天记录中的双语显示

1. `pnpm build` 后，在 `chrome://extensions` 点击扩展的重新加载，然后刷新 WhatsApp 网页（否则旧 hook 仍然在运行）。保持加载同一个 `dist/` 扩展，不要卸载后重装，以免丢失本地历史。
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
