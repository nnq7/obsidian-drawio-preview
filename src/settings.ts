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
  /** Preview cache budget in MB. Only desktop caches at all. */
  cacheLimitMB: number;
}

export const DEFAULT_SETTINGS: DrawioSettings = {
  followObsidianTheme: true,
  previewAppearance: 'light',
  newDiagramLocation: 'root',
  newDiagramFolder: '',
  cacheLimitMB: 15,
};

/** Slider bounds for {@link DrawioSettings.cacheLimitMB}, in MB. */
export const CACHE_LIMIT_MB_MIN = 10;
export const CACHE_LIMIT_MB_MAX = 100;

/** The cache budget in bytes, clamped to the slider range. The settings file is
 *  user-editable, so a non-numeric or out-of-range value must not turn the cap
 *  into NaN (which would read as "over budget" and wipe the cache on every write). */
export function cacheLimitBytes(mb: number): number {
  const safe = Number.isFinite(mb) ? mb : DEFAULT_SETTINGS.cacheLimitMB;
  const clamped = Math.min(CACHE_LIMIT_MB_MAX, Math.max(CACHE_LIMIT_MB_MIN, Math.round(safe)));
  return clamped * 1024 * 1024;
}
