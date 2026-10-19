import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub the viewer so the module loads fast under vitest.
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));
vi.mock('../src/preview/ViewerRenderer', () => {
  const render = (el: HTMLElement, _xml: string, opts: { page?: number }) => {
    el.empty();
    const svg = el.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    svg.dataset.page = String(opts.page ?? 0);
    el.appendChild(svg);
    return true;
  };
  return {
    renderPreview: render,
    renderPreviewCached: async (el: HTMLElement, xml: string, opts: { page?: number }) => render(el, xml, opts),
  };
});
import { Platform, TFile } from 'obsidian';
import { registerDrawioEmbeds } from '../src/file/EmbedRenderer';
import {
  applyEmbedSize, findSizedEmbed, readEmbedSize,
} from '../src/preview/embedSize';
import type DrawioPlugin from '../src/main';

describe('embedSize — link size read/apply', () => {
  function embedSpan(width?: string, height?: string): HTMLElement {
    const span = document.createElement('span');
    span.className = 'internal-embed';
    if (width !== undefined) span.setAttribute('width', width);
    if (height !== undefined) span.setAttribute('height', height);
    return span;
  }

  it('reads `|400` as width and `|400x300` as width × height', () => {
    expect(readEmbedSize(embedSpan('400'))).toEqual({ width: 400, height: null });
    expect(readEmbedSize(embedSpan('400', '300'))).toEqual({ width: 400, height: 300 });
  });

  it('ignores a plain embed and a non-numeric alias', () => {
    expect(readEmbedSize(embedSpan())).toBeNull();
    expect(readEmbedSize(embedSpan('alias', 'nope'))).toBeNull();
    expect(readEmbedSize(null)).toBeNull();
  });

  it('finds the hosting `.internal-embed` (or reports none)', () => {
    const span = embedSpan('400');
    expect(findSizedEmbed(span)).toBe(span);
    const child = span.createDiv();
    expect(findSizedEmbed(child)).toBe(span);
    expect(findSizedEmbed(document.createElement('div'))).toBeNull();
  });

  it('mirrors the size onto the host and the preview, from the outside in', () => {
    const span = embedSpan('400', '300');
    const preview = document.createElement('div');
    applyEmbedSize(span, preview, readEmbedSize(span));
    expect(span.style.width).toBe('400px');
    expect(span.style.height).toBe('');
    expect(preview.style.width).toBe('400px');
    expect(preview.style.height).toBe('300px');
  });

  it('leaves the height to the content when only a width is given', () => {
    const span = embedSpan('400');
    const preview = document.createElement('div');
    applyEmbedSize(span, preview, readEmbedSize(span));
    expect(span.style.width).toBe('400px');
    expect(preview.style.width).toBe('400px');
    expect(preview.style.height).toBe('');
  });

  it('is idempotent across repeated applications', () => {
    const span = embedSpan('400', '300');
    const preview = document.createElement('div');
    const size = readEmbedSize(span);
    applyEmbedSize(span, preview, size);
    const snapshot = [span.style.width, preview.style.width, preview.style.height];
    applyEmbedSize(span, preview, size);
    expect([span.style.width, preview.style.width, preview.style.height]).toEqual(snapshot);
  });

  it('clears only its own sizing when the size goes away', () => {
    const span = document.createElement('span');
    span.className = 'internal-embed';
    span.style.marginTop = '4px'; // unrelated inline style must survive
    const preview = document.createElement('div');
    applyEmbedSize(span, preview, { width: 400, height: null });
    expect(span.style.width).toBe('400px');

    applyEmbedSize(span, preview, null); // link no longer carries a size
    expect(span.style.width).toBe('');
    expect(span.style.marginTop).toBe('4px');
  });

  it('never touches an embed it never sized', () => {
    const span = embedSpan();
    span.style.width = '222px'; // someone else's inline width
    const preview = document.createElement('div');
    applyEmbedSize(span, preview, null);
    expect(span.style.width).toBe('222px');
    expect(preview.style.width).toBe('');
  });
});

describe('drawio embed — link size integration', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel/></diagram></mxfile>';

  type Creator = (
    ctx: { containerEl: HTMLElement; sourcePath?: string },
    file: TFile,
    subpath?: string,
  ) => { loadFile: () => Promise<void> };

  function fakePlugin() {
    let creator: Creator | undefined;
    const file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
    const plugin = {
      app: {
        embedRegistry: { registerExtension: (_ext: string, c: Creator) => { creator = c; } },
        vault: { read: async () => XML, on: vi.fn(() => ({})) },
        openWithDefaultApp: vi.fn(),
      },
      settings: {},
      previewOpts: () => ({ dark: false }),
      register: vi.fn(),
    } as unknown as DrawioPlugin;
    return {
      plugin,
      create: (containerEl: HTMLElement, sourcePath?: string) =>
        creator!({ containerEl, sourcePath }, file, undefined),
    };
  }

  function sizedSpan(width?: string, height?: string): HTMLElement {
    const span = document.createElement('span');
    span.className = 'internal-embed';
    if (width !== undefined) span.setAttribute('width', width);
    if (height !== undefined) span.setAttribute('height', height);
    return span;
  }

  it('|400 sizes the preview (and its host) to 400px, leaving the height to content', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin();
    registerDrawioEmbeds(plugin);
    const span = sizedSpan('400');
    await create(span, 'note.md').loadFile();

    const preview = span.querySelector<HTMLElement>('.drawio-preview')!;
    expect(span.style.width).toBe('400px');
    expect(preview.style.width).toBe('400px');
    expect(preview.style.height).toBe('');
  });

  it('|400x300 sizes the preview to 400×300', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin();
    registerDrawioEmbeds(plugin);
    const span = sizedSpan('400', '300');
    await create(span, 'note.md').loadFile();

    const preview = span.querySelector<HTMLElement>('.drawio-preview')!;
    expect(span.style.width).toBe('400px');
    expect(preview.style.width).toBe('400px');
    expect(preview.style.height).toBe('300px');
  });

  it('does not intervene when the link carries no size', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin();
    registerDrawioEmbeds(plugin);
    const span = sizedSpan();
    await create(span, 'note.md').loadFile();

    const preview = span.querySelector<HTMLElement>('.drawio-preview')!;
    expect(span.style.width).toBe('');
    expect(preview.style.width).toBe('');
  });

  it('drops the size when the link loses its width parameter', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin();
    registerDrawioEmbeds(plugin);
    const span = sizedSpan('400');
    const embed = create(span, 'note.md');
    await embed.loadFile();
    expect(span.style.width).toBe('400px');

    span.removeAttribute('width');
    await embed.loadFile();
    expect(span.style.width).toBe('');
    expect(span.querySelectorAll('.drawio-preview')).toHaveLength(1);
  });
});
