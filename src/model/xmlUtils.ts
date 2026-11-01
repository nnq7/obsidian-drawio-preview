const MXFILE_RE = /<mxfile[\s>]/;
const MXMODEL_RE = /<mxGraphModel[\s>]/;

export function isValidDrawioXml(xml: string): boolean {
  if (!xml || !xml.trim()) return false;
  return MXFILE_RE.test(xml) || MXMODEL_RE.test(xml);
}

export function ensureMxfile(xml: string): string {
  const trimmed = xml.trim();
  if (MXFILE_RE.test(trimmed)) return trimmed;
  if (MXMODEL_RE.test(trimmed)) {
    return `<mxfile><diagram id="0" name="Page-1">${trimmed}</diagram></mxfile>`;
  }
  return trimmed;
}

const DIAGRAM_TAG_RE = /<diagram\b([^>]*)>/g;
const ID_ATTR_RE = /\bid="([^"]*)"/;

/** One page of an mxfile. Callers only need the ordinal (see {@link pageAnchor});
 *  the id is kept because it is drawio's own stable page identifier. */
export interface DiagramPage { id: string; }

/** Parse every `<diagram ...>` opening tag from an mxfile, in document order.
 *  A missing id falls back to the page index so the list never has holes. */
export function getDiagramPages(xml: string): DiagramPage[] {
  const pages: DiagramPage[] = [];
  DIAGRAM_TAG_RE.lastIndex = 0; // the shared `g`-flagged regex is stateful across calls
  let match: RegExpExecArray | null;
  while ((match = DIAGRAM_TAG_RE.exec(xml))) {
    const attrs = match[1] ?? ''; // noUncheckedIndexedAccess: capture group 1 always matches here, but is still typed optional
    const id = ID_ATTR_RE.exec(attrs)?.[1] ?? String(pages.length);
    pages.push({ id });
  }
  return pages;
}

/**
 * Anchor written into a link for the page at `index` (0-based): `p1`, `p2`, …
 *
 * Links deliberately do NOT use the diagram's own page name: a name is free-form
 * (and often localized, e.g. "第 2 页"), so an anchor built from it breaks when
 * the page is renamed or the file is moved between languages. The ordinal is
 * stable, short, and readable in a wikilink.
 */
export function pageAnchor(index: number): string {
  return `p${index + 1}`;
}

/** What a link's subpath asks for: which page, and optionally which region. */
export interface SubpathInfo {
  /** 0-based page index; 0 whenever the ordinal is absent or out of range. */
  page: number;
  /** Element id of the box that bounds the region, or null for a whole page. */
  regionId: string | null;
}

/**
 * A page anchor is a bare `p<n>` with one or two digits. Everything else in the
 * subpath is treated as an element id, so a diagram id such as
 * `p2fAgg-5UjtChK90sZJI-4` never collides with the anchor even though it starts
 * with `p`. Two forms, and only two: `#p2` (page) and `#<element id>` (region).
 */
const PAGE_ANCHOR_RE = /^p(\d{1,2})$/;

/**
 * Parse an embed's subpath into a page index and an optional region id.
 *
 * Page names are NOT consulted: a name is free-form text that changes when the
 * diagram is renamed or translated, so it is not a reference.
 *
 * `#p2` selects a page. Anything else is an element id: it starts on page 1, and
 * the caller re-targets it with {@link findPageWithId} when the id lives on a
 * different page.
 *
 * A region id keeps its raw text here; escaping for a selector happens at the
 * point of use.
 */
export function parseSubpath(
  pages: DiagramPage[],
  subpath: string | undefined | null,
): SubpathInfo {
  if (!subpath) return { page: 0, regionId: null };
  const raw = subpath.replace(/^#/, '').trim();
  if (!raw) return { page: 0, regionId: null };
  const anchor = PAGE_ANCHOR_RE.exec(raw);
  if (anchor) {
    const index = Number(anchor[1]) - 1;
    return { page: index >= 0 && index < pages.length ? index : 0, regionId: null };
  }
  return { page: 0, regionId: raw };
}

/**
 * 0-based index of the page whose body contains `<… id="<elementId>">`.
 *
 * Walks the `<diagram …>` opening tags in document order and searches each
 * page's body, so the result always agrees with `#pN` (see
 * {@link getDiagramPages}) and is immune to the page `name`: drawio writes that
 * name in the UI language and the user may rename it to anything.
 *
 * Uncompressed diagrams only. In a compressed file the page body is one base64
 * blob, so no id is findable and this returns null — the decision to accept that
 * limitation is recorded in `docs/region-preview-research.md`.
 */
export function findPageWithId(xml: string, elementId: string): number | null {
  if (!xml || !elementId) return null;
  const needle = `id="${elementId}"`;
  const tags: Array<{ openStart: number; bodyStart: number }> = [];
  DIAGRAM_TAG_RE.lastIndex = 0; // shared `g`-flagged regex is stateful across calls
  let match: RegExpExecArray | null;
  while ((match = DIAGRAM_TAG_RE.exec(xml))) {
    tags.push({ openStart: match.index, bodyStart: match.index + match[0].length });
  }
  for (let i = 0; i < tags.length; i++) {
    const from = tags[i]!.bodyStart;
    // Stop at the *opening* tag of the next page: using its end would let this
    // page's slice swallow the next page's `id="…"` attributes.
    const to = i + 1 < tags.length ? tags[i + 1]!.openStart : xml.length;
    if (xml.slice(from, to).includes(needle)) return i;
  }
  return null;
}
/** Page index for an embed's subpath; see {@link parseSubpath}. Kept as a
 *  thin wrapper so every older call site still reads as "which page". */
export function resolvePageFromSubpath(
  pages: DiagramPage[],
  subpath: string | undefined | null,
): number {
  return parseSubpath(pages, subpath).page;
}
