# 工单：去掉两处"写回笔记"的路径 + 拖拽改高度

> 目标：**预览只读**。预览高度只由链接决定（`![[x.drawio|400x300]]`），插件不再往笔记里写任何字节。
> 用户已拍板「都删」。上游 `doge-liang/obsidian-drawio` 自带这两条写路径，改造时未删除。

## 验收条件（缺一条不算完成）

1. 在预览底边**拖不动**（没有调整高度的把手/指针变为别的光标）；
2. 拖动后笔记里**不会出现** `<!-- drawio-viewer: height=N -->`；
3. 预览里**没有"将当前页面固定在笔记中"按钮**（`.drawio-pin`）；
4. 笔记文件在以下操作前后 **md5 不变**：打开预览、点页面控件翻页、点各类按钮；
5. `![[x.drawio|400]]` / `|400x300` / 无参数自适应 / 实时跟随 / 外部保存后尺寸不被改小 / 滚动位置不跳 —— **这 6 条既有行为全部保持**；
6. `npm run build` exit 0；`npx vitest run --no-file-parallelism` 全过；部署到测试仓库并 `plugin:reload id=drawio-editor` 后真机复验。

## 执行顺序（建议）

### 第 1 步：删模块 + 删测试（机械，可直接做）
```bash
git rm src/preview/embedViewportHeight.ts src/file/pinEmbedPage.ts
git rm tests/viewportHeight.test.ts tests/embedViewportHeight.test.ts tests/pinEmbedPage.test.ts
```
保留 `src/preview/viewportHeight.ts`：它同时导出 `MIN_VIEWPORT_HEIGHT` / `MAX_VIEWPORT_HEIGHT`，
被 `src/preview/interactiveViewer.ts:2` 使用 —— 只删它的**注释读写函数**（第 6-7 行两个正则、第 29-70 行的插入/更新实现），
删完后该文件应只剩常量与必要的 clamp helper。

### 第 2 步：让 `tsc` 带你走（这就是"压缩上下文"的关键手法）
```bash
npm run build 2>&1 | head -30     # tsc -noEmit 会逐条列出所有断掉的引用
```
每条错误只读它指出的那几行，逐个修，不要通读整文件。可预期的断点：

| 位置 | 要改什么 |
| --- | --- |
| `src/file/EmbedRenderer.ts:10` | 删掉指向 `embedViewportHeight` 的**多行 import**（从 `import {` 起到 `} from '../preview/embedViewportHeight';` 止） |
| `src/file/EmbedRenderer.ts:14` | 删 `import { pinEmbedPage } from './pinEmbedPage';` |
| `src/file/EmbedRenderer.ts:298` | `const outcome = await pinEmbedPage(...)` → 连带它下面使用 `outcome` 的提示分支一起删（这是"固定页面"的反馈流程） |
| `src/file/EmbedRenderer.ts:394` | `if (name !== undefined) void pinEmbedPage(...)` → 整行删 |
| `src/file/EmbedRenderer.ts` | 去掉传给查看器的 `onHeightCommit`（高度写回的唯一触发点） |
| `src/preview/pageControl.ts` | 删 `pin` 选项：8-15（类型）、24（解构）、30-42（按钮创建 + disabled 同步）、61-63（点击回调）；`aria-label`/`title` 也一并消失 |
| `src/model/embedLink.ts` | 删 `PinRewrite` 类型（14 起）与其返回处（48 起）——用花括号配平定位 |
| `src/preview/interactiveViewer.ts` | 删拖拽：`resizeHandle`(61) / `resizeStartY`(65) / `resizeStartHeight`(66) / `resizeMoved`(67) / `applyPersistedHeight`(93) / `onHeightCommit`(443) / `viewportHeight` 字段与赋值(68, 514) / `createResizeHandle()` 及其指针监听；`MIN/MAX_VIEWPORT_HEIGHT` 若仅被这里用到，可改成本地常量 |
| `tests/embedRendererMobile.test.ts:38`、`tests/embedSize.test.ts:27` | 删掉这两处 `vi.mock('../src/preview/embedViewportHeight', …)` |

### 第 3 步：⚠️ 别弄坏"翻页不改变插入高度"
`interactiveViewer.ts` 13-14 行的 `preserveViewportHeight` 与拖拽高度**共用同一套状态**。
删完拖拽后要确认：**点页面控件翻页，预览高度不变**（这条要有真机证据，不是"看着没报错"）。

### 第 4 步：验证
```bash
npm run build
npx vitest run --no-file-parallelism          # 必须看到 "Tests N passed"，别只看 exit code
cp main.js styles.css "E:/BaiduSyncdisk/测试仓库/.obsidian/plugins/drawio-editor/"
"D:/SoftWare/Obsidian/Obsidian.com" plugin:reload id=drawio-editor
```
真机探针（**每条第一句闸门** `if(app.vault.getName()!=="测试仓库") return "闸门";`）：
- 打开一篇带 `![[111.drawio|400]]` 的笔记（**可见标签页 + 阅读模式**，否则会量到 0×0 假象），
  断言：外框宽 400；`.drawio-pin` 不存在；预览里没有 resize 把手元素；
- **笔记 md5 前后一致**：开预览 → 翻页 → 点按钮，前后 `md5sum` 必须相同（这是本工单的核心验收）；
- 回归：无参数 = 自适应宽度、`|400x300` = 400×300、改数字 ≥160ms 后生效、外部改 `.drawio` 后宽度仍 400 且滚动不跳。

## 背景资料（避免重新侦察）

- 写回注释的正则是 `^[\s>]*<!--\s*drawio-viewer:\s*height=(\d+)\s*-->$`（`src/preview/viewportHeight.ts:6`）；
- 写路径在 `src/preview/embedViewportHeight.ts`；页面固定在 `src/file/pinEmbedPage.ts`；
- 预览容器类：`.drawio-preview`；嵌入宿主：`.internal-embed`（尺寸由 `src/preview/embedSize.ts` 管理，**不要动它**）；
- 尺寸功能的既有实现要点：外层+内层同时写 `width`、内层带 `max-width: 100%`、`setDimension` 必须幂等（监听 `style` 会自激）、
  滚动锚定在"预览高度真的变化"时复位 `scrollTop`、防抖 160ms。**本次手术不得触碰这条链路。**
