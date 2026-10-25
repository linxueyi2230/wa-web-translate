# 打包与同事试用说明

适用于将好麦 Chrome 扩展交给少量熟悉的同事试用。正式商店发布请看[上线部署](DEPLOYMENT.md)，本地加载和服务端准备见[本地调试](LOCAL_DEBUG.md)。

## 打包

打包者推荐使用 Node.js 26（本轮使用 26.4.0 验证）、Yarn 4.18.0 和项目依赖。其他受支持的 Node 版本及 Corepack 准备见[本地调试](LOCAL_DEBUG.md#1-准备环境)；若缺失，可用 `npm install --global corepack@0.34.5` 安装兼容推荐 Node 的工具，项目依赖统一使用 Yarn。先构建，再打包；每条命令成功后再执行下一条。把示例 API 域名替换为同事可以访问的真实 HTTPS 地址，远程电脑不能访问你电脑上的 `127.0.0.1`。

```sh
corepack enable
cd /Users/ywr/src/haomai-chrome
yarn --version
yarn install --immutable
yarn test
VITE_HAOMAI_API_BASE_URL=https://api.example.com/api/v1 yarn build
trial_zip="/Users/ywr/src/haomai-chrome/haomai-chrome-trial-$(date +%Y%m%d-%H%M%S)-$$.zip"
zip -r "$trial_zip" dist -x '*.DS_Store'
```

`yarn build` 执行 `tsc -b --noEmit && vite build`，生成 `dist/`。构建或测试失败时不要继续打包；新输出文件名避免旧 ZIP 残留已删除文件。不要压缩正在运行 `yarn dev` 的产物。

`yarn --version` 应输出 `4.18.0`；使用已提交的 `yarn.lock` 和 `.yarnrc.yml`，不在打包时改写依赖锁文件。

打包产物是项目根目录内带时间戳的 `haomai-chrome-trial-*.zip`，只包含构建后的 `dist/`，接收者无需 Node.js 或 Yarn。**这是内部试用 ZIP**；Chrome Web Store ZIP 必须直接以 `manifest.json` 为根条目，不能外包 `dist/`，具体打包方式见[上线部署](DEPLOYMENT.md#4-两类-zip-的目录结构)。

## 同事安装与试用

1. 将 ZIP 解压到固定目录，得到 `dist/` 文件夹。
2. 在 Chrome 地址栏打开 `chrome://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择解压后的 `dist/` 文件夹。
4. 保留该文件夹及其所在目录，安装后不要移动或删除。
5. 在扩展管理页记下该电脑上的扩展 ID，请后端部署者将 `chrome-extension://实际ID` 加入 API 来源白名单。点击工具栏的“登录好麦”打开完整工作台；API 地址已由打包者通过 `VITE_HAOMAI_API_BASE_URL` 设置。提交登录或点击“获取验证码”时，允许 Chrome 请求的对应 API 主机访问权限，无需填写服务器地址。浏览器已有地址仍优先于构建默认值；请求旧主机时由维护者核对本地旧配置，不自动覆盖或清理历史数据。
6. 打开并登录 [WhatsApp Web](https://web.whatsapp.com/)，开始试用；若页面已经打开，安装后刷新页面。

同事使用后台模式时，业务数据来自其好麦账号的服务器。生产注册与找回密码需要部署者配置阿里云短信；仅本地 `development` 可配置固定验证码 `123456`，仍须先点击“获取验证码”取得挑战，详见[本地调试](LOCAL_DEBUG.md#5-最小联调顺序)。当前界面不提供独立模式切换入口，旧 API Key 和本地业务数据继续保留兼容。

已有浏览器的 API Key、本地商品/支付配置和独立模式聊天历史不会随构建包携带；没有通用本地配置导入导出功能。更新时保留原目录和扩展安装，替换构建文件后点击“重新加载”并刷新 WhatsApp，避免卸载导致本地数据丢失。
