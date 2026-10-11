# 打包与同事试用说明

适用于将 WA Web Translate Chrome 扩展交给少量熟悉的同事试用，当前版本为 `0.1.0`。

## 打包

打包者需要已安装 Node.js、pnpm 和项目依赖（首次可在项目根目录执行 `pnpm install`）。在项目根目录运行：

```sh
cd /Users/ywr/src/wa-web-translate &&
pnpm build &&
rm -f wa-web-translate-0.1.0.zip &&
zip -r wa-web-translate-0.1.0.zip dist
```

`pnpm build` 执行 `tsc -b --noEmit && vite build`，生成 `dist/`。以上命令仅在构建成功后删除同名旧 ZIP 并重新压缩，避免旧包残留已移除的文件；构建失败时停止，不会继续压缩。

打包产物为项目根目录下的 `wa-web-translate-0.1.0.zip`，只包含构建后的 `dist/`。将这个 ZIP 发给同事即可，接收者不需要安装 Node.js 或 pnpm。版本更新时，将命令中的两处 ZIP 文件名同步改为新版本号。

## 同事安装与试用

1. 将 ZIP 解压到固定目录，得到 `dist/` 文件夹。
2. 在 Chrome 地址栏打开 `chrome://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择解压后的 `dist/` 文件夹。
4. 保留该文件夹及其所在目录，安装后不要移动或删除。
5. 从插件的“打开设置”进入配置页，选择 AI 服务商，填写自己的 API Key，设置自己的母语和对方语言。
6. 打开并登录 [WhatsApp Web](https://web.whatsapp.com/)，开始试用；若页面已经打开，安装后刷新页面。

本机 API Key、已填写的商品与支付配置及聊天历史保存在当前浏览器的扩展本地存储中，不会随构建包携带；当前没有配置导入导出功能，同事需要自行填写。
