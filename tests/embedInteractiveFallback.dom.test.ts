import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/preview/viewer.min.txt', () => ({
  default: 'window.GraphViewer = window.GraphViewer || undefined;',
}));
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

import { TFile } from 'obsidian';
import { registerDrawioEmbeds } from '../src/file/EmbedRenderer';
import type DrawioPlugin from '../src/main';

const XML = '<mxfile>' +
  '<diagram id="0" name="Page-1"><mxGraphModel/></diagram>' +
  '<diagram id="1" name="Page-2"><mxGraphModel/></diagram>' +
  '</mxfile>';

type Processor = (
  el: HTMLElement,
  ctx: { sourcePath: string; addChild: (child: unknown) => void },
) => void;

function harness() {
  let processor: Processor | undefined;
  const openWithDefaultApp = vi.fn();
  const file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
  const plugin = {
    settings: {},
    previewOpts: () => ({ dark: false }),
    app: {
      vault: { read: () => Promise.resolve(XML), on: vi.fn(() => ({})) },
      metadataCache: { getFirstLinkpathDest: () => file },
      openWithDefaultApp,
    },
    registerMarkdownPostProcessor: (fn: Processor) => { processor = fn; },
  } as unknown as DrawioPlugin;
  registerDrawioEmbeds(plugin);
  return { processor: () => processor!, openWithDefaultApp };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => { window.setTimeout(resolve, 0); });
}

describe('interactive embed fallback renderer', () => {
  it('mounts the controller, routes Edit, and rebinds page changes', async () => {
    const { processor, openWithDefaultApp } = harness();
    const section = document.body.createDiv();
    const span = section.createSpan({ cls: 'internal-embed' });
    span.setAttribute('src', 'diagram.drawio');
    // Load added children the way Obsidian's real ctx.addChild does — the
    // fallback renderer gates its interactive mount on the section lifecycle
    // child actually being loaded.
    const addChild = vi.fn((child: unknown) => { (child as { load?: () => void }).load?.(); });
    processor()(section, { sourcePath: 'note.md', addChild });
    await tick();

    const preview = span.querySelector<HTMLElement>('.drawio-preview')!;
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(span.classList.contains('drawio-interactive-active')).toBe(true);
    expect(span.querySelector('.drawio-interactive-toolbar')).not.toBeNull();
    expect(addChild).toHaveBeenCalledTimes(1);
    span.querySelector<HTMLButtonElement>('[aria-label="编辑图表"]')!.click();
    expect(openWithDefaultApp).toHaveBeenCalledWith('diagram.drawio');

    // Establish a viewport height, then flip pages: the replacement SVG must
    // be rebound while the height is preserved.
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300, x: 0, y: 0,
      toJSON: () => ({}),
    });
    window.dispatchEvent(new Event('resize'));
    const height = preview.style.height;
    expect(height).toBe('300px');

    span.querySelectorAll<HTMLButtonElement>('.drawio-page-control button')[1]!.click();
    // Page flips render through an async cache read: wait for it to settle.
    await tick();
    expect(preview.querySelector<SVGSVGElement>('svg')!.dataset.page).toBe('1');
    expect(preview.querySelector('svg')!.classList.contains('drawio-interactive-svg')).toBe(true);
    // Page 1 is 400x300 at a 600px width ⇒ 450px: the box re-fits per page.
    expect(preview.style.height).toBe('450px');
    expect(span.classList.contains('drawio-interactive-active')).toBe(false);
  });

  it('mounts once the section load arrives, even after the async render finished', async () => {
    const { processor } = harness();
    const section = document.body.createDiv();
    const span = section.createSpan({ cls: 'internal-embed' });
    span.setAttribute('src', 'diagram.drawio');
    // Obsidian stores the child now and dispatches its load later — e.g.
    // when the render's awaits complete before the section's own load.
    let pending: { load: () => void } | null = null;
    const addChild = vi.fn((child: unknown) => { pending = child as { load: () => void }; });
    processor()(section, { sourcePath: 'note.md', addChild });
    await tick();
    expect(span.classList.contains('drawio-interactive')).toBe(false);

    pending!.load();
    expect(span.classList.contains('drawio-interactive')).toBe(true);
    span.querySelector<HTMLElement>('.drawio-preview')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(span.classList.contains('drawio-interactive-active')).toBe(true);
  });
});
