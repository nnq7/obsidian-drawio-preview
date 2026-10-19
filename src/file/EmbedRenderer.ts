import { MarkdownPostProcessorContext, MarkdownRenderChild, Notice, Platform, TFile } from 'obsidian';
import { renderPreviewCached, type PreviewCacheTarget } from '../preview/ViewerRenderer';
import { cacheDir } from '../preview/svgFileCache';
import { cacheLimitBytes } from '../settings';
import { ensureViewerLoaded } from '../preview/loadViewer';
import { renderPageControl } from '../preview/pageControl';
import { openWithDefaultApp } from '../preview/clickAction';
import { InteractiveViewerController } from '../preview/interactiveViewer';
import { SectionLifecycle } from '../preview/sectionLifecycle';
import { applyEmbedSize, findSizedEmbed, readEmbedSize, type EmbedSize } from '../preview/embedSize';
import { getDiagramPages, resolvePageFromSubpath, ensureMxfile, type DiagramPage } from '../model/xmlUtils';
import { DRAWIO_FILE_EXT } from '../constants';
import { pinEmbedPage } from './pinEmbedPage';
import type DrawioPlugin from '../main';

/**
 * Make `![[diagram.drawio]]` embeds render the diagram (and open the interactive
 * viewer on click) in BOTH Live Preview and Reading view.
 *
 * The reliable way to do this is Obsidian's embed registry: it owns embeds in both
 * editing modes, where a markdown post-processor only reaches Reading view. The
 * registry isn't in the public typings, so we feature-detect it and fall back to a
 * post-processor (Reading-view only) on the off chance it's unavailable.
 */
export function registerDrawioEmbeds(plugin: DrawioPlugin) {
  const registry = (plugin.app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
  if (registry && typeof registry.registerExtension === 'function') {
    try {
      registry.registerExtension(DRAWIO_FILE_EXT, (ctx, file, subpath) =>
        new DrawioFileEmbed(plugin, file, ctx.containerEl, subpath, ctx.sourcePath));
      plugin.register(() => {
        try { registry.unregisterExtension?.(DRAWIO_FILE_EXT); } catch { /* ignore */ }
      });
      return;
    } catch {
      // Extension already taken or API shape changed — use the fallback.
    }
  }
  registerEmbedPostProcessor(plugin);
}

interface EmbedRegistry {
  registerExtension(ext: string, creator: (ctx: { containerEl: HTMLElement; sourcePath?: string }, file: TFile, subpath?: string) => unknown): void;
  unregisterExtension?(ext: string): void;
}

/** An embed component Obsidian drives in either editing mode. */
class DrawioFileEmbed extends MarkdownRenderChild {
  private currentPage = 0;
  private pageResolvedFromSubpath = false;
  private interactive: InteractiveViewerController | null = null;
  /** Invalidates in-flight render() awaits when a newer render supersedes them. */
  private renderGeneration = 0;
  /** Serializes async page flips so the last click wins (see onPageChange). */
  private flipChain: Promise<void> = Promise.resolve();
  /** Set on unload; render() must become a no-op afterwards (see below). */
  private torndown = false;

  constructor(
    private plugin: DrawioPlugin,
    private file: TFile,
    containerEl: HTMLElement,
    private subpath?: string,
    /** Owning note, as reported by the embed registry — the page-pin write target. */
    private sourcePath?: string,
  ) {
    super(containerEl);
  }

  /** Called by the embed system to (re)render the file's diagram. */
  async loadFile(file?: TFile): Promise<void> {
    if (file && file.path !== this.file.path) {
      // Target file actually changed: any subpath was resolved for the old
      // file and no longer applies. Start over at page 0 for the new one.
      this.file = file;
      this.currentPage = 0;
      this.pageResolvedFromSubpath = false;
      this.subpath = undefined;
    }
    await this.render();
  }

  onload(): void {
    // Reflect edits made elsewhere (e.g. the file view) in the preview.
    this.registerEvent(this.plugin.app.vault.on('modify', (f) => {
      if (f instanceof TFile && f.path === this.file.path) void this.render();
    }));
  }

  onunload(): void {
    this.torndown = true;
    this.renderGeneration += 1;
    this.interactive?.dispose();
    this.interactive = null;
  }

  private async render(): Promise<void> {
    // An in-flight render can resume after Obsidian unloaded this component.
    // Rendering then would mount a controller nothing ever disposes.
    if (this.torndown) return;
    const generation = ++this.renderGeneration;
    const el = this.containerEl;
    this.interactive?.dispose();
    this.interactive = null;
    // 重渲染前先撑住外框：清空容器那一瞬会塌陷，把滚动/光标锚点顶走。
    const frozenHeight = el.offsetHeight;
    if (frozenHeight > 0) el.style.setProperty('min-height', frozenHeight + 'px');
    el.empty();
    el.addClass('drawio-embed');
    // The link's own size (`![[x.drawio|400]]` / `|400x300`), read off the
    // embed attributes Obsidian already filled in. `sizeHost` is the hosting
    // `.internal-embed` (the container itself in the registry path).
    //
    // Timing differs by view: in Reading view the attributes are in place
    // before our component is created, but Live Preview writes them only
    // *after* this creator returns — so this early peek is best-effort, and the
    // size is read again authoritatively once the awaits have given Obsidian
    // time to fill them in.
    const sizeHost = findSizedEmbed(el);
    let initialHeight: number | null = readEmbedSize(sizeHost)?.height ?? null;
    el.setAttribute('title', Platform.isDesktopApp ? '点击以浏览图表' : 'Drawio 图表');
    try {
      const xml = await this.plugin.app.vault.read(this.file);
      if (generation !== this.renderGeneration) return;
      const wrapped = ensureMxfile(xml);
      const pages = getDiagramPages(wrapped);

      if (!this.pageResolvedFromSubpath) {
        this.pageResolvedFromSubpath = true;
        this.currentPage = resolvePageFromSubpath(pages, this.subpath);
      } else {
        // A modify-triggered refresh: keep whatever page the user was looking
        // at, clamped in case the page count shrank.
        this.currentPage = Math.min(this.currentPage, Math.max(pages.length - 1, 0));
      }

      // Authoritative size read: Live Preview sets the attributes only by now.
      const size = readEmbedSize(sizeHost);
      // A link-pinned height is the authoritative viewport height: use it even
      // if the early peek missed it.
      if (size?.height != null) initialHeight = size.height;

      const preview = el.createDiv({ cls: 'drawio-preview' });
      applyEmbedSize(sizeHost, preview, size);
      await renderPreviewCached(
        preview, xml, { ...this.plugin.previewOpts(), page: this.currentPage },
        this.file.name, previewCacheTarget(this.plugin),
      );
      // The cache read is an await: a newer render may have superseded this one.
      if (generation !== this.renderGeneration) return;

      let pageControlEl: HTMLElement | null = null;
      if (pages.length > 1) {
        pageControlEl = el.createDiv({ cls: 'drawio-page-control' });
        renderPageControl(pageControlEl, {
          pages,
          initialPage: this.currentPage,
          onPageChange: (page) => {
            this.currentPage = page;
            const cache = previewCacheTarget(this.plugin);
            // Flips are async now (cache read): chain them so a fast double
            // click cannot land out of order — the last click must win.
            this.flipChain = this.flipChain.then(async () => {
              if (this.torndown) return;
              await renderPreviewCached(
                preview, xml, { ...this.plugin.previewOpts(), page },
                this.file.name, cache,
              );
              this.interactive?.bindSvg(preview.querySelector('svg'));
            });
          },
          pin: !this.sourcePath ? undefined : {
            pinnedPage: resolvePageFromSubpath(pages, this.subpath),
            onPin: (page) => { void this.pin(pages, page); },
          },
        });
      }

      if (Platform.isDesktopApp) {
        this.interactive = new InteractiveViewerController(el, preview, {
          initialHeight: initialHeight ?? undefined,
          onEdit: () => {
            openWithDefaultApp(this.plugin.app, this.file.path);
            warmViewerLater(el.ownerDocument);
          },
        });
        this.interactive.bindSvg(preview.querySelector('svg'));
        if (pageControlEl) this.interactive.attachPager(pageControlEl);
      }
    } catch (err) {
      if (generation !== this.renderGeneration) return;
      el.createDiv({ cls: 'drawio-error', text: `渲染图表失败：${String(err)}` });
    }
    // Wire the click handler once (survives re-renders; el.empty() keeps the
    // listener). Desktop clicks activate the interactive viewer (its own
    // listeners); on mobile there is no viewer, so surface a hint.
    if (!el.dataset.drawioClick) {
      el.dataset.drawioClick = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!Platform.isDesktopApp) {
          new Notice('Drawio: 交互式查看器仅在桌面端可用');
        }
      });
    }
    // 新内容已就位，交还高度，让外框按新尺寸更新（「外框后更新」）。
    el.style.removeProperty('min-height');
  }

  /** Persist the shown page into the note's link; on success adopt the new
   *  subpath locally so a modify-triggered re-render agrees with the note. */
  private async pin(pages: DiagramPage[], page: number): Promise<void> {
    const name = pages[page]?.name;
    if (name === undefined || this.sourcePath === undefined) return;
    const outcome = await pinEmbedPage(this.plugin.app, this.sourcePath, this.file, this.subpath, name);
    if (outcome === 'pinned') {
      this.subpath = name;
      await this.render();
    }
  }
}

/**
 * Where this preview's cache lives, plus the user's size budget. A null `dir`
 * means no caching at all (mobile, no filesystem, or a stub environment).
 */
function previewCacheTarget(plugin: DrawioPlugin): PreviewCacheTarget {
  return {
    dir: cacheDir(plugin.app, plugin.manifest?.id),
    limitBytes: cacheLimitBytes(plugin.settings.cacheLimitMB),
  };
}

/**
 * Warm drawio's core *after* the user clicked 编辑 — by then they are already in
 * drawio, so this never delays a preview's first paint. Idle-scheduled and
 * failure-tolerant: it is an optimisation, not a requirement.
 */
function warmViewerLater(doc: Document): void {
  const win = doc.defaultView ?? window;
  const warm = () => { try { ensureViewerLoaded(doc); } catch { /* ignore */ } };
  const idle = (win as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
  }).requestIdleCallback;
  if (idle) idle(warm, { timeout: 2000 }); else win.setTimeout(warm, 800);
}

/** Reading-view-only fallback when the embed registry is unavailable. */
function registerEmbedPostProcessor(plugin: DrawioPlugin) {
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    for (const span of Array.from(el.querySelectorAll<HTMLElement>('.internal-embed'))) {
      if (span.dataset.drawioEmbed === '1') continue;
      const rawSrc = span.getAttribute('src');
      if (!rawSrc) continue;
      // Obsidian's exact behavior for whether a `#subpath` ends up in `src` for
      // an unrecognized (non-.md) embed extension isn't guaranteed — split it
      // off before the extension check so this works either way (see Task 6
      // in the implementation plan for why).
      const hashIndex = rawSrc.indexOf('#');
      const path = hashIndex === -1 ? rawSrc : rawSrc.slice(0, hashIndex);
      const subpath = hashIndex === -1 ? undefined : rawSrc.slice(hashIndex + 1);
      if (!path.toLowerCase().endsWith('.' + DRAWIO_FILE_EXT)) continue;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(path, ctx.sourcePath);
      if (!(file instanceof TFile)) continue;
      span.dataset.drawioEmbed = '1';
      span.setAttribute('title', Platform.isDesktopApp ? '点击以浏览图表' : 'Drawio 图表');
      span.addEventListener('click', () => {
        if (!Platform.isDesktopApp) {
          new Notice('Drawio: 交互式查看器仅在桌面端可用');
        }
        // Desktop clicks activate the interactive viewer (its own listeners).
      });
      // Register the lifecycle tracker before any awaits: mounting below is
      // queued through it, so a section torn down while the render is still
      // reading files never receives a controller — and a load that arrives
      // only after the reads still mounts (whenReady queues the work).
      const lifecycle = new SectionLifecycle(span);
      ctx.addChild(lifecycle);
      void renderEmbedInto(plugin, span, file, subpath, ctx, lifecycle);
    }
  });
}

async function renderEmbedInto(
  plugin: DrawioPlugin,
  span: HTMLElement,
  file: TFile,
  subpath: string | undefined,
  ctx: MarkdownPostProcessorContext,
  lifecycle: SectionLifecycle,
) {
  // 重渲染前先撑住外框：清空容器那一瞬会塌陷，把滚动/光标锚点顶走。
  const frozenHeight = span.offsetHeight;
  if (frozenHeight > 0) span.style.setProperty('min-height', frozenHeight + 'px');
  span.empty();
  span.addClass('drawio-embed');
  span.removeClasses(['file-embed', 'mod-generic', 'is-loaded']);
  let interactive: InteractiveViewerController | null = null;
  try {
    const xml = await plugin.app.vault.read(file);
    const wrapped = ensureMxfile(xml);
    const pages = getDiagramPages(wrapped);
    const currentPage = resolvePageFromSubpath(pages, subpath);
    // Link-pinned size (see DrawioFileEmbed.render). `span` is the hosting
    // `.internal-embed` in this Reading-view fallback path.
    const sizeHost = findSizedEmbed(span);
    const size: EmbedSize | null = readEmbedSize(sizeHost);
    const initialHeight: number | null = size?.height ?? null;

    const preview = span.createDiv({ cls: 'drawio-preview' });
    applyEmbedSize(sizeHost, preview, size);
    await renderPreviewCached(
      preview, xml, { ...plugin.previewOpts(), page: currentPage },
      file.name, previewCacheTarget(plugin),
    );

    let pageControlEl: HTMLElement | null = null;
    if (pages.length > 1) {
      pageControlEl = span.createDiv({ cls: 'drawio-page-control' });
      // Serializes async page flips so a fast double click cannot land out of
      // order — the last click must win (same rule as the registry path).
      let flipChain: Promise<void> = Promise.resolve();
      renderPageControl(pageControlEl, {
        pages,
        initialPage: currentPage,
        onPageChange: (page) => {
          const cache = previewCacheTarget(plugin);
          flipChain = flipChain.then(async () => {
            await renderPreviewCached(
              preview, xml, { ...plugin.previewOpts(), page },
              file.name, cache,
            );
            interactive?.bindSvg(preview.querySelector('svg'));
          });
        },
        pin: !ctx.sourcePath ? undefined : {
          pinnedPage: currentPage,
          onPin: (page) => {
            const name = pages[page]?.name;
            if (name !== undefined) void pinEmbedPage(plugin.app, ctx.sourcePath, file, subpath, name);
          },
        },
      });
    }

    // The interactive mount is queued through the section lifecycle: it runs
    // when (and only when) Obsidian loads this section's children — never for
    // a section already torn down while the reads above were in flight, and
    // not skipped when the load is dispatched only after those reads.
    if (Platform.isDesktopApp) {
      lifecycle.whenReady(() => {
        const controller = new InteractiveViewerController(span, preview, {
          initialHeight: initialHeight ?? undefined,
          onEdit: () => {
            openWithDefaultApp(plugin.app, file.path);
            warmViewerLater(span.ownerDocument);
          },
        });
        controller.bindSvg(preview.querySelector('svg'));
        if (pageControlEl) controller.attachPager(pageControlEl);
        interactive = controller;
        lifecycle.register(() => { controller.dispose(); });
      });
    }
  } catch (err) {
    span.empty();
    span.createDiv({ cls: 'drawio-error', text: `渲染图表失败：${String(err)}` });
  }
  // 新内容已就位，交还高度，让外框按新尺寸更新（「外框后更新」）。
  span.style.removeProperty('min-height');
}
