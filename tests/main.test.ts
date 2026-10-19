import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform } from 'obsidian';

vi.mock('../src/desktop/registerDesktopFeatures', () => ({
  registerDesktopFeatures: vi.fn(async () => {}),
}));

import {
  maybeRegisterDesktopFeatures, setPreviewAppearance,
} from '../src/main';
import DrawioPlugin from '../src/main';
import { registerDesktopFeatures } from '../src/desktop/registerDesktopFeatures';
import type { PreviewAppearance } from '../src/settings';

describe('maybeRegisterDesktopFeatures', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => {
    Platform.isDesktopApp = originalIsDesktopApp;
    vi.clearAllMocks();
  });

  it('registers desktop features when Platform.isDesktopApp is true', async () => {
    Platform.isDesktopApp = true;
    const fakePlugin = {} as unknown as DrawioPlugin;
    await maybeRegisterDesktopFeatures(fakePlugin);
    expect(registerDesktopFeatures).toHaveBeenCalledWith(fakePlugin);
  });

  it('does nothing when Platform.isDesktopApp is false', async () => {
    Platform.isDesktopApp = false;
    const fakePlugin = {} as unknown as DrawioPlugin;
    await maybeRegisterDesktopFeatures(fakePlugin);
    expect(registerDesktopFeatures).not.toHaveBeenCalled();
  });
});

describe('previewAppearance resolution', () => {
  function resolve(follow: boolean, appearance: PreviewAppearance, dark: boolean): PreviewAppearance {
    const ctx = {
      settings: { followObsidianTheme: follow, previewAppearance: appearance },
      isDark: () => dark,
    };
    return DrawioPlugin.prototype.previewAppearance.call(ctx as unknown as DrawioPlugin);
  }

  it('follows the Obsidian theme while the toggle is on (dropdown ignored)', () => {
    expect(resolve(true, 'light', true)).toBe('dark');
    expect(resolve(true, 'dark', false)).toBe('light');
    expect(resolve(true, 'transparent', false)).toBe('light');
  });

  it('uses the dropdown value while the toggle is off', () => {
    expect(resolve(false, 'dark', false)).toBe('dark');
    expect(resolve(false, 'light', true)).toBe('light');
    expect(resolve(false, 'transparent', true)).toBe('transparent');
  });
});

describe('setPreviewAppearance', () => {
  function fakePlugin(leaves: Array<{ view: { containerEl: HTMLElement } }>): DrawioPlugin {
    return {
      app: {
        workspace: {
          iterateAllLeaves: (cb: (leaf: unknown) => void) => { leaves.forEach(cb); },
        },
      },
    } as unknown as DrawioPlugin;
  }

  it('writes the appearance onto every preview root in every window', () => {
    const popoutDoc = document.implementation.createHTMLDocument();
    const mainPreview = document.createElement('div');
    mainPreview.className = 'drawio-preview';
    document.body.appendChild(mainPreview);
    const popoutPreview = popoutDoc.createElement('div');
    popoutPreview.className = 'drawio-preview';
    popoutDoc.body.appendChild(popoutPreview);

    setPreviewAppearance(fakePlugin([
      { view: { containerEl: document.createElement('div') } },
      { view: { containerEl: popoutDoc.createElement('div') } },
    ]), 'dark');

    expect(mainPreview.dataset.appearance).toBe('dark');
    expect(popoutPreview.dataset.appearance).toBe('dark');
    mainPreview.remove();
  });
});
