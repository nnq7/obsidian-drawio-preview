export const DRAWIO_VIEW_TYPE = 'drawio-file-view';
export const DRAWIO_FILE_EXT = 'drawio';

/** Pinned drawio version — MUST match scripts/fetch-drawio.mjs (guarded by
 * tests/drawioVersionSync.test.ts) so the drawio release the bundled
 * viewer.min.txt was taken from stays in step with the pinned version. */
export const DRAWIO_VERSION = 'v31.1.8';

/** Default empty mxfile diagram. */
export const EMPTY_DIAGRAM =
  '<mxfile><diagram id="0" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" ' +
  'gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" ' +
  'pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">' +
  '<root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
