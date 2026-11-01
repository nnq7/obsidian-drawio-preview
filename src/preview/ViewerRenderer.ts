import { ensureViewerLoaded, getGraphViewer } from './loadViewer';
import { isValidDrawioXml, ensureMxfile } from '../model/xmlUtils';
import { sanitizeSvgToNode } from './svgSanitizer';
import { crc32Hex } from './crc32';
import { cacheFileName, readCache, writeCache, type CacheStore } from './svgFileCache';
import {
  applyRegionViewBox, flattenLabelSwitches, hasCellIds, sharedRegionCacheName,
} from './regionViewBox';
import type { PreviewAppearance } from '../settings';

/**
 * Shown in place of the diagram when a region link cannot be resolved (bad id,
 * bad link shape, frame that is not a rectangle, export unavailable).
 *
 * Both languages are shown at once, Chinese first: the text is short, and it has
 * to stay readable whatever UI language the vault is set to. A region link either
 * shows its region or says why not — silently falling back to the whole diagram
 * would make a typo look like it worked.
 */
export const REGION_ERROR_ZH =
  'drawio渲染错误：请检查链接格式和元素id是否正确，元素id仅支持矩形框元素';
export const REGION_ERROR_EN =
  'drawio render error: check the link format and whether the element id is correct. '
  + 'Only rectangular frames are supported as element ids.';

export interface RenderOptions {
  dark: boolean;
  /**
   * Appearance applied to the preview root as `data-appearance`. drawio exports
   * its colours as `light-dark(light, dark)` semantic pairs resolved through CSS
   * `color-scheme`, so the actual light/dark resolution is driven by the
   * styles.css rule for this attribute — not by the kernel's `dark` flag.
   */
  appearance?: PreviewAppearance;
  /** Which diagram page to render (0-indexed); defaults to 0 (first page). */
  page?: number;
  /**
   * Element id of a box; when set, only the area that box covers is shown.
   *
   * Rendered through drawio's SVG **export** path, which tags every element
   * with `data-cell-id` and emits content coordinates with no root transform —
   * so the box's bbox is the viewBox, with nothing to back-solve. Any failure
   * (no instance, no such id, degenerate box) silently falls back to the whole
   * page: a wrong region is worse than no region.
   */
  regionId?: string;
}

const RENDER_TIMEOUT_MS = 5000;

/**
 * Render drawio XML into `el` as a static, sanitized, non-interactive SVG preview.
 *
 * Two GraphViewer behaviours shape this code:
 *
 *  1. By default GraphViewer DEFERS rendering whenever the mount has
 *     `offsetWidth == 0` (detached or hidden), waiting on a MutationObserver for
 *     an *attribute* change on an ancestor. In Obsidian's reading view the
 *     post-processor runs on a DETACHED fragment, and the later attach is a
 *     childList change, not an attribute change — so that observer never fires and
 *     the diagram never renders. We pass `check-visible-state: false` to force an
 *     immediate, synchronous render regardless of attachment, which is what makes
 *     reading-mode (and lazy embeds) work.
 *
 *  2. GraphViewer's <svg> has NO `viewBox`/`width`/`height` attributes — only
 *     inline `width:100%;height:100%` plus `min-width`/`min-height` equal to the
 *     diagram bounds. That only renders correctly inside GraphViewer's own
 *     precisely-sized container. Since we lift the bare <svg> out (to drop
 *     GraphViewer's click/lightbox handlers), we must re-attach explicit
 *     dimensions, otherwise the standalone SVG stretches to the note width and
 *     shows blank padding. {@link extractSizedSvg} restores a self-contained,
 *     content-sized SVG that scales down responsively via CSS.
 *
 * Returns false synchronously only for the early-exit cases (invalid XML / viewer
 * unavailable). The render itself is normally synchronous; a MutationObserver is
 * kept purely as a safety net for any environment that still defers.
 */
export function renderPreview(el: HTMLElement, xml: string, opts: RenderOptions): boolean {
  el.empty();
  // Pin the appearance on the preview root; styles.css maps it to a
  // `color-scheme` + background. Set before any early return so error
  // placeholders carry it too. Falls back to the kernel flag when a caller
  // omits `appearance` (older call sites / tests).
  el.dataset.appearance = opts.appearance ?? (opts.dark ? 'dark' : 'light');
  // Step1 背景下沉：同一外观也写到稳定父元素（它不会被重渲染替换）⇒ 重渲染期间背景不消失。
  const appearanceHost = el.parentElement;
  if (appearanceHost && el.dataset.appearance) appearanceHost.dataset.appearance = el.dataset.appearance;
  if (!isValidDrawioXml(xml)) {
    el.createDiv({ cls: 'drawio-error', text: '无效的 drawio 图表' });
    return false;
  }
  ensureViewerLoaded(el.ownerDocument);
  const viewer = getGraphViewer(el.ownerDocument.defaultView ?? window);
  if (!viewer) {
    el.createDiv({ cls: 'drawio-error', text: 'drawio 查看器加载失败' });
    return false;
  }

  const mount = el.createDiv({ cls: 'mxgraph' });
  const data = {
    highlight: '#0000ff', nav: false, lightbox: false, toolbar: '', edit: null,
    // Render even when the mount is detached/hidden (reading view, lazy embeds).
    'check-visible-state': false,
    'dark-mode': opts.dark ? 'auto' : 'off',
    page: opts.page ?? 0,
    xml: ensureMxfile(xml),
  };
  mount.setAttribute('data-mxgraph', JSON.stringify(data));
  // GraphViewer's init writes `data.page` into the window-global
  // `urlParams.page` (its internal handshake for selecting the <diagram> out
  // of an mxfile) and never restores it. Every consumer inside this render is
  // done with the global once createViewerForElement returns, so put it back —
  // otherwise the last-rendered page steers any later same-window mxfile parse
  // that doesn't set a page of its own (other plugins, future code paths).
  const win = el.ownerDocument.defaultView ?? window;
  const urlParams = (win as unknown as { urlParams?: Record<string, unknown> }).urlParams;
  const prevPage = urlParams?.page;
  try {
    viewer.createViewerForElement(mount);
  } finally {
    if (urlParams) urlParams.page = prevPage;
  }

  let done = false;

  const finalize = (svg: SVGSVGElement): void => {
    if (done) return;
    done = true;
    let clean: Node | null = null;
    try {
      clean = extractSizedSvg(svg, el.ownerDocument);
    } catch {
      clean = null;
    }
    el.empty(); // drop GraphViewer's container + its handlers/overlays
    if (clean) {
      el.appendChild(clean);
    } else {
      el.createDiv({ cls: 'drawio-error', text: 'drawio 渲染失败' });
    }
  };

  // With `check-visible-state: false` the SVG is produced synchronously.
  const immediate = mount.querySelector('svg');
  if (immediate) {
    finalize(immediate);
    return true;
  }

  // Safety net: if some environment still defers, wait for the SVG to appear.
  const observer = new win.MutationObserver(() => {
    const svg = mount.querySelector('svg');
    if (svg) {
      observer.disconnect();
      finalize(svg);
    }
  });
  observer.observe(mount, { childList: true, subtree: true });
  win.setTimeout(() => {
    observer.disconnect();
    if (!done) {
      el.empty();
      el.createDiv({ cls: 'drawio-error', text: 'drawio 渲染超时' });
    }
  }, RENDER_TIMEOUT_MS);
  return true;
}

/** Where the preview cache lives and how big it may grow. */
export interface PreviewCacheTarget {
  /** `vault.adapter` + vault-relative directory; null when unavailable. */
  store: CacheStore | null;
  /** Max number of cached SVGs; the oldest are evicted past it. */
  limitFiles: number;
}

/**
 * Preview with a **file-level cache**: on a hit the stored SVG is injected
 * directly and drawio's core is never loaded; on a miss it renders as usual and
 * writes the (sanitized, sized) `<svg>` back out.
 *
 * Cache identity is `<文件名>.<页码>.<CRC32(xml)>` — same name + same content ⇒
 * same diagram, so no path hashing is needed. A null `cache.store` (no adapter,
 * e.g. a stub environment) skips both the read and the write.
 *
 * Serialization MUST go through `XMLSerializer`: the rendered SVG contains
 * `&nbsp;` entity references that an HTML→XML round-trip cannot parse.
 */
export async function renderPreviewCached(
  el: HTMLElement, xml: string, opts: RenderOptions, sourceName: string, cache: PreviewCacheTarget,
): Promise<boolean> {
  const { store } = cache;
  const page = opts.page ?? 0;
  const crc = crc32Hex(xml);

  // A region never uses the whole-page path. Every region of one page shares a
  // single export (`<file>#x`) and crops its own viewBox out of it, so 30
  // regions of one diagram cost one render and one cache file instead of 30.
  if (opts.regionId) {
    const markup = await acquireRegionMarkup(el, xml, opts, sourceName, cache);
    const svg = markup ? cropRegionSvg(markup, opts.regionId, el.ownerDocument) : null;
    el.empty();
    el.dataset.appearance = opts.appearance ?? (opts.dark ? 'dark' : 'light');
    const appearanceHost = el.parentElement;
    if (appearanceHost && el.dataset.appearance) {
      appearanceHost.dataset.appearance = el.dataset.appearance;
    }
    if (svg) {
      el.appendChild(svg);
      return true;
    }
    // Two lines in one box: Chinese first, English second.
    const errorBox = el.createDiv({ cls: 'drawio-error' });
    errorBox.createDiv({ text: REGION_ERROR_ZH });
    errorBox.createDiv({ text: REGION_ERROR_EN });
    return false;
  }

  const name = cacheFileName(sourceName, page, crc);
  const hit = await readCache(store, name);
  if (hit) {
    const win = el.ownerDocument.defaultView ?? window;
    let root: Element | null = null;
    try {
      root = new win.DOMParser().parseFromString(hit, 'image/svg+xml').documentElement;
    } catch {
      root = null;
    }
    if (root && root.tagName.toLowerCase() === 'svg') {
      // A whole-page cache entry (written before regions existed, or by a plain
      // `![[x.drawio]]` embed) carries no cell ids. Serving it for a region
      // would silently show the entire diagram, so treat it as a miss.
      const usable = !opts.regionId || hasCellIds(root);
      if (usable) {
        el.empty();
        // Same appearance pinning as renderPreview (root + stable parent).
        el.dataset.appearance = opts.appearance ?? (opts.dark ? 'dark' : 'light');
        const appearanceHost = el.parentElement;
        if (appearanceHost && el.dataset.appearance) {
          appearanceHost.dataset.appearance = el.dataset.appearance;
        }
        el.appendChild(el.ownerDocument.importNode(root, true));
        return true;
      }
    }
  }
  const ok = renderPreview(el, xml, opts);
  if (ok) {
    // ⚠️ take the *inserted* <svg>: extractSizedSvg may return a DocumentFragment,
    // whose children are gone once appended.
    const svg = el.querySelector('svg');
    // A region link that fell back produced a whole-page svg. Caching it under
    // the region name would be stored-but-never-used (the reader above rejects
    // any entry without cell ids), so skip the write rather than leave an entry
    // that can never be hit.
    const fellBack = opts.regionId !== undefined && svg !== null && !hasCellIds(svg);
    if (svg && !fellBack) {
      try {
        const win = el.ownerDocument.defaultView ?? window;
        void writeCache(store, name, new win.XMLSerializer().serializeToString(svg), cache.limitFiles);
      } catch {
        /* soft failure: a cache write must never break the preview */
      }
    }
  }
  return ok;
}

/**
 * GraphViewer positions the diagram against an 8px top/left border but sizes the
 * SVG as `bounds + 25`, so the right/bottom margins come out 8px wider than the
 * left/top ones and the diagram sits visibly off-centre — ~1.4% of the width on a
 * short code block. Shifting the viewBox ORIGIN by half that surplus re-centres it
 * without touching the diagram or resizing the box.
 *
 * Both constants are GraphViewer's, not ours; tests/viewerBorderContract.dom.test.ts
 * renders a known geometry through the REAL vendored viewer and fails if either one
 * moves — that is the signal to re-derive this shift, not to relax the test.
 */
export const VIEWER_BORDER = 8;
export const VIEWER_SIZE_PADDING = 25;
/** (25 - 2*8) / 2 = 4.5 in GraphViewer's own terms, but its shapes land on a
 *  half-pixel grid, which measures out as 8.5 / 16.5 gutters — so the shift that
 *  actually equalises them is 4. */
export const VIEWBOX_CENTERING_SHIFT = (VIEWER_SIZE_PADDING - 2 * VIEWER_BORDER - 1) / 2;

/**
 * In-flight exports, keyed by the shared cache name: N regions of one page wait
 * on one render instead of starting N of them.
 */
const regionInFlight = new Map<string, Promise<string | null>>();
/** How long a finished export stays reachable for a late-arriving region. */
const REGION_INFLIGHT_TTL_MS = 2000;

/**
 * Render one page through drawio's SVG **export** path and return its markup.
 *
 * Mirrors `renderPreview`'s bootstrap (same mount shape and flags, so the viewer
 * behaves identically) but harvests `graph.getSvg()` instead of the viewer's own
 * inline `<svg>`: only the export carries `data-cell-id`, and it emits content
 * coordinates with no root transform.
 *
 * The result is the **whole page**, uncropped — one export serves every region
 * of that page, which is the whole point.
 */
function renderExportMarkup(container: HTMLElement, xml: string, opts: RenderOptions): string | null {
  const doc = container.ownerDocument;
  ensureViewerLoaded(doc);
  const viewer = getGraphViewer(doc.defaultView ?? window);
  if (!viewer) return null;
  const mount = container.createDiv({ cls: 'mxgraph' });
  mount.setAttribute('data-mxgraph', JSON.stringify({
    highlight: '#0000ff', nav: false, lightbox: false, toolbar: '', edit: null,
    'check-visible-state': false,
    'dark-mode': opts.dark ? 'auto' : 'off',
    page: opts.page ?? 0,
    xml: ensureMxfile(xml),
  }));
  const win = doc.defaultView ?? window;
  const urlParams = (win as unknown as { urlParams?: Record<string, unknown> }).urlParams;
  const prevPage = urlParams?.page;
  let instance: unknown = null;
  try {
    viewer.createViewerForElement(mount, (v) => { instance = v; });
  } finally {
    if (urlParams) urlParams.page = prevPage;
  }
  const graph = (instance as { graph?: { getSvg?: () => unknown } } | null)?.graph;
  if (!graph || typeof graph.getSvg !== 'function') return null;
  let node: unknown;
  try {
    node = graph.getSvg(); // no arguments: its cell filter is not usable here
  } catch {
    return null;
  }
  const exported = node as Node | null;
  if (!exported || typeof exported.nodeType !== 'number' || exported.nodeType !== 1) return null;
  try {
    return new win.XMLSerializer().serializeToString(exported);
  } catch {
    return null;
  }
}

/**
 * The shared export for one diagram page, or null.
 *
 * One diagram + page = one cache entry (`<file>#x.<page>.<crc>`) and one render,
 * regardless of how many regions point at it.
 */
async function acquireRegionMarkup(
  host: HTMLElement,
  xml: string,
  opts: RenderOptions,
  sourceName: string,
  cache: PreviewCacheTarget,
): Promise<string | null> {
  const page = opts.page ?? 0;
  const key = cacheFileName(sharedRegionCacheName(sourceName), page, crc32Hex(xml));

  // Claim the key before anything awaits. The cache read lives INSIDE the task:
  // doing it outside meant that while it was pending the key was still unclaimed,
  // so N regions of one page each read the disk before the first one registered —
  // measured as 5 reads for 1 key.
  const pending = regionInFlight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<string | null> => {
    const hit = await readCache(cache.store, key);
    if (hit && hit.includes('data-cell-id')) return hit;

    const doc = host.ownerDocument;
    // The viewer needs a container inside the document; park it off-screen.
    // NOTE: keep this as an inline style for now. A CSS class (or setCssProps)
    // was tried to satisfy obsidianmd/no-static-styles-assignment and the cold
    // render path stalled — no svg, no error, the embed just stayed empty.
    // Restoring the inline form is what ships in 1.3.0 and is known to render.
    const scrap = doc.createElement('div');
    // Styling lives in styles.css (.drawio-export-scratch): inline styles are a
    // hard review error and cannot be waived.
    scrap.className = 'drawio-export-scratch';
    doc.body.appendChild(scrap);
    let markup: string | null = null;
    try {
      markup = renderExportMarkup(scrap, xml, opts);
    } finally {
      scrap.remove();
    }
    if (!markup || !markup.includes('data-cell-id')) return null;
    void writeCache(cache.store, key, markup, cache.limitFiles);
    return markup;
  })();

  regionInFlight.set(key, task);
  const win = host.ownerDocument.defaultView ?? window;
  void task.finally(() => {
    // Keep the finished export briefly so a slow embed still benefits, then drop
    // it: a rejected task must never be memoised.
    win.setTimeout(() => {
      if (regionInFlight.get(key) === task) regionInFlight.delete(key);
    }, REGION_INFLIGHT_TTL_MS);
  });
  return task;
}

/**
 * Sanitize a shared export into a fresh tree and crop it to one region.
 *
 * `sanitizeSvgToNode` parses the markup on every call, so each region gets its
 * own copy — that is what keeps region A's viewBox out of B. If this is ever
 * changed to reuse a parsed template, it MUST clone first.
 *
 * Cropping reads the frame's geometry from the `<rect>` inside its group (see
 * `readElementBox`), so the frame has to be a rectangle. Other shapes render as
 * `<ellipse>`/`<path>` with no measurable fallback on a detached tree and fall
 * back to the error placeholder. Supporting them would mean measuring after
 * attach or baking geometry at export time; both were evaluated and dropped.
 */
function cropRegionSvg(markup: string, regionId: string, doc: Document): SVGSVGElement | null {
  let frag: Node;
  try {
    frag = sanitizeSvgToNode(markup, doc);
  } catch {
    return null;
  }
  let svg: SVGSVGElement | null = null;
  for (const child of Array.from(frag.childNodes)) {
    if (child.nodeType === 1 && (child as Element).localName.toLowerCase() === 'svg') {
      svg = child as SVGSVGElement;
      break;
    }
  }
  if (!svg) return null;
  flattenLabelSwitches(svg);
  return applyRegionViewBox(svg, regionId) ? svg : null;
}

/**
 * Sanitize GraphViewer's <svg> and make it self-contained: give it an explicit
 * `viewBox`/`width`/`height` from the diagram bounds (GraphViewer encodes those as
 * the SVG's `min-width`/`min-height`) and strip the inline `width:100%`/`height:100%`
 * sizing that only works inside GraphViewer's own container. The result renders at
 * its natural size and scales down to the note width via CSS (`max-width:100%`).
 *
 * Returns the imported, sanitized <svg> node, or null if no <svg> survived.
 */
function extractSizedSvg(svg: SVGSVGElement, targetDoc: Document): Node | null {
  // Capture bounds before sanitizing. `min-width`/`min-height` carry the diagram
  // size even when the mount is detached (offsetWidth would be 0); a live bounding
  // rect is the fallback when, rarely, the style isn't present.
  const rect = svg.getBoundingClientRect();
  const w = parseFloat(svg.style.minWidth) || rect.width || 0;
  const h = parseFloat(svg.style.minHeight) || rect.height || 0;

  const frag = sanitizeSvgToNode(svg.outerHTML, targetDoc);
  let out: SVGSVGElement | null = null;
  for (const node of Array.from(frag.childNodes)) {
    if (node.nodeType === 1 && (node as Element).localName.toLowerCase() === 'svg') {
      out = node as SVGSVGElement;
      break;
    }
  }
  if (!out) return null;

  if (w > 0 && h > 0) {
    // Shift the origin, not the size: same box, diagram centred inside it.
    const origin = -VIEWBOX_CENTERING_SHIFT;
    out.setAttribute('viewBox', `${origin} ${origin} ${w} ${h}`);
    out.setAttribute('width', String(w));
    out.setAttribute('height', String(h));
    // Inline width/height:100% (and absolute positioning) would override the
    // attributes and the responsive CSS — remove them so the SVG sizes naturally.
    for (const prop of ['width', 'height', 'min-width', 'min-height', 'position', 'left', 'top']) {
      out.style.removeProperty(prop);
    }
  }
  return frag;
}
