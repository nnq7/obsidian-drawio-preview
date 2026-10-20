import { moment, Platform, Plugin } from 'obsidian';
import {
  DrawioSettings, DEFAULT_SETTINGS, PreviewAppearance, normalizeNewDiagramLocation,
} from './settings';
import { languageFromLocale, setLanguage } from './i18n';
import type { RenderOptions } from './preview/ViewerRenderer';
import { DRAWIO_VIEW_TYPE, DRAWIO_FILE_EXT } from './constants';
import { observeEmbedSizes } from './preview/embedSize';

export default class DrawioPlugin extends Plugin {
  settings!: DrawioSettings;

  async onload() {
    await this.loadSettings();

    // Preview-only: .drawio files always open as a static preview (never an
    // embedded editor), on every platform.
    const { DrawioPreviewFileView } = await import('./preview/DrawioPreviewFileView');
    this.registerView(DRAWIO_VIEW_TYPE, (leaf) => new DrawioPreviewFileView(leaf, this));
    this.registerExtensions([DRAWIO_FILE_EXT], DRAWIO_VIEW_TYPE);

    const { registerDrawioEmbeds } = await import('./file/EmbedRenderer');
    registerDrawioEmbeds(this);

    // 链接尺寸实时跟随：只监听 width/height 属性变化，改数字即时生效（原生图片同款手感）
    const embedSizeObserver = observeEmbedSizes(window.document, window);
    this.register(() => embedSizeObserver.disconnect());

    // Appearance is a `data-appearance` attribute on each preview root (see
    // styles.css), so a theme switch only needs to re-write that attribute on
    // already-rendered previews — no re-render. `css-change` fires on every
    // Obsidian theme change.
    this.applyPreviewAppearance();
    this.registerEvent(this.app.workspace.on('css-change', () => {
      this.applyPreviewAppearance();
    }));

    await maybeRegisterDesktopFeatures(this);

    const { DrawioSettingTab } = await import('./settingsTab');
    this.addSettingTab(new DrawioSettingTab(this.app, this));
  }

  isDark(): boolean {
    return activeDocument.body.hasClass('theme-dark');
  }

  /**
   * Appearance a preview should render with. When following the Obsidian theme
   * the dropdown is ignored and the semantic appearance tracks the theme
   * (dark theme → 'dark', light → 'light'); otherwise the dropdown's own value
   * is used.
   */
  previewAppearance(): PreviewAppearance {
    if (this.settings.followObsidianTheme) return this.isDark() ? 'dark' : 'light';
    return this.settings.previewAppearance;
  }

  /** Options for every preview render (embeds and file previews). */
  previewOpts(): RenderOptions {
    const appearance = this.previewAppearance();
    // `dark` is the viewer's kernel flag; the visible colours come from the
    // `data-appearance` attribute + CSS `color-scheme`, not from this flag.
    return { dark: appearance === 'dark', appearance };
  }

  /** Re-apply the resolved appearance to every already-rendered preview. */
  applyPreviewAppearance() {
    setPreviewAppearance(this, this.previewAppearance());
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<DrawioSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
    // `root` was retired in favour of `attachment`; an empty folder target is
    // no target at all. Both migrate to `attachment`.
    this.settings.newDiagramLocation = normalizeNewDiagramLocation(
      saved?.newDiagramLocation,
      saved?.newDiagramFolder,
    );
    // Locale follows Obsidian's own UI language, read once at startup: Chinese
    // gets a translated UI, every other language falls back to English.
    setLanguage(languageFromLocale(moment.locale()));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Obsidian's raw `attachmentFolderPath` setting (`'/'`, `'./'`, `'./sub'`,
   * `'sub'`). `Vault.getConfig` is not in the public typings but is the only way
   * to read it; a missing or throwing implementation degrades to '' (vault root).
   */
  attachmentFolderConfig(): string {
    const vault = this.app.vault as unknown as { getConfig?: (key: string) => unknown };
    try {
      const value = vault.getConfig?.('attachmentFolderPath');
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  }
}

/** Write the resolved appearance onto every rendered preview root in the main
 * window and any popouts (see {@link previewDocuments}). Exported standalone so
 * it's unit-testable without a full Plugin instance. */
export function setPreviewAppearance(plugin: DrawioPlugin, appearance: PreviewAppearance): void {
  for (const doc of previewDocuments(plugin)) {
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.drawio-preview'))) {
      el.dataset.appearance = appearance;
      if (el.parentElement) el.parentElement.dataset.appearance = appearance;
    }
  }
}

/** Every document a preview may live in: the active window plus every popout
 * window, discovered through their leaves. */
function previewDocuments(plugin: DrawioPlugin): Set<Document> {
  const docs = new Set<Document>([activeDocument]);
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    docs.add(leaf.view.containerEl.ownerDocument);
  });
  return docs;
}

/** Dynamically load and run desktop-only registration (ribbon, command,
 * folder-context-menu, migrate) — skipped entirely on mobile. Exported
 * standalone so the platform gate is unit-testable without a full Plugin
 * instance. */
export async function maybeRegisterDesktopFeatures(plugin: DrawioPlugin): Promise<void> {
  if (!Platform.isDesktopApp) return;
  const { registerDesktopFeatures } = await import('./desktop/registerDesktopFeatures');
  await registerDesktopFeatures(plugin);
}
