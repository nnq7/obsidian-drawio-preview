import { App, Platform, PluginSettingTab, Setting } from 'obsidian';
import type DrawioPlugin from './main';
import { cacheDir, pruneToLimit } from './preview/svgFileCache';
import {
  CACHE_LIMIT_MB_MAX, CACHE_LIMIT_MB_MIN, cacheLimitBytes,
  type NewDiagramLocation, type PreviewAppearance,
} from './settings';

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
    const save = () => { void this.plugin.saveSettings(); };

    if (Platform.isDesktopApp) {
      new Setting(containerEl)
        .setName('新建图表位置')
        .setDesc(
          '命令和功能区按钮新建图表的位置。文件夹右键菜单始终在点击的文件夹中创建。',
        )
        .addDropdown((d) => d
          .addOption('root', '仓库根目录')
          .addOption('current', '与当前笔记相同的文件夹')
          .addOption('folder', '下方指定的文件夹')
          .setValue(s.newDiagramLocation)
          .onChange((v) => { s.newDiagramLocation = v as NewDiagramLocation; save(); this.display(); }));

      // Target folder, only relevant when the location is a fixed folder.
      if (s.newDiagramLocation === 'folder') {
        new Setting(containerEl)
          .setName('新建图表文件夹')
          .setDesc('若不存在则自动创建。')
          .addText((t) => t
            .setPlaceholder('Diagrams/drawio')
            .setValue(s.newDiagramFolder)
            .onChange((v) => { s.newDiagramFolder = v; save(); }));
      }
    }

    new Setting(containerEl)
      .setName('跟随 Obsidian 主题')
      .setDesc(
        '打开时预览外观自动跟随 Obsidian 当前的浅色 / 深色主题，下方下拉框不可用；' +
        '关闭时使用下拉框选择的外观。',
      )
      .addToggle((t) => t
        .setValue(s.followObsidianTheme)
        .onChange((v) => {
          s.followObsidianTheme = v;
          save();
          this.display(); // re-render so the dropdown enables/disables
          this.plugin.applyPreviewAppearance();
        }))
      .addDropdown((d) => d
        .addOption('light', '浅色')
        .addOption('dark', '深色')
        .addOption('transparent', '透明')
        .setValue(s.previewAppearance)
        .setDisabled(s.followObsidianTheme)
        .onChange((v) => {
          s.previewAppearance = v as PreviewAppearance;
          save();
          this.plugin.applyPreviewAppearance();
        }));

    if (Platform.isDesktopApp) {
      new Setting(containerEl)
        .setName('缓存大小上限')
        .setDesc(
          '预览缓存的磁盘占用上限，超出后按最近使用时间删除最旧的缓存。' +
          '只删缓存文件，不会动图表文件。',
        )
        .addSlider((sl) => sl
          .setLimits(CACHE_LIMIT_MB_MIN, CACHE_LIMIT_MB_MAX, 1)
          .setValue(s.cacheLimitMB)
          .setDynamicTooltip()
          .onChange((v) => {
            s.cacheLimitMB = v;
            save();
            this.scheduleCachePrune();
          }));
    }
  }

  /** Shrinking the budget should free space now, not on the next render. */
  private scheduleCachePrune(): void {
    if (this.cachePruneTimer !== null) window.clearTimeout(this.cachePruneTimer);
    this.cachePruneTimer = window.setTimeout(() => {
      this.cachePruneTimer = null;
      const dir = cacheDir(this.app, this.plugin.manifest.id);
      void pruneToLimit(dir, cacheLimitBytes(this.plugin.settings.cacheLimitMB));
    }, 400);
  }
}
