/**
 * Sanitize untrusted SVG produced by GraphViewer from diagram XML before inserting
 * it into Obsidian's live DOM.
 *
 * Why not DOMPurify: drawio renders `html=1` labels as `<foreignObject>` wrapping
 * XHTML (`<div>`/`<span>`/`<b>` with inline styles). DOMPurify — in every profile
 * combination — either drops `<foreignObject>` entirely or strips the XHTML inside
 * it, because foreignObject sits on the SVG↔HTML namespace boundary it treats as a
 * mutation-XSS hazard. That erased every text label in our previews. So we run a
 * targeted, namespace-agnostic scrub that PRESERVES foreignObject + its HTML while
 * removing the genuine vectors: <script>/embedding elements, `on*` handlers,
 * script-bearing URL schemes (`javascript:`/`vbscript:`/`data:text/html`/…),
 * external `<use>` references, SMIL attribute injection, and dangerous CSS
 * (`url()`/`expression()`).
 *
 * Parsing happens in an INERT document (DOMParser 'text/html'): images don't load
 * and scripts don't run there, and only the scrubbed nodes are imported into the
 * live document — so the live DOM never sees an un-sanitized node.
 */

// Elements that have no place in a static diagram preview and are removed outright.
const REMOVE_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'annotation-xml',
]);

// Schemes that execute script if navigated to / loaded as a document.
const SCRIPT_SCHEME = /^(?:javascript|vbscript|livescript|mocha|data:text\/html|data:image\/svg)/;
// `data:` payloads we still allow: raster images (drawio embeds these in labels).
const SAFE_DATA = /^data:image\/(?:png|jpe?g|gif|webp|bmp|x-icon|vnd\.microsoft\.icon)[;,]/;

/**
 * Decide whether a URL attribute value is unsafe. Browsers strip ASCII whitespace
 * and control characters before resolving a scheme, so `java\tscript:`, leading
 * NULs, embedded newlines, etc. all execute despite a naive regex on the raw text.
 * We normalise the same way (remove every char in U+0000–U+0020) before testing,
 * which defeats those obfuscations.
 */
function isUnsafeUrl(value: string): boolean {
  // Drop every ASCII whitespace/control char (code points 0–32), matching how
  // browsers normalise a URL before resolving its scheme. Done char-by-char to
  // avoid a control-character regex literal.
  let norm = '';
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x20) norm += value[i];
  }
  norm = norm.toLowerCase();
  if (SCRIPT_SCHEME.test(norm)) return true;
  // Allow only safe raster data images; block data:text/html, data:image/svg+xml, etc.
  if (norm.startsWith('data:') && !SAFE_DATA.test(norm)) return true;
  return false;
}

function sanitizeCss(css: string): string {
  // url() can fetch external resources (SSRF/tracking) or carry javascript:; the
  // legacy expression() runs script. CSS only treats space/tab/newline as
  // whitespace inside values, so \s is a sufficient normaliser here.
  return css
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

function scrubElement(el: Element): boolean {
  const tag = (el.localName || '').toLowerCase();
  if (REMOVE_TAGS.has(tag)) { el.remove(); return false; }

  // SMIL can rewrite another attribute (e.g. set attributeName="onload").
  if (tag === 'set' || tag === 'animate' || tag === 'animatetransform') {
    const target = (el.getAttribute('attributeName') || '').trim().toLowerCase();
    if (target.startsWith('on')) { el.remove(); return false; }
  }

  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value || '';
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name);
    } else if (name === 'href' || name === 'xlink:href' || name === 'src') {
      if (isUnsafeUrl(value)) el.removeAttribute(attr.name);
      // <use> pulls in (and can script) external symbols — keep only #fragments.
      else if (tag === 'use' && !value.trim().startsWith('#')) el.removeAttribute(attr.name);
    } else if (name === 'style') {
      const clean = sanitizeCss(value);
      if (clean !== value) el.setAttribute(attr.name, clean);
    }
  }

  // A <style> element's text is CSS, not attributes — scrub it the same way.
  if (tag === 'style' && el.textContent) {
    const clean = sanitizeCss(el.textContent);
    if (clean !== el.textContent) el.textContent = clean;
  }
  return true;
}

/** Walk `root` and every descendant, scrubbing in place. */
function scrub(root: Element): void {
  scrubElement(root);
  // Snapshot first; removing a node detaches its descendants, which we then skip.
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (root.contains(el)) scrubElement(el);
  }
}

function parseInert(svg: string): HTMLElement {
  // DOMParser produces an inert document: images don't load and scripts don't run.
  const doc = new DOMParser().parseFromString(svg, 'text/html');
  scrub(doc.body);
  return doc.body;
}

/**
 * Sanitize SVG markup and return it as a DOM fragment imported into `targetDoc`,
 * ready to insert. Preserves foreignObject/XHTML labels; strips XSS vectors.
 */
export function sanitizeSvgToNode(svg: string, targetDoc: Document = activeDocument): Node {
  const body = parseInert(svg);
  const frag = targetDoc.createDocumentFragment();
  for (const child of Array.from(body.childNodes)) frag.appendChild(targetDoc.importNode(child, true));
  return frag;
}

/** Sanitize SVG markup and return it as a string (used by tests / non-DOM callers). */
export function sanitizeSvg(svg: string): string {
  return parseInert(svg).innerHTML;
}
