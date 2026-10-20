import { AbstractInputSuggest, App, Platform, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type DrawioPlugin from './main';
import { cacheStore, pruneToCount } from './preview/svgFileCache';
import {
  CACHE_LIMIT_FILES_MAX, CACHE_LIMIT_FILES_MIN, clampCacheLimitFiles,
  type NewDiagramLocation, type PreviewAppearance,
} from './settings';
import { strings } from './i18n';

/**
 * Folder suggestions for the "specified folder" box. Obsidian ships this as
 * `AbstractInputSuggest` — the same widget its own "attachment folder" field
 * uses, so typing behaves identically to a native setting.
 */
class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly onPick: (path: string) => void,
  ) {
    super(app, inputEl);
  }

  protected getSuggestions(query: string): TFolder[] {
    const needle = query.trim().toLowerCase();
    const folders = this.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder);
    const matches = needle
      ? folders.filter((folder) => folder.path.toLowerCase().includes(needle))
      : folders;
    return matches.slice(0, 20);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path || '/');
  }

  selectSuggestion(folder: TFolder): void {
    this.setValue(folder.path);
    this.onPick(folder.path);
    this.close();
  }
}

/**
 * Settings tab, rendered with the imperative `display()` API.
 *
 * Do NOT migrate this to `getSettingDefinitions()`: that API (with
 * `setControlValue` / `refreshDomState`) is `@since 1.13.0` while
 * `minAppVersion` is 1.4.0. Conditional rows are handled by re-rendering on the
 * gating change.
 */
export class DrawioSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DrawioPlugin) { super(app, plugin); }

  /** Slider drags fire on every step; the prune runs once the value settles. */
  private cachePruneTimer: number | null = null;

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const L = strings();
    const save = () => { void this.plugin.saveSettings(); };

    if (Platform.isDesktopApp) {
      const isFolder = s.newDiagramLocation === 'folder';

      new Setting(containerEl)
        .setName(L.newDiagramLocationName)
        .setDesc(L.newDiagramLocationDesc)
        .addDropdown((d) => d
          .addOption('attachment', L.newDiagramLocationAttachment)
          .addOption('current', L.newDiagramLocationCurrent)
          .addOption('folder', L.newDiagramLocationFolder)
          .setValue(s.newDiagramLocation)
          .onChange((value) => {
            s.newDiagramLocation = value as NewDiagramLocation;
            save();
            // Re-render so the folder box below flips between editable/disabled.
            this.display();
          }));

      // The folder box sits directly under the dropdown and belongs to it: it is
      // only editable when the dropdown points at `folder`.
      const folderRow = new Setting(containerEl)
        .setDesc(L.newDiagramFolderDesc)
        .addText((text) => {
          text
            .setPlaceholder(L.newDiagramFolderPlaceholder)
            .setValue(s.newDiagramFolder)
            .setDisabled(!isFolder)
            .onChange((value) => { s.newDiagramFolder = value; save(); });
          text.inputEl.addClass('drawio-folder-input');
          if (isFolder) {
            new FolderSuggest(this.app, text.inputEl, (path) => {
              text.setValue(path);
              s.newDiagramFolder = path;
              save();
            });
          }
        });
      folderRow.settingEl.addClass('drawio-folder-row');
    }

    new Setting(containerEl)
      .setName(L.appearanceName)
      .setDesc(L.appearanceDesc)
      .addToggle((t) => t
        .setValue(s.followObsidianTheme)
        .onChange((v) => {
          s.followObsidianTheme = v;
          save();
          this.display(); // re-render so the dropdown enables/disables
          this.plugin.applyPreviewAppearance();
        }))
      .addDropdown((d) => d
        .addOption('light', L.appearanceLight)
        .addOption('dark', L.appearanceDark)
        .addOption('transparent', L.appearanceTransparent)
        .setValue(s.previewAppearance)
        .setDisabled(s.followObsidianTheme)
        .onChange((v) => {
          s.previewAppearance = v as PreviewAppearance;
          save();
          this.plugin.applyPreviewAppearance();
        }));

    // 缓存不再限于桌面端：vault.adapter 在移动端同样能写，所以两端都要能调上限。
    new Setting(containerEl)
      .setName(L.cacheName)
      .setDesc(L.cacheDesc)
      .addSlider((sl) => sl
        .setLimits(CACHE_LIMIT_FILES_MIN, CACHE_LIMIT_FILES_MAX, 1)
        .setValue(s.cacheLimitFiles)
        .setDynamicTooltip()
        .onChange((v) => {
          s.cacheLimitFiles = v;
          save();
          this.scheduleCachePrune();
        }));
  }

  /** Shrinking the budget should free space now, not on the next render. */
  private scheduleCachePrune(): void {
    if (this.cachePruneTimer !== null) window.clearTimeout(this.cachePruneTimer);
    this.cachePruneTimer = window.setTimeout(() => {
      this.cachePruneTimer = null;
      const store = cacheStore(this.app, this.plugin.manifest.id);
      void pruneToCount(store, clampCacheLimitFiles(this.plugin.settings.cacheLimitFiles));
    }, 400);
  }
}
