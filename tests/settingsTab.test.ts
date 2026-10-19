import { describe, it, expect, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { DrawioSettingTab } from '../src/settingsTab';
import { DEFAULT_SETTINGS } from '../src/settings';
import type DrawioPlugin from '../src/main';

function fakePlugin(overrides: Record<string, unknown> = {}): DrawioPlugin {
  return {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
    applyPreviewAppearance: () => {},
    ...overrides,
  } as unknown as DrawioPlugin;
}

function rowNames(containerEl: HTMLElement): (string | null)[] {
  return Array.from(containerEl.querySelectorAll('.setting-item-name')).map((n) => n.textContent);
}

/** The `.setting-item` whose name matches `name`. */
function row(containerEl: HTMLElement, name: string): HTMLElement {
  const match = Array.from(containerEl.querySelectorAll<HTMLElement>('.setting-item'))
    .find((item) => item.querySelector('.setting-item-name')?.textContent === name);
  if (!match) throw new Error(`no setting row named ${name}`);
  return match;
}

describe('DrawioSettingTab', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('shows the desktop-only rows on desktop', () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin());
    tab.display();
    const names = rowNames(tab.containerEl);
    expect(names).toContain('新建图表位置');
    expect(names).toContain('跟随 Obsidian 主题');
    // All editor-source / click-action / shape-library / idle-timeout rows are gone.
    expect(names).not.toContain('Editor source');
    expect(names).not.toContain('Open diagram files read-only');
    expect(names).not.toContain('Preview click action');
    expect(names).not.toContain('Edit button action');
    expect(names).not.toContain('Show shape libraries');
    expect(names).not.toContain('Server idle timeout (seconds)');
  });

  it('hides the folder row unless the location is a fixed folder', () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin());
    tab.display();
    expect(rowNames(tab.containerEl)).not.toContain('新建图表文件夹');

    const plugin = fakePlugin();
    plugin.settings.newDiagramLocation = 'folder';
    const tab2 = new DrawioSettingTab({} as never, plugin);
    tab2.display();
    expect(rowNames(tab2.containerEl)).toContain('新建图表文件夹');
  });

  it('puts the appearance dropdown on the follow-theme row, disabled while following', () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin());
    tab.display();
    const select = row(tab.containerEl, '跟随 Obsidian 主题').querySelector<HTMLSelectElement>('select')!;
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ['light', '浅色'], ['dark', '深色'], ['transparent', '透明'],
    ]);
    expect(select.value).toBe('light');
    expect(select.disabled).toBe(true);
  });

  it('enables the appearance dropdown once follow-theme is off', () => {
    Platform.isDesktopApp = false;
    const plugin = fakePlugin();
    plugin.settings.followObsidianTheme = false;
    plugin.settings.previewAppearance = 'dark';
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    const select = row(tab.containerEl, '跟随 Obsidian 主题').querySelector<HTMLSelectElement>('select')!;
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('dark');
  });

  it('hides the desktop-only new-diagram rows on mobile, keeps theme/cache rows', () => {
    Platform.isDesktopApp = false;
    const tab = new DrawioSettingTab({} as never, fakePlugin());
    tab.display();
    const names = rowNames(tab.containerEl);
    expect(names).not.toContain('新建图表位置');
    expect(names).not.toContain('新建图表文件夹');
    expect(names).toContain('缓存文件个数上限');
    expect(names).toContain('跟随 Obsidian 主题');
  });

  it('offers a 10–30 file cache slider showing the saved value (default 20)', () => {
    Platform.isDesktopApp = true;
    const tab = new DrawioSettingTab({} as never, fakePlugin());
    tab.display();
    const slider = row(tab.containerEl, '缓存文件个数上限')
      .querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.min).toBe('10');
    expect(slider.max).toBe('30');
    expect(slider.value).toBe('20');
  });

  it('shows the saved cache limit, not the default, once the user changed it', () => {
    Platform.isDesktopApp = true;
    const plugin = fakePlugin();
    plugin.settings.cacheLimitFiles = 25;
    const tab = new DrawioSettingTab({} as never, plugin);
    tab.display();
    const slider = row(tab.containerEl, '缓存文件个数上限')
      .querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.value).toBe('25');
  });
});
