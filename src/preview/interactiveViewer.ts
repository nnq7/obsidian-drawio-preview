import { MarkdownRenderChild, setIcon } from 'obsidian';
import { strings } from '../i18n';

interface InteractiveViewerOptions {
  /** A height already resolved by the caller (e.g. a link-pinned size). */
  initialHeight?: number;
  onEdit?: () => void;
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
 * Minimal interactive-viewer lifecycle and activation shell.
 *
 * Zoom, pan, Edit, and fullscreen are intentionally added by later stages. This
 * walking skeleton only owns activation, exit, a placeholder toolbar, and cleanup.
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
  /** 正在等预览框尺寸稳定（退出全屏后）：期间的 window resize 一律跳过。 */
  private settling = false;
  private settleTimer: number | null = null;
  private settleObserver: ResizeObserver | null = null;
  private panStartX = 0;
  private panStartY = 0;
  /** 拖拽开始时算好的内容缩放比：拖拽期间元素尺寸不变，不必每次 pointermove
   *  都调 getBoundingClientRect（那会强制同步布局，高频拖动时每秒上百次）。 */
  private panStartScale = 0;
  /** 宿主是否支持 Fullscreen API；构造时算一次，别在每次 updateControls 里 duck-type。 */
  private canFullscreen = false;
  private panStartBox: ViewBox | null = null;
  /** Watches a detached/hidden preview until layout gives it a real width. */
  private measureObserver: ResizeObserver | null = null;

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
    this.canFullscreen = typeof this.root.requestFullscreen === 'function';
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
    // 宿主可能在我们构造之后才注入 Fullscreen API（测试替身就是这样），
    // 所以在激活（低频）时重新探测一次，而不是每次 updateControls 都 duck-type。
    this.canFullscreen = typeof this.root.requestFullscreen === 'function';
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
    // Being torn down while fullscreen (e.g. the note re-renders) would leave
    // the pane stuck fullscreen with no exit control — reconcile first.
    if (this.doc.fullscreenElement === this.root && typeof this.doc.exitFullscreen === 'function') {
      try {
        void this.doc.exitFullscreen().catch(() => { /* host is already leaving */ });
      } catch { /* host denies fullscreen control */ }
    }
    this.deactivate();
    this.disconnectSettle();
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
    doc.addEventListener('fullscreenchange', this.onFullscreenChange);
    doc.defaultView?.addEventListener('resize', this.onWindowResize);
  }

  private removeDocumentListeners(doc: Document): void {
    doc.removeEventListener('click', this.onDocumentClick, true);
    doc.removeEventListener('keydown', this.onDocumentKeydown);
    doc.removeEventListener('fullscreenchange', this.onFullscreenChange);
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
      toolbar, '×', L.btnExitFullscreen, () => { void this.exitFullscreen(); },
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
    const target = this.eventNode(event);
    if (!target || !this.root.contains(target)) this.deactivate();
  };

  private onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (this.doc.fullscreenElement === this.root) void this.exitFullscreen();
    this.deactivate();
  };

  private onFullscreenChange = (): void => {
    const fullscreen = this.doc.fullscreenElement === this.root;
    this.root.classList.toggle('drawio-interactive-fullscreen', fullscreen);
    this.fullscreenButton.hidden = fullscreen;
    this.closeFullscreenButton.hidden = !fullscreen;
    this.closeFullscreenButton.disabled = !fullscreen;
    // 退出全屏后按「尺寸稳定」重算高度（见 settleViewport）。进入全屏时不用做事：
    // 全屏尺寸由 CSS 决定，内联高度本来就不变。
    if (!fullscreen) this.settleViewport();
  };

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

  private async enterFullscreen(): Promise<void> {
    if (!this.active || typeof this.root.requestFullscreen !== 'function') return;
    try {
      await this.root.requestFullscreen();
      this.onFullscreenChange();
    } catch {
      // The host may deny fullscreen; the rest of the viewer remains usable.
    }
  }

  private async exitFullscreen(): Promise<void> {
    if (this.doc.fullscreenElement !== this.root || typeof this.doc.exitFullscreen !== 'function') return;
    try {
      await this.doc.exitFullscreen();
      this.onFullscreenChange();
    } catch {
      // The host may already be leaving fullscreen; fullscreenchange reconciles state.
    }
  }

  private async runEditAction(): Promise<void> {
    if (this.doc.fullscreenElement === this.root) await this.exitFullscreen();
    this.deactivate();
    this.opts.onEdit?.();
  }

  private onWindowResize = (): void => {
    if (this.manuallyResized) return;
    // 退出全屏后的那波 resize 交给 settleViewport 统一收尾，这里不插一脚。
    if (this.settling) return;
    if (this.doc.fullscreenElement === this.root) return;
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

  /**
   * 退出全屏后按「尺寸稳定」重算高度。
   *
   * 退出瞬间浏览器先派发 window resize、之后才完成笔记排版，此时量到的宽度还是
   * 全屏宽度（实测 1278），据此算高度会把框写死成 1136。固定时间窗挡不住慢机器
   * 上更长的排版；而 ResizeObserver 的回调本来就在布局完成后才触发，所以
   * 「它不再变化」就等于布局真的稳了 —— 与机器快慢无关。
   */
  private settleViewport(): void {
    const win = this.doc.defaultView;
    if (!win || typeof win.ResizeObserver !== 'function') return;
    this.disconnectSettle();
    this.settling = true;
    this.settleObserver = new win.ResizeObserver(() => {
      if (this.settleTimer !== null) win.clearTimeout(this.settleTimer);
      this.settleTimer = win.setTimeout(() => {
        this.disconnectSettle();
        if (!this.disposed) this.initializeViewport(true);
      }, 120);
    });
    this.settleObserver.observe(this.preview);
  }

  private disconnectSettle(): void {
    if (this.settleTimer !== null) {
      this.doc.defaultView?.clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.settleObserver?.disconnect();
    this.settleObserver = null;
    this.settling = false;
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
    this.fullscreenButton.disabled = !ready || !this.canFullscreen;
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
