import { Platform, TextFileView, WorkspaceLeaf } from 'obsidian';
import { DRAWIO_VIEW_TYPE } from '../constants';
import { strings } from '../i18n';
import { renderPreviewCached, stampOfFile } from './ViewerRenderer';
import { previewCacheTarget } from '../file/EmbedRenderer';
import { renderPageControl } from './pageControl';
import { openWithDefaultApp } from './clickAction';
import { InteractiveViewerController } from './interactiveViewer';
import { getDiagramPages, ensureMxfile } from '../model/xmlUtils';
import type DrawioPlugin from '../main';

/**
 * Read-only view for `.drawio` files: a static preview rendered via the same
 * renderPreview used by embeds. No iframe, no editor — used unconditionally on
 * every platform (preview-only build). Clicking the preview always activates
 * the interactive viewer; the viewer's Edit button opens the file in the system
 * default application (the local drawio app).
 */
export class DrawioPreviewFileView extends TextFileView {
  private interactive: InteractiveViewerController | null = null;
  /** 防止在途渲染覆盖更新的内容（切换文件 / 外部修改）。 */
  private renderGeneration = 0;
  /** 当前这轮渲染的 promise（setViewData 不阻塞，但要能被等待）。 */
  private renderDone: Promise<void> = Promise.resolve();

  constructor(leaf: WorkspaceLeaf, private plugin: DrawioPlugin) {
    super(leaf);
    this.data = '';
  }

  getViewType(): string { return DRAWIO_VIEW_TYPE; }
  getIcon(): string { return 'pencil-ruler'; }
  getViewData(): string { return this.data; }

  /** 缓存渲染是异步的（命中缓存时甚至不加载内核），但 TextFileView 的契约是同步返回，
   *  所以这里不 await，只把 promise 存下来供测试与后续逻辑等待。 */
  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    this.renderDone = this.render();
  }

  /** 缓存身份种子来自 `TFile.stat`（内存元数据，不读文件）。 */
  private stampOpt(): { stamp?: string } {
    const stamp = stampOfFile(this.file);
    return stamp ? { stamp } : {};
  }

  /** 等当前这轮渲染落地（测试用；Obsidian 自己不调）。 */
  whenRendered(): Promise<void> {
    return this.renderDone;
  }

  clear(): void {
    this.renderGeneration++;
    this.interactive?.dispose();
    this.interactive = null;
    this.data = '';
    this.contentEl.empty();
  }

  private async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    const c = this.contentEl;
    this.interactive?.dispose();
    this.interactive = null;
    c.empty();
    c.addClass('drawio-preview-file-view');

    if (Platform.isDesktopApp) {
      c.setAttribute('title', strings().titleClickToView);
      c.toggleClass('drawio-clickable', true);
    } else {
      c.createDiv({
        cls: 'drawio-mobile-banner',
        text: 'Drawio: 移动端仅支持预览 —— 请在桌面端打开此文件以进行交互式查看。',
      });
    }

    const preview = c.createDiv({ cls: 'drawio-preview' });
    const pages = getDiagramPages(ensureMxfile(this.data));
    const cache = previewCacheTarget(this.plugin);
    const sourceName = this.file?.name ?? 'untitled.drawio';
    await renderPreviewCached(
      preview, this.data,
      { ...this.plugin.previewOpts(), page: 0, ...this.stampOpt() }, sourceName, cache,
    );
    // 期间用户切了文件/内容又变了：本次结果作废，别把旧图挂上去。
    if (generation !== this.renderGeneration) return;

    let pageControlEl: HTMLElement | null = null;
    if (pages.length > 1) {
      pageControlEl = c.createDiv({ cls: 'drawio-page-control' });
      renderPageControl(pageControlEl, {
        pages,
        initialPage: 0,
        onPageChange: (page) => {
          const gen = this.renderGeneration;
          void (async () => {
            const flipped = await renderPreviewCached(
              preview, this.data,
              { ...this.plugin.previewOpts(), page, ...this.stampOpt() }, sourceName, cache,
            );
            if (gen !== this.renderGeneration) return;
            if (flipped) this.interactive?.bindSvg(preview.querySelector('svg'));
          })();
        },
      });
    }

    if (Platform.isDesktopApp) {
      this.interactive = new InteractiveViewerController(c, preview, {
        onEdit: () => {
          if (!this.file) return;
          openWithDefaultApp(this.plugin.app, this.file.path);
        },
      });
      this.interactive.bindSvg(preview.querySelector('svg'));
      if (pageControlEl) this.interactive.attachPager(pageControlEl);
    }
  }
}
