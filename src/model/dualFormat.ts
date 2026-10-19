/**
 * Dual-format drawio files (`*.drawio.svg` / `*.drawio.png`): the file body is a
 * standard SVG or PNG image with the diagram XML embedded inside — SVG keeps it
 * in the root element's `content` attribute, PNG in a `tEXt` chunk with keyword
 * `mxfile`.
 *
 * This build never writes dual-format files (they are not registered as an
 * extension); the two helpers below exist so the legacy-SVG migration can tell
 * "already a drawio dual-format file" from "an old Diagrams-plugin `.svg`" and
 * read the XML back out of the latter.
 *
 * Pure string/DOM work with no Node or Electron APIs, so it is safe on mobile.
 */

export type DualFormat = 'svg' | 'png';

/** The dual format a path denotes, or null for anything else (incl. plain `.drawio`). */
export function dualFormatOf(path: string): DualFormat | null {
  const p = path.toLowerCase();
  if (p.endsWith('.drawio.svg')) return 'svg';
  if (p.endsWith('.drawio.png')) return 'png';
  return null;
}

/** Extract the embedded diagram XML from an SVG, or null when absent. */
export function extractXmlFromSvg(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;
  const content = root.getAttribute('content');
  return content && content.trim() ? content : null;
}
