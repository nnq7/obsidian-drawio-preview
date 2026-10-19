import { describe, it, expect, vi } from 'vitest';
import { TFolder, TFile } from 'obsidian';
import { registerDesktopFeatures } from '../src/desktop/registerDesktopFeatures';
import type DrawioPlugin from '../src/main';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

function tfolder(path: string): TFolder {
  const f = new TFolder();
  f.path = path;
  return f;
}

function fakePlugin() {
  const workspaceOn = vi.fn(
    (_name: string, _cb: (menu: unknown, file: unknown) => unknown) => ({}));
  const raw = {
    app: {
      workspace: {
        on: workspaceOn,
        getActiveFile: vi.fn(() => null),
        iterateAllLeaves: vi.fn(),
      },
    },
    addCommand: vi.fn(),
    addRibbonIcon: vi.fn(),
    registerEvent: vi.fn(),
    registerDomEvent: vi.fn(),
  };
  return { plugin: raw as unknown as DrawioPlugin, raw, workspaceOn };
}

/** Menu double: records item titles, ignores icons/clicks. */
function fakeMenu() {
  const titles: string[] = [];
  const item = {
    setTitle(t: string) { titles.push(t); return item; },
    setIcon() { return item; },
    onClick() { return item; },
  };
  const menu = { addItem: (cb: (i: typeof item) => unknown) => { cb(item); return menu; } };
  return { menu, titles };
}

describe('registerDesktopFeatures', () => {
  it('registers the create-drawio-file command', async () => {
    const { plugin, raw } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.addCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'create-drawio-file', name: '新建图表' }),
    );
  });

  it('adds the ribbon icon', async () => {
    const { plugin, raw } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.addRibbonIcon).toHaveBeenCalledWith(
      'workflow', '新建 drawio 图表', expect.any(Function),
    );
  });

  it('registers a file-menu handler for the folder context menu', async () => {
    const { plugin, workspaceOn } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(workspaceOn).toHaveBeenCalledWith('file-menu', expect.any(Function));
  });

  it('offers the new-diagram item on folders and nothing on files', async () => {
    const { plugin, workspaceOn } = fakePlugin();
    await registerDesktopFeatures(plugin);
    const handler = workspaceOn.mock.calls
      .find((c) => c[0] === 'file-menu')![1] as (menu: unknown, file: unknown) => void;

    const folder = fakeMenu();
    handler(folder.menu, tfolder('Diagrams'));
    expect(folder.titles).toEqual(['新建 drawio 图表']);

    const other = fakeMenu();
    handler(other.menu, tfile('a.drawio'));
    expect(other.titles).toEqual([]);
  });

  it('does not create a legacy export or edit command', async () => {
    const { plugin, raw } = fakePlugin();
    await registerDesktopFeatures(plugin);
    const ids = raw.addCommand.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(ids).not.toContain('export-diagram-svg');
    expect(ids).not.toContain('export-diagram-png');
    expect(ids).not.toContain('edit-dual-format-diagram');
  });
});
