import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from '../src/preview/svgSanitizer';

describe('sanitizeSvg', () => {
  it('keeps benign svg shapes', () => {
    const out = sanitizeSvg('<svg><rect width="10" height="10"/></svg>');
    expect(out).toContain('<rect');
  });
  it('removes <script> elements', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<rect');
  });
  it('removes inline event handlers', () => {
    const out = sanitizeSvg('<svg><rect onload="alert(1)" onclick="x()"/></svg>');
    expect(out).not.toContain('onload');
    expect(out).not.toContain('onclick');
  });

  it('strips external href from <use> elements', () => {
    const out = sanitizeSvg('<svg><use href="http://evil.com/evil.svg#x"/></svg>');
    expect(out).not.toContain('http://evil.com');
  });

  it('strips external xlink:href from <use> elements', () => {
    const out = sanitizeSvg('<svg><use xlink:href="https://evil.com/evil.svg#x"/></svg>');
    expect(out).not.toContain('evil.com');
  });

  it('keeps internal fragment href on <use> elements', () => {
    const out = sanitizeSvg('<svg><use href="#sym1"/></svg>');
    expect(out).toContain('#sym1');
  });

  // --- foreignObject (html=1 labels) must survive: this is the whole point ---
  it('preserves foreignObject and its XHTML label content (text, bold, styles)', () => {
    const out = sanitizeSvg(
      '<svg><foreignObject width="100" height="40">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="color:#888">' +
      '<b>Title</b><span>body</span></div></foreignObject></svg>',
    );
    expect(out.toLowerCase()).toContain('foreignobject');
    expect(out).toContain('<div');
    expect(out).toContain('<b>Title</b>');
    expect(out).toContain('<span>body</span>');
    expect(out).toContain('color:#888');
  });

  it('strips event handlers but keeps text inside a foreignObject label', () => {
    const out = sanitizeSvg(
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" onclick="bad()">' +
      'hello<img src="x" onerror="bad()"></div></foreignObject></svg>',
    );
    expect(out).toContain('hello');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onerror');
  });

  it('removes javascript: links', () => {
    const out = sanitizeSvg('<svg><a xlink:href="javascript:bad()"><text>t</text></a></svg>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<text>t</text>');
  });

  it('removes obfuscated script schemes (control chars / whitespace browsers ignore)', () => {
    const cases = [
      '<svg><a href="java\tscript:bad()"><text>t</text></a></svg>',     // embedded tab
      '<svg><a href="  javascript:bad()"><text>t</text></a></svg>',      // leading spaces
      '<svg><a href="\x01javascript:bad()"><text>t</text></a></svg>',    // leading control char
      '<svg><a xlink:href="java\nscript:bad()"><text>t</text></a></svg>', // embedded newline
      '<svg><a href="VBScript:bad()"><text>t</text></a></svg>',          // case-insensitive vbscript
    ];
    for (const c of cases) {
      const out = sanitizeSvg(c).replace(/[\x00-\x20]+/g, '').toLowerCase();
      expect(out).not.toContain('javascript:');
      expect(out).not.toContain('vbscript:');
    }
  });

  it('blocks dangerous data: URLs but keeps embedded raster images', () => {
    const html = sanitizeSvg('<svg><image href="data:text/html,<script>bad()</script>"/></svg>');
    expect(html).not.toContain('data:text/html');
    const svgData = sanitizeSvg('<svg><image href="data:image/svg+xml,<svg onload=bad()>"/></svg>');
    expect(svgData).not.toContain('data:image/svg');
    const png = sanitizeSvg('<svg><image href="data:image/png;base64,AAAA"/></svg>');
    expect(png).toContain('data:image/png;base64,AAAA');
  });

  it('removes SMIL elements that retarget an event handler', () => {
    const out = sanitizeSvg('<svg><set attributeName="onload" to="alert(1)"/><rect/></svg>');
    expect(out.toLowerCase()).not.toContain('<set');
    expect(out).toContain('<rect');
  });

  it('strips url() and expression() from inline styles', () => {
    const out = sanitizeSvg('<svg><rect style="fill:url(http://evil/x);width:expression(bad())"/></svg>');
    expect(out).not.toContain('url(');
    expect(out).not.toContain('expression(');
  });
});
