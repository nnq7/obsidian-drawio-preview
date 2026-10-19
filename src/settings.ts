export type NewDiagramLocation = 'root' | 'current' | 'folder';
/** Preview appearance. `light`/`dark` paint a matching background and pin the
 * diagram's `color-scheme`; `transparent` keeps a light diagram on a see-through
 * background. Only used when `followObsidianTheme` is off. */
export type PreviewAppearance = 'light' | 'dark' | 'transparent';

export interface DrawioSettings {
  followObsidianTheme: boolean;
  /** Used only when `followObsidianTheme` is off. */
  previewAppearance: PreviewAppearance;
  newDiagramLocation: NewDiagramLocation;
  /** Target folder for new diagrams when newDiagramLocation is 'folder'. */
  newDiagramFolder: string;
  /** 预览缓存最多保留多少个 SVG 文件（按个数而非体积：量体积就得遍历并 stat 全部缓存，
   *  用个数只读一次目录清单）。 */
  cacheLimitFiles: number;
}

export const DEFAULT_SETTINGS: DrawioSettings = {
  followObsidianTheme: true,
  previewAppearance: 'light',
  newDiagramLocation: 'root',
  newDiagramFolder: '',
  cacheLimitFiles: 20,
};

/** Slider bounds for {@link DrawioSettings.cacheLimitFiles}. */
export const CACHE_LIMIT_FILES_MIN = 10;
export const CACHE_LIMIT_FILES_MAX = 30;

/** Clamp a stored file-count budget into the slider range. The settings file is
 *  user-editable, so a non-numeric or out-of-range value must not turn the cap
 *  into 0 (wipe everything) or NaN (never prune). */
export function clampCacheLimitFiles(value: number): number {
  const safe = Number.isFinite(value) ? value : DEFAULT_SETTINGS.cacheLimitFiles;
  return Math.min(CACHE_LIMIT_FILES_MAX, Math.max(CACHE_LIMIT_FILES_MIN, Math.round(safe)));
}
