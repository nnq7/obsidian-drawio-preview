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

/**
 * Page index for an embed's subpath, which is always the `pN` anchor the pin
 * button writes. Page names are NOT consulted: a name is free-form text that
 * changes when the diagram is renamed or translated, so it is not a reference.
 * Anything that is not `pN`, or an out-of-range ordinal, shows the first page.
 */
export function resolvePageFromSubpath(
  pages: DiagramPage[],
  subpath: string | undefined | null,
): number {
  if (!subpath) return 0;
  const numbered = /^p(\d+)$/.exec(subpath.replace(/^#/, ''));
  if (!numbered) return 0;
  const index = Number(numbered[1]) - 1;
  return index >= 0 && index < pages.length ? index : 0;
}
