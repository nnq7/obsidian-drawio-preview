import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the raw-text import so the module loads fast under vitest.
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));

import { renderPreview } from '../src/preview/ViewerRenderer';
import { ensureViewerLoaded, __resetViewerForTests } from '../src/preview/loadViewer';

// Minimal Obsidian-like DOM helpers used by renderPreview.
function patchEl(el: HTMLElement) {
  (el as any).empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
  (el as any).createDiv = function (o: any) {
    const d = document.createElement('div');
    if (o?.cls) d.className = o.cls;
    if (o?.text) d.textContent = o.text;
    (d as any).empty = (el as any).empty;
    (d as any).createDiv = (el as any).createDiv;
    this.appendChild(d); return d;
  };
}

beforeEach(() => { __resetViewerForTests(); });

describe('renderPreview error path', () => {
  it('renders an error placeholder for invalid xml', () => {
    const el = document.createElement('div');
    patchEl(el);
    const ok = renderPreview(el, 'garbage', { dark: false });
    expect(ok).toBe(false);
    expect(el.querySelector('.drawio-error')?.textContent).toBe('无效的 drawio 图表');
  });
});

describe('ensureViewerLoaded offline globals', () => {
  it('sets mx offline globals and does not throw', () => {
    ensureViewerLoaded(document);
    const w = window as any;
    expect(w.mxLoadResources).toBe(false);
    expect(w.mxLoadStylesheets).toBe(false);
  });
});
