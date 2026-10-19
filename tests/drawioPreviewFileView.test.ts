import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the viewer.min.txt file to avoid needing to fetch it
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));
vi.mock('../src/preview/ViewerRenderer', () => {
  const render = (el: HTMLElement, _xml: string, opts: { page?: number }) => {
    el.empty();
    const svg = el.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', opts.page === 1 ? '10 20 400 300' : '0 0 200 100');
    svg.dataset.page = String(opts.page ?? 0);
    el.appendChild(svg);
    return true;
  };
  return {
    renderPreview: render,
    // File cache is a no-op here: no dir ⇒ straight to the render path.
    renderPreviewCached: async (el: HTMLElement, xml: string, opts: { page?: number }) => render(el, xml, opts),
  };
});

import { Platform, TFile } from 'obsidian';
import { DrawioPreviewFileView } from '../src/preview/DrawioPreviewFileView';
import type DrawioPlugin from '../src/main';

function fakePlugin(app: Record<string, unknown> = {}): DrawioPlugin {
  return {
    app,
    settings: {},
    previewOpts: () => ({ dark: false }),
  } as unknown as DrawioPlugin;
}

function makeView(plugin: DrawioPlugin, withFile = true): DrawioPreviewFileView {
  const view = new DrawioPreviewFileView({} as never, plugin);
  if (withFile) {
    view.file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
  }
  return view;
}

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" ' +
  'gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" ' +
  'pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">' +
  '<root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

const MULTI_PAGE_XML = '<mxfile>' +
  '<diagram id="0" name="Page-1"><mxGraphModel/></diagram>' +
  '<diagram id="1" name="Page-2"><mxGraphModel/></diagram>' +
  '</mxfile>';

describe('DrawioPreviewFileView', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('on mobile renders the fixed banner and the diagram, with no iframe', () => {
    Platform.isDesktopApp = false;
    const view = makeView(fakePlugin());
    view.setViewData(XML, true);
    const banner = view.contentEl.querySelector('.drawio-mobile-banner');
    expect(banner?.textContent).toContain('移动端仅支持预览');
    expect(view.contentEl.querySelector('.drawio-preview')).not.toBeNull();
    expect(view.contentEl.querySelector('iframe')).toBeNull();
  });

  it('on mobile ignores clicks (no viewer, no default app)', () => {
    Platform.isDesktopApp = false;
    const openWithDefaultApp = vi.fn();
    const view = makeView(fakePlugin({ openWithDefaultApp }));
    view.setViewData(XML, true);
    view.contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openWithDefaultApp).not.toHaveBeenCalled();
  });

  it('on desktop skips the banner and shows a click-to-explore title', () => {
    Platform.isDesktopApp = true;
    const view = makeView(fakePlugin());
    view.setViewData(XML, true);
    expect(view.contentEl.querySelector('.drawio-mobile-banner')).toBeNull();
    expect(view.contentEl.getAttribute('title')).toBe('点击以浏览图表');
  });

  it('mounts the interactive viewer and routes its Edit button to the default app', () => {
    Platform.isDesktopApp = true;
    const openWithDefaultApp = vi.fn();
    const view = makeView(fakePlugin({ openWithDefaultApp }));
    view.setViewData(XML, true);
    const preview = view.contentEl.querySelector<HTMLElement>('.drawio-preview')!;
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(view.contentEl.classList.contains('drawio-interactive-active')).toBe(true);
    expect(view.contentEl.querySelector('.drawio-interactive-toolbar')).not.toBeNull();
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="编辑图表"]')!.click();
    expect(openWithDefaultApp).toHaveBeenCalledWith('diagram.drawio');
  });

  it('rebinds the interactive viewer and refits the height after a file-view page flip', () => {
    Platform.isDesktopApp = true;
    const view = makeView(fakePlugin());
    view.setViewData(MULTI_PAGE_XML, true);
    const preview = view.contentEl.querySelector<HTMLElement>('.drawio-preview')!;
    // jsdom measures 0, so the automatic height stays deferred until a real
    // layout: mock a width and let the window-resize pass apply it.
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300, x: 0, y: 0,
      toJSON: () => ({}),
    });
    window.dispatchEvent(new Event('resize'));
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const height = preview.style.height;
    expect(height).toBe('300px');
    view.contentEl.querySelectorAll<HTMLButtonElement>('.drawio-page-control button')[1]!.click();
    const replacement = preview.querySelector('svg')!;
    expect(replacement.dataset.page).toBe('1');
    expect(replacement.classList.contains('drawio-interactive-svg')).toBe(true);
    // 600px wide × (300/400) = 450px: the box re-fits to page 1's shape.
    expect(preview.style.height).toBe('450px');
    // 同上：翻页不该把激活态清掉。
    expect(view.contentEl.classList.contains('drawio-interactive-active')).toBe(true);
  });

  it('renders the page switcher for multi-page diagrams', () => {
    Platform.isDesktopApp = true;
    const view = makeView(fakePlugin());
    view.setViewData(MULTI_PAGE_XML, true);
    expect(view.contentEl.querySelector('.drawio-page-control')).not.toBeNull();
  });

  it('getViewData returns the last data set (no write path)', () => {
    Platform.isDesktopApp = false;
    const view = makeView(fakePlugin());
    view.setViewData(XML, true);
    expect(view.getViewData()).toBe(XML);
  });

  it('clear() empties the content element and resets the data', () => {
    Platform.isDesktopApp = false;
    const view = makeView(fakePlugin());
    view.setViewData(XML, true);
    view.clear();
    expect(view.contentEl.children.length).toBe(0);
    expect(view.getViewData()).toBe('');
  });

  it('reports the shared drawio view type and a pencil-ruler icon', () => {
    const view = makeView(fakePlugin(), false);
    expect(view.getViewType()).toBe('drawio-file-view');
    expect(view.getIcon()).toBe('pencil-ruler');
  });
});
