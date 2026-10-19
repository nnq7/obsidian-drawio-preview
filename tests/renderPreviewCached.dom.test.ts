/**
 * `renderPreviewCached` 的集成测试 —— 守住新方案的核心承诺：
 *
 *   ① **命中 ⇒ 完全不加载 drawio 核心** ✓（`ensureViewerLoaded` 一次都不能被调）；
 *   ② 未命中 ⇒ 正常渲染，且只有渲染成功才写缓存；
 *   ③ 缓存里的 SVG 含 `&nbsp;` 实体也能原样读回来（`XMLSerializer` → `DOMParser`
 *      的 XML 往返，**不是** HTML 的 innerHTML 路径 ✗）；
 *   ④ `store === null`（拿不到 adapter）⇒ 不读不写，照常渲染。
 *
 * 缓存在 `vault.adapter` 上，这里给一个**内存版 adapter**（移动端走的同一条路径），
 * 只有 `loadViewer` 被换成计数器。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DataAdapter } from 'obsidian';

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
import { cacheFileName, readCache, writeCache, type CacheStore } from '../src/preview/svgFileCache';
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

/** In-memory `DataAdapter`: the cache runs on `vault.adapter`, so this is the
 *  same code path the mobile app takes — just a Map underneath. */
function memoryStore(dir = '.obsidian/plugins/drawio-preview/cache') {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => {
      const data = files.get(p);
      if (data === undefined) throw new Error('ENOENT ' + p);
      return data;
    },
    write: async (p: string, data: string) => { files.set(p, data); },
    mkdir: async () => {},
    remove: async (p: string) => { files.delete(p); },
    stat: async (p: string) => (files.has(p)
      ? { type: 'file', ctime: 0, mtime: 0, size: files.get(p)!.length }
      : null),
    list: async (d: string) => ({
      files: [...files.keys()].filter((k) => k.startsWith(d + '/')),
      folders: [],
    }),
  } as unknown as DataAdapter;
  return { store: { adapter, dir } as CacheStore, files };
}

let store: CacheStore;

/** Cache target used by the render calls below; 15 MB unless overridden. */
function target(storeOrNull: CacheStore | null, limitFiles = 20): PreviewCacheTarget {
  return { store: storeOrNull, limitFiles };
}

function previewIn(host: HTMLElement): HTMLElement {
  const el = host.ownerDocument.createElement('div');
  el.className = 'drawio-preview';
  host.appendChild(el);
  return el;
}

beforeEach(() => {
  spies.ensureViewerLoaded.mockClear();
  spies.getGraphViewer.mockReturnValue(null);
  Platform.isDesktopApp = true;
  store = memoryStore().store;
});

describe('renderPreviewCached — 命中路径', () => {
  it('injects the cached SVG and never loads the viewer core', async () => {
    const { store: local, files } = memoryStore();
    store = local;
    const name = cacheFileName('图.drawio', 0, crc32Hex(XML));
    await writeCache(store, name, SVG_TEXT);
    // The stored name is the contract: <文件名>.<页码>.<CRC32>.
    expect([...files.keys()].some((k) => k.endsWith('/' + name))).toBe(true);

    const host = document.createElement('div');
    const el = previewIn(host);
    const ok = await renderPreviewCached(
      el, XML, { dark: false, appearance: 'dark', page: 0 }, '图.drawio', target(store),
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
    await writeCache(store, cacheFileName('旧.drawio', 0, crc32Hex(XML)), SVG_TEXT);
    const host = document.createElement('div');
    const el = previewIn(host);
    // Same file name, different content ⇒ different CRC ⇒ must be a miss.
    const changed = XML.replace('Page-1', 'Page-After-Edit');
    const ok = await renderPreviewCached(
      el, changed, { dark: false, page: 0 }, '旧.drawio', target(store),
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
    const ok = await renderPreviewCached(el, fresh, { dark: false }, '新的.drawio', target(store));

    expect(ok).toBe(false);
    expect(spies.ensureViewerLoaded).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.drawio-error')).not.toBeNull();
    // Fail-closed: nothing is cached for a render that produced no <svg>.
    expect(await readCache(store, cacheFileName('新的.drawio', 0, crc32Hex(fresh)))).toBeNull();
  });

  it('no store (no adapter) still renders, without throwing', async () => {
    Platform.isDesktopApp = false;
    const host = document.createElement('div');
    const el = previewIn(host);
    const ok = await renderPreviewCached(el, XML, { dark: false }, '手机.drawio', target(null));

    expect(ok).toBe(false);
    expect(spies.ensureViewerLoaded).toHaveBeenCalledTimes(1);
  });
});
