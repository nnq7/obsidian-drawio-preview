import { TFolder } from 'obsidian';
import { createNewDiagram, createNewDiagramAtCursor } from '../file/createDiagram';
import type DrawioPlugin from '../main';

/**
 * Registers everything that only makes sense — and only works — on desktop: the
 * "Create new diagram" command, the ribbon icon and the folder context-menu
 * item. Only reached through the `Platform.isDesktopApp` gate in main.ts's
 * `onload()` (via `maybeRegisterDesktopFeatures`), so this file is never loaded
 * on mobile.
 *
 * The command embeds the new diagram at the cursor (see
 * `createNewDiagramAtCursor`); the ribbon and folder-menu entries keep opening
 * it in a tab, since neither has a cursor to insert into.
 *
 * Preview-only: there is no local drawio server or embedded editor, so no
 * server is created and no editor entry points are registered.
 */
export async function registerDesktopFeatures(plugin: DrawioPlugin): Promise<void> {
  plugin.addCommand({
    id: 'create-drawio-file',
    name: '新建图表',
    callback: () => { void createNewDiagramAtCursor(plugin); },
  });

  plugin.addRibbonIcon('workflow', '新建 drawio 图表', () => {
    void createNewDiagram(plugin);
  });

  // "New drawio diagram" on folder context menus, creating in that folder.
  plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
    if (file instanceof TFolder) {
      menu.addItem((item) => item
        .setTitle('新建 drawio 图表')
        .setIcon('workflow')
        .onClick(() => { void createNewDiagram(plugin, file); }));
    }
  }));
}
