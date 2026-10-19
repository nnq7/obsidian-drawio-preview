import { describe, it, expect } from 'vitest';
import {
  CACHE_LIMIT_FILES_MAX, CACHE_LIMIT_FILES_MIN, DEFAULT_SETTINGS, clampCacheLimitFiles,
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

  it('defaults the preview cache to 20 files, inside the 10–30 slider range', () => {
    expect(DEFAULT_SETTINGS.cacheLimitFiles).toBe(20);
    expect(CACHE_LIMIT_FILES_MIN).toBe(10);
    expect(CACHE_LIMIT_FILES_MAX).toBe(30);
  });

  it('clamps out-of-range / non-numeric file counts', () => {
    expect(clampCacheLimitFiles(20)).toBe(20);
    expect(clampCacheLimitFiles(1)).toBe(CACHE_LIMIT_FILES_MIN);
    expect(clampCacheLimitFiles(500)).toBe(CACHE_LIMIT_FILES_MAX);
    // A hand-edited settings file must never yield NaN (which would never prune).
    expect(clampCacheLimitFiles(Number.NaN)).toBe(20);
  });

  it('exposes exactly the documented settings keys (guards accidental shape drift)', () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(
      [
        'cacheLimitFiles',
        'followObsidianTheme',
        'newDiagramFolder',
        'newDiagramLocation',
        'previewAppearance',
      ].sort(),
    );
  });
});
