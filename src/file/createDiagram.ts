import { Notice, TFile, TFolder } from 'obsidian';
import type DrawioPlugin from '../main';
import type { DrawioSettings } from '../settings';
import { EMPTY_DIAGRAM } from '../constants';

/** Normalize a vault folder path: forward slashes, no empty/leading/trailing segments. */
function normalizeFolderPath(path: string): string {
  return path.trim().replace(/\\/g, '/').split('/').filter(Boolean).join('/');
}

/**
 * Resolve the target folder ('' = vault root) for a new diagram from the
 * location setting and the active file's parent path (null when no file is open).
 */
export function resolveNewDiagramFolder(
  settings: Pick<DrawioSettings, 'newDiagramLocation' | 'newDiagramFolder'>,
  activeFileParentPath: string | null,
): string {
  switch (settings.newDiagramLocation) {
    case 'current': return normalizeFolderPath(activeFileParentPath ?? '');
    case 'folder': return normalizeFolderPath(settings.newDiagramFolder);
    default: return '';
  }
}

/** Create missing folders segment by segment. */
async function ensureFolderExists(plugin: DrawioPlugin, path: string): Promise<boolean> {
  if (!path) return true;
  let current = '';
  for (const segment of path.split('/')) {
    current = current ? `${current}/${segment}` : segment;
    const existing = plugin.app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing) {
      new Notice(`Drawio: 「${current}」已存在，但它不是文件夹。`);
      return false;
    }
    await plugin.app.vault.createFolder(current);
  }
  return true;
}

/** Base file name for a new diagram; a numeric suffix is added on collisions. */
const BASE_NAME = 'Untitled Diagram';

/**
 * A free `.drawio` path inside `folder` (`''` = vault root). The name is what
 * ends up inside the note's `![[…]]` link, so a timestamp is deliberately not
 * used — `Untitled Diagram 2.drawio` reads far better than an epoch number.
 */
export function uniqueDiagramPath(plugin: DrawioPlugin, folder: string): string {
  const prefix = folder ? `${folder}/` : '';
  let path = `${prefix}${BASE_NAME}.drawio`;
  let n = 1;
  while (plugin.app.vault.getAbstractFileByPath(path)) {
    path = `${prefix}${BASE_NAME} ${n}.drawio`;
    n += 1;
  }
  return path;
}

/**
 * Create an empty diagram and return it WITHOUT opening anything — the
 * `drawio:新建图表` command embeds it at the cursor instead. `folderOverride`
 * (the folder the user right-clicked) wins over the location setting.
 */
export async function createDiagramFile(
  plugin: DrawioPlugin,
  folderOverride?: TFolder,
): Promise<TFile | null> {
  try {
    let folder: string;
    if (folderOverride) {
      folder = normalizeFolderPath(folderOverride.path);
    } else {
      const parent = plugin.app.workspace.getActiveFile()?.parent?.path ?? null;
      folder = resolveNewDiagramFolder(plugin.settings, parent);
      if (!(await ensureFolderExists(plugin, folder))) return null;
    }
    return await plugin.app.vault.create(uniqueDiagramPath(plugin, folder), EMPTY_DIAGRAM);
  } catch (err) {
    new Notice(`Drawio: 无法创建图表 —— ${String(err)}`);
    return null;
  }
}

/** Create a diagram and open it in a new tab (ribbon icon, folder menu). */
export async function createNewDiagram(
  plugin: DrawioPlugin,
  folderOverride?: TFolder,
): Promise<void> {
  const file = await createDiagramFile(plugin, folderOverride);
  if (!file) return;
  // Our registered file view shows the static preview inline.
  const leaf = plugin.app.workspace.getLeaf(true);
  await leaf.openFile(file);
}

/**
 * The `drawio:新建图表` command: create the file, then embed it at the cursor of
 * the active note. `replaceSelection` is what puts it at the cursor and keeps
 * the edit undoable. With no editor (Reading view, settings, any non-markdown
 * view) there is nothing to insert into, so fall back to opening the file —
 * the command must never end in a no-op.
 */
export async function createNewDiagramAtCursor(plugin: DrawioPlugin): Promise<void> {
  // Read the editor before the awaits: creating the file can shift the
  // active editor if Obsidian decides to reveal something.
  const active = plugin.app.workspace.activeEditor;
  const editor = active?.editor;
  const sourcePath = active?.file?.path;
  const file = await createDiagramFile(plugin);
  if (!file) return;
  if (!editor || sourcePath === undefined) {
    const leaf = plugin.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    return;
  }
  const linktext = plugin.app.metadataCache.fileToLinktext(file, sourcePath);
  editor.replaceSelection(`![[${linktext}]]`);
}
