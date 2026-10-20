# Drawio Preview

obsidian 笔记里的 drawio 图表预览插件：打开 `.drawio` 即刻出图，点击后可缩放、拖动、全屏。
<img width="1080" alt="动画2" src="https://github.com/user-attachments/assets/c70cce74-0450-41e3-a9e8-8aeb98738f99" />

- **只读预览**：内置drawio预览内核，改图仍用本地 drawio 软件 —— 预览框的「编辑」按钮直接用默认应用打开文件。多页图表可翻页。
- **预览缓存**：首次打开和编辑时要渲染几秒，之后命中缓存直接出图、**不再加载 drawio 内核**。
- **内核预热**：「编辑」时自动后台预加载内核，下次预览更快。
- **尺寸跟随obsidian链接语法**：`![[Test.drawio]]` 自适应窗口宽度，`![[Test.drawio|400]]` 指定宽度，`![[Test.drawio|400x300]]` 指定宽高，缩放时等比适配。
- **三种外观**：浅色 / 深色 / 透明，也可以跟随 Obsidian 主题。

## 安装

1. 下载 `main.js`、`manifest.json`、`styles.css`。
2. 放进 `<你的仓库>/.obsidian/plugins/drawio-preview/`。
3. 重开 Obsidian，在第三方插件里启用 **Drawio Preview**。

## 许可
MIT

