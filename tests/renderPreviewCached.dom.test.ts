/**
 * `renderPreviewCached` 的集成测试 —— 守住新方案的核心承诺：
 *
 *   ① **命中 ⇒ 完全不加载 drawio 核心** ✓（`ensureViewerLoaded` 一次都不能被调）；
 *   ② 未命中 ⇒ 正常渲染，且只有渲染成功才写缓存；
 *   ③ 缓存里的 SVG 含 `&nbsp;` 实体也能原样读回来（`XMLSerializer` → `DOMParser`
 *      的 XML 往返，**不是** HTML 的 innerHTML 路径 ✗）；
 *   ④ `dir === null`（移动端 / 无 fs）⇒ 不读不写，照常渲染。
 *
 * 这里用**真实 fs 临时目录** + 真实的 `svgFileCache`，只有 `loadViewer` 被换成计数器。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import * as os from 'os';

const spies = vi.hoisted(() => ({
  ensureViewerLoaded: vi.fn(),
  getGraphViewer: vi.fn((): unknown => null),
}));

vi.mock('../src/preview/loadViewer', () => ({
  ensureViewerLoaded: spies.ensureViewerLoaded,
  getGraphViewer: spies.getGraphViewer,
}));

import { Platform } from 'obsidian';
import { renderPreviewCached, type PreviewCacheTarget } from '../src/preview/ViewerRenderer';
import { cacheFileName, readCache, writeCache } from '../src/preview/svgFileCache';
import { crc32Hex } from '../src/preview/crc32';

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel/></diagram></mxfile>';

/**
 * The real write path serialises a live `<svg>` node, so the NBSP inside the
 * diagram text becomes `&#160;` (a legal character reference) rather than the
 * `&nbsp;` HTML entity — which XML parsing rejects. Build it the same way here.
 */
function serializedSvg(): string {
  const NS = 'http://www.w3.org/2000/svg';
  const doc = document.implementation.createDocument(NS, 'svg', null);
  const svg = doc.documentElement;
  svg.setAttribute('width', '120');
  svg.setAttribute('height', '80');
  svg.setAttribute('viewBox', '-4.5 -4.5 120 80');
  const text = doc.createElementNS(NS, 'text');
  text.textContent = 'a\u00a0b';
  svg.appendChild(text);
  return new XMLSerializer().serializeToString(svg);
}

const SVG_TEXT = serializedSvg();

let tmp = '';
let dir = '';

/** Cache target used by the render calls below; 15 MB unless overridden. */
function target(dir: string | null, limitBytes = 15 * 1024 * 1024): PreviewCacheTarget {
  return { dir, limitBytes };
}

function previewIn(host: HTMLElement): HTMLElement {
  const el = host.ownerDocument.createElement('div');
  el.className = 'drawio-preview';
  host.appendChild(el);
  return el;
}

beforeAll(async () => {
  (window as unknown as { require: (m: string) => unknown }).require = (m: string) => {
    if (m === 'fs') return { promises: fsPromises };
    if (m === 'path') return path;
    throw new Error('unexpected module ' + m);
  };
  tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'drawio-cached-render-'));
  dir = path.join(tmp, 'cache');
});

afterAll(async () => {
  try { await fsPromises.rm(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  delete (window as unknown as { require?: unknown }).require;
});

beforeEach(() => {
  spies.ensureViewerLoaded.mockClear();
  spies.getGraphViewer.mockReturnValue(null);
  Platform.isDesktopApp = true;
});

describe('renderPreviewCached — 命中路径', () => {
  it('injects the cached SVG and never loads the viewer core', async () => {
    const name = cacheFileName('图.drawio', 0, crc32Hex(XML));
    await writeCache(dir, name, SVG_TEXT);
    // The on-disk name is the contract: <文件名>.<页码>.<CRC32>.
    expect(await fsPromises.readdir(dir)).toContain(name);

    const host = document.createElement('div');
    const el = previewIn(host);
    const ok = await renderPreviewCached(
      el, XML, { dark: false, appearance: 'dark', page: 0 }, '图.drawio', target(dir),
    );

    expect(ok).toBe(true);
    expect(spies.ensureViewerLoaded).not.toHaveBeenCalled();
    expect(spies.getGraphViewer).not.toHaveBeenCalled();
    const svg = el.querySelector('svg');
    expect(svg).not.toBeNull();
    // `&nbsp;` survived the XML round-trip (no "Entity not defined" placeholder).
    expect(el.querySelector('text')?.textContent).toBe('a\u00a0b');
    expect(el.querySelector('.drawio-error')).toBeNull();
    // Appearance is pinned on the preview root *and* its stable parent.
    expect(el.dataset.appearance).toBe('dark');
    expect(host.dataset.appearance).toBe('dark');
  });

  it('ignores a cache entry whose CRC does not match the current content', async () => {
    await writeCache(dir, cacheFileName('旧.drawio', 0, crc32Hex(XML)), SVG_TEXT);
    const host = document.createElement('div');
    const el = previewIn(host);
    // Same file name, different content ⇒ different CRC ⇒ must be a miss.
    const changed = XML.replace('Page-1', 'Page-After-Edit');
    const ok = await renderPreviewCached(
      el, changed, { dark: false, page: 0 }, '旧.drawio', target(dir),
    );

    expect(ok).toBe(false); // no viewer in this test ⇒ error placeholder
    expect(spies.ensureViewerLoaded).toHaveBeenCalledTimes(1);
  });
});

describe('renderPreviewCached — 未命中路径', () => {
  it('renders through the core and writes nothing when the render fails', async () => {
    const host = document.createElement('div');
    const el = previewIn(host);
    const fresh = XML.replace('Page-1', 'Brand-New');
    const ok = await renderPreviewCached(el, fresh, { dark: false }, '新的.drawio', target(dir));

    expect(ok).toBe(false);
    expect(spies.ensureViewerLoaded).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.drawio-error')).not.toBeNull();
    // Fail-closed: nothing is cached for a render that produced no <svg>.
    expect(await readCache(dir, cacheFileName('新的.drawio', 0, crc32Hex(fresh)))).toBeNull();
  });

  it('no cache dir (mobile / no filesystem) still renders, without throwing', async () => {
    Platform.isDesktopApp = false;
    const host = document.createElement('div');
    const el = previewIn(host);
    const ok = await renderPreviewCached(el, XML, { dark: false }, '手机.drawio', target(null));

    expect(ok).toBe(false);
    expect(spies.ensureViewerLoaded).toHaveBeenCalledTimes(1);
  });
});
