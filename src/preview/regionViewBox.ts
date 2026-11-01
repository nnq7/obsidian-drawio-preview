/**
 * Region preview geometry.
 *
 * Why this can be exact instead of estimated: drawio's **export** path wraps
 * every element in `<g data-cell-id="…">` and emits content coordinates with no
 * root transform (see `docs/region-preview-research.md`). So the box element's
 * own bbox *is* the viewBox — nothing has to be back-solved from a transform
 * matrix, and no element→node mapping is needed either (the id is on the node).
 *
 * Everything here fails soft: a missing element, a missing id, or a degenerate
 * box returns false/null so the caller can fall back to the whole diagram. A
 * wrong region must never be shown.
 */

/**
 * Offset from the box's own bounds, in source units. **Negative = pull inwards.**
 *
 * -1 by request: a frame's stroke is drawn centred on its path, so at 0 the
 * preview shows a sliver of the frame itself along all four edges. Pulling in
 * 1px moves the whole 1px stroke (0.5px either side of the path) outside the
 * viewport. Diagonals still clip anything that sits exactly on the frame line,
 * and a stroke wider than 2 would still leave a faint line.
 */
export const REGION_PADDING = -1;

/**
 * Cache identity for the **shared** export of a diagram page: `<file>#x`.
 *
 * Every region of the same page reads this one entry and crops its own viewBox,
 * so N regions cost one render and one file instead of N of each. The `#x`
 * segment keeps it apart from the whole-page entry (`<file>.<page>.`) and from
 * the retired per-region entries (`<file>#r-<id>.<page>.`), which are never
 * written again.
 */
export function sharedRegionCacheName(sourceName: string): string {
  return `${sourceName}#x`;
}

/**
 * Attribute selector for a cell id. Quoted + escaped, so an id containing a
 * quote or backslash still matches the literal attribute value.
 */
export function regionSelector(regionId: string): string {
  const escaped = regionId.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '');
  return `g[data-cell-id="${escaped}"]`;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function attrNumber(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw === null) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Geometry of a rendered element, in the SVG's own user units.
 *
 * `getBBox()` is authoritative once the node is in a document with layout. When
 * it is unavailable (jsdom, detached trees, some mobile WebViews) a plain
 * `<rect>` still carries `x/y/width/height` as attributes — and a region box is
 * a rectangle by construction, so that covers the real case.
 */
export function readElementBox(el: Element): Box | null {
  const graphics = el as SVGGraphicsElement;
  if (typeof graphics.getBBox === 'function') {
    try {
      const b = graphics.getBBox();
      if (b && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0) {
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }
    } catch {
      /* no layout (jsdom / detached): fall through to attributes */
    }
  }
  const rect = el.querySelector('rect');
  if (!rect) return null;
  const x = attrNumber(rect, 'x');
  const y = attrNumber(rect, 'y');
  const width = attrNumber(rect, 'width');
  const height = attrNumber(rect, 'height');
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return { x: x ?? 0, y: y ?? 0, width, height };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Point the SVG at the area covered by one cell.
 *
 * `viewBox` and the intrinsic `width`/`height` MUST move together: changing only
 * the viewBox scales the region up (a 200-wide region inside a 362-wide svg
 * renders ~1.8x), which reads as "the region was computed wrong".
 *
 * `foreignObject` boxes must be widened too. drawio writes label offsets
 * (`margin-left` / `padding-top`) relative to the **content origin**, while a
 * foreignObject's own box starts at the content origin and is only
 * `viewBox`-sized. Shrinking the viewBox therefore leaves labels outside their
 * own foreignObject and Chromium clips them away — the text silently disappears
 * on any diagram whose region is not at the content origin. Sizing every
 * foreignObject to the full content bounds keeps labels inside their box; the
 * viewBox still decides what is visible.
 *
 * Returns false when the id is blank, the element is absent, or the box is
 * degenerate — the caller then keeps the whole diagram.
 */
export function applyRegionViewBox(
  svg: SVGSVGElement,
  regionId: string,
  padding: number = REGION_PADDING,
): boolean {
  if (!regionId) return false;
  let target: Element | null = null;
  try {
    target = svg.querySelector(regionSelector(regionId));
  } catch {
    return false;
  }
  if (!target) return false;
  const box = readElementBox(target);
  if (!box) return false;
  // Content bounds, in the same user units as the label offsets. Read BEFORE the
  // viewBox is shrunk — and remembered, because callers reuse one cached export
  // for many regions: on the second call the viewBox is already a region, and
  // reading it again would shrink every foreignObject to that region's size.
  // Remembered size wins: on a second crop the viewBox is already a region, and
  // `parseViewBoxAttr` would happily return that (non-null) value instead.
  const content = contentSizeFromDataset(svg) ?? parseViewBoxAttr(svg.getAttribute('viewBox'));
  const pad = Number.isFinite(padding) ? padding : 0;
  // Guarded so a tiny frame cannot collapse to zero or negative extent.
  const width = round3(Math.max(1, box.width + pad * 2));
  const height = round3(Math.max(1, box.height + pad * 2));
  if (content) {
    svg.setAttribute('data-content-width', String(content.width));
    svg.setAttribute('data-content-height', String(content.height));
    for (const foreignObject of Array.from(svg.querySelectorAll('foreignObject'))) {
      foreignObject.setAttribute('x', '0');
      foreignObject.setAttribute('y', '0');
      foreignObject.setAttribute('width', String(content.width));
      foreignObject.setAttribute('height', String(content.height));
    }
  }
  svg.setAttribute('viewBox', `${round3(box.x - pad)} ${round3(box.y - pad)} ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  return true;
}

/** Content size remembered by a previous {@link applyRegionViewBox} call. */
function contentSizeFromDataset(svg: Element): { width: number; height: number } | null {
  const width = Number(svg.getAttribute('data-content-width'));
  const height = Number(svg.getAttribute('data-content-height'));
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

/** `"0 0 766 862"` → { width, height }; null when unusable. */
function parseViewBoxAttr(raw: string | null): { width: number; height: number } | null {
  if (!raw) return null;
  const values = raw.trim().split(/[\s,]+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const width = values[2]!;
  const height = values[3]!;
  return width > 0 && height > 0 ? { width, height } : null;
}

/** True when a parsed SVG looks like drawio's export (carries cell ids). */
export function hasCellIds(svg: Element): boolean {
  return svg.querySelector('[data-cell-id]') !== null;
}

/**
 * Replace label `<switch>` wrappers with the `<foreignObject>` they contain.
 *
 * drawio's **export** path wraps every `html=1` label in
 * `<switch><foreignObject requiredFeatures="…Extensibility"/><text/></switch>`
 * — a fallback for viewers with no HTML support. But `<switch>` renders only the
 * first child whose feature requirements pass, and `requiredFeatures` is
 * deprecated in Chromium, while the `<text>` fallback is left unlaid-out. Result:
 * neither branch renders and **every label disappears**.
 *
 * The inline render path (what the whole-page preview uses) emits a bare
 * `<foreignObject>` and shows text fine, so unwrapping restores exactly that
 * shape. The feature declaration is meaningless outside a `<switch>`, so it goes.
 *
 * A switch with no direct `foreignObject` child (a genuinely text-only label) is
 * left untouched.
 *
 * Returns how many wrappers were flattened.
 */
export function flattenLabelSwitches(root: Element): number {
  let count = 0;
  for (const wrapper of Array.from(root.querySelectorAll('switch'))) {
    // Walk children directly: `:scope > foreignObject` is unreliable in XML
    // documents (jsdom) and case sensitivity differs between HTML/XML parsing.
    const foreignObject = Array.from(wrapper.children)
      .find((child) => child.localName.toLowerCase() === 'foreignobject');
    if (!foreignObject) continue;
    foreignObject.removeAttribute('requiredFeatures');
    wrapper.parentNode?.replaceChild(foreignObject, wrapper);
    count += 1;
  }
  return count;
}
