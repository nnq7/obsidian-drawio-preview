import { describe, it, expect, vi } from 'vitest';
import {
  createNewDiagramAtCursor, resolveNewDiagramFolder, uniqueDiagramPath,
} from '../src/file/createDiagram';
import type DrawioPlugin from '../src/main';
import { DEFAULT_SETTINGS } from '../src/settings';

const settings = (location: 'root' | 'current' | 'folder', folder = '') =>
  ({ newDiagramLocation: location, newDiagramFolder: folder });

describe('resolveNewDiagramFolder', () => {
  it('root mode always resolves to the vault root', () => {
    expect(resolveNewDiagramFolder(settings('root'), 'Notes/Daily')).toBe('');
    expect(resolveNewDiagramFolder(settings('root', 'Diagrams'), null)).toBe('');
  });

  it('current mode uses the active file parent', () => {
    expect(resolveNewDiagramFolder(settings('current'), 'Notes/Daily')).toBe('Notes/Daily');
  });

  it('current mode falls back to root when there is no active file', () => {
    expect(resolveNewDiagramFolder(settings('current'), null)).toBe('');
  });

  it('current mode treats the root folder path "/" as root', () => {
    expect(resolveNewDiagramFolder(settings('current'), '/')).toBe('');
  });

  it('folder mode uses the configured folder', () => {
    expect(resolveNewDiagramFolder(settings('folder', 'Diagrams'), 'Notes')).toBe('Diagrams');
  });

  it('folder mode with an empty setting resolves to root', () => {
    expect(resolveNewDiagramFolder(settings('folder', ''), 'Notes')).toBe('');
    expect(resolveNewDiagramFolder(settings('folder', '   '), 'Notes')).toBe('');
  });

  it('normalizes slashes and whitespace in the configured folder', () => {
    expect(resolveNewDiagramFolder(settings('folder', ' /Diagrams/sub/ '), null)).toBe('Diagrams/sub');
    expect(resolveNewDiagramFolder(settings('folder', 'Diagrams\\sub'), null)).toBe('Diagrams/sub');
    expect(resolveNewDiagramFolder(settings('folder', '//Diagrams//sub//'), null)).toBe('Diagrams/sub');
  });
});

/** Minimal plugin double: root location (no folder work), recording vault + workspace. */
function fakePlugin(existing: string[] = [], withEditor = false) {
  const created: string[] = [];
  const replaceSelection = vi.fn();
  const openFile = vi.fn(async () => {});
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => (existing.includes(path) ? { path } : null),
        create: async (path: string) => {
          created.push(path);
          return { path, name: path.split('/').pop() };
        },
        createFolder: async () => {},
      },
      workspace: {
        getActiveFile: () => null,
        activeEditor: withEditor
          ? { editor: { replaceSelection }, file: { path: 'notes/a.md' } }
          : null,
        getLeaf: () => ({ openFile }),
      },
      metadataCache: {
        fileToLinktext: (file: { path: string }) => String(file.path).split('/').pop(),
      },
    },
  } as unknown as DrawioPlugin;
  return { plugin, created, replaceSelection, openFile };
}

describe('uniqueDiagramPath', () => {
  it('uses the base name when it is free, without a timestamp suffix', () => {
    const { plugin } = fakePlugin();
    expect(uniqueDiagramPath(plugin, '')).toBe('Untitled Diagram.drawio');
  });

  it('appends 1, 2, … while the names are taken, and keeps the folder prefix', () => {
    const { plugin } = fakePlugin([
      'Diagrams/Untitled Diagram.drawio',
      'Diagrams/Untitled Diagram 1.drawio',
    ]);
    expect(uniqueDiagramPath(plugin, 'Diagrams')).toBe('Diagrams/Untitled Diagram 2.drawio');
  });
});

describe('createNewDiagramAtCursor', () => {
  it('embeds the new diagram at the cursor instead of opening a tab', async () => {
    const { plugin, replaceSelection, openFile } = fakePlugin([], true);
    await createNewDiagramAtCursor(plugin);
    expect(replaceSelection).toHaveBeenCalledWith('![[Untitled Diagram.drawio]]');
    expect(openFile).not.toHaveBeenCalled();
  });

  it('falls back to opening the file when there is no editor', async () => {
    const { plugin, openFile } = fakePlugin([], false);
    await createNewDiagramAtCursor(plugin);
    expect(openFile).toHaveBeenCalledTimes(1);
  });
});
