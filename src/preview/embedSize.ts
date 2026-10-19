/**
 * Size control for `![[diagram.drawio|400]]` / `![[diagram.drawio|400x300]]`,
 * matching Obsidian's native image-embed syntax.
 *
 * Obsidian already parses the size out of the wikilink and writes it onto the
 * embed element as HTML attributes: `|400` → `width="400"`, `|400x300` →
 * `width="400" height="300"`; a non-numeric alias goes to `alt` and is ignored.
 * So nothing has to be parsed here — only applied. HTML width/height
 * *attributes* have no effect on a `<span>`, and the host `.internal-embed` is a
 * block box that stays full width on its own, so the size must be mirrored onto
 * inline styles from the outside in (host + `.drawio-preview`), not just onto
 * the preview.
 */

/** `|400` = width; `|400x300` = width × height. Either half may be absent. */
export interface EmbedSize {
  /** Explicit width in px, or null when the link carried only a height. */
  width: number | null;
  /** Explicit height in px, or null when the link carried only a width. */
  height: number | null;
}

/**
 * Data attribute marking inline sizing *this* plugin wrote. An un-sized
 * re-render clears exactly our own writes — never an unrelated inline
 * width/height that some other code put on the same element.
 */
const SIZED_DATA_KEY = 'drawioSized';

/**
 * The embed element that carries Obsidian's parsed size attributes, or null
 * when `el` sits outside an `.internal-embed` — the `.drawio` file view has no
 * link size parameter and must stay untouched.
 */
export function findSizedEmbed(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>('.internal-embed');
}

/**
 * Read the link's size off the embed element. Null when the link carried no
 * numeric size: a plain `![[x.drawio]]`, or a non-numeric alias.
 */
export function readEmbedSize(embedEl: HTMLElement | null): EmbedSize | null {
  if (!embedEl) return null;
  const width = positivePx(embedEl.getAttribute('width'));
  const height = positivePx(embedEl.getAttribute('height'));
  if (width === null && height === null) return null;
  return { width, height };
}

/**
 * Apply (or clear) the link's size. Idempotent: the same size writes the same
 * inline styles however many times it runs, and a size that no longer carries a
 * height drops a height we set earlier. A null `size` only touches the host
 * when this plugin sized it before, so a plain `![[x.drawio]]` is never
 * interfered with.
 *
 * Height lands only on the preview (never on the outer host): the interactive
 * viewer resizes the preview while the host keeps wrapping it, so pinning the
 * host's height would clip a user drag-resize. Width goes on both, because the
 * block-level host would otherwise stay full width.
 */
export function applyEmbedSize(
  embedEl: HTMLElement | null,
  previewEl: HTMLElement,
  size: EmbedSize | null,
): void {
  if (embedEl && size !== null) {
    embedEl.dataset[SIZED_DATA_KEY] = '1';
    setDimension(embedEl, 'width', size.width);
    // 和原生图片一样：宽度是「上限」——内容元素带 max-width:100%，
    // 笔记窗口变窄时预览跟着缩，而不是死死钉在链接里写的那个像素值。
    setDimension(previewEl, 'width', size.width);
    if (size.width !== null) previewEl.style.setProperty('max-width', '100%');
    else previewEl.style.removeProperty('max-width');
    setDimension(previewEl, 'height', size.height);
    return;
  }
  if (embedEl && embedEl.dataset[SIZED_DATA_KEY] === '1') {
    delete embedEl.dataset[SIZED_DATA_KEY];
    embedEl.style.removeProperty('width');
    embedEl.style.removeProperty('height');
    // 链接里的尺寸被删掉时，内层我们写过的宽高也要清干净，
    // 否则预览会留着旧尺寸（看起来像被缩成一小块）。
    previewEl.style.removeProperty('width');
    previewEl.style.removeProperty('height');
    previewEl.style.removeProperty('max-width');
  }
}

function setDimension(el: HTMLElement, property: 'width' | 'height', px: number | null): void {
  if (px === null) el.style.removeProperty(property);
  else el.style.setProperty(property, `${px}px`);
}

function positivePx(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Keep sizes live while typing. Obsidian parses the size out of the wikilink and
 * writes it as HTML *attributes* on the embed element, so editing `|400` → `|500`
 * changes only those attributes — the diagram XML is untouched and the renderer
 * skips its work, leaving the box at the old size until something re-renders it.
 * Watching the attributes and re-applying makes the box resize immediately, the
 * way native image embeds do.
 *
 * Only `width`/`height` are observed: our own writes go to inline `style`, so the
 * observer can never feed itself.
 */
export function observeEmbedSizes(doc: Document, win: Window): MutationObserver {
  const pending = new Set<HTMLElement>();
  let timer: number | null = null;

  const touch = (el: Element): void => {
    const host = el.closest<HTMLElement>('.internal-embed');
    if (host && host.querySelector('.drawio-preview')) pending.add(host);
  };

  const flush = (): void => {
    timer = null;
    for (const host of pending) {
      const preview = host.querySelector<HTMLElement>('.drawio-preview');
      if (preview) applyEmbedSize(host, preview, readEmbedSize(host));
    }
    pending.clear();
  };

  const Ctor = (win as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver ?? MutationObserver;
  const observer = new Ctor((records: MutationRecord[]) => {
    for (const record of records) touch(record.target as Element);
    if (timer === null && pending.size > 0) {
      // 改动后约 120ms 落地；连续输入只算一次。
      timer = win.setTimeout(flush, 160);
    }
  });
  // Only the two link-derived attributes. Watching `style` as well would feed the
  // observer its own writes (applyEmbedSize writes inline styles), leaving a
  // 160 ms apply-loop running for as long as a preview is mounted.
  observer.observe(doc.body, { attributes: true, attributeFilter: ['width', 'height'], subtree: true });
  return observer;
}
