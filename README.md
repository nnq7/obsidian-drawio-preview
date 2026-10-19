# Drawio Preview

obsidian 笔记里的 drawio 图表预览插件：打开 `.drawio` 即刻出图，点击后可缩放、拖动、全屏。

基于 [doge-liang/obsidian-drawio](https://github.com/doge-liang/obsidian-drawio) 改造（MIT），只保留预览能力，同时优化性能，编辑能力依靠本地drawio软件。
<img height="520" alt="image" src="https://github.com/user-attachments/assets/f8ab32ef-5b46-4b19-b954-515b50f80e5b" />

- **只读预览**：去掉内置编辑器与在线编辑，改图仍用本地 drawio 软件 —— 预览框的「编辑」按钮直接用默认应用打开文件。多页图表可翻页。
- **预览缓存**：首次打开要渲染几秒，之后命中缓存直接出图、**不再加载 drawio 内核**，也不会再让 Obsidian 假死 1~5 秒。
- **内核预热**：「编辑」时自动后台预加载内核，下次预览更快。
- **尺寸跟随obsidian链接语法**：`![[Test.drawio]]` 自适应窗口宽度，`![[Test.drawio|400]]` 指定宽度，`![[Test.drawio|400x300]]` 指定宽高，缩放时等比适配。
- **三种外观**：浅色 / 深色 / 透明，也可以跟随 Obsidian 主题。
- **细节优化**：(1)调整滚轮缩放速度，缩放更跟手；(2)在 drawio 里保存后，笔记视图不再跳动或闪烁。

## 安装

1. 下载 `main.js`、`manifest.json`、`styles.css`。
2. 放进 `<你的仓库>/.obsidian/plugins/drawio-preview/`。
3. 重开 Obsidian，在第三方插件里启用 **Drawio Preview**。

> 该插件不能和原版的 `drawio-editor/` 同时启用，防止冲突。

## 许可

MIT，原始版权归 [doge-liang](https://github.com/doge-liang/obsidian-drawio)；本仓库只做「去编辑 + 预览增强 + 细节优化」的改造。
