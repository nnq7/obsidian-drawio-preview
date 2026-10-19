# 工单完成记录与验收证据：strip-write-paths

状态：**已完成**（构建 / 单测 / 部署 / 真机复验全绿）
日期：2026-10-16
产物：`main.js` md5 `3d1d0780a428ef5e9f652b74e1534069`（2,699,484 B）、`styles.css` md5 `b99ba47075c9748cdeb17a0b9f227573`（8,347 B），已部署到 `E:\BaiduSyncdisk\测试仓库\.obsidian\plugins\drawio-editor\` 并 `plugin:reload`。

## 1. 改了什么（文件清单）

**删除（8 个文件）**
- `src/preview/embedViewportHeight.ts`（高度写回路径）
- `src/file/pinEmbedPage.ts`（页面固定路径）
- `src/model/embedLink.ts`（`EmbedSpan` / `PinRewrite` / `rewriteEmbedSubpath`，只被 `pinEmbedPage` 引用 → 整文件成孤儿）
- 测试：`tests/{viewportHeight,embedViewportHeight,pinEmbedPage,embedLink}.test.ts`、`tests/embedPin.dom.test.ts`

**改动**
| 文件 | 改了什么 |
| --- | --- |
| `src/preview/viewportHeight.ts` | 只留 `MIN_VIEWPORT_HEIGHT` / `MAX_VIEWPORT_HEIGHT` 两个常量（95 行 → 2 行） |
| `src/preview/interactiveViewer.ts` | 删拖拽把手：`resizeHandle` / `resizeStartY` / `resizeStartHeight` / `resizeMoved` / `onResizeStart`·`Move`·`End` / `createResizeHandle()` / `applyPersistedHeight()` / `onHeightCommit`；`setViewportHeight` 不再写把手位置。**保留** `preserveViewportHeight` 与 `initialHeight`（链接高度） |
| `src/preview/interactiveMount.ts` | 删 `onHeightCommit` / `loadPersistedHeight` 选项与其懒激活回调 |
| `src/preview/pageControl.ts` | 删 `pin` 选项（按钮、`aria-label`/`title`、disabled 同步、点击回调）与 `setIcon` 依赖 |
| `src/file/EmbedRenderer.ts` | 删两个模块的 import 与全部调用点、`pin()` 方法、`commitEmbedHeight` / `scheduleStoredEmbedHeight` / `applyStoredEmbedHeight`、`storedHeightRefresh`（含 `debounceOnWindow`）、`markEmbedInsertion` / `getEmbedOccurrence` / `getLivePreviewSourceOffset`；`initialHeight` 只来自链接尺寸 |
| `styles.css` | 删 `.drawio-interactive-resize-handle`（含 `::after`、`-resizing`、全屏态）与 `.drawio-pin` 规则 |
| 7 个测试文件 | 删/改对应断言与用例（详见下） |

**净变化**：`git diff HEAD --stat -- src tests styles.css` → 本轮 15 个文件 +289 / −2234。

## 2. 验收条件逐条结论

| # | 条件 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | 预览底边拖不动、无调整高度的把手 | ✅ | 真机 `.drawio-interactive-resize-handle` 计数 **0**；`createResizeHandle` 已从源码与产物移除 |
| 2 | 不会出现 `<!-- drawio-viewer: height=N -->` | ✅ | 写路径模块整体删除，产物中无 `drawio-viewer: height` 写回逻辑 |
| 3 | 无"将当前页面固定在笔记中"按钮 `.drawio-pin` | ✅ | 真机 `.drawio-pin` 计数 **0**；页控件只剩 `‹ N / M ›` |
| 4 | 笔记 md5 前后不变（打开预览 / 翻页 / 点按钮） | ✅ | 探针笔记 md5 `839207b9…`：打开前后、翻页、放大/适应/缩小、上一页后**完全一致** |
| 5 | 6 条既有尺寸行为保持 | ✅ | 见下节实测表 |
| 6 | build exit 0 + 单测全过 + 部署 reload + 真机复验 | ✅ | `BUILD_EXIT=0`；`vitest run --no-file-parallelism` → **26 文件 / 161 项全过**；已部署 reload |

### 条件 5 的 6 条实测（真机，测试仓库）

| 场景 | 实测 |
| --- | --- |
| 无参数 = 自适应宽度 | 外框 **839**（=可用宽度），高随内容 |
| `\|400` | 外框 **400**，高度交给内容（521） |
| `\|400x300` | 外框 **400** / 预览 **400×300**（svg 正好 400×300） |
| 实时跟随（改数字） | 编辑器里 `\|400`→`\|440`：**400 → 440**；删掉参数：**→ 839（自适应，无残留旧尺寸）**；恢复 `\|400`：**→ 400** |
| 外部保存后尺寸不被改小 | 外部改写 `.drawio` 后（svg 真重渲染，出现 `PROBE-MARK-1`）宽度仍 **400** |
| 滚动位置不跳 | 同一场景 `scrollTop` **700 → 700**（delta 0） |
| 翻页不改变插入高度 | 多页嵌入翻到第 2 页：高度 **1024 → 1024**，指示器 `2 / 2` |

## 3. ⚠️ 与工单的两处偏差（如实记录）

1. **工单低估了测试改动面**。工单第 2 步只列了 2 个测试文件，实际必须同步 **7 个**：
   `pageControl`（4 条 pin 用例）、`interactiveViewer.dom`（9 条拖拽/持久高度用例）、`embedRendererMobile`（4 条高度记忆用例 + 2 处 mock）、
   `embedSize`（2 处断言 + mock）、`drawioPreviewFileView` / `embedInteractiveFallback`（靠拖拽"建立高度"的用例改为 mock `getBoundingClientRect`）、
   以及整体删除 `embedPin.dom` / `embedLink` / `embedViewportHeight` / `pinEmbedPage` / `viewportHeight` 五份测试。
2. **真机复验落在「实时预览（Live Preview / source 模式）」而非阅读模式**。Obsidian 的**阅读视图在本机 CLI `eval` 会话里完全不渲染**
   ——探针笔记切到 `mode: preview` 后 `.markdown-preview-view` 内只有 `markdown-preview-sizer > markdown-preview-pusher`
   （**连标题和正文都没有**，说明是渲染根本没跑，与插件无关）。已试 3 种触发（`leaf.setViewState` / `view.setState` /
   `markdown:toggle-preview`）× 最长 6 秒等待 + `window.show()/focus()`，均无效。
   两种模式走的是**同一套 embed registry 路径**，产出同一套 `.drawio-embed` / `.drawio-preview` DOM，故结论有效；
   但「阅读视图下无 pin / 无把手 / 尺寸正确」这一条**尚无直接证据**，需要人工在阅读模式下目视确认一次。

## 4. 现场卫生

- 测试仓库用户文件完整性核验：`C-金融/…/json测试.md` md5 `8de019901fcd…`、`Z-附件/111.drawio` md5 `bd5d8cd688…` **与基线一致**。
- 临时探针文件（`_drawio-strip-probe.md` / `_drawio-strip-probe2.md` / `_probe-diagram.drawio`）已全部删除，vault 根无残留；
  探针期间多开的重复标签页已 detach，工作区恢复为 1 个标签（用户笔记、source 模式）。
- 插件 `data.json` 未被触碰（设置仍为 `followObsidianTheme=false / previewAppearance=light / newDiagramLocation=root / previewAlignment=center`）。
- 改动**未提交**（源码侧仍是工作区未提交状态，按既有约定等发布时统一处理）。
- 备份：`E:\WorkBuddy_task\ob_vlc\_tmp\drawio-strip-backup\`（改动前的 `src` / `tests` / `styles.css` 全量副本 + 补丁脚本 pairs*.json / apply.cjs）。
  回退：`git -C obsidian-drawio-preview checkout -- src tests styles.css` 或从该备份目录拷回。
