import { App, Notice } from 'obsidian';
import { strings } from '../i18n';

/**
 * Open a vault file in the OS default application. `App.openWithDefaultApp`
 * is an Obsidian internal that isn't in the public typings, so it's
 * feature-detected (same pattern as EmbedRenderer's embedRegistry) with a
 * Notice fallback instead of a throw.
 *
 * Preview-only: this is the sole remaining "edit" entry point — the
 * interactive viewer's Edit button and any preview click that used to open the
 * embedded editor now route here.
 */
export function openWithDefaultApp(app: App, path: string): void {
  const internal = app as unknown as { openWithDefaultApp?: (path: string) => unknown };
  if (typeof internal.openWithDefaultApp === 'function') {
    internal.openWithDefaultApp(path);
  } else {
    new Notice(strings().noticeNoDefaultApp);
  }
}
