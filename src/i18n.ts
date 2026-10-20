/**
 * UI strings. Three locales, one flat dictionary each.
 *
 * `Dict` is derived from the English literals, so any locale that misses a key
 * or adds a stray one fails `tsc` instead of silently falling back at runtime.
 *
 * The active locale is module state: `setLanguage()` is called once from
 * `loadSettings()` and again whenever the setting changes. Every consumer reads
 * through `strings()`, so notices fired from deep modules pick up the choice
 * without threading a plugin reference through the call chain.
 */

export type Language = 'en' | 'zh-CN' | 'zh-TW';

const en = {
  // ---- Settings tab ----
  settingsLanguageName: 'Language',
  newDiagramLocationName: 'New diagram location',
  newDiagramLocationDesc: 'Where diagrams created by the command are saved.',
  newDiagramLocationAttachment: 'Follow attachment folder',
  newDiagramLocationCurrent: 'Same folder as the current note',
  newDiagramLocationFolder: 'Folder specified below',
  newDiagramFolderDesc: 'Created automatically if it does not exist.',
  newDiagramFolderPlaceholder: 'Diagrams/drawio',
  appearanceName: 'Diagram preview appearance',
  appearanceDesc:
    'When on, the preview follows the current light/dark theme and the dropdown below is disabled. '
    + 'When off, the dropdown value is used.',
  appearanceLight: 'Light',
  appearanceDark: 'Dark',
  appearanceTransparent: 'Transparent',
  cacheName: 'Cached preview files',
  cacheDesc:
    'Maximum number of cached preview files; the oldest are removed first by write time. '
    + 'Only cache files are deleted, never diagrams.',

  // ---- Notices ----
  noticeFolderNotAFolder: 'Drawio: "{path}" already exists but is not a folder.',
  noticeCannotCreate: 'Drawio: could not create the diagram — {error}',
  noticeDesktopOnly: 'Drawio: the interactive viewer is only available on desktop.',
  noticeNoteUnreadable: 'Drawio: could not read the note containing this embed — page not pinned.',
  noticeUpdateNoteFailed: 'Drawio: failed to update the note — {error}',
  noticeLinkUpdated: 'Drawio: link updated to {anchor}.',
  noticeLinkNotFound: 'Drawio: could not find this embed\'s link in the note — page not pinned.',
  noticeDuplicateLinks: 'Drawio: several links point to this file on the same page — please edit the subpath manually.',
  noticeMarkdownLink: 'Drawio: this embed uses a Markdown-style link — please edit the page manually.',
  noticeNoDefaultApp: 'Drawio: this Obsidian version cannot open files with the default app.',

  // ---- Commands, ribbon, menus ----
  commandNewDiagram: 'New diagram',
  ribbonNewDiagram: 'New drawio diagram',
  menuNewDiagram: 'New drawio diagram',

  // ---- Viewer chrome ----
  titleClickToView: 'Click to view the diagram',
  titleDiagram: 'Drawio diagram',
  toolbarLabel: 'Interactive viewer controls',
  btnZoomIn: 'Zoom in',
  btnZoomOut: 'Zoom out',
  btnFit: 'Fit',
  btnFitLabel: 'Fit diagram',
  btnEdit: 'Edit',
  btnEditLabel: 'Edit diagram',
  btnFullscreen: 'Fullscreen',
  btnFullscreenLabel: 'Enter fullscreen',
  btnExitFullscreen: 'Exit fullscreen',
  pinCurrentPage: 'Pin the current page in the note',
};

type Dict = typeof en;

const zhCN: Dict = {
  settingsLanguageName: 'Language',
  newDiagramLocationName: '新建图表位置',
  newDiagramLocationDesc: '通过命令新建的图表保存位置。',
  newDiagramLocationAttachment: '跟随附件位置',
  newDiagramLocationCurrent: '与当前笔记相同的文件夹',
  newDiagramLocationFolder: '下方指定文件夹',
  newDiagramFolderDesc: '若不存在则自动创建。',
  newDiagramFolderPlaceholder: 'Diagrams/drawio',
  appearanceName: '图表预览外观主题',
  appearanceDesc:
    '开启时，预览外观跟随 Obsidian 当前的浅色/深色主题，下方下拉框不可用；'
    + '关闭时使用下拉框选择的外观。',
  appearanceLight: '浅色',
  appearanceDark: '深色',
  appearanceTransparent: '透明',
  cacheName: '缓存文件个数上限',
  cacheDesc: '最多保留多少个预览缓存文件，超出后按写入时间删除最旧的。只删缓存文件，不会动图表文件。',

  noticeFolderNotAFolder: 'Drawio: 「{path}」已存在，但它不是文件夹。',
  noticeCannotCreate: 'Drawio: 无法创建图表 —— {error}',
  noticeDesktopOnly: 'Drawio: 交互式查看器仅在桌面端可用。',
  noticeNoteUnreadable: 'Drawio: 无法读取嵌入所在的笔记 —— 页面未固定。',
  noticeUpdateNoteFailed: 'Drawio: 更新笔记失败 —— {error}',
  noticeLinkUpdated: 'Drawio: 链接已更新至 {anchor}。',
  noticeLinkNotFound: 'Drawio: 在笔记中找不到该嵌入的链接 —— 页面未固定。',
  noticeDuplicateLinks: 'Drawio: 有多条指向此文件且页面相同的链接 —— 请手动修改笔记中的子路径。',
  noticeMarkdownLink: 'Drawio: 该嵌入使用的是 Markdown 风格链接 —— 请手动修改笔记中的页面。',
  noticeNoDefaultApp: 'Drawio: 当前 Obsidian 版本无法用默认应用打开文件。',

  commandNewDiagram: '新建图表',
  ribbonNewDiagram: '新建 drawio 图表',
  menuNewDiagram: '新建 drawio 图表',

  titleClickToView: '点击以浏览图表',
  titleDiagram: 'Drawio 图表',
  toolbarLabel: '交互式查看器控件',
  btnZoomIn: '放大',
  btnZoomOut: '缩小',
  btnFit: '适应',
  btnFitLabel: '适应图表',
  btnEdit: '编辑',
  btnEditLabel: '编辑图表',
  btnFullscreen: '全屏',
  btnFullscreenLabel: '进入全屏',
  btnExitFullscreen: '退出全屏',
  pinCurrentPage: '将当前页面固定在笔记中',
};

const zhTW: Dict = {
  settingsLanguageName: 'Language',
  newDiagramLocationName: '新建圖表位置',
  newDiagramLocationDesc: '透過指令新建的圖表儲存位置。',
  newDiagramLocationAttachment: '跟隨附件位置',
  newDiagramLocationCurrent: '與目前筆記相同的資料夾',
  newDiagramLocationFolder: '下方指定資料夾',
  newDiagramFolderDesc: '若不存在則自動建立。',
  newDiagramFolderPlaceholder: 'Diagrams/drawio',
  appearanceName: '圖表預覽外觀主題',
  appearanceDesc:
    '開啟時，預覽外觀跟隨 Obsidian 目前的淺色/深色主題，下方下拉選單無法使用；'
    + '關閉時使用下拉選單選擇的外觀。',
  appearanceLight: '淺色',
  appearanceDark: '深色',
  appearanceTransparent: '透明',
  cacheName: '快取檔案數量上限',
  cacheDesc: '最多保留多少個預覽快取檔案，超過後依寫入時間刪除最舊的。只會刪除快取檔案，不會動到圖表檔案。',

  noticeFolderNotAFolder: 'Drawio: 「{path}」已存在，但它不是資料夾。',
  noticeCannotCreate: 'Drawio: 無法建立圖表 —— {error}',
  noticeDesktopOnly: 'Drawio: 互動式檢視器僅在桌面端可用。',
  noticeNoteUnreadable: 'Drawio: 無法讀取嵌入所在的筆記 —— 頁面未固定。',
  noticeUpdateNoteFailed: 'Drawio: 更新筆記失敗 —— {error}',
  noticeLinkUpdated: 'Drawio: 連結已更新至 {anchor}。',
  noticeLinkNotFound: 'Drawio: 在筆記中找不到該嵌入的連結 —— 頁面未固定。',
  noticeDuplicateLinks: 'Drawio: 有多條指向此檔案且頁面相同的連結 —— 請手動修改筆記中的子路徑。',
  noticeMarkdownLink: 'Drawio: 該嵌入使用的是 Markdown 風格連結 —— 請手動修改筆記中的頁面。',
  noticeNoDefaultApp: 'Drawio: 目前 Obsidian 版本無法用預設應用程式開啟檔案。',

  commandNewDiagram: '新建圖表',
  ribbonNewDiagram: '新建 drawio 圖表',
  menuNewDiagram: '新建 drawio 圖表',

  titleClickToView: '點擊以瀏覽圖表',
  titleDiagram: 'Drawio 圖表',
  toolbarLabel: '互動式檢視器控制項',
  btnZoomIn: '放大',
  btnZoomOut: '縮小',
  btnFit: '適應',
  btnFitLabel: '適應圖表',
  btnEdit: '編輯',
  btnEditLabel: '編輯圖表',
  btnFullscreen: '全螢幕',
  btnFullscreenLabel: '進入全螢幕',
  btnExitFullscreen: '退出全螢幕',
  pinCurrentPage: '將目前頁面固定在筆記中',
};

const DICTS: Record<Language, Dict> = { en, 'zh-CN': zhCN, 'zh-TW': zhTW };

let current: Language = 'en';

/**
 * Map Obsidian's active locale (`moment.locale()`) to one of our three
 * dictionaries. Only Chinese is translated; every other language falls back to
 * English, which is the documented behaviour of the plugin.
 *
 * `zh-HK` / `zh-MO` / `zh-Hant*` are traditional; `zh`, `zh-CN`, `zh-Hans*`
 * are simplified. Observing both separators matters: moment reports `zh-cn`
 * while other callers may hand us `zh_CN`.
 */
export function languageFromLocale(locale: string): Language {
  const value = locale.trim().toLowerCase().replace(/_/g, '-');
  if (!value.startsWith('zh')) return 'en';
  return /-(tw|hk|mo)$|hant/.test(value) ? 'zh-TW' : 'zh-CN';
}

export function setLanguage(lang: Language): void {
  current = lang;
}

/** All UI strings for the active locale. */
export function strings(): Dict {
  return DICTS[current];
}

/** Replace `{name}` placeholders; unknown keys become an empty string. */
export function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? '');
}
