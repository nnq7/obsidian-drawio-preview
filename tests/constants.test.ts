import { describe, it, expect } from 'vitest';
import {
  EMPTY_DIAGRAM,
  DRAWIO_VIEW_TYPE,
  DRAWIO_FILE_EXT,
} from '../src/constants';
import { isValidDrawioXml, getDiagramPages } from '../src/model/xmlUtils';

describe('constant invariants', () => {
  it('EMPTY_DIAGRAM is valid, single-page drawio XML named Page-1', () => {
    expect(isValidDrawioXml(EMPTY_DIAGRAM)).toBe(true);
    const pages = getDiagramPages(EMPTY_DIAGRAM);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.name).toBe('Page-1');
  });

  it('exposes the stable view type / extension identifiers', () => {
    expect(DRAWIO_VIEW_TYPE).toBe('drawio-file-view');
    expect(DRAWIO_FILE_EXT).toBe('drawio');
  });
});
