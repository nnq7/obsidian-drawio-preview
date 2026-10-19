import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub the raw-text import so the module loads fast under vitest and avoids
// jsdom-eval incompatibilities in the real vendored viewer.
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
import { registerDrawioEmbeds } from '../src/file/EmbedRenderer';
import type DrawioPlugin from '../src/main';

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel/></diagram></mxfile>';
const MULTI_PAGE_XML = '<mxfile>' +
  '<diagram id="0" name="Page-1"><mxGraphModel/></diagram>' +
  '<diagram id="1" name="Page-2"><mxGraphModel/></diagram>' +
  '</mxfile>';

type Creator = (
  ctx: { containerEl: HTMLElement; sourcePath?: string },
  file: TFile,
  subpath?: string,
) => { loadFile: () => Promise<void> };

function fakePlugin(xml = XML) {
  let creator: Creator | undefined;
  const openWithDefaultApp = vi.fn();
  const file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
  const raw = {
    app: {
      embedRegistry: {
        registerExtension: (_ext: string, c: Creator) => { creator = c; },
      },
      vault: { read: async () => xml, on: vi.fn(() => ({})) },
      openWithDefaultApp,
    },
    settings: {},
    previewOpts: () => ({ dark: false }),
    register: vi.fn(),
  };
  return {
    plugin: raw as unknown as DrawioPlugin,
    create: (containerEl: HTMLElement, sourcePath?: string) =>
      creator!({ containerEl, sourcePath }, file, undefined),
    openWithDefaultApp,
  };
}

describe('drawio embed — click behavior', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  /** Page flips render through an async cache read: wait for it to settle. */
  async function tick(): Promise<void> {
    await new Promise((resolve) => { window.setTimeout(resolve, 0); });
  }

  it('mounts the interactive viewer and opens the system app from its Edit button', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create, openWithDefaultApp } = fakePlugin();
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();

    containerEl.querySelector<HTMLElement>('.drawio-preview')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(containerEl.classList.contains('drawio-interactive-active')).toBe(true);
    expect(containerEl.querySelector('.drawio-interactive-toolbar')).not.toBeNull();
    containerEl.querySelector<HTMLButtonElement>('[aria-label="编辑图表"]')!.click();
    expect(openWithDefaultApp).toHaveBeenCalledWith('diagram.drawio');
  });

  it('keeps activation state isolated between two embeds', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin();
    registerDrawioEmbeds(plugin);
    const first = document.createElement('div');
    const second = document.createElement('div');
    await create(first).loadFile();
    await create(second).loadFile();

    first.querySelector<HTMLElement>('.drawio-preview')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(first.classList.contains('drawio-interactive-active')).toBe(true);
    expect(second.classList.contains('drawio-interactive-active')).toBe(false);
    expect(first.querySelectorAll('.drawio-interactive-toolbar')).toHaveLength(1);
    expect(second.querySelectorAll('.drawio-interactive-toolbar')).toHaveLength(1);
  });

  it('rebinds a multi-page embed and refits the viewport height to the new page', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin(MULTI_PAGE_XML);
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    const preview = containerEl.querySelector<HTMLElement>('.drawio-preview')!;
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300, x: 0, y: 0,
      toJSON: () => ({}),
    });
    window.dispatchEvent(new Event('resize'));
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const height = preview.style.height;
    expect(height).toBe('300px');

    const buttons = containerEl.querySelectorAll<HTMLButtonElement>('.drawio-page-control button');
    buttons[1]!.click();
    // Page flips go through the file cache (async read), so let the microtasks land.
    await tick();
    const replacement = preview.querySelector('svg')!;
    expect(replacement.dataset.page).toBe('1');
    expect(replacement.classList.contains('drawio-interactive-svg')).toBe(true);
    // Page 1 is 400x300 at a 600px width ⇒ 450px, i.e. the box re-fits instead of
    // keeping page 0's 300px.
    expect(preview.style.height).toBe('450px');
    expect(containerEl.classList.contains('drawio-interactive-active')).toBe(false);
    expect(containerEl.querySelectorAll('.drawio-interactive-toolbar')).toHaveLength(1);
  });

  it('does not leak the previous controller when renders overlap', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin();
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl, 'note.md');
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    await Promise.all([embed.loadFile(), embed.loadFile()]);
    const added = addSpy.mock.calls.filter((call) => call[0] === 'keydown').length;
    const removed = removeSpy.mock.calls.filter((call) => call[0] === 'keydown').length;
    addSpy.mockRestore();
    removeSpy.mockRestore();
    // Exactly one live controller: the superseded render must not have
    // constructed (and leaked) a second set of document-level listeners.
    expect(added - removed).toBe(1);
    expect(containerEl.querySelectorAll('.drawio-interactive-toolbar')).toHaveLength(1);
  });

  it('renders nothing new after the embed component unloads mid-flight', async () => {
    Platform.isDesktopApp = true;
    const { plugin, create } = fakePlugin();
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl, 'note.md') as unknown as {
      loadFile: () => Promise<void>; load: () => void; unload: () => void;
    };
    embed.load();
    await embed.loadFile();
    expect(containerEl.querySelector('.drawio-interactive-toolbar')).not.toBeNull();

    const addSpy = vi.spyOn(document, 'addEventListener');
    embed.unload();
    // A caller holding an await (e.g. the initial file read) resumes and
    // re-renders after the unload — this must be a no-op, not a fresh mount.
    await embed.loadFile();
    const added = addSpy.mock.calls.filter((call) => call[0] === 'keydown').length;
    addSpy.mockRestore();
    expect(added).toBe(0);
    expect(containerEl.querySelector('.drawio-interactive-toolbar')).toBeNull();
  });

  it('shows a Notice instead of a viewer on mobile', async () => {
    Platform.isDesktopApp = false;
    const { plugin, create, openWithDefaultApp } = fakePlugin();
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    containerEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openWithDefaultApp).not.toHaveBeenCalled();
    expect(containerEl.querySelector('.drawio-interactive-toolbar')).toBeNull();
  });
});
