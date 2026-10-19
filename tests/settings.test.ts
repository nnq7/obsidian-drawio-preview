import { describe, it, expect } from 'vitest';
import {
  CACHE_LIMIT_MB_MAX, CACHE_LIMIT_MB_MIN, DEFAULT_SETTINGS, cacheLimitBytes,
} from '../src/settings';

describe('DEFAULT_SETTINGS', () => {
  it('follows the Obsidian theme by default', () => {
    expect(DEFAULT_SETTINGS.followObsidianTheme).toBe(true);
  });

  it('creates new diagrams at the vault root', () => {
    expect(DEFAULT_SETTINGS.newDiagramLocation).toBe('root');
    expect(DEFAULT_SETTINGS.newDiagramFolder).toBe('');
  });

  it('defaults the non-follow preview appearance to light', () => {
    expect(DEFAULT_SETTINGS.previewAppearance).toBe('light');
  });

  it('defaults the preview cache to 15 MB, inside the 10–100 MB slider range', () => {
    expect(DEFAULT_SETTINGS.cacheLimitMB).toBe(15);
    expect(CACHE_LIMIT_MB_MIN).toBe(10);
    expect(CACHE_LIMIT_MB_MAX).toBe(100);
  });

  it('converts MB to bytes and clamps out-of-range / non-numeric input', () => {
    expect(cacheLimitBytes(15)).toBe(15 * 1024 * 1024);
    expect(cacheLimitBytes(1)).toBe(CACHE_LIMIT_MB_MIN * 1024 * 1024);
    expect(cacheLimitBytes(500)).toBe(CACHE_LIMIT_MB_MAX * 1024 * 1024);
    // A hand-edited settings file must never yield NaN (which would evict everything).
    expect(cacheLimitBytes(Number.NaN)).toBe(15 * 1024 * 1024);
  });

  it('exposes exactly the documented settings keys (guards accidental shape drift)', () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(
      [
        'cacheLimitMB',
        'followObsidianTheme',
        'newDiagramFolder',
        'newDiagramLocation',
        'previewAppearance',
      ].sort(),
    );
  });
});
