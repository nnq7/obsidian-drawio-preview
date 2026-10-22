import { MarkdownRenderChild, setIcon } from 'obsidian';
import { strings } from '../i18n';
import { renderPageControl } from './pageControl';
import type { PreviewAppearance } from '../settings';

interface InteractiveViewerOptions {
  /** A height already resolved by the caller (e.g. a link-pinned size). */
  initialHeight?: number;
  onEdit?: () => void;
  /** 全屏层的数据来源。缺省时全屏按钮不可用。
   *
   *  全屏层不移动原 embed 的任何节点（Obsidian 会把它搬回去），而是新建一层、
   *  用同一个缓存把当前页渲染进去，再挂一个独立的 viewer 实例。 */
  pages?: {
    count: number;
    current: number;
    /** Render page `page` into `target` through the embed's own cache. */
    render: (target: HTMLElement, page: number) => Promise<SVGSVGElement | null>;
    /** Persist a page into the note's link (the pin button in the layer). */
    onPin?: (page: number) => void;
    /** Page index the note's link currently resolves to. */
    pinnedPage?: number;
    /** 预览外观：drawio 的颜色是 `light-dark()` 语义色，靠容器的
     *  `color-scheme` 解析，所以全屏层必须带上同一个 `data-appearance`。 */
    appearance: PreviewAppearance;
  };
  /** 全屏层自己不再提供「再全屏」，隐藏该按钮。 */
  suppressFullscreen?: boolean;
  /** 全屏层里的「×」由外层负责关闭（该实例本身没有覆盖层）。 */
  onExitFullscreen?: () => void;
}

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rendered content rectangle in client coordinates (letterbox-aware). */
interface ContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Viewport height bounds for an activated preview, in CSS px. */
const MIN_VIEWPORT_HEIGHT = 80;
const MAX_VIEWPORT_HEIGHT = 4000;

/** Multiplicative step per wheel notch (~10% per notch). */
const WHEEL_ZOOM_STEP = 1.10;
/** Coarser step for the discrete toolbar buttons — 2% per click is imperceptible. */
const BUTTON_ZOOM_STEP = 1.25;
const MAX_SCALE = 8;
const SCALE_EPSILON = 0.0001;

/**
 * Interactive viewer: activation, zoom/pan, Fit, Edit, page pinning, and the
 * in-window fullscreen layer.
 *
 * Fullscreen deliberately does NOT use the Fullscreen API: that moves the embed
 * into the top layer, which makes Codemirror recompute scrolling and jumps the
 * note (measured +811~+4581px). It builds a separate fixed layer instead, so the
 * embed's own layout — and the scroll position — never change.
 */
export class InteractiveViewerController extends MarkdownRenderChild {
  private active = false;
  private disposed = false;
  private svg: SVGSVGElement | null = null;
  private baseBox: ViewBox | null = null;
  private currentBox: ViewBox | null = null;
  private frame: number | null = null;
  private toolbar: HTMLElement;
  private zoomInButton!: HTMLButtonElement;
  private zoomOutButton!: HTMLButtonElement;
  private fitButton!: HTMLButtonElement;
  private fullscreenButton!: HTMLButtonElement;
  private editButton!: HTMLButtonElement;
  private closeFullscreenButton!: HTMLButtonElement;
  private doc: Document;
  private viewportInitialized = false;
  private manuallyResized = false;
  private panStartX = 0;
  private panStartY = 0;
  /** 拖拽开始时算好的内容缩放比：拖拽期间元素尺寸不变，不必每次 pointermove
   *  都调 getBoundingClientRect（那会强制同步布局，高频拖动时每秒上百次）。 */
  private panStartScale = 0;
  private panStartBox: ViewBox | null = null;
  /** Watches a detached/hidden preview until layout gives it a real width. */
  private measureObserver: ResizeObserver | null = null;
  /** 全屏覆盖层；null 表示未进入全屏。 */
  private overlay: HTMLElement | null = null;
  /** 全屏层里那台独立的 viewer；关闭时一并销毁。 */
  private fullscreenViewer: InteractiveViewerController | null = null;
  /** 全屏层里承载 svg 的容器，翻页时往这里重渲染。 */
  private fullscreenSurface: HTMLElement | null = null;

  constructor(
    private root: HTMLElement,
    private preview: HTMLElement,
    private opts: InteractiveViewerOptions = {},
  ) {
    super(root);
    this.doc = root.ownerDocument;
    this.root.classList.add('drawio-interactive');
    this.toolbar = this.createToolbar();
    this.root.addEventListener('click', this.onRootClick);
    this.preview.addEventListener('wheel', this.onWheel, { passive: false });
    this.preview.addEventListener('pointerdown', this.onPanStart);
    this.addDocumentListeners(this.doc);
  }

  get isActive(): boolean { return this.active; }

  /**
   * Move a rendered page control into the toolbar, ahead of the zoom buttons.
   * The toolbar only shows while the preview is active, so the pager becomes
   * part of that surface instead of costing a row below the diagram — which is
   * what lets a fullscreen preview keep the whole box.
   */
  attachPager(pager: HTMLElement): void {
    pager.addClass('drawio-toolbar-pager');
    this.toolbar.prepend(pager);
  }

  /**
   * Bind a freshly rendered SVG. The viewport height is always re-derived from
   * the new SVG's own aspect ratio (a page flip switches diagrams, and each page
   * may be a different shape) — see `initializeViewport`.
   */
  bindSvg(svg: SVGSVGElement | null): void {
    this.rebindIfDocumentChanged();
    this.cancelFrame();
    this.svg?.classList.remove('drawio-interactive-svg');
    this.svg = svg;
    this.baseBox = svg ? parseViewBox(svg.getAttribute('viewBox')) : null;
    this.currentBox = this.baseBox ? { ...this.baseBox } : null;
    this.viewportInitialized = false;
    // A link that pins `|400x300` owns its height; everything else is auto-fitted.
    this.manuallyResized = this.opts.initialHeight !== undefined;
    // 翻页是同一次浏览的延续，必须保留激活态 —— 否则每次翻页都要重新点一下才能缩放/拖拽。
    // 只结束可能残留在旧 SVG 上的拖拽（pointer 监听挂在 document 上，不能带到新 SVG）。
    this.endPan();
    this.updateControls();
    this.initializeViewport();
  }

  activate(): void {
    if (this.disposed || !this.svg) return;
    this.rebindIfDocumentChanged();
    this.initializeViewport();
    this.active = true;
    this.root.classList.add('drawio-interactive-active');
    this.updateControls();
  }

  deactivate(): void {
    this.endPan();
    this.active = false;
    this.root.classList.remove('drawio-interactive-active');
    this.updateControls();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // 被销毁时若还在全屏，先拆掉覆盖层，否则会留下一个没有关闭入口的空层。
    this.exitFullscreen();
    this.deactivate();
    this.root.classList.remove('drawio-interactive');
    this.root.classList.remove('drawio-interactive-fullscreen');
    this.root.removeEventListener('click', this.onRootClick);
    this.preview.removeEventListener('wheel', this.onWheel);
    this.preview.removeEventListener('pointerdown', this.onPanStart);
    this.removeDocumentListeners(this.doc);
    this.doc.removeEventListener('pointermove', this.onPanMove);
    this.doc.removeEventListener('pointerup', this.onPanEnd);
    this.disconnectMeasureObserver();
    this.cancelFrame();
    this.toolbar.remove();
    this.preview.classList.remove('drawio-interactive-viewport');
    this.preview.style.removeProperty('height');
    this.svg?.classList.remove('drawio-interactive-svg');
    this.svg = null;
    this.baseBox = null;
    this.currentBox = null;
  }

  onunload(): void {
    this.dispose();
  }

  private addDocumentListeners(doc: Document): void {
    // Capture phase for click-outside: content click handlers (embeds, other
    // plugins) may stopPropagation during bubbling, which must not leave a
    // second viewer stuck active.
    doc.addEventListener('click', this.onDocumentClick, true);
    doc.addEventListener('keydown', this.onDocumentKeydown);
    doc.defaultView?.addEventListener('resize', this.onWindowResize);
  }

  private removeDocumentListeners(doc: Document): void {
    doc.removeEventListener('click', this.onDocumentClick, true);
    doc.removeEventListener('keydown', this.onDocumentKeydown);
    doc.defaultView?.removeEventListener('resize', this.onWindowResize);
  }

  /**
   * Obsidian adopts a pane's DOM into a popout window after mount; the
   * document-level listeners must follow the root's current document or
   * Escape, click-outside, drags, and fullscreen keep targeting the old
   * window. Checked at
   * every element-bound entry point, since those listeners travel with the DOM.
   */
  private rebindIfDocumentChanged(): void {
    const current = this.root.ownerDocument;
    if (current === this.doc) return;
    this.removeDocumentListeners(this.doc);
    this.doc = current;
    if (this.disposed) return;
    this.addDocumentListeners(current);
    // A ResizeObserver belongs to one window; re-arm it from the new one.
    if (this.measureObserver) {
      this.disconnectMeasureObserver();
      this.observeUntilMeasurable();
    }
  }

  private createToolbar(): HTMLElement {
    const toolbar = this.root.createDiv({ cls: 'drawio-interactive-toolbar' });
    const L = strings();
    toolbar.setAttribute('aria-label', L.toolbarLabel);
    this.zoomInButton = this.createButton(toolbar, '+', L.btnZoomIn, () => this.zoomBy(BUTTON_ZOOM_STEP));
    this.zoomOutButton = this.createButton(toolbar, '−', L.btnZoomOut, () => this.zoomBy(1 / BUTTON_ZOOM_STEP));
    this.fitButton = this.createButton(
      toolbar, L.btnFit, L.btnFitLabel, () => this.fit(), { icon: 'rotate-cw', fallback: L.btnFit },
    );
    this.editButton = this.createButton(
      toolbar, L.btnEdit, L.btnEditLabel, () => { void this.runEditAction(); },
      { icon: 'pencil', fallback: L.btnEdit },
    );
    this.fullscreenButton = this.createButton(
      toolbar, L.btnFullscreen, L.btnFullscreenLabel, () => { void this.enterFullscreen(); },
      { icon: 'maximize', fallback: L.btnFullscreen },
    );
    this.closeFullscreenButton = this.createButton(
      toolbar, '×', L.btnExitFullscreen, () => {
        if (this.opts.onExitFullscreen) this.opts.onExitFullscreen();
        else this.exitFullscreen();
      },
      { icon: 'minimize', fallback: '×' },
    );
    this.closeFullscreenButton.hidden = true;
    return toolbar;
  }

  private createButton(
    toolbar: HTMLElement,
    label: string,
    ariaLabel: string,
    action: () => void,
    icon?: { icon: string; fallback: string },
  ): HTMLButtonElement {
    const button = toolbar.createEl('button', { text: icon ? undefined : label });
    if (icon) {
      // Icon ids differ across Obsidian versions and a miss renders an empty
      // <svg>, so fall back to the label rather than ship a blank control.
      setIcon(button, icon.icon);
      const rendered = button.querySelector('svg');
      if (rendered && rendered.childElementCount > 0) button.addClass('drawio-icon-button');
      else {
        rendered?.remove();
        button.textContent = icon.fallback;
      }
    }
    button.disabled = true;
    button.setAttribute('aria-label', ariaLabel);
    // 工具栏按钮不抢焦点：点「全屏」时焦点若落到按钮上，浏览器会为了它调整
    // 滚动位置，进全屏后笔记就跳了（实测 -492px；image-toolkit 打开图片时
    // activeElement 仍停在 cm-content，所以它不跳）。
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      // A pane can move into a popout without any prior rebinding interaction
      // (e.g. the "Move to new window" command while the viewer is active) —
      // and this handler's stopPropagation keeps onRootClick from rebinding.
      this.rebindIfDocumentChanged();
      action();
    });
    return button;
  }

  private onRootClick = (event: MouseEvent): void => {
    const target = this.eventNode(event);
    if (target && this.preview.contains(target)) this.activate();
  };

  private onDocumentClick = (event: MouseEvent): void => {
    if (!this.active) return;
    // 全屏层只响应 Esc 与「退出全屏」按钮：点空白不退出，也不失活，
    // 否则工具栏（连退出按钮）会一起消失。
    if (this.overlay) return;
    const target = this.eventNode(event);
    if (!target || !this.root.contains(target)) this.deactivate();
  };

  private onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (this.overlay) { this.exitFullscreen(); return; }
    this.deactivate();
  };

  /** 离 root 最近的滚动容器（编辑器是 `.cm-scroller`，阅读视图是预览容器）。
   *  进全屏时靠它保住笔记的滚动位置。 */
  private findScrollParent(): HTMLElement | null {
    return this.root.closest<HTMLElement>('.cm-scroller, .markdown-preview-view, .markdown-reading-view');
  }

  /** 覆盖层里的实例用：直接切到「全屏形态」——显示 ×、隐藏全屏按钮。
   *  它是被放进去的那台 viewer，本身没有覆盖层，状态由外层同步。 */
  enterFullscreenChrome(): void {
    this.applyFullscreenChrome(true);
  }

  /** 根元素的全屏标记与工具栏按钮显隐，进出全屏时统一在这里切换。 */
  private applyFullscreenChrome(fullscreen: boolean): void {
    this.root.classList.toggle('drawio-interactive-fullscreen', fullscreen);
    this.fullscreenButton.hidden = fullscreen || this.opts.suppressFullscreen === true;
    this.closeFullscreenButton.hidden = !fullscreen;
    this.closeFullscreenButton.disabled = !fullscreen;
  }

  private onWheel = (event: WheelEvent): void => {
    if (!this.active || event.deltaY === 0) return;
    this.rebindIfDocumentChanged();
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP, event.clientX, event.clientY);
  };

  private onPanStart = (event: PointerEvent): void => {
    if (event.button !== 0) return; // never let a right/middle press activate or pan
    this.rebindIfDocumentChanged();
    if (!this.active) this.activate();
    const base = this.baseBox;
    const current = this.currentBox;
    if (!this.active || !base || !current) return;
    if (base.width / current.width <= 1 + SCALE_EPSILON) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = this.svg!.getBoundingClientRect();
    // preserveAspectRatio="meet" letterboxes the content, so pixels map to
    // viewBox units through the rendered content scale, not the raw rect size.
    this.panStartScale = rect.width > 0 && rect.height > 0
      ? Math.min(rect.width / current.width, rect.height / current.height)
      : 0;
    this.panStartX = event.clientX;
    this.panStartY = event.clientY;
    this.panStartBox = { ...current };
    this.root.classList.add('drawio-interactive-panning');
    this.doc.addEventListener('pointermove', this.onPanMove);
    this.doc.addEventListener('pointerup', this.onPanEnd);
    this.doc.addEventListener('pointercancel', this.onPanEnd);
  };

  private onPanMove = (event: PointerEvent): void => {
    const base = this.baseBox;
    const start = this.panStartBox;
    if (!base || !start) return;
    event.preventDefault();
    // Scale is measured once in onPanStart: the element keeps its size for the
    // whole drag, so re-measuring every move would force a sync layout for nothing.
    const scale = this.panStartScale;
    if (scale <= 0) return;
    this.currentBox = {
      x: clamp(
        start.x - (event.clientX - this.panStartX) / scale,
        base.x,
        base.x + base.width - start.width,
      ),
      y: clamp(
        start.y - (event.clientY - this.panStartY) / scale,
        base.y,
        base.y + base.height - start.height,
      ),
      width: start.width,
      height: start.height,
    };
    this.scheduleViewBoxWrite();
  };

  private onPanEnd = (): void => {
    this.endPan();
  };

  private endPan(): void {
    if (!this.panStartBox) return;
    this.panStartBox = null;
    this.root.classList.remove('drawio-interactive-panning');
    this.doc.removeEventListener('pointermove', this.onPanMove);
    this.doc.removeEventListener('pointerup', this.onPanEnd);
    this.doc.removeEventListener('pointercancel', this.onPanEnd);
  }

  /** 进入全屏：**新建**一层（不动原 embed 的任何节点），把当前页渲染进去，
   *  再挂一台独立的 viewer。原节点的布局与滚动位置因此完全不受影响。 */
  private async enterFullscreen(): Promise<void> {
    const pages = this.opts.pages;
    if (!this.active || this.overlay || !pages) return;
    const doc = this.root.ownerDocument;
    const body = doc.body;
    if (!body) return;
    // Build through the target document's own helpers so a popout window gets
    // nodes owned by its document. `Document.win` is typed as the plain DOM
    // Window, hence the cast.
    const dom = doc.win as unknown as { createDiv(): HTMLDivElement };
    // 把焦点交给覆盖层会让浏览器顺手滚动宿主容器；这里记下位置，稍后原样放回。
    const scroller = this.findScrollParent();
    const savedTop = scroller?.scrollTop ?? 0;

    const overlay = dom.createDiv();
    overlay.className = 'drawio-interactive-overlay';
    const stage = dom.createDiv();
    stage.className = 'drawio-fullscreen-stage';
    const surface = dom.createDiv();
    surface.className = 'drawio-fullscreen-surface';
    // 与预览框同一个外观：否则 SVG 的语义色会跟随 Obsidian 主题解析成深色。
    surface.dataset.appearance = pages.appearance;
    stage.appendChild(surface);
    overlay.appendChild(stage);

    // 多页时给覆盖层自己的翻页条：原实例的 pager 留在笔记里，不能共用。
    if (pages.count > 1) {
      const pagerBar = dom.createDiv();
      pagerBar.className = 'drawio-fullscreen-pager';
      // 放进 stage（第二实例的 root）里：否则点翻页会被它判为「点外部」而失活，
      // 连带把缩放按钮禁用。
      stage.insertBefore(pagerBar, surface);
      renderPageControl(pagerBar, {
        pages: Array.from({ length: pages.count }, (_, i) => ({ id: String(i) })),
        initialPage: pages.current,
        onPageChange: (page) => { void this.showFullscreenPage(page); },
        pin: pages.onPin
          ? { pinnedPage: pages.pinnedPage ?? pages.current, onPin: pages.onPin }
          : undefined,
      });
    }

    body.appendChild(overlay);
    this.fullscreenSurface = surface;

    this.overlay = overlay;
    this.applyFullscreenChrome(true);

    const svg = await pages.render(surface, pages.current);
    // 渲染期间用户可能已经退出全屏。
    if (!svg || !this.overlay) return;
    const viewer = new InteractiveViewerController(stage, surface, {
      // Editing must also tear down the overlay: this instance owns no overlay
      // of its own, so closing the layer is the outer viewer's job.
      onEdit: () => {
        this.exitFullscreen();
        this.deactivate();
        this.opts.onEdit?.();
      },
      suppressFullscreen: true,
      onExitFullscreen: () => this.exitFullscreen(),
    });
    viewer.bindSvg(svg);
    viewer.activate();
    viewer.enterFullscreenChrome();
    this.fullscreenViewer = viewer;
    // 浏览器的滚动由焦点变化**异步**触发，此刻可能还没发生 —— 所以无条件调度，
    // 在两帧内各放回一次（Codemirror 也可能随后再修一次）。
    if (scroller) {
      const win2 = doc.defaultView;
      const restore = (pass: number) => {
        if (this.disposed) return;
        scroller.scrollTop = savedTop;
        if (pass < 1) win2?.requestAnimationFrame(() => restore(pass + 1));
      };
      win2?.requestAnimationFrame(() => restore(0));
    }
  }

  /** 覆盖层里翻页：用同一个缓存重渲染该页，再让独立 viewer 绑到新 svg 上。 */
  private async showFullscreenPage(page: number): Promise<void> {
    const pages = this.opts.pages;
    const surface = this.fullscreenSurface;
    const viewer = this.fullscreenViewer;
    if (!pages || !surface || !viewer) return;
    surface.empty();
    const svg = await pages.render(surface, page);
    if (!svg || !this.overlay) return;
    viewer.bindSvg(svg);
  }

  private exitFullscreen(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    this.overlay = null;
    this.applyFullscreenChrome(false);
    this.fullscreenViewer?.dispose();
    this.fullscreenViewer = null;
    this.fullscreenSurface = null;
    overlay.remove();
  }

  private async runEditAction(): Promise<void> {
    if (this.overlay) this.exitFullscreen();
    this.deactivate();
    this.opts.onEdit?.();
  }

  private onWindowResize = (): void => {
    if (this.manuallyResized) return;
    // 全屏层是独立的固定层，宿主尺寸变化不影响它里面的视口。
    if (this.overlay) return;
    this.initializeViewport(true);
  };

  private initializeViewport(force = false): void {
    if (this.viewportInitialized && !force) return;
    const base = this.baseBox;
    const svg = this.svg;
    const win = this.doc.defaultView;
    if (!base || !svg || !win) return;
    if (this.opts.initialHeight !== undefined) {
      this.applyViewport(svg, clamp(this.opts.initialHeight, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT));
      return;
    }
    const width = this.preview.getBoundingClientRect().width
      || this.root.getBoundingClientRect().width;
    if (width <= 0) {
      // Detached or hidden (code blocks and Reading-view sections render
      // detached): measuring now would produce a bogus height. Watch for the
      // first real layout instead — otherwise a tall diagram renders at full
      // height until the user clicks or resizes the OS window (Obsidian pane
      // drags don't fire window resize, and PDF export never clicks).
      this.observeUntilMeasurable();
      return;
    }
    const availableHeight = Math.max(1, win.innerHeight);
    const height = clamp(
      Math.min(width * base.height / base.width, availableHeight),
      MIN_VIEWPORT_HEIGHT,
      MAX_VIEWPORT_HEIGHT,
    );
    this.applyViewport(svg, height);
  }

  private observeUntilMeasurable(): void {
    const win = this.doc.defaultView;
    if (!win || this.measureObserver || typeof win.ResizeObserver !== 'function') return;
    this.measureObserver = new win.ResizeObserver(() => {
      if (this.disposed || this.viewportInitialized || this.manuallyResized) {
        this.disconnectMeasureObserver();
        return;
      }
      const width = this.preview.getBoundingClientRect().width
        || this.root.getBoundingClientRect().width;
      if (width <= 0) return;
      this.initializeViewport();
    });
    this.measureObserver.observe(this.preview);
  }

  private disconnectMeasureObserver(): void {
    this.measureObserver?.disconnect();
    this.measureObserver = null;
  }

  private applyViewport(svg: SVGSVGElement, height: number): void {
    this.disconnectMeasureObserver();
    this.preview.classList.add('drawio-interactive-viewport');
    svg.classList.add('drawio-interactive-svg');
    this.setViewportHeight(height);
    this.viewportInitialized = true;
  }

  private setViewportHeight(height: number): void {
    this.preview.setCssStyles({ height: `${height}px` });
  }

  private zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const svg = this.svg;
    const base = this.baseBox;
    const current = this.currentBox;
    if (!svg || !base || !current) return;

    const scale = base.width / current.width;
    const nextScale = clamp(scale * factor, 1, MAX_SCALE);
    if (Math.abs(nextScale - scale) < SCALE_EPSILON) return;

    const content = this.contentRect(svg, current);
    const rx = clientX === undefined || !content
      ? 0.5
      : clamp((clientX - content.left) / content.width, 0, 1);
    const ry = clientY === undefined || !content
      ? 0.5
      : clamp((clientY - content.top) / content.height, 0, 1);
    const anchorX = current.x + rx * current.width;
    const anchorY = current.y + ry * current.height;
    const width = base.width / nextScale;
    const height = base.height / nextScale;

    this.currentBox = {
      x: clamp(anchorX - rx * width, base.x, base.x + base.width - width),
      y: clamp(anchorY - ry * height, base.y, base.y + base.height - height),
      width,
      height,
    };
    this.scheduleViewBoxWrite();
  }

  /**
   * The client rectangle the viewBox content actually occupies. With the
   * default `preserveAspectRatio` ("xMidYMid meet") the content is scaled
   * uniformly and centered, leaving letterbox margins whenever the element's
   * aspect differs from the viewBox's — mapping the cursor over the full
   * client rect would drift the zoom anchor on every wheel step.
   */
  private contentRect(svg: SVGSVGElement, box: ViewBox): ContentRect | null {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const scale = Math.min(rect.width / box.width, rect.height / box.height);
    const width = box.width * scale;
    const height = box.height * scale;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top + (rect.height - height) / 2,
      width,
      height,
    };
  }

  private fit(): void {
    if (!this.baseBox) return;
    this.currentBox = { ...this.baseBox };
    this.scheduleViewBoxWrite();
  }

  private updateControls(): void {
    const ready = this.active && this.baseBox !== null && this.currentBox !== null;
    const scale = ready ? this.baseBox!.width / this.currentBox!.width : 1;
    this.root.classList.toggle('drawio-interactive-zoomed', ready && scale > 1 + SCALE_EPSILON);
    this.zoomInButton.disabled = !ready || scale >= MAX_SCALE - SCALE_EPSILON;
    this.zoomOutButton.disabled = !ready || scale <= 1 + SCALE_EPSILON;
    this.fitButton.disabled = !ready || scale <= 1 + SCALE_EPSILON;
    this.fullscreenButton.hidden = this.opts.suppressFullscreen === true;
    this.fullscreenButton.disabled = !ready || this.opts.pages === undefined;
    this.editButton.disabled = !ready || this.opts.onEdit === undefined;
  }

  private scheduleViewBoxWrite(): void {
    const win = this.doc.defaultView;
    if (!win || this.frame !== null) return;
    this.frame = win.requestAnimationFrame(() => {
      this.frame = null;
      if (this.svg && this.currentBox) {
        const { x, y, width, height } = this.currentBox;
        this.svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
      }
      // 和 viewBox 同一帧更新按钮状态：滚轮每秒可发上百个事件，逐个改
      // classList/disabled 会让样式系统反复失效。
      this.updateControls();
    });
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    this.doc.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /**
   * Duck-type the event target instead of an instanceof check against one
   * realm's Node constructor — after a pane moves to a popout window, events
   * arrive from a different realm and a realm-bound check drops them.
   */
  private eventNode(event: Event): Node | null {
    const target = event.target as Node | null;
    return target && typeof target.nodeType === 'number' ? target : null;
  }
}

function parseViewBox(raw: string | null): ViewBox | null {
  if (!raw) return null;
  const values = raw.trim().split(/[\s,]+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const x = values[0]!;
  const y = values[1]!;
  const width = values[2]!;
  const height = values[3]!;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
