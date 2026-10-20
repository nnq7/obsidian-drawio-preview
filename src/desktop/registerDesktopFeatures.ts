import { TFolder } from 'obsidian';
import { createNewDiagram, createNewDiagramAtCursor } from '../file/createDiagram';
import { strings } from '../i18n';
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
 * Labels are read once at registration: the locale is resolved at startup from
 * Obsidian's own UI language and never changes while the app is running, so
 * there is nothing to relabel.
 *
 * Preview-only: there is no local drawio server or embedded editor, so no
 * server is created and no editor entry points are registered.
 */
export async function registerDesktopFeatures(plugin: DrawioPlugin): Promise<void> {
  plugin.addCommand({
    id: 'create-drawio-file',
    name: strings().commandNewDiagram,
    callback: () => { void createNewDiagramAtCursor(plugin); },
  });

  plugin.addRibbonIcon('workflow', strings().ribbonNewDiagram, () => {
    void createNewDiagram(plugin);
  });

  // The folder context menu rebuilds on every open, so it reads `strings()`
  // live and stays correct without extra bookkeeping.
  plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
    if (file instanceof TFolder) {
      menu.addItem((item) => item
        .setTitle(strings().menuNewDiagram)
        .setIcon('workflow')
        .onClick(() => { void createNewDiagram(plugin, file); }));
    }
  }));
}
