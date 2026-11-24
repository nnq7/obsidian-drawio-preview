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
  /** 预览缓存保留天数：超过这么多天没被读取过的缓存会被清理掉。常用条目因为每次命中
   *  都会记进白名单，实际上会一直续期（热度机制）。 */
  cacheRetentionDays: number;
}

export const DEFAULT_SETTINGS: DrawioSettings = {
  followObsidianTheme: true,
  previewAppearance: 'light',
  newDiagramLocation: 'attachment',
  newDiagramFolder: '',
  cacheRetentionDays: 7,
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

/** 下拉框里的可选项（天）。刻意不给 30 天以上：缓存目录会长期堆积大体积 SVG。 */
export const CACHE_RETENTION_OPTIONS = [3, 7, 15] as const;

/** 默认保留天数，与 {@link DEFAULT_SETTINGS} 保持一致。 */
export const DEFAULT_CACHE_RETENTION_DAYS = 7;

/** Coerce a stored retention value onto one of {@link CACHE_RETENTION_OPTIONS}.
 *  data.json is user-editable, so a junk value must not become 0 (prune on every
 *  start) or NaN (never prune). Anything unrecognised falls back to the default. */
export function clampRetentionDays(value: unknown): number {
  const n = Number(value);
  return (CACHE_RETENTION_OPTIONS as readonly number[]).includes(n)
    ? n
    : DEFAULT_CACHE_RETENTION_DAYS;
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
