import { describe, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import { openWithDefaultApp } from '../src/preview/clickAction';

describe('openWithDefaultApp', () => {
  it('calls the app internal with the path when available', () => {
    const open = vi.fn();
    openWithDefaultApp({ openWithDefaultApp: open } as unknown as App, 'diagram.drawio');
    expect(open).toHaveBeenCalledWith('diagram.drawio');
  });

  it('does not throw when the internal is missing', () => {
    expect(() => openWithDefaultApp({} as App, 'diagram.drawio')).not.toThrow();
  });
});
