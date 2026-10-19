# 交接：Drawio Preview **文件直读缓存**（用户定稿方案）

> 新会话读完这份就够 ✓。**不要**去看旧的 `lazy-preview-render/HANDOFF.md`（那是过时方案 ✗）。
> 工程：`E:\WorkBuddy_task\ob_vlc\obsidian-drawio-preview`
> 部署：`E:\BaiduSyncdisk\测试仓库\.obsidian\plugins\drawio-preview`
> 发布仓库：`https://github.com/nnq7/obsidian-drawio-preview`

---

## 0. 目标（用户定稿，别再改设计 ✗）

**一个文件一个 SVG 的极简缓存**，不建索引、不做内存镜像、不做写队列：

- 目录：`<vault>/<configDir>/plugins/<id>/cache/`（首次写时自动建 ✓）
- 文件名：**`<文件名>.<页码>.<CRC32>`**（例：`测试.drawio.0.a1b2c3d4`，页码 0 起 ✓）
- 容量：**15 MB** 上限，超限按 mtime 删最旧 ✓；**同一 `<文件名>.<页码>` 只保留最新 1 个** ✓
- **命中 ⇒ 直接注入 SVG，完全不加载 drawio 核心** ✓✓
- 未命中 ⇒ 正常渲染 → 写缓存 ✓
- **核心加载只发生在两处**：① 缓存未命中 ② 用户点「编辑」后（此时他已在 drawio 里 ✓）
- **移动端**：不做编辑、不做缓存、不做预热（只预览 ✓）
- **不需要**路径哈希（用户已论证：同名 + 同 CRC = 同内容 = 同一张图 ✓）

## 1. 现状（2026-10-18 17:59 实测）

| 项 | 状态 |
|---|---|
| **测试仓库的插件** | **权威 1.0.1** ✓ `main.js` md5 **`27ac0cd8aca681a0b9102c2d9b36c1a`**、v1.0.1、id `drawio-preview` ✓ **别动它** |
| 工程分支 | `dev/render-cache`（提交 `b73c4c5` ✓）= **1.0.1 + 旧缓存（复杂方案 ✗）** + 我新写的两个模块 ✓ |
| 构建/测试 | exit 0 ✓ / **34 文件 219 项全绿** ✓（219 = 211 + 新模块的 8 项 ✓） |
| 新方案模块 | `src/preview/crc32.ts` ✓、`src/preview/svgFileCache.ts` ✓、`tests/svgFileCache.test.ts` ✓（**未跟踪文件**，`git checkout -- src/` 不会删它们 ✓ 但 `git clean` 会 ✗ 别用 ✓） |

**判据（认源码的唯一标准 ✓）**：`npm run build` 出来的 `main.js` md5 **必须等于 `27ac0cd8…`** 才叫"干净 1.0.1 源码"。
（当前 dev 构建是 `17ad5d4d…` = 1.0.1+旧缓存，**不等** ✓ 属预期 ✓）

## 2. 要做的四步

### 第 1 步：清掉旧缓存在 `settingsTab.ts` / `settings.ts` 的痕迹
> ⚠️ **必须按行号删，不要写"自动扩句"脚本** ✗（今天栽过：它把文件头一起删了 ✗）

1. `sed -n '90,170p' src/settingsTab.ts` 打印出来，**确认三段的确切首尾行**：
   - 「预览缓存上限」滑块段（约 94–122，含 `cacheLimitDesc(...)`、`this.cacheTimer`）
   - 「清空预览缓存」按钮段（约 135–145，引用 `purgeAll` / `currentSyncEnv`）
   - 「占用 X MB / Y 条」显示段（约 148–158，引用 `getCacheStats`）
2. 按行号整段删除；再删三个 helper：`cacheLimitDesc()`、`clearPreviewCache()`、字段 `cacheTimer`
3. `src/settings.ts`：删 `cacheLimitMB` 的**类型字段**与**默认值**两行
4. `npm run build` → **md5 必须 == `27ac0cd8…`**
   若不等 ✗：`grep -rn "cacheLimitMB\|cacheLimitDesc\|getCacheStats\|purgeAll\|currentSyncEnv\|clearPreviewCache\|cacheTimer" src/` 找残留，继续删（**不要**猜 ✗）

### 第 2 步：把新方案接上
1. 在 `src/preview/ViewerRenderer.ts` 里加一个导出函数（约 25 行）：
```ts
export async function renderPreviewCached(
  el: HTMLElement, xml: string, opts: RenderOptions, sourceName: string, dir: string | null,
): Promise<boolean> {
  const page = opts.page ?? 0;
  const crc = crc32Hex(xml);
  const hit = await readCache(dir, cacheFileName(sourceName, page, crc));
  if (hit) {
    const parsed = new DOMParser().parseFromString(hit, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root && root.tagName.toLowerCase() === 'svg') {
      el.empty();
      el.dataset.appearance = opts.appearance ?? (opts.dark ? 'dark' : 'light');
      const host = el.parentElement;
      if (host && el.dataset.appearance) host.dataset.appearance = el.dataset.appearance;
      el.appendChild(el.ownerDocument.importNode(root, true));
      return true;               // ← 命中：**不加载核心** ✓✓
    }
  }
  const ok = renderPreview(el, xml, opts);
  if (ok) {
    const svg = el.querySelector('svg');            // ⚠️ 别用 extractSizedSvg 的返回值（可能是 Fragment ✗）
    if (svg) { try { void writeCache(dir, cacheFileName(sourceName, page, crc), new XMLSerializer().serializeToString(svg)); } catch { /* 软失败 */ } }
  }
  return ok;
}
```
2. **两处 async 入口**改成调用它（都在 `src/file/EmbedRenderer.ts`，两个函数本来就是 async ✓）：
   - 类内 `render()`：`renderPreview(preview, xml, { ...this.plugin.previewOpts(), page: this.currentPage })`
     → `await renderPreviewCached(preview, xml, { ...this.plugin.previewOpts(), page: this.currentPage }, this.file.name, cacheDir(this.plugin.app, this.plugin.manifest.id))`
   - 回退路径 `renderEmbedInto()`：`renderPreview(preview, xml, { ...plugin.previewOpts(), page: currentPage })`
     → `await renderPreviewCached(preview, xml, { ...plugin.previewOpts(), page: currentPage }, file.name, cacheDir(plugin.app, plugin.manifest.id))`
3. **「编辑」按钮预热核心**（`onEdit` 回调里，`openWithDefaultApp(...)` 之后）：
```ts
const idle = (window as any).requestIdleCallback;
const warm = () => { try { ensureViewerLoaded(this.containerEl.ownerDocument); } catch {} };
idle ? idle(warm, { timeout: 2000 }) : setTimeout(warm, 800);
```
4. 移动端：编辑按钮不显示（`Platform.isDesktopApp` 判断 ✓）；缓存/预热已由模块自身 no-op ✓

### 第 3 步：测试
- `npx vitest run --no-file-parallelism` → **219+ 全绿**（新模块的 8 项已绿 ✓）
- 补 1–2 项集成测试更好：**命中路径不调用 `ensureViewerLoaded`** ✓✓（可 mock 一个计数）

### 第 4 步：真机验收（测试仓库 ✓，闸门第一句 `if (app.vault.getName() !== '测试仓库') return`）
1. 部署 dev 构建（`cp main.js styles.css <插件目录>`）→ **硬重载**：
   `app.plugins.disablePlugin('drawio-preview')` → 300ms → `enablePlugin(...)`
2. 打开一篇带 `![[111.drawio|400]]` 的笔记 → 首次渲染 → **看 `<插件目录>/cache/` 是否生成 `111.drawio.0.<crc>`** ✓
3. **关键**：`delete window.GraphViewer` + `delete document.head.dataset['drawioViewerLoaded']` → 改笔记文本触发重渲染 → 断言 **`window.GraphViewer === undefined` 且预览仍有 `<svg>`** ✓✓
4. 翻页/回翻有图 ✓、含 `&nbsp;` 的图无红框 ✓、多嵌入笔记（`C-金融/C1-期货/C1.0-片段/json测试.md` ✓）正常 ✓
5. 改 `.drawio` 内容（CRC 变）→ 打开 → 应**重新渲染并生成新缓存**，旧 CRC 文件被删 ✓
6. 容量：写一堆图超 15MB → 旧文件按 mtime 被删 ✓

## 3. 今晚踩过的坑（**每一条都会让你白干一轮**）

| # | 坑 | 结论 |
|---|---|---|
| 1 | 用 `el.innerHTML` 存 SVG ✗ | `&nbsp;` 实体 ⇒ XML 解析报 `Entity not defined` ✗ ⇒ **必须 `XMLSerializer`** ✓ |
| 2 | 存 `extractSizedSvg()` 的返回值 ✗ | 它可能是 **DocumentFragment**，append 后即清空 ⇒ 缓存是空的 ⇒ "翻页后只剩一条" ✗ ⇒ **取 `el.querySelector('svg')`** ✓ |
| 3 | 以为工程仓库 `main` 就是 1.0.1 ✗ | `main` = `6d05ce6` 是 **1.0.0 时代**（`appearance` 0 处 ✗）⇒ **1.0.1 源码只在 `b73c4c5`** ✓ |
| 4 | 切分支被 `main.js` 挡住 ✗ | `main.js` 是**被 git 跟踪的构建产物** ⇒ 先 `git checkout -- main.js styles.css` ✓ |
| 5 | 只信 `plugin:reload` ✗ | 目录改名/内部 API 拉起后它可能不生效 ⇒ **必须 disable→enable 硬重载** ✓ |
| 6 | 用 shell 内联拼脚本改源码 ✗ | 引号/CRLF/索引全出过事 ⇒ **Write 成 `.cjs` 再跑** ✓，锚点**按行 + 花括号配平** ✓，命中数断言 + fail-closed ✓ |
| 7 | **"自动扩句删除"** ✗（今天刚栽 ✓） | 它把 `settingsTab.ts` 的文件头一起删了 ⇒ **UI 段一律按行号删** ✓ |
| 8 | `PATH` 漏了 `:$PATH` ✗ | 会 `node: command not found` ⇒ `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"` ✓ |

## 4. 回退 / 恢复

```bash
# A) 源码回到 dev/render-cache 的已提交状态（会保留未跟踪的 crc32/svgFileCache ✓）
cd "E:/WorkBuddy_task/ob_vlc/obsidian-drawio-preview" && git checkout -- . && npm run build

# B) 测试仓库装回权威 1.0.1（4 文件全部来自 2e2d3fd ✓）
#    用 raw 下载这 4 个文件覆盖部署目录，然后硬重载：
#    https://raw.githubusercontent.com/nnq7/obsidian-drawio-preview/2e2d3fd/{main.js,manifest.json,styles.css,versions.json}
#    期望 main.js md5 = 27ac0cd83aca681a0b9102c2d9b36c1a ✓
```

## 5. 禁区

- **别动** 冻结外框（`min-height`）、背景下沉（`data-appearance` 写到宿主）、`pin`、`embedSize.ts` —— 都是用户实测确认过的 ✓
- **别改** `manifest.json` 的 id/version（`drawio-preview` / `1.0.1` ✓）
- **别动** 测试仓库里正在跑的 1.0.1，除非要部署新构建做验收 ✓
- 测试只能在 `E:\BaiduSyncdisk\测试仓库` 跑（`WorldForOne` 是正式库 ✗）

## 6. 常用命令

```bash
cd "E:/WorkBuddy_task/ob_vlc/obsidian-drawio-preview"
npm run build                                   # 先 tsc：类型错会拦住 main.js 重建
npx vitest run --no-file-parallelism            # 串行；并行会 EPERM
md5sum main.js                                  # 对照 27ac0cd8… / 17ad5d4d…
"D:/SoftWare/Obsidian/Obsidian.com" plugin:reload id=drawio-preview
"D:/SoftWare/Obsidian/Obsidian.com" eval 'code=...'   # eval 里顶层 return 非法 ⇒ 包成 (()=>{…})()
```

---

## 7. 执行结果（2026-10-18 18:40 · 四步全通 ✓）

| 步骤 | 结果 |
|---|---|
| 1 清旧缓存接线 | ✓ 构建 md5 = **`27ac0cd83aca681a0b9102c2d9b36c1a`**（与权威 1.0.1 字节级一致，2,702,860 B）。⚠️ 你给的 `27ac0cd8aca681a0b9102c2d9b36c1a` 少一位（31 字符），正确值见左 |
| 2 接新方案 | ✓ `renderPreviewCached()` + 两处 async 入口 + **两处翻页回调**（+ `flipChain` 串行化）+ `onEdit` 后 `warmViewerLater()` |
| 3 测试 | ✓ **35 文件 220 项全绿**（216 + 新增 `tests/renderPreviewCached.dom.test.ts` 4 项：命中免库 / CRC 不符算未命中 / 失败不写盘 / 无 dir 照常渲染） |
| 4 真机验收 | ✓ 见下 |

**真机（测试仓库，dev 构建 `3a0c5834…` 已部署）**
- 首开未命中 ⇒ 出图 + 写 `111.drawio.0.a332c02d` ✓
- 清 `window.GraphViewer` + 哨兵后重开 ⇒ **`svg=1 && GraphViewer===undefined`** ✓✓
- **翻到已缓存页同样 `GraphViewer===undefined`** ✓（比预期更好）
- 同名同内容 ⇒ 同 CRC 同文件 ✓；改内容 ⇒ 新 CRC 文件生成、旧 CRC 被删 ✓；多嵌入 2/2 ✓；15 MB 上限由 `pruneToLimit` 单测覆盖 ✓

**新踩到的坑（已并入 MEMORY-细节 §11.7）**
1. ⚠️⚠️ **`disablePlugin→300ms→enablePlugin` 不足以换代码** —— 新缓存一个文件都不写，看着像"功能没生效"。
   正解：`app.plugins.unloadPlugin(id)` + `loadPlugin(id)`。
2. ⚠️ 翻页变异步 ⇒ 4 个 `vi.mock('.../ViewerRenderer')` 的测试要补 `renderPreviewCached`；3 个翻页断言要 `await tick()`。
3. ⚠️ `cacheDir()` 必须对 `app/manifest/adapter.getBasePath` 全程软失败（测试替身没有 `manifest`）。
4. ⚠️ 真机计数要先 detach `drawio-preview` 类型 leaf（打开 `.drawio` 文件会留一个常驻 `.drawio-preview` 带偏计数）；
   阅读模式程序化打开不渲染内容 ⇒ 用「小探针笔记 + 顶部嵌入」验收。

**回退**（备份已移出工程目录，避免 `git add` 误带 2.7MB 二进制）

```bash
# 部署回权威 1.0.1（md5 = 27ac0cd83aca681a0b9102c2d9b36c1a）
cp "E:/WorkBuddy_task/ob_vlc/_tmp/drawio-file-cache/golden-1.0.1/main.js" \
   "E:/BaiduSyncdisk/测试仓库/.obsidian/plugins/drawio-preview/main.js"
# 然后在 Obsidian 里 unloadPlugin('drawio-preview') + loadPlugin('drawio-preview')

# 源码回 dev/render-cache 已提交状态（会保留未跟踪的 crc32/svgFileCache 与两条新测试）
git checkout -- src tests && npm run build
```

## 8. 收尾状态（2026-10-18 19:00）

- **旧分支的缓存功能代码已全部删除**：`src/preview/{svgCache,svgCacheSync,svgDiskCache,nodeDiskAdapter}.ts` +
  对应 4 个测试；`tests/obsidian-stub.ts` 里为缓存滑块加的 `SliderComponent/addSlider` 也一并撤掉
  （**与 1.0.1 主干版本逐字节一致，`git diff b73c4c5^` 为空**）。
- **旧方案的文档也一起删了**：`.scratch/lazy-preview-render/{HANDOFF,ticket}.md`（用户 2026-10-18：
  「旧代码和功能一起删」）。`.scratch/strip-write-paths/` 是 1.0.1 的写路径记录，**保留**。
- 现在 `src/` 里只剩「1.0.1 主干 + 新方案」：新增 `crc32.ts`、`svgFileCache.ts`，改 `ViewerRenderer.ts`、
  `EmbedRenderer.ts`，其余 4 个文件只是把旧缓存的接线删掉（回到主干）。
- 删完后：**构建 exit 0，md5 仍是 `3a0c5834…`**（死代码不影响产物 ⇒ 已部署的那份仍然是最新）；
  **31 文件 195 项全绿**（220 − 旧缓存 25 项）。
- 按用户决定：**改动不提交**（保持未提交态）、测试仓库**继续跑 dev 版**。
- 备份位置：`E:/WorkBuddy_task/ob_vlc/_tmp/drawio-file-cache/`（`golden-1.0.1/main.js` = 权威 1.0.1；
  `backup-step1-*/` = 改前的 5 个文件）。

---

## 9. 2026-10-18 · 缓存大小滑块 + 整体重构（行为不变）

### 9.1 新功能：缓存大小滑块
- 设置页新增「缓存大小上限」滑块：**10–100 MB，步长 1，默认 15 MB**，桌面端显示（缓存本身只在桌面端存在）。
- 上限真正生效：`writeCache(...)` 多一个 `limitBytes` 参数；`renderPreviewCached` 改收 `PreviewCacheTarget { dir, limitBytes }`。
- 拉动滑块后 **400ms 防抖**再 `pruneToLimit`，所以"改小立即释放"是即时的，但拖动过程中不反复删文件。
- `cacheLimitBytes(mb)` 把 MB→字节并夹到 10–100；`data.json` 被手改成非数字时回落到 15（否则 NaN 会被判成"超预算"而清空缓存）。

### 9.2 重构（删死代码 / 死分支 / 多余封装，行为不变）
| 类别 | 处置 |
|---|---|
| 零引用模块 | 删 `src/model/DrawioSource.ts`、`src/preview/interactiveMount.ts`（3 个调用点改为直接 `new InteractiveViewerController(...)` + `bindSvg`）|
| 2 行模块 | `src/preview/viewportHeight.ts` 内联进 `interactiveViewer.ts` 后删除 |
| 死导出 | 删 `svgFileCache.clearCacheDir`（"清空缓存"按钮已不存在）、`xmlUtils.extractDiagramTitle`（只被测试用）、`enable`… |
| 测试专用代码 | `dualFormat.buildInitialSvg` + `escapeXmlAttr` 移到 `tests/legacySvgFixture.ts`；`dualFormat.ts` 里那段**没有函数体的悬空注释**（`replaceXmlInSvg` 被删后留下的）一并删掉 |
| 死分支 | 预览版所有调用点都是 `isEnabled: () => true` ⇒ 删掉 `InteractiveViewerOptions.isEnabled`、4 处开关判断、`mountInteractiveViewer` 的懒激活路径 |
| 死变量/死监听 | `observeEmbedSizes` 里为"滚动锚定"留的 `anchors` WeakMap、`scroll` 捕获监听、`scrollHost()`、`before`、`scroller` 全部删除（补偿逻辑早已移除，只剩空转）|
| 自馈循环 | `attributeFilter` 从 `['width','height','style']` 收窄为 `['width','height']` —— 我们自己的写入也走 inline style，原来会 160ms 一次自己喂自己 |
| 多余防御 | `cacheDir()` 两段 try/catch 合一、去掉 `?? '.obsidian'`；`readCache` 去掉 `length > 16` 魔法阈值；`updateControls` 去掉按钮必然已赋值的守卫 |
| 注释/格式 | 修 `EmbedRenderer` 里"sourcePath 已不用"的过时注释、`registerDesktopFeatures` 里描述已不存在入口的注释、`settingsTab` 头部过长的历史说明；修 `main.ts` 三行 0 缩进 |

**明确没做**（避免行为风险，留给后续）：`EmbedRenderer` 的 registry 路径与 post-processor 回退路径仍有 ~80 行结构重复；
`interactiveViewer` 的 fullscreen/prototype 检查保留（jsdom 无这些 API，测试依赖该分支）。

### 9.3 验证
- `npm run build` exit 0，产物 md5 `3fea0f6b…`（两次构建一致）。
- `npx vitest run --no-file-parallelism`：**31 文件 197 项全绿**。
- 真机（测试仓库）：滑块 `min=10 / max=100 / step=1 / value=15` ✓；清 `window.GraphViewer`+哨兵后打开已缓存笔记 ⇒
  `svg=1 && GraphViewer===undefined` ✓（命中路径未回归）。
- 顺手清掉 `data.json` 里旧 dev 版留下的 `cacheLimitMB: 10`（备份在 `_tmp/drawio-file-cache/data.json.before-cacheLimitMB-removal`），
  否则默认值会显示 10 而不是 15。

---

## 10. 2026-10-18 · 修「翻页后高度不自适应」（方案 B，行为变更已确认）

**根因**（详见 §9 之后那次定位）：`embedSize.observeEmbedSizes` 的 `attributeFilter` 里去掉了 `'style'`，
导致旧版那套「observer 把查看器写的内联高度清掉」的补偿机制消失，框高被钉在第一页。

**方案 B**：高度只由「当前 SVG 的宽高比」决定，删掉跨页保留。
- 删 `BindSvgOptions` / `preserveViewportHeight`：`bindSvg(svg)` **每次都重新计算**视口高度。
- 3 个翻页调用点（registry / post-processor 回退 / `.drawio` 文件视图）不再传该选项。
- `manuallyResized` 语义收敛为「链接自己钉了高度」（`initialHeight !== undefined`），只在窗口 resize 时跳过重算。

**结果**
| 场景 | 翻页前 | 翻页后 |
|---|---|---|
| `![[111.drawio\|400]]`（无高度） | 519.4px（506×657） | **315.4px**（506×399）✓ 自适应 |
| `![[111.drawio#第 2 页\|400x300]]`（显式高度） | 300px | **300px** ✓ 保持不变 |
| 激活 + 放大 | — | viewBox 506×399 → 404.8×319.2，框高仍 315.4 ✓ 不跳动 |

- 构建 exit 0，md5 `d707ac47…`；测试 **31 文件 197 项全绿**（3 个原本断言"高度不变"的测试已改为断言"按新页重算"）。
- 注意：`|400x300` 这种显式高度**不随页变化**是刻意的（用户写了固定高度）。
