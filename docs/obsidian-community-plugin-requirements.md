# Obsidian 官方第三方插件目录 · 上架要求汇总

> 查证日期：2026-10-18。来源：docs.obsidian.md（Submit your plugin / Submission requirements / Plugin guidelines / Developer policies）
> 与 `github.com/obsidianmd/obsidian-releases` README。政策会变，提交前请复核对应当页。

---

## 一、提交流程

1. 2026-05 起 **不再给 `obsidianmd/obsidian-releases` 提 PR**，改为在 **`community.obsidian.md`** 提交（GitHub 仓库只做镜像）。
2. 需要两个账号：**GitHub 账号**（放插件与 release）+ **Obsidian 账号**（提交与审核沟通）。
3. 只提交**初始版本**。上架后升级不用再提交：用户在 Obsidian 内直接从你的 GitHub release 更新。
4. 审核通过后，可到官方论坛 Showcase 与 Discord `#updates` 频道宣布首发（Discord 需先申请 developer 角色）。

## 二、仓库里必须有什么（都在根目录）

| 文件 | 作用 |
| --- | --- |
| `README.md` | 说明插件做什么、怎么用。列表页会抓一段显示，`./images/x.png` 这类相对链接会被自动改写 |
| `LICENSE` | 必须明确许可证（fork 或引用他人代码时还要遵守上游许可并在 README 署名） |
| `manifest.json` | 插件元信息，见下节 |

另外需要 **GitHub release**：tag 必须与 `manifest.json` 的 `version` 完全一致，附件至少含 `manifest.json`、`main.js`、`styles.css`（有则带）。`versions.json` 用于「用户 Obsidian 版本太低」时回退到兼容的旧版本。

## 三、manifest.json 的硬要求

| 字段 | 要求 |
| --- | --- |
| `id` | 唯一；**不得包含 "obsidian"**；不能与已上架插件冲突 |
| `name` | 不得借用 "Obsidian" 商标让人误以为官方出品 |
| `version` | 必须是 `x.y.z`，且与 release tag 一致 |
| `minAppVersion` | 填**真正需要的最低版本**；不确定就填当前最新稳定版 |
| `description` | **≤250 字符**、**以句号结尾**、不用 emoji / 特殊字符、专有名词大小写正确（Obsidian / Markdown / PDF）；建议以动作开头（"预览…"、"同步…"），不要写"这是一个插件" |
| `isDesktopOnly` | 只要用了 **Node.js / Electron API**（`fs`、`crypto`、`os`、`path`、`electron`…）就**必须为 `true`**，运行时怎么 guard 都不例外。手机端等价物：`SubtleCrypto`、`navigator.clipboard` 等 Web API |
| `fundingUrl` | **只在确实接受捐助时**才写；不接受就删掉 |

其他：命令 id 不要自己加插件前缀（Obsidian 会自动加）；提交前删掉 sample plugin 的示例代码。

## 四、开发者政策（Developer policies）

### 不允许

- 混淆代码隐藏用途
- 联网加载的动态广告；插件界面之外的静态广告
- 客户端遥测
- 插件自我安装 / 自我更新，或自动更新其依赖
- 主题从网络加载资源

### 必须披露（写进 README）

全额功能需付费 · 需账号 · 使用网络（说明用了哪些远端服务、为什么）· 访问仓库外的文件（说明原因）· 插件界面内的静态广告 · 服务端遥测（需隐私政策链接）· 闭源（个案评估）

### 版权与 fork

- 必须有 LICENSE 文件并写明许可；遵守所引用代码的上游许可，按要求在 README 署名
- 遵守 Obsidian 商标政策，不能让人误以为是官方插件
- ⚠️ **不接受 fork**，除非满足其一：
  1. 有**原作者公开可验证的书面同意**；
  2. 能证明原作者**失联且至少 6 个月未更新**（还要先联系并给 30 天公开回应期）。
  两种情况都必须在项目里**把原作者列为贡献者**。
- 如果功能与现有插件差异很大：**另开新仓库、自己重写**，不要从上游继承任何代码。

## 五、代码评审常见意见（官方 guidelines）

| 类别 | 要求 |
| --- | --- |
| 全局对象 | 不用全局 `app` / `window.app`，用 `this.app` |
| 日志 | 不刷无意义的 `console.log`；默认控制台只应有错误 |
| 安全 | 不用 `innerHTML` / `outerHTML` / `insertAdjacentHTML`，用 `createEl` / `createDiv` / `empty()` |
| 资源释放 | 事件用 `registerEvent()`，命令用 `addCommand()`；`onunload` 里**不要 detach leaves** |
| 命令 | 不给默认快捷键；按条件选 `callback` / `checkCallback` / `editorCallback` |
| 工作区 | 不直接读 `workspace.activeLeaf`，用 `getActiveViewOfType()` / `activeEditor`；不要把自定义 view 存成插件字段 |
| Vault | 改当前笔记用 Editor API；后台改文件用 `Vault.process`；改 frontmatter 用 `processFrontMatter`；优先 Vault API 而非 Adapter；不要遍历所有文件找路径（用 `getFileByPath` 等） |
| 路径 | 用户输入的路径一律过 `normalizePath()` |
| 样式 | 不硬编码颜色/尺寸，用 CSS class + Obsidian 的 CSS 变量 |
| 设置界面 | 设置页不加顶级标题；标题里不出现 "settings"；文案用 Sentence case；标题用 `setHeading()` 而不是 `<h1>` |
| 工程 | 多文件时按目录组织；重命名 `MyPlugin` / `SampleSettingTab` 之类的占位名 |

## 六、提交前自检清单

- [ ] 根目录有 `README.md`、`LICENSE`、`manifest.json`
- [ ] `description` ≤250 字符、句号结尾、无 emoji
- [ ] 用了 Node/Electron API ⇒ `isDesktopOnly: true`
- [ ] `manifest.version` == release tag；release 附件含 `main.js`/`manifest.json`/`styles.css`
- [ ] `versions.json` 覆盖历史版本（含本次）
- [ ] 无网络请求 / 无遥测 / 无自更新 / 无广告（有则已在 README 披露）
- [ ] 已按第五节自查代码
- [ ] **若是 fork：已拿到原作者公开同意，或能证明其失联 ≥6 个月，且已署名原作者**

## 七、附录：本插件（Drawio Preview）对照

| 项 | 现状 | 结论 |
| --- | --- | --- |
| fork 政策 | fork 自 `doge-liang/obsidian-drawio`，上游 2026-10-12 仍在更新 | ❌ **阻塞**：须拿到原作者公开同意 |
| `isDesktopOnly` | `false`，但用 `window.require('fs'/'path')` 做缓存 | ❌ 须改 `true` |
| `README.md` / `LICENSE` | 本地已有，GitHub 仓库未包含 | ❌ 待推 |
| `description` | 无句号 | ⚠️ 小改 |
| tag ↔ version | tag `1.1.0` = manifest `1.1.0`，附件 4 个 | ✅ |
| 离线 / 遥测 / 自更新 / fundingUrl | 均无 | ✅ |
| id / 命令 id / `this.app` / 资源释放 / 无 `innerHTML` | 符合 | ✅ |

待办（按优先级）：① 向原作者请求公开许可 → ② 改 `isDesktopOnly` + 描述、发新版本 → ③ 推 README/LICENSE → ④ 提交。

## 八、参考

- Submit your plugin — https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
- Submission requirements — https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins
- Plugin guidelines — https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Developer policies — https://docs.obsidian.md/community-directory/developer-policies
- 目录与 release 抓取规则 — https://github.com/obsidianmd/obsidian-releases
