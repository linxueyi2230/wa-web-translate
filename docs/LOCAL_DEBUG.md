# Chrome 扩展本地调试

适用：当前好麦后台业务模式；源码核对日期 2026-10-23。四仓库公共入口见[本地调试与部署指南](../../haomai-go/docs/guides/README.md)，正式发行见[上线部署](DEPLOYMENT.md)。

## 1. 准备环境

- Chrome 116 或更新版本。
- 推荐 Node.js **26**，本轮使用 **26.4.0** 验证。使用 Node 22 时至少为 **22.22.2**；使用 Node 24 时至少为 **24.15.0**。当前锁定的测试依赖对 Node 补丁版本有要求，不能只按 Vite 的最低版本判断完整测试环境是否兼容。
- Yarn **4.18.0**，由 `package.json` 的 `packageManager` 固定，`yarn.lock` 是唯一依赖锁文件；不混用其他包管理器生成锁文件。`.yarnrc.yml` 使用 `nodeLinker: node-modules`，保留现有 Vite/CRXJS 工具链的安装目录。
- 启动 Go API、MySQL、Redis，并按主工程文档手动初始化业务表。扩展不启动后端、不初始化数据库；关闭数据库只能验证部分接口，不能完成登录和业务联调。
- 当前本机源码目录为 `/Users/ywr/src/haomai-chrome`；换电脑时使用自己的克隆路径。

不假设 Node 自带 Corepack；如果 `corepack` 命令不存在，先执行 `npm install --global corepack@0.34.5`。该引导版本兼容上述推荐的 Node 环境，已有兼容当前 Node 的可用 Corepack 无需重装或降级。npm 仅用于安装这个包管理工具，项目依赖、运行和构建全部使用 Yarn。

```sh
cd /Users/ywr/src/haomai-chrome
node --version
corepack --version
corepack enable
yarn --version
yarn install --immutable
```

`yarn --version` 应输出 `4.18.0`。常规安装使用 `--immutable`，锁文件与依赖声明不匹配时直接失败，不自动改写锁文件；调整依赖使用 `yarn add`／`yarn remove`，并提交更新后的 `package.json` 与 `yarn.lock`。Vue 后台与扩展分别安装依赖，各自保留自己的锁文件。

工具栏 popup、完整工作台、后台 service worker、WhatsApp 页面脚本属于不同运行环境，不能只在普通浏览器标签页打开 Vite 地址就验收整个扩展。

已有安装在目录迁移时先保留原实例和浏览器存储，不卸载重装。当前 manifest 没有固定 `key`，从新目录加载会使用新的扩展 ID，原 ID 下的本地设置不会自动变成新 ID 的数据。先在扩展管理页人工核对 ID，再同步 Go/OSS 来源白名单；不要为排障复制真实令牌。身份机制见 [Chrome manifest.key](https://developer.chrome.com/docs/extensions/reference/manifest/key) 和 [Chromium 路径 ID 算法](https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/id_util.cc)。

本机迁移为旧实例保留了 `/Users/ywr/src/wa-web-translate/dist` **真实发布目录**，不是符号链接，也不含源码、Git 或依赖。父目录只允许标记 `.haomai-extension-bundle-only`、说明 README 和 `dist`。保留真实规范路径可避免目录改名本身改变 ID 的路径来源；工具不会更改 manifest key、读取浏览器资料或替用户安装/重载。今后的源码和常规命令全部在 `haomai-chrome` 执行，只有需要更新该兼容副本时才运行：

```sh
cd /Users/ywr/src/haomai-chrome
VITE_HAOMAI_API_BASE_URL=http://127.0.0.1:8080/api/v1 yarn build
python3 tools/sync_legacy_bundle.py --target ../wa-web-translate/dist
```

同步只读取本仓库已编译的 `dist`，拒绝符号链接、无标记目录、Git/源码混入、异常文件和来源/目标包含关系。先暂存复制并核对逐文件 SHA256，再备份旧包、切换并复核；常规失败恢复旧包。若连恢复也遇到文件系统错误，工具保留本次 `.haomai-sync-*/previous-dist` 供人工恢复，不删除原有未知目录。该操作不属于 `yarn build` 的前置，也不修改浏览器状态；暂存目录只清理工具本次创建的内容。保持单次执行，避免构建和复制同时改动同一份 `dist`。

同步成功后，使用者可人工重新加载**原有**扩展实例并核对 ID、设置和来源；不要从新源码路径另建实例替代旧安装。确认旧路径不再使用后再人工删除临时兼容目录。符号链接会被 Chrome 解析，不能代替该真实目录来承诺旧 ID。工具隔离测试为 `python3 -m unittest discover -s tools -p 'test_*.py' -v`。

## 2. 推荐：构建后加载，做完整业务联调

```sh
cd /Users/ywr/src/haomai-chrome
VITE_HAOMAI_API_BASE_URL=http://127.0.0.1:8080/api/v1 yarn build
```

1. 打开 `chrome://extensions`，开启“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择 `/Users/ywr/src/haomai-chrome/dist`，不要选源码目录。
3. 记下扩展 ID，例如页面显示的 32 位字母 ID。
4. 在 Go 所用环境的 YAML 中，保留现有后台来源，并把实际扩展来源加入 `http.allowed_origins`，然后重启 Go。来源只写协议与 ID，不加 `/` 或页面路径：

   ```yaml
   http:
     allowed_origins:
       - "http://localhost:5173"
       - "http://127.0.0.1:5173"
       - "http://localhost:8088"
       - "http://127.0.0.1:8088"
       - "chrome-extension://替换为实际扩展ID"
   ```

5. 点击浏览器工具栏的好麦图标，再点击“登录好麦”打开完整工作台。API 地址由维护者通过上面的 `VITE_HAOMAI_API_BASE_URL` 构建命令统一设置，登录、注册、找回密码和设置页不再显示服务器配置。远程主机必须 HTTPS；本机仅支持 `localhost`、`127.0.0.1`、`[::1]` 的 HTTP，不能使用局域网 HTTP 地址。
6. 提交登录或点击“获取验证码”时，扩展沿用已配置地址启用后台模式，并自动申请对应主机访问权限，按 Chrome 提示允许。**Chrome 主机权限**与**Go 来源白名单**都需要正确；后者同时校验 HTTP 与 WebSocket。
7. 使用真实好麦账号登录，打开并登录 WhatsApp Web。工作台同步真实社交账号；APP 登录同一好麦账号，也可在手机入口使用服务端生成的三分钟绑定二维码。

API 地址需要包含 `/api/v1`，例如 `http://127.0.0.1:8080/api/v1`。扩展自动从 API 地址推导 `ws://127.0.0.1:8080/api/v1/realtime/ws`，先申请一次性票据，再用 `haomai.v1` 子协议连接；无需单独配置 WebSocket 地址。

旧安装保存在 `chrome.storage.local` 的服务器地址仍优先于构建默认值，**重新构建不会覆盖已保存地址**，也不会自动清理历史数据。若实际请求主机与新构建不符，由维护者检查扩展 service worker 中的本地旧配置及 Network 请求，不再引导用户寻找地址输入框；不要通过卸载或清空全部存储排障。访问/刷新令牌持久保存在扩展自身 Origin 的 IndexedDB `haomai-private-auth`，`chrome.storage.session` 只作可信上下文缓存；不向网页/content script 或可由 content script 读取的 `chrome.storage.local` 暴露令牌。同一扩展 ID 正常更新、重载及浏览器重启可恢复有效会话，失效/撤销仍须重新登录；主动退出及切换 API 地址会清除持久会话。来源设置和旧版本地内容仍在 `chrome.storage.local`。

首次从旧版升级时，如果 Chrome 已清空旧版唯一的 session 凭据，无法找回这份凭据，需登录一次。仍存在的旧 session 可在新 worker 启动时迁入持久存储；以后正常升级自动恢复。不迁移不同扩展 ID 的凭据，不更改 manifest key、不重装或清理用户数据。

2026-10-25 修复：manifest 版本改从 `package.json.version` 生成；登录及每次申请 WS 票据均上报运行中的 `chrome.runtime.getManifest().version`。服务端需包含票据元数据更新及 Redis 6.0 兼容修复。此前 Redis 6.0.16 不支持 GETDEL，会导致已登录但 WS 503、后台显示离线。新登录先退役旧 socket，旧会话撤销/关闭不影响新会话；暂时网络或 503 刷新失败保留凭据，401 失效才清除。重连定时器另由 Chrome alarm 唤醒保障 worker 休眠后的恢复。

每次修改代码后重新执行构建，在扩展管理页点击“重新加载”，并**刷新已打开的 WhatsApp 标签页**。复用同一个扩展安装及固定的 `dist` 路径，保留本地配置与历史；不要通过卸载重装来更新。

## 3. 页面开发：Vite / CRXJS 热更新

```sh
cd /Users/ywr/src/haomai-chrome
VITE_HAOMAI_API_BASE_URL=http://127.0.0.1:8080/api/v1 yarn dev --host localhost --port 5174 --strictPort
```

保持此终端运行，然后在 Chrome 加载同一 `dist` 目录。选择 `5174` 是为了避免与 Vue 后台默认 `5173` 冲突；它只是扩展资源/HMR 端口，API 仍是 `8080`。打开 popup/工作台查看样式更新；后台源码变化可能触发整个扩展重载，必要时重新打开 popup、工作台并刷新 WhatsApp。[CRXJS 后台开发说明](https://crxjs.dev/concepts/background/)说明了该重载方式。

本项目在 `vite.config.ts` 中有**仅 build 阶段执行**的 MAIN-world 入口重写，用于 WhatsApp 页面内模块和动态导入。dev 与正式构建注入路径不同，HMR 可辅助页面开发，**完整账号发现、媒体采集、消息派发及原生发送验收采用上一节的构建加载流程**。出现 `page bundle path was not injected at build time` 时先改用构建加载检查，不应把普通 UI 热更新成功当作发送链路通过。

不要同时让 `yarn dev` 与 `yarn build` 写同一个 `dist`。需要独立运行扩展时，停止 dev 后重新 build，再重新加载扩展；dev 生成的包依赖本机开发服务器，不能发给其他人。

## 4. 分别查看各层日志与断点

| 要查什么 | DevTools 入口 | 对应源码 |
|---|---|---|
| 工具栏小窗口 | 打开 popup 后在窗口中右键“检查” | `src/popup/main.tsx` |
| 登录、设置与全部业务页面 | 完整工作台标签页中打开 DevTools | `src/options/HaomaiApp.tsx` |
| HTTP、WebSocket、刷新令牌与派发 | `chrome://extensions` → 好麦 → service worker 检查链接 | `src/background/haomai.ts`、`src/background/index.ts` |
| WhatsApp 隔离层、页面中继、气泡显示 | WhatsApp 标签页 DevTools → Sources → Content scripts，选择本扩展 | `src/content/index.ts`、`src/content/haomai-connector.ts` |
| WhatsApp 原生模块、发送确认与媒体下载 | 同一 WhatsApp DevTools 的页面运行上下文，搜索 `[wa-translate]` 日志 | `src/page/index.ts`、`src/page/haomai-connector.ts` |

Chrome 官方[扩展调试指南](https://developer.chrome.com/docs/extensions/get-started/tutorial/debug)分别介绍 popup、service worker 与 content script 的检查入口。打开 service worker DevTools 会影响其休眠行为，重连验收还应关闭 DevTools 后重试。当前最低 Chrome 116 与 WebSocket 活动维持后台生命周期相关，参见[官方 WebSocket 说明](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets)。

在 service worker 的 Network 面板检查：请求主机和 `/api/v1` 是否正确；HTTP 状态与响应 `code`；WS 是否得到 `101`、子协议是否为 `haomai.v1`、Frames 是否有心跳。不要复制完整票据 URL、Authorization、验证码或消息正文到公开日志。

## 5. 最小联调顺序

1. 检查 Go `/health/live` 和 `/health/ready`；就绪通过后再登录。
2. 核对构建使用的 API 地址、service worker 的实际请求主机和 Origin 白名单。提交登录时允许对应主机访问；登录后查看 popup 的来源状态、用量，以及完整工作台的社交账号列表。
3. 登录 WhatsApp，确认账号来源键和在线状态同步；退出 WhatsApp、关闭标签页和断网时，检查离线状态与恢复。
4. 在测试账号和自己控制的收件人之间，**手动发起**一条文字，确认来源账号、服务端记录、ACK 与防重；再检查一张图片和一段语音。尚未启用的自动回复分类保持关闭。
5. OSS 开启后检查上传意图 → 原始文件 PUT → 完成校验 → 临时下载地址。Bucket CORS 要允许实际扩展 Origin、PUT/GET/HEAD 与签名请求头；具体约定见主工程 [OSS 文档](../../haomai-go/docs/architecture/OSS_MEDIA.md)。录音点击时才请求麦克风权限。
6. 本地 `development` 可启用后端 `sms.development_code: '123456'`，注册/找回密码不发送真实短信。仍先点击“获取验证码”，等待接口成功创建 `challengeId`，再输入 `123456` 提交；固定码不能替代获取步骤。该配置仅 `development` 有效；生产环境仍调用已配置的阿里云短信，未配置时返回真实错误。
7. 重新加载扩展、刷新 WhatsApp、恢复网络后确认不会重复发送。测试框架通过与真实 WhatsApp 联调是两个验收层次。

当前工作台不提供旧独立 AI 模式的切换入口，相关旧代码与本地数据仅保留兼容。后台业务是否接通应以 Go API、会话、WebSocket 和社交账号状态为准。

## 6. 自动检查与常见问题

```sh
cd /Users/ywr/src/haomai-chrome
yarn test
VITE_HAOMAI_API_BASE_URL=http://127.0.0.1:8080/api/v1 yarn build
```

测试使用隔离 fixture，不向真实联系人发送消息。`yarn preview` 只是静态预览工具，不能替代 Chrome 的扩展运行环境。

| 现象 | 优先检查 |
|---|---|
| 找不到 `corepack`／`yarn`，或 Yarn 版本不对 | 按第一节安装并启用 Corepack，在扩展目录确认 Yarn 为 `4.18.0` |
| 安装提示锁文件需要变更 | 确认 `package.json`、`yarn.lock` 与 `.yarnrc.yml` 来自同一版本；保持 `--immutable`，不要删除锁文件绕过 |
| `origin_not_allowed` / WS 403 | Go 配置是否加入**当前**扩展 ID；配置改变后是否重启 Go；不要填写 WhatsApp Origin 来代替扩展 Origin |
| 无法连接扩展后台 | 是否在真正的扩展页面打开；service worker 错误；dev 服务器是否仍运行 |
| 构建已换地址但仍请求旧域名 | 旧安装保存的地址优先；由维护者核对 `chrome.storage.local` 的旧配置与 service worker 实际请求，不会自动覆盖或清理历史数据 |
| 本地填 `123456` 仍提示验证码无效 | 确认后端为 `development` 且配置了固定码；先点击“获取验证码”取得当前用途的 `challengeId`，不要跳过或使用旧挑战 |
| HTTP 成功但 WS 失败 | 反向代理 Upgrade、HTTPS 对应 WSS、一次性票据、实际 Origin、子协议转发 |
| 登录报 503 | 检查 MySQL/Redis、业务表及服务端日志，关闭数据库不能获得完整演示业务 |
| 发送前后状态不确定 | 查看明确 ACK；不重复点击或自动重发，先在来源聊天中核对 |
| 账号或原生适配器未就绪 | WhatsApp 是否登录、是否刷新过、模块是否变化；查看 page-world 日志并使用正式构建重试 |
| 图片/语音上传失败 | 后端 OSS 是否开启、签名有效期与请求头、Bucket CORS；临时 URL 不能当永久地址 |
| 页面更新但 WhatsApp 仍旧行为 | 扩展重载后还要刷新 WhatsApp，旧页面 hook 不会自动卸载 |

源码依据：`package.json`、`manifest.config.ts`、`vite.config.ts`、`src/background/haomai.ts`、`src/shared/haomai/client.ts`、`src/shared/haomai/protocol.ts`。
