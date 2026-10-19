# Obsidian Drawio 插件 — 设计文档

- **日期**: 2026-06-04
- **状态**: 已批准（设计阶段）
- **作者**: liangsycmail@gmail.com + Claude

## 1. 目标与范围

开发一个 Obsidian 插件，让用户能够在 Obsidian 中创建、嵌入、预览和编辑 [drawio](https://www.drawio.com/)（diagrams.net）图表，完全离线可用。

### 核心能力

1. **代码块内嵌** — 在 markdown 中用 ` ```drawio ` 代码块直接存储 drawio XML，阅读模式下渲染为 SVG 预览，可点击进入编辑。
2. **独立 `.drawio` 文件** — 创建独立的 `.drawio` 文件，拥有自定义 View，在 Obsidian 内打开并编辑。
3. **文件嵌入** — 在 markdown 笔记中用 `![[diagram.drawio]]` Wiki 链接语法嵌入 `.drawio` 文件，渲染为 SVG 预览。
4. **离线编辑器** — 内置离线 drawio webapp，通过本地 HTTP server + iframe + postMessage 协议提供完整编辑能力；同时允许用户配置自定义/在线 drawio URL。

### 非目标（YAGNI）

- 实时协同编辑（diff sync）— 不在首版范围。
- 移动端支持 — 因依赖本地 HTTP server，插件标记为 `isDesktopOnly: true`。
- PDF 导出 — drawio embed 模式下 PDF 导出依赖外部服务，暂不支持。
- AI 生成图表 — 不在范围。

## 2. 关键设计决策（已确认）

| 决策点 | 选择 |
|--------|------|
| 文件管理方式 | **代码块内嵌 + 独立文件** 双支持 |
| 编辑器加载 | **离线优先 + 在线可配** |
| 阅读模式呈现 | **静态 SVG 预览 + 点击进入编辑** |
| 编辑器打开方式 | **模态窗口（Modal，全屏沉浸）** |
| 文件嵌入语法 | **Wiki 链接 `![[file.drawio]]`** |
| 集成架构 | **本地 HTTP Server + postMessage 协议**（drawio 官方标准集成方式）|

### 关键技术洞察：预览与编辑分离

- **SVG 预览**使用 drawio 官方轻量级 `viewer.min.js`（`GraphViewer`），纯客户端把 mxGraph XML 渲染为 SVG，**无需启动服务器**。覆盖所有"只看不编辑"场景，零开销。
- **完整编辑**才启动本地 HTTP server，加载完整 drawio webapp 到 iframe，通过 postMessage 双向通信。
- 服务器**懒启动**（首次编辑时），空闲超时后自动关闭。

## 3. 架构

### 目录结构

```
obsidian-drawio/
├── src/
│   ├── main.ts                 # 插件入口，注册所有扩展点与生命周期
│   ├── settings.ts             # DrawioSettings 接口 + 设置面板 UI
│   │
│   ├── server/
│   │   └── ServerManager.ts    # 单例：懒启动/停止本地 server、端口探测、空闲超时
│   │
│   ├── preview/
│   │   ├── ViewerRenderer.ts   # 用 GraphViewer 将 XML 渲染为 SVG（客户端）
│   │   └── svgSanitizer.ts     # DOMPurify 清洗 SVG，防 XSS
│   │
│   ├── codeblock/
│   │   └── DrawioCodeBlock.ts  # registerMarkdownCodeBlockProcessor('drawio') 处理器
│   │
│   ├── editor/
│   │   ├── DrawioModal.ts      # 模态窗口，承载编辑 iframe
│   │   └── EmbedProtocol.ts    # postMessage JSON 协议封装（init/load/save/exit/export）
│   │
│   ├── file/
│   │   ├── DrawioFileView.ts   # .drawio 文件的自定义 TextFileView
│   │   └── EmbedRenderer.ts    # ![[file.drawio]] 嵌入渲染（markdown post processor）
│   │
│   ├── model/
│   │   ├── DrawioSource.ts     # 编辑目标抽象：代码块 / 文件 的统一读写接口
│   │   └── xmlUtils.ts         # XML 校验、压缩/解压、mxfile 包装
│   │
│   └── constants.ts            # 视图类型、URL 参数、默认值常量
│
├── webapp/                     # drawio 离线 webapp（构建时下载，不入 git）
│   └── viewer.min.js           # GraphViewer 单独提取，随插件打包
│
├── scripts/
│   └── fetch-drawio.mjs        # 构建脚本：下载指定版本 drawio webapp 与 viewer
│
├── tests/                      # vitest 单元测试（纯逻辑模块）
│
├── manifest.json               # isDesktopOnly: true
├── styles.css
├── package.json
├── esbuild.config.mjs
├── tsconfig.json
└── versions.json
```

### 组件职责

| 组件 | 职责 | 依赖 |
|------|------|------|
| `main.ts` | 注册代码块处理器、文件视图、嵌入渲染器、命令、设置；管理生命周期清理 | 所有模块 |
| `ServerManager` | 单例。`ensureStarted()` 懒启动 `http.Server` 服务 `webapp/` 静态文件；绑定 `127.0.0.1` + 随机端口；端口冲突自动重试；空闲 N 秒后 `stop()` | Node `http`, `fs` |
| `ViewerRenderer` | 输入 XML 字符串，输出 SVG 元素（用 `GraphViewer.createViewerForElement` 或 mxgraph data 属性）；失败返回错误占位符 | `viewer.min.js`, `svgSanitizer` |
| `svgSanitizer` | 用 DOMPurify（SVG profile）清洗，移除 `<script>`、事件处理器、外部引用 | DOMPurify |
| `DrawioCodeBlock` | `registerMarkdownCodeBlockProcessor('drawio', ...)`；渲染 SVG + "编辑"按钮；按钮点击打开 `DrawioModal`；保存时用 `ctx.getSectionInfo` 定位并替换源文件中的代码块 | `ViewerRenderer`, `DrawioModal`, `DrawioSource` |
| `DrawioModal` | Obsidian `Modal` 子类；全屏 iframe 指向 `http://localhost:PORT/?embed=1&proto=json...`；通过 `EmbedProtocol` 加载初始 XML、监听 save/autosave/exit | `ServerManager`, `EmbedProtocol` |
| `EmbedProtocol` | 封装 `window.postMessage` 收发；提供 `onInit/load/onSave/onExit/export` 等 Promise 化 API；校验 message origin | — |
| `DrawioFileView` | 继承 `TextFileView`，注册扩展名 `drawio`；`getViewData/setViewData`；显示 SVG 预览 + "编辑"按钮（或直接内嵌编辑器，见 §5） | `ViewerRenderer`, `DrawioModal` |
| `EmbedRenderer` | markdown post processor，识别 `![[*.drawio]]` 内部链接，读取目标文件 XML，渲染 SVG 预览 + 编辑按钮 | `ViewerRenderer`, vault |
| `DrawioSource` | 抽象"被编辑的图"：`CodeBlockSource`（读写 markdown 片段）与 `FileSource`（读写 `.drawio` 文件）两种实现，统一 `read()/write(xml)` | vault |

## 4. 数据流

### 4.1 代码块预览（阅读模式，无服务器）

```
Markdown ```drawio XML```
  → registerMarkdownCodeBlockProcessor 回调 (source, el, ctx)
  → ViewerRenderer.render(source) → GraphViewer 客户端渲染
  → svgSanitizer 清洗
  → el 插入 <svg> + 右上角"编辑"按钮
```

### 4.2 编辑流程（代码块或文件，懒启动服务器）

```
用户点击"编辑"按钮 / 打开 .drawio 文件
  → ServerManager.ensureStarted() → 返回 port（懒启动）
  → new DrawioModal(source).open()
  → iframe.src = http://127.0.0.1:PORT/?embed=1&proto=json&spin=1&libraries=1
  → iframe → postMessage {event:'init'}
  → 插件 → postMessage {action:'load', xml: source.read(), autosave:1}
  → 用户编辑
  → iframe → postMessage {event:'autosave'|'save', xml}
       → source.write(xml)：
           - CodeBlockSource: ctx.getSectionInfo 定位 lineStart..lineEnd，
             替换源文件对应行，vault.modify
           - FileSource: vault.modify(file, xml)
  → iframe → postMessage {event:'exit'}
       → modal.close()，ServerManager 启动空闲计时
```

### 4.3 文件嵌入 `![[diagram.drawio]]`

```
markdown post processor 扫描渲染后的内部嵌入链接
  → 匹配 .drawio 目标
  → vault.read(file) 获取 XML
  → ViewerRenderer.render → SVG 预览 + 编辑按钮（编辑走 4.2，FileSource）
```

### 4.4 postMessage 协议要点（来自 drawio embed 官方协议）

- **URL 参数**: `embed=1`（必需）、`proto=json`（JSON 协议）、`spin=1`（加载动画）、`libraries=1`（形状库）、`dark` 跟随 Obsidian 主题。
- **加载**: 收到 `{event:'init'}` 后发送 `{action:'load', xml, autosave:1, modified:0, dark:<theme>}`。
- **保存**: 监听 `{event:'save', xml, ...}` 与 `{event:'autosave', xml}`；`save` 可带 `exit:true`。
- **退出**: `{event:'exit', modified}`。
- **导出 SVG**（用于持久化预览缓存，可选）: 发送 `{action:'export', format:'svg'}`，监听 `{event:'export', data, xml}`。

## 5. 待定的设计细节（实施期决定，低风险）

1. **`.drawio` 文件视图的交互**：两种可选 —
   - (a) `DrawioFileView` 显示 SVG 预览 + "编辑"按钮 → 点击打开 Modal（与代码块一致，体验统一）。
   - (b) `DrawioFileView` 直接内嵌编辑器 iframe（打开文件即可编辑，更直接）。
   - **倾向 (a)**，保持"预览+点击编辑"的一致心智模型，符合既定决策；实施时若 (b) 体验更好可调整。
2. **代码块 XML 存储格式**：存原始 `mxfile` XML（可读）vs 压缩 base64（紧凑）。**倾向原始 XML**，便于 git diff 与人工查看；viewer 与 editor 都兼容两种。
3. **预览缓存**：首版每次渲染（GraphViewer 很快）；如有性能问题再加缓存。

## 6. 错误处理

| 场景 | 处理 |
|------|------|
| 端口被占用 | 在端口范围内重试（如 3000–3999），全部失败则 `Notice` 报错并禁用编辑 |
| 服务器启动失败 | `Notice` 提示，预览仍可用（不依赖服务器），仅编辑不可用 |
| XML 格式错误 | `ViewerRenderer` 返回错误占位符（带原始文本 + "编辑"按钮以便修复）|
| iframe 加载超时 | 计时器超时后 `Notice`，关闭 Modal |
| 外部修改冲突 | 首版采用最后写入获胜（last-write-wins）；保存时若检测到 mtime 变化给出 `Notice` 警告 |
| 移动端运行 | `isDesktopOnly: true`，Obsidian 自动不加载 |
| 恶意 SVG（XSS） | 所有渲染 SVG 经 DOMPurify 清洗后才插入 DOM |

## 7. 安全

- 本地 server 仅绑定 `127.0.0.1`，仅服务 `webapp/` 目录静态文件（路径穿越防护）。
- 编辑 iframe 仅加载本地或用户显式配置的 URL。
- postMessage 校验 `event.origin` 与 `event.source`。
- 所有外部来源 SVG 经 DOMPurify 清洗。

## 8. 设置项（DrawioSettings）

| 设置 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `drawioMode` | `'offline' \| 'custom'` | `offline` | 离线内置 / 自定义 URL |
| `customDrawioUrl` | string | `''` | 自定义/在线 drawio embed URL |
| `serverPortRange` | `[number, number]` | `[3000, 3999]` | 本地 server 端口范围 |
| `serverIdleTimeout` | number(秒) | `300` | 空闲多久后停止 server |
| `followObsidianTheme` | boolean | `true` | 编辑器主题跟随 Obsidian 明暗 |
| `showLibraries` | boolean | `true` | 编辑器是否显示形状库面板 |
| `storeFormat` | `'xml' \| 'compressed'` | `xml` | 代码块 XML 存储格式 |

## 9. 测试策略

Obsidian 插件 UI 难以自动化，因此**分层**：

### 单元测试（vitest，纯逻辑模块，TDD）

- `xmlUtils`：XML 校验、mxfile 包装、压缩/解压往返。
- `EmbedProtocol`：消息构造/解析、origin 校验逻辑。
- `CodeBlockSource`：给定源文本 + section 行号，正确替换代码块内容（含边界：首行/末行/多代码块）。
- `portDetector`/`ServerManager` 纯逻辑：端口选择、冲突重试（mock `http`）。
- `svgSanitizer`：恶意输入（`<script>`、`onload=`）被移除。

### 集成 / 手动测试（测试 vault 清单）

- 创建 ` ```drawio ` 代码块 → 阅读模式显示 SVG。
- 点击编辑 → Modal 打开 drawio → 改动 → 保存 → 代码块 XML 更新、预览刷新。
- 新建 `.drawio` 文件 → 打开 → 编辑 → 保存。
- `![[x.drawio]]` 嵌入 → 显示预览 → 编辑。
- 切换 Obsidian 明暗主题 → 编辑器主题跟随。
- 自定义 URL 模式 → 指向在线 embed.diagrams.net 正常工作。
- 端口冲突场景（占用首选端口）→ 自动切换。

### 构建验证

- `scripts/fetch-drawio.mjs` 能下载并校验 drawio webapp 版本。
- `npm run build` 产出 `main.js` + `manifest.json` + `styles.css` + `webapp/`。

## 10. 构建与打包

- **drawio webapp 获取**：`scripts/fetch-drawio.mjs` 从 [jgraph/drawio 官方 release](https://github.com/jgraph/drawio/releases) 下载锁定版本的 webapp 静态资源到 `webapp/`，校验完整性；该目录不入 git，由 CI / 首次构建生成。
- **打包**：esbuild 打包 `src/` → `main.js`；`viewer.min.js` 从 webapp 中提取，随插件分发用于预览。
- **版本锁定**：`scripts/fetch-drawio.mjs` 顶部常量锁定 drawio 版本号，确保可复现构建。

## 11. 参考资料

- [Obsidian 插件开发文档](https://docs.obsidian.md/)
- [Obsidian 示例插件](https://github.com/obsidianmd/obsidian-sample-plugin)
- [drawio Embed Mode JSON 协议（Discussion #5612）](https://github.com/jgraph/drawio/discussions/5612)
- [drawio embed mode 文档](https://www.drawio.com/doc/faq/embed-mode)
- [jgraph/drawio-integration（官方集成示例）](https://github.com/jgraph/drawio-integration)
- [既有参考实现 somesanity/draw-io-obsidian](https://github.com/somesanity/draw-io-obsidian)（未上架，本项目独立实现）
