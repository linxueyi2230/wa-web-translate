# Chrome 扩展上线部署与发布

源码核对日期 2026-10-23。本扩展采用 Manifest V3、React、TypeScript 和 CRXJS/Vite，发布物是 Chrome 扩展文件，不需要在服务器上运行 Node 或 Docker。Go API、MySQL、Redis、OSS 和后台站点仍按[主工程部署指南](../../haomai-go/docs/guides/README.md)部署。开发流程见[本地调试](LOCAL_DEBUG.md)。

## 1. 确定环境和扩展身份

准备生产 API HTTPS 地址，例如 `https://api.example.com/api/v1`。示例域名必须替换为自己的真实域名；API 路径保留 `/api/v1`，WS 自动使用同主机的 `wss://.../api/v1/realtime/ws`。

当前 `manifest.config.ts` 没有固定 `key`，开发者模式下移动目录或换电脑可能导致扩展 ID 变化。生产使用 Chrome Web Store 中同一个条目的固定 ID，并将 `chrome-extension://实际ID` 精确加入 Go `production.yaml` 的 `http.allowed_origins`。保留 Vue 后台等已有可信来源，不能使用 `*` 替代。测试、生产扩展最好使用各自明确的条目和白名单。

本机旧未打包实例另有临时兼容发布目录 `../wa-web-translate/dist`：它是真实构建副本，不是符号链接，不是第五个源码仓库。需要更新时，在本仓库完成目标环境构建后显式运行 `python3 tools/sync_legacy_bundle.py --target ../wa-web-translate/dist`。工具只接受带正确 bundle-only 标记的专用目录，暂存/逐文件 SHA256 校验后切换，失败恢复旧包；不改 Git、manifest key、浏览器存储或已安装实例，也不自动发布商店。目录保护和恢复说明见[本地调试](LOCAL_DEBUG.md)。该副本不参与正常构建；新使用者按新源码路径安装并配置自己的真实 Origin。

如需要让本地包与商店条目保持同一 ID：在开发者后台先上传但不发布一个 ZIP，取得该条目的**公钥**，按 Chrome 官方 [`manifest.key` 步骤](https://developer.chrome.com/docs/extensions/reference/manifest/key)加入 `manifest.config.ts` 的 `key`，重新构建后对照本地和商店 ID。不要把私钥、商店 OAuth 凭据、阿里云密钥或 JWT 签名密钥放进扩展。

## 2. 先准备服务器和浏览器权限

- Go 生产环境与数据库就绪，真实用户数据表已由部署者导入；生产反向代理支持 WebSocket Upgrade 并保留 Origin 和 `Sec-WebSocket-Protocol`。
- Go 来源白名单包含生产扩展来源，HTTP 与 WS 均按实际 ID 校验。浏览器主机权限与服务器来源白名单属于两层不同检查。
- 当前 manifest 为 API 服务器声明 `optional_host_permissions`；维护者通过 `VITE_HAOMAI_API_BASE_URL` 构建统一设置生产 HTTPS 地址。用户提交登录或点击“获取验证码”时，扩展沿用已配置地址启用后台模式，并申请该 API Origin 的访问授权；当前 UI 不显示服务器地址输入或保存按钮。Chrome 官方[跨域请求说明](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)解释了扩展主机权限与 content script 的边界。
- OSS 使用私有 Bucket、服务端短时签名与完成校验；Bucket CORS 放行实际扩展 Origin，允许所需 PUT/GET/HEAD 和签名头。不要把 OSS AccessKey 打进 `VITE_*` 或源码。详情见 [OSS 媒体约定](../../haomai-go/docs/architecture/OSS_MEDIA.md)。
- 阿里云短信、DeepSeek 等密钥仅在 Go 部署环境填写。官网、APP 下载与扩展安装链接由服务端公开配置返回，不在浏览器凭据中配置。

仓库仍保留旧供应商直连相关代码、兼容存储及供应商主机权限，当前工作台不再提供独立模式切换入口。发布时核对实际保留的权限与旧安装数据用途；移除旧代码或权限需要另行修改并回归。

## 3. 构建正式包

构建与测试推荐 Node.js `26`，本轮使用 `26.4.0` 验证；如使用 Node 22，至少为 `22.22.2`，Node 24 至少为 `24.15.0`。Yarn 固定为 `4.18.0`。若缺少 Corepack，先执行 `npm install --global corepack@0.34.5`；该工具版本兼容上述 Node 环境，该命令只安装包管理工具，已有兼容的 Corepack 无需重装。项目依赖由 Yarn 安装，版本以 `package.json` 的 `packageManager` 为准。

```sh
corepack enable
cd /Users/ywr/src/haomai-chrome
yarn --version
yarn install --immutable
yarn test
VITE_HAOMAI_API_BASE_URL=https://api.example.com/api/v1 yarn build
```

`yarn --version` 应输出 `4.18.0`。保留并提交 `package.json`、`yarn.lock` 和 `.yarnrc.yml`；锁文件固定依赖，`--immutable` 保证发布安装不改写它，`nodeLinker: node-modules` 保持 Vite/CRXJS 现有安装方式。

用实际 API 地址替换 `api.example.com` 后执行。仅 `VITE_HAOMAI_API_BASE_URL` 是当前业务构建读取的公开地址，不能杜撰额外的 WS/数据库客户端变量。Vite 环境变量在构建时写入 JS，后续修改服务器环境变量不会改变已经发布的扩展包。

当前后台运行时未配置构建地址时仍会默认使用本机 API，**`yarn build` 成功并不等于生产地址正确**。发布必须显式指定生产地址，再用干净的测试 Chrome Profile 加载正式 `dist`，在 service worker 的 Network 中核对实际主机；用户端不再填写服务器地址。已有安装保存在 `chrome.storage.local` 的地址仍优先于构建默认值，发布更新不会强制覆盖或清理历史数据；旧安装请求主机不符时由维护者核对旧配置。

核对构建清单与入口：

```sh
node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync("dist/manifest.json","utf8"));console.log(JSON.stringify({name:m.name,version:m.version,manifestVersion:m.manifest_version,minimumChrome:m.minimum_chrome_version,popup:m.action.default_popup,options:m.options_ui.page,worker:m.background.service_worker},null,2))'
```

当前 manifest 版本直接读取 `package.json.version`；发新版时提高该值，并同步发布记录，构建后确认 `dist/manifest.json` 与其一致。后台上报读取运行包的 manifest，不能以源码版本代替已加载包的版本。Chrome 商店要求更新版本号递增，见[官方发布准备文档](https://developer.chrome.com/docs/webstore/prepare)。

`vite.config.ts` 在 build 后重写 MAIN-world 注入入口；只能分发最终 `dist`，不能打包 `yarn dev` 运行期间的产物。构建目前生成 source map，应在发布前确认是否接受源码暴露；若决定关闭，需修改构建配置并重新构建回归，不能删除运行时 JS。

## 4. 两类 ZIP 的目录结构

### Chrome Web Store：manifest 必须位于 ZIP 根目录

从 `dist` 内压缩文件，使用从未使用过的新输出文件名，避免旧 ZIP 中残留已删除文件：

```sh
cd /Users/ywr/src/haomai-chrome/dist
release_zip="/Users/ywr/src/haomai-chrome/haomai-chrome-store-$(date +%Y%m%d-%H%M%S)-$$.zip"
zip -r "$release_zip" . -x '*.DS_Store'
unzip -l "$release_zip"
```

检查列表应直接出现 `manifest.json`、`assets/...`、`src/...` 等相对条目，不能外面再包一层 `dist/`。Chrome 官方[ZIP 结构要求](https://developer.chrome.com/docs/webstore/prepare#zip-your-extension-files)明确要求 manifest 在归档根目录。不要把源码仓库、`node_modules`、`.env`、浏览器缓存或用户导出数据一起压缩。

### 少量内部试用：可以包含 dist 目录

```sh
cd /Users/ywr/src/haomai-chrome
trial_zip="/Users/ywr/src/haomai-chrome/haomai-chrome-trial-$(date +%Y%m%d-%H%M%S)-$$.zip"
zip -r "$trial_zip" dist -x '*.DS_Store'
```

同事解压后在 `chrome://extensions` 以开发者模式加载里面的 `dist`。这种试用包不等于商店发布物，不能把包含外层 `dist/` 的 ZIP 直接上传商店。解压目录保持固定；换包覆盖目录后点击扩展“重新加载”，再刷新 WhatsApp。

## 5. 手动发布到 Chrome Web Store

1. 在 Chrome Web Store 开发者后台创建或选择好麦条目；更新已有条目，不为每版新建 ID。
2. 上传本节生成的 Store ZIP，确认版本和扩展权限。
3. 填写名称、说明、图标、截图、支持联系和真实隐私政策，准确说明 WhatsApp 数据、服务器同步、媒体 OSS、AI 翻译、旧数据兼容以及数据保留/删除方式。
4. 按实际实现填写隐私与权限用途，准备审核所需的功能访问说明及受控测试账号；不提供生产管理员凭据或真实客户会话。
5. 完成团队审阅、生产验收后手动提交审核并按选择的可见性发布。本文不会自动提交、发布或安装扩展。

具体表单和流程以 Chrome 官方[首次发布说明](https://developer.chrome.com/docs/webstore/publish)为准。

## 6. 发布前后验收与回退

发布前使用生产构建和干净 Chrome Profile 验证：

1. 不运行 Vite 也可打开 popup 和完整工作台，初次默认 API 地址正确。
2. 注册/登录/忘记密码按生产真实配置执行；生产仍使用阿里云短信，不使用仅 `development` 有效的固定验证码，未配置短信时返回真实错误。
3. 正确授权 API 主机；拒绝权限、过期令牌、账号退出和浏览器重启后提示明确。
4. WS 握手、心跳、断线重连，以及 service worker 无 DevTools 时的恢复正常。
5. WhatsApp 来源发现、离线原因、手动文字和单图/语音收发、ACK、防重，以及媒体签名过期后的重新取址正常。只使用自己的测试账号和收件人，真实发送由测试者手动发起。
6. 旧安装升级保留本地设置/历史，核对已有服务器地址的优先级；当前后台模式不与端侧旧规则重复翻译或自动回复。
7. 商店实际 ID 已加入 Go 和 OSS 来源配置，生产环境不再依赖开发扩展 ID。

保留每次发布对应源码版本、构建时公开 API 地址、锁文件、ZIP 校验值、扩展 ID 和数据库/API 兼容说明。出现问题时可先关闭服务端相关功能或停止推广；扩展修复使用**更高版本号**重新上传，不能用低版本覆盖现有商店版本。开发者模式试用可恢复已知版本 `dist` 并重新加载，仍要确认它与当前服务端兼容，不清除用户存储。

本仓库自动测试不验证真实商店审核、WhatsApp 当天内部模块、真实短信或生产 OSS。上线验收记录应区分自动检查和实际外部服务联调。
