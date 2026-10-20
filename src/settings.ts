/**
 * Where a new diagram goes.
 *
 * `attachment` mirrors Obsidian's own "default location for new attachments"
 * setting; `current` sits next to the note; `folder` uses the folder typed in
 * the settings tab (foreign-key style: the path lives in `newDiagramFolder`).
 */
export type NewDiagramLocation = 'attachment' | 'current' | 'folder';
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
  newDiagramLocation: 'attachment',
  newDiagramFolder: '',
  cacheLimitFiles: 20,
};

/**
 * Coerce a stored `newDiagramLocation` into the current vocabulary.
 *
 * `root` no longer exists: it and "folder selected but left empty" both meant
 * the vault root, which is what `attachment` covers when Obsidian's attachment
 * folder is the root. An empty `folder` is downgraded too — keeping it would
 * claim a folder target that points nowhere.
 */
export function normalizeNewDiagramLocation(location: unknown, folder: unknown): NewDiagramLocation {
  if (location === 'current') return 'current';
  if (location === 'folder' && typeof folder === 'string' && folder.trim()) return 'folder';
  return 'attachment';
}

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

/**
 * Resolve Obsidian's `attachmentFolderPath` config value against the active
 * note, producing a vault-relative folder ('' = vault root).
 *
 * Obsidian stores one of four shapes:
 *   `/`            vault root
 *   `./` or `.`    same folder as the note
 *   `./sub`        a subfolder of the note's folder
 *   `sub`          a fixed vault-relative folder
 */
export function resolveAttachmentFolder(config: string, activeFileParentPath: string | null): string {
  const raw = config.trim().replace(/\\/g, '/');
  const parent = (activeFileParentPath ?? '').trim().replace(/\\/g, '/');
  if (!raw || raw === '/') return '';
  if (raw === './' || raw === '.') return joinPath(parent, '');
  if (raw.startsWith('./')) return joinPath(parent, raw.slice(2));
  return joinPath('', raw);
}

/** Join two vault paths, dropping empty segments (result '' = vault root). */
function joinPath(base: string, rest: string): string {
  return [base, rest]
    .join('/')
    .split('/')
    .filter(Boolean)
    .join('/');
}
