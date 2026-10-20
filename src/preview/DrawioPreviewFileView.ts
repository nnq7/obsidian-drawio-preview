import { Platform, TextFileView, WorkspaceLeaf } from 'obsidian';
import { DRAWIO_VIEW_TYPE } from '../constants';
import { strings } from '../i18n';
import { renderPreview } from './ViewerRenderer';
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

  constructor(leaf: WorkspaceLeaf, private plugin: DrawioPlugin) {
    super(leaf);
    this.data = '';
  }

  getViewType(): string { return DRAWIO_VIEW_TYPE; }
  getIcon(): string { return 'pencil-ruler'; }
  getViewData(): string { return this.data; }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    this.render();
  }

  clear(): void {
    this.interactive?.dispose();
    this.interactive = null;
    this.data = '';
    this.contentEl.empty();
  }

  private render(): void {
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
    renderPreview(preview, this.data, { ...this.plugin.previewOpts(), page: 0 });

    let pageControlEl: HTMLElement | null = null;
    if (pages.length > 1) {
      pageControlEl = c.createDiv({ cls: 'drawio-page-control' });
      renderPageControl(pageControlEl, {
        pages,
        initialPage: 0,
        onPageChange: (page) => {
          renderPreview(preview, this.data, { ...this.plugin.previewOpts(), page });
          this.interactive?.bindSvg(preview.querySelector('svg'));
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
