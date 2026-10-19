# Obsidian Drawio Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Obsidian plugin to embed, preview, and edit drawio diagrams fully offline — both as ` ```drawio ` code blocks and standalone `.drawio` files, with `![[file.drawio]]` wiki embeds.

**Architecture:** Lightweight client-side `GraphViewer` renders XML→SVG for all previews (no server). A lazily-started local HTTP server serves the bundled offline drawio webapp into a full-screen Modal `<iframe>`, which communicates via the drawio embed `postMessage` JSON protocol for full editing. Pure logic (XML utils, code-block source replacement, protocol messages, sanitizing, port detection) is TDD-tested with vitest; UI surfaces are implemented and verified against a manual checklist.

**Tech Stack:** TypeScript, esbuild, Obsidian API (`Plugin`, `Modal`, `TextFileView`, `registerMarkdownCodeBlockProcessor`, `registerMarkdownPostProcessor`), Node `http`, vitest, DOMPurify, drawio webapp (`draw.war` v30.0.4) + `viewer.min.js`.

---

## Reference: Key External Facts

These are verified facts the implementation depends on. Engineers should not re-derive them.

- **Obsidian sample scaffold** (verified): `package.json` uses `"type": "module"`, scripts `dev`/`build`/`lint`; build is `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`. esbuild externals must include `obsidian`, `electron`, the `@codemirror/*` and `@lezer/*` packages, and Node `builtinModules`. Output is `main.js` (CJS, target es2021).
- **manifest.json fields**: `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `authorUrl`, `isDesktopOnly`. This plugin sets `isDesktopOnly: true` (needs Node `http`).
- **drawio offline webapp**: `https://github.com/jgraph/drawio/releases/download/v30.0.4/draw.war` is a ZIP archive containing the full static webapp (`index.html`, `js/`, `styles/`, `images/`, `math/`, etc., plus a `WEB-INF/` we do NOT serve). It contains `js/viewer.min.js` (the `GraphViewer` used for previews).
- **drawio embed URL params**: `embed=1` (required), `proto=json` (JSON protocol), `spin=1` (spinner), `libraries=1` (shape panel), `dark=1` (dark theme).
- **drawio embed protocol** (host ⇄ iframe, all messages are `JSON.stringify`'d):
  - iframe → host on ready: `{event:'init'}`
  - host → iframe to load: `{action:'load', xml, autosave:1, modified:0, dark:true|false}`
  - iframe → host on save: `{event:'save', xml, exit?:true}`
  - iframe → host on autosave: `{event:'autosave', xml}`
  - iframe → host on exit: `{event:'exit', modified:boolean}`
  - host → iframe export: `{action:'export', format:'svg'}` → iframe → host `{event:'export', data, xml}`
- **GraphViewer usage**: include `viewer.min.js`; it exposes global `GraphViewer`. Render via `GraphViewer.createViewerForElement(element)` where `element` contains a `<div class="mxgraph" data-mxgraph="<json>">`, or call `new GraphViewer(container, xmlNode, graphConfig)`. The simplest stable path: build the `data-mxgraph` JSON `{highlight:'#0000ff', nav:true, toolbar:'', edit:null, xml:'<mxfile...>'}` and call `GraphViewer.processElements()` / `createViewerForElement`.

---

## Phase 0 — Project Scaffold

### Task 1: Initialize project scaffold and tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `manifest.json`
- Create: `versions.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`
- Create: `src/constants.ts`
- Create: `src/main.ts` (minimal stub)

- [ ] **Step 1: Initialize git repo**

Run:
```bash
cd /mnt/d/Workspace/project/obsidian-drawio
git init
```
Expected: `Initialized empty Git repository`.

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "obsidian-drawio",
  "version": "0.1.0",
  "description": "Embed, preview and edit drawio diagrams in Obsidian, fully offline.",
  "main": "main.js",
  "type": "module",
  "scripts": {
    "fetch-drawio": "node scripts/fetch-drawio.mjs",
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint ."
  },
  "keywords": ["obsidian", "drawio", "diagrams"],
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^22.15.17",
    "esbuild": "0.25.5",
    "obsidian": "latest",
    "typescript": "^5.8.3",
    "vitest": "^2.1.8"
  },
  "dependencies": {
    "dompurify": "^3.2.3"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2021",
    "strict": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "moduleResolution": "node",
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "lib": ["ES2021", "DOM"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: Create `esbuild.config.mjs`**

```js
import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';

const banner = `/* THIS IS A GENERATED/BUNDLED FILE BY ESBUILD */`;
const prod = process.argv[2] === 'production';

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian', 'electron',
    '@codemirror/autocomplete', '@codemirror/collab', '@codemirror/commands',
    '@codemirror/language', '@codemirror/lint', '@codemirror/search',
    '@codemirror/state', '@codemirror/view',
    '@lezer/common', '@lezer/highlight', '@lezer/lr',
    ...builtinModules,
  ],
  format: 'cjs',
  target: 'es2021',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: prod,
});

if (prod) { await context.rebuild(); process.exit(0); }
else { await context.watch(); }
```

- [ ] **Step 5: Create `manifest.json`**

```json
{
  "id": "obsidian-drawio",
  "name": "Drawio",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "description": "Embed, preview and edit drawio diagrams in Obsidian, fully offline.",
  "author": "liangsycmail",
  "authorUrl": "https://github.com/liangsycmail/obsidian-drawio",
  "isDesktopOnly": true
}
```

- [ ] **Step 6: Create `versions.json`**

```json
{
  "0.1.0": "1.0.0"
}
```

- [ ] **Step 7: Create `.gitignore`**

```
node_modules/
main.js
*.js.map
webapp/
.vscode/
data.json
```

- [ ] **Step 8: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
```

Note: add `jsdom` to devDependencies in Step 2 if not present — append `"jsdom": "^25.0.1"` to `devDependencies`.

- [ ] **Step 9: Create `src/constants.ts`**

```ts
export const DRAWIO_VIEW_TYPE = 'drawio-file-view';
export const DRAWIO_CODE_BLOCK_LANG = 'drawio';
export const DRAWIO_FILE_EXT = 'drawio';

/** Default empty mxfile diagram. */
export const EMPTY_DIAGRAM =
  '<mxfile><diagram id="0" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" ' +
  'gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" ' +
  'pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">' +
  '<root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

/** drawio embed iframe URL query params. */
export function buildEmbedQuery(opts: { dark: boolean; libraries: boolean }): string {
  const params = ['embed=1', 'proto=json', 'spin=1'];
  if (opts.libraries) params.push('libraries=1');
  if (opts.dark) params.push('dark=1');
  return params.join('&');
}
```

- [ ] **Step 10: Create minimal `src/main.ts` stub**

```ts
import { Plugin } from 'obsidian';

export default class DrawioPlugin extends Plugin {
  async onload() {
    console.log('obsidian-drawio loaded');
  }
  onunload() {
    console.log('obsidian-drawio unloaded');
  }
}
```

- [ ] **Step 11: Install dependencies**

Run: `npm install`
Expected: completes without errors; `node_modules/` populated.

- [ ] **Step 12: Verify build compiles**

Run: `npm run build`
Expected: produces `main.js` with no TypeScript errors.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: scaffold obsidian-drawio plugin"
```

---

### Task 2: Build script to fetch & unpack the offline drawio webapp

**Files:**
- Create: `scripts/fetch-drawio.mjs`

- [ ] **Step 1: Write `scripts/fetch-drawio.mjs`**

```js
// Downloads a pinned drawio webapp (draw.war = ZIP) and extracts static files to webapp/.
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const DRAWIO_VERSION = 'v30.0.4';
const WAR_URL = `https://github.com/jgraph/drawio/releases/download/${DRAWIO_VERSION}/draw.war`;
const OUT_DIR = join(process.cwd(), 'webapp');

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

async function main() {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const tmp = await mkdtemp(join(tmpdir(), 'drawio-'));
  const war = join(tmp, 'draw.war');
  console.log(`Downloading ${WAR_URL} ...`);
  await download(WAR_URL, war);

  // draw.war is a ZIP. Extract everything, then drop the server-only WEB-INF/META-INF.
  console.log('Extracting ...');
  execFileSync('unzip', ['-q', '-o', war, '-d', OUT_DIR]);
  rmSync(join(OUT_DIR, 'WEB-INF'), { recursive: true, force: true });
  rmSync(join(OUT_DIR, 'META-INF'), { recursive: true, force: true });

  // Sanity check key files exist.
  for (const f of ['index.html', join('js', 'viewer.min.js')]) {
    if (!existsSync(join(OUT_DIR, f))) throw new Error(`Missing expected file in webapp: ${f}`);
  }

  await writeFile(join(OUT_DIR, 'DRAWIO_VERSION'), DRAWIO_VERSION + '\n');
  console.log(`drawio ${DRAWIO_VERSION} extracted to ${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the fetch script**

Run: `npm run fetch-drawio`
Expected: `webapp/index.html` and `webapp/js/viewer.min.js` exist; final log `drawio v30.0.4 extracted to .../webapp`.

- [ ] **Step 3: Verify key files**

Run: `ls webapp/index.html webapp/js/viewer.min.js`
Expected: both paths listed (no "No such file").

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-drawio.mjs
git commit -m "build: add drawio webapp fetch script"
```

---

## Phase 1 — Pure Logic (TDD)

### Task 3: `xmlUtils` — validate & normalize drawio XML

**Files:**
- Create: `src/model/xmlUtils.ts`
- Test: `tests/xmlUtils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isValidDrawioXml, ensureMxfile, extractDiagramTitle } from '../src/model/xmlUtils';

describe('xmlUtils', () => {
  it('accepts a valid mxfile', () => {
    expect(isValidDrawioXml('<mxfile><diagram>x</diagram></mxfile>')).toBe(true);
  });
  it('accepts a bare mxGraphModel', () => {
    expect(isValidDrawioXml('<mxGraphModel><root/></mxGraphModel>')).toBe(true);
  });
  it('rejects empty or non-xml', () => {
    expect(isValidDrawioXml('')).toBe(false);
    expect(isValidDrawioXml('not xml')).toBe(false);
  });
  it('wraps a bare mxGraphModel into an mxfile', () => {
    const out = ensureMxfile('<mxGraphModel><root/></mxGraphModel>');
    expect(out.startsWith('<mxfile')).toBe(true);
    expect(out).toContain('<mxGraphModel>');
  });
  it('leaves an existing mxfile unchanged', () => {
    const src = '<mxfile><diagram>x</diagram></mxfile>';
    expect(ensureMxfile(src)).toBe(src);
  });
  it('extracts a diagram name attribute', () => {
    const src = '<mxfile><diagram name="Flow">x</diagram></mxfile>';
    expect(extractDiagramTitle(src)).toBe('Flow');
  });
  it('returns null title when absent', () => {
    expect(extractDiagramTitle('<mxfile><diagram>x</diagram></mxfile>')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- xmlUtils`
Expected: FAIL — cannot find module `../src/model/xmlUtils`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/model/xmlUtils.ts
const MXFILE_RE = /<mxfile[\s>]/;
const MXMODEL_RE = /<mxGraphModel[\s>]/;

export function isValidDrawioXml(xml: string): boolean {
  if (!xml || !xml.trim()) return false;
  return MXFILE_RE.test(xml) || MXMODEL_RE.test(xml);
}

export function ensureMxfile(xml: string): string {
  const trimmed = xml.trim();
  if (MXFILE_RE.test(trimmed)) return trimmed;
  if (MXMODEL_RE.test(trimmed)) {
    return `<mxfile><diagram id="0" name="Page-1">${trimmed}</diagram></mxfile>`;
  }
  return trimmed;
}

export function extractDiagramTitle(xml: string): string | null {
  const m = xml.match(/<diagram[^>]*\bname="([^"]*)"/);
  return m ? m[1] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- xmlUtils`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/model/xmlUtils.ts tests/xmlUtils.test.ts
git commit -m "feat: add drawio XML validation utilities"
```

---

### Task 4: `CodeBlockSource` — replace a code block's body in a markdown file

This is the trickiest pure-logic piece: given the full markdown text and the line range of a ` ```drawio ` block (from Obsidian's `getSectionInfo`), replace only the XML body lines, preserving the fence lines.

**Files:**
- Create: `src/model/codeBlockEdit.ts`
- Test: `tests/codeBlockEdit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { replaceCodeBlockBody } from '../src/model/codeBlockEdit';

const NL = '\n';

describe('replaceCodeBlockBody', () => {
  it('replaces body between fences (lineStart=fence, lineEnd=closing fence)', () => {
    const doc = ['# Note', '', '```drawio', 'OLD', '```', '', 'after'].join(NL);
    // section: lineStart=2 (```drawio), lineEnd=4 (```)
    const out = replaceCodeBlockBody(doc, 2, 4, 'NEW1\nNEW2');
    expect(out).toBe(['# Note', '', '```drawio', 'NEW1', 'NEW2', '```', '', 'after'].join(NL));
  });

  it('handles an empty original body', () => {
    const doc = ['```drawio', '```'].join(NL);
    const out = replaceCodeBlockBody(doc, 0, 1, 'X');
    expect(out).toBe(['```drawio', 'X', '```'].join(NL));
  });

  it('replaces the correct block when multiple blocks exist', () => {
    const doc = ['```drawio', 'A', '```', '', '```drawio', 'B', '```'].join(NL);
    const out = replaceCodeBlockBody(doc, 4, 6, 'B2'); // second block
    expect(out).toBe(['```drawio', 'A', '```', '', '```drawio', 'B2', '```'].join(NL));
  });

  it('preserves a trailing newline at end of document', () => {
    const doc = ['```drawio', 'A', '```', ''].join(NL);
    const out = replaceCodeBlockBody(doc, 0, 2, 'A2');
    expect(out).toBe(['```drawio', 'A2', '```', ''].join(NL));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- codeBlockEdit`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/model/codeBlockEdit.ts
/**
 * Replace the body of a fenced code block.
 * @param doc full markdown source
 * @param lineStart 0-based line index of the opening fence (```drawio)
 * @param lineEnd   0-based line index of the closing fence (```)
 * @param newBody   replacement body (without fences); may contain newlines
 */
export function replaceCodeBlockBody(
  doc: string,
  lineStart: number,
  lineEnd: number,
  newBody: string,
): string {
  const lines = doc.split('\n');
  const opening = lines[lineStart];
  const closing = lines[lineEnd];
  const before = lines.slice(0, lineStart);
  const after = lines.slice(lineEnd + 1);
  const bodyLines = newBody.split('\n');
  return [...before, opening, ...bodyLines, closing, ...after].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- codeBlockEdit`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/model/codeBlockEdit.ts tests/codeBlockEdit.test.ts
git commit -m "feat: add code-block body replacement logic"
```

---

### Task 5: `EmbedProtocol` message helpers — build & parse drawio postMessage payloads

**Files:**
- Create: `src/editor/embedMessages.ts`
- Test: `tests/embedMessages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildLoadMessage, buildExportMessage, parseDrawioEvent } from '../src/editor/embedMessages';

describe('embedMessages', () => {
  it('builds a load message with autosave and theme', () => {
    const msg = JSON.parse(buildLoadMessage('<mxfile/>', { dark: true }));
    expect(msg).toEqual({ action: 'load', xml: '<mxfile/>', autosave: 1, modified: 0, dark: true });
  });

  it('builds an export-svg message', () => {
    const msg = JSON.parse(buildExportMessage('svg'));
    expect(msg).toEqual({ action: 'export', format: 'svg' });
  });

  it('parses an init event', () => {
    expect(parseDrawioEvent(JSON.stringify({ event: 'init' }))).toEqual({ event: 'init' });
  });

  it('parses a save event with xml', () => {
    const parsed = parseDrawioEvent(JSON.stringify({ event: 'save', xml: '<x/>' }));
    expect(parsed).toEqual({ event: 'save', xml: '<x/>' });
  });

  it('returns null for non-drawio / malformed payloads', () => {
    expect(parseDrawioEvent('not json')).toBeNull();
    expect(parseDrawioEvent(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- embedMessages`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/editor/embedMessages.ts
export type DrawioEvent =
  | { event: 'init' }
  | { event: 'load'; [k: string]: unknown }
  | { event: 'save'; xml: string; exit?: boolean }
  | { event: 'autosave'; xml: string }
  | { event: 'exit'; modified?: boolean }
  | { event: 'export'; data: string; xml?: string; format?: string }
  | { event: 'configure' };

export function buildLoadMessage(xml: string, opts: { dark: boolean }): string {
  return JSON.stringify({ action: 'load', xml, autosave: 1, modified: 0, dark: opts.dark });
}

export function buildExportMessage(format: 'svg' | 'png' | 'xmlpng'): string {
  return JSON.stringify({ action: 'export', format });
}

export function parseDrawioEvent(raw: unknown): DrawioEvent | null {
  if (typeof raw !== 'string') return null;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const ev = (obj as Record<string, unknown>).event;
  if (typeof ev !== 'string') return null;
  return obj as DrawioEvent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- embedMessages`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/editor/embedMessages.ts tests/embedMessages.test.ts
git commit -m "feat: add drawio embed protocol message helpers"
```

---

### Task 6: `svgSanitizer` — strip scripts/handlers from rendered SVG

**Files:**
- Create: `src/preview/svgSanitizer.ts`
- Test: `tests/svgSanitizer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- svgSanitizer`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/preview/svgSanitizer.ts
import DOMPurify from 'dompurify';

export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- svgSanitizer`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/preview/svgSanitizer.ts tests/svgSanitizer.test.ts
git commit -m "feat: add SVG sanitizer"
```

---

### Task 7: `portDetector` — pick a free localhost port in a range

**Files:**
- Create: `src/server/portDetector.ts`
- Test: `tests/portDetector.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { findFreePort } from '../src/server/portDetector';

function listen(port: number): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(() => s.close()));
  });
}

describe('findFreePort', () => {
  it('returns a port within the requested range', async () => {
    const port = await findFreePort(41000, 41010);
    expect(port).toBeGreaterThanOrEqual(41000);
    expect(port).toBeLessThanOrEqual(41010);
  });

  it('skips an occupied port', async () => {
    const close = await listen(41020);
    try {
      const port = await findFreePort(41020, 41030);
      expect(port).not.toBe(41020);
    } finally { close(); }
  });

  it('throws when no port is free in range', async () => {
    const close = await listen(41040);
    try {
      await expect(findFreePort(41040, 41040)).rejects.toThrow();
    } finally { close(); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- portDetector`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/portDetector.ts
import { createServer } from 'node:http';

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

export async function findFreePort(min: number, max: number): Promise<number> {
  for (let p = min; p <= max; p++) {
    if (await isFree(p)) return p;
  }
  throw new Error(`No free port in range ${min}-${max}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- portDetector`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/portDetector.ts tests/portDetector.test.ts
git commit -m "feat: add free-port detector"
```

---

## Phase 2 — Local Server

### Task 8: `ServerManager` — lazy static file server with idle shutdown

**Files:**
- Create: `src/server/ServerManager.ts`
- Test: `tests/serverManager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerManager } from '../src/server/ServerManager';

let mgr: ServerManager | null = null;
afterEach(() => { mgr?.stop(); mgr = null; });

function fakeWebapp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wa-'));
  writeFileSync(join(dir, 'index.html'), '<html>drawio</html>');
  mkdirSync(join(dir, 'js'));
  writeFileSync(join(dir, 'js', 'viewer.min.js'), 'console.log(1)');
  return dir;
}

describe('ServerManager', () => {
  it('serves index.html after ensureStarted', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41100, max: 41200, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    const res = await fetch(`http://127.0.0.1:${port}/index.html`);
    expect(await res.text()).toContain('drawio');
  });

  it('does not serve files outside the webapp dir (path traversal)', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41100, max: 41200, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    const res = await fetch(`http://127.0.0.1:${port}/../../etc/passwd`);
    expect(res.status).toBe(403);
  });

  it('ensureStarted is idempotent (same port)', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41100, max: 41200, idleMs: 60000 });
    const p1 = await mgr.ensureStarted();
    const p2 = await mgr.ensureStarted();
    expect(p1).toBe(p2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- serverManager`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/ServerManager.ts
import { createServer, Server } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { findFreePort } from './portDetector';

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json', '.txt': 'text/plain',
};

export interface ServerOptions { min: number; max: number; idleMs: number; }

export class ServerManager {
  private server: Server | null = null;
  private port = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly root: string, private readonly opts: ServerOptions) {}

  async ensureStarted(): Promise<number> {
    this.touch();
    if (this.server) return this.port;
    this.port = await findFreePort(this.opts.min, this.opts.max);
    this.server = createServer((req, res) => this.handle(req.url ?? '/', res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, '127.0.0.1', resolve);
    });
    return this.port;
  }

  /** Reset the idle countdown; call on each editor open/activity. */
  touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), this.opts.idleMs);
  }

  stop(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.server) { this.server.close(); this.server = null; this.port = 0; }
  }

  private handle(url: string, res: import('node:http').ServerResponse): void {
    let path = decodeURIComponent(url.split('?')[0]);
    if (path === '/' || path === '') path = '/index.html';
    const full = normalize(join(this.root, path));
    if (!full.startsWith(this.root + sep) && full !== this.root) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!existsSync(full) || !statSync(full).isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream' });
    createReadStream(full).pipe(res);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- serverManager`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/ServerManager.ts tests/serverManager.test.ts
git commit -m "feat: add lazy static-file server with idle shutdown"
```

---

## Phase 3 — Preview Rendering

### Task 9: `ViewerRenderer` — render drawio XML to an SVG preview element

`viewer.min.js` is large and not a module; it is loaded as a bundled raw string and injected once. This task wires that injection and exposes `renderInto(el, xml)`.

**Files:**
- Create: `src/preview/loadViewer.ts`
- Create: `src/preview/ViewerRenderer.ts`
- Modify: `esbuild.config.mjs` (add a loader so `viewer.min.js` can be imported as text)
- Test: `tests/viewerRenderer.dom.test.ts` (error-path only; full render needs Obsidian runtime)

- [ ] **Step 1: Add a text loader for the viewer asset in `esbuild.config.mjs`**

Replace the `treeShaking: true,` line region by adding a `loader` option to the esbuild config object (insert after `treeShaking: true,`):

```js
  treeShaking: true,
  loader: { '.txt': 'text' },
```

- [ ] **Step 2: Write `src/preview/loadViewer.ts`**

The viewer JS is copied (by Task 11 wiring / fetch step) to `src/preview/viewer.min.txt` at build time. For now create a loader that injects it once into the document.

```ts
// src/preview/loadViewer.ts
// @ts-expect-error - imported as raw text via esbuild text loader
import viewerSource from './viewer.min.txt';

let injected = false;

/** Inject drawio's GraphViewer (viewer.min.js) into the document exactly once. */
export function ensureViewerLoaded(doc: Document = document): void {
  if (injected) return;
  const w = doc.defaultView as unknown as { GraphViewer?: unknown };
  if (w && w.GraphViewer) { injected = true; return; }
  const script = doc.createElement('script');
  script.textContent = viewerSource as unknown as string;
  doc.head.appendChild(script);
  injected = true;
}

interface GraphViewerStatic {
  createViewerForElement(el: HTMLElement): void;
}

export function getGraphViewer(win: Window = window): GraphViewerStatic | null {
  const w = win as unknown as { GraphViewer?: GraphViewerStatic };
  return w.GraphViewer ?? null;
}
```

Note for implementer: add `webapp/js/viewer.min.js` → `src/preview/viewer.min.txt` copy as a step in `scripts/fetch-drawio.mjs`. Append to that script's `main()` before the final log:

```js
import { copyFileSync } from 'node:fs';
// ... after extraction & sanity check:
copyFileSync(join(OUT_DIR, 'js', 'viewer.min.js'),
  join(process.cwd(), 'src', 'preview', 'viewer.min.txt'));
```

Then re-run `npm run fetch-drawio` so `src/preview/viewer.min.txt` exists before building.

- [ ] **Step 3: Write `src/preview/ViewerRenderer.ts`**

```ts
// src/preview/ViewerRenderer.ts
import { ensureViewerLoaded, getGraphViewer } from './loadViewer';
import { isValidDrawioXml, ensureMxfile } from '../model/xmlUtils';
import { sanitizeSvg } from './svgSanitizer';

export interface RenderOptions { dark: boolean; }

/**
 * Render drawio XML into `el` as an inline SVG preview.
 * Returns true on success; on invalid XML renders an error placeholder and returns false.
 */
export function renderPreview(el: HTMLElement, xml: string, opts: RenderOptions): boolean {
  el.empty();
  if (!isValidDrawioXml(xml)) {
    el.createDiv({ cls: 'drawio-error', text: 'Invalid drawio diagram' });
    return false;
  }
  ensureViewerLoaded(el.ownerDocument);
  const viewer = getGraphViewer(el.ownerDocument.defaultView ?? window);
  const mount = el.createDiv({ cls: 'mxgraph' });
  const data = {
    highlight: '#0000ff', nav: true, toolbar: '', edit: null,
    'dark-mode': opts.dark ? 'auto' : 'off',
    xml: ensureMxfile(xml),
  };
  mount.setAttribute('data-mxgraph', JSON.stringify(data));
  if (viewer) {
    viewer.createViewerForElement(mount);
    // GraphViewer injects an <svg>; sanitize it post-hoc.
    const svg = mount.querySelector('svg');
    if (svg) {
      const clean = sanitizeSvg(svg.outerHTML);
      svg.outerHTML = clean;
    }
    return true;
  }
  el.createDiv({ cls: 'drawio-error', text: 'drawio viewer failed to load' });
  return false;
}
```

- [ ] **Step 4: Write the error-path test**

```ts
// tests/viewerRenderer.dom.test.ts
import { describe, it, expect, vi } from 'vitest';

// Stub the raw-text import so the module loads under vitest.
vi.mock('../src/preview/viewer.min.txt', () => ({ default: '' }), { virtual: true });

import { renderPreview } from '../src/preview/ViewerRenderer';

// Minimal Obsidian-like helpers used by renderPreview.
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

describe('renderPreview error path', () => {
  it('renders an error placeholder for invalid xml', () => {
    const el = document.createElement('div');
    patchEl(el);
    const ok = renderPreview(el, 'garbage', { dark: false });
    expect(ok).toBe(false);
    expect(el.querySelector('.drawio-error')?.textContent).toBe('Invalid drawio diagram');
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- viewerRenderer`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add esbuild.config.mjs scripts/fetch-drawio.mjs src/preview/loadViewer.ts src/preview/ViewerRenderer.ts tests/viewerRenderer.dom.test.ts
git commit -m "feat: add client-side drawio SVG preview renderer"
```

---

## Phase 4 — Plugin Wiring (implement + manual verify)

> Obsidian UI surfaces can't be unit-tested without the app runtime. Each task below ends with a **manual verification** in a test vault. Set up a test vault symlink once:
>
> ```bash
> # one-time: link the built plugin into a throwaway vault
> mkdir -p /path/to/TestVault/.obsidian/plugins/obsidian-drawio
> ln -sf "$(pwd)/main.js" /path/to/TestVault/.obsidian/plugins/obsidian-drawio/main.js
> ln -sf "$(pwd)/manifest.json" /path/to/TestVault/.obsidian/plugins/obsidian-drawio/manifest.json
> ln -sf "$(pwd)/styles.css" /path/to/TestVault/.obsidian/plugins/obsidian-drawio/styles.css
> ln -sf "$(pwd)/webapp" /path/to/TestVault/.obsidian/plugins/obsidian-drawio/webapp
> ```
> Then `npm run dev`, enable the plugin in Obsidian, and use Ctrl+R (reload) after each rebuild.

### Task 10: Settings model + plugin skeleton with ServerManager lifecycle

**Files:**
- Create: `src/settings.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/settings.ts`**

```ts
// src/settings.ts
export type DrawioMode = 'offline' | 'custom';
export type StoreFormat = 'xml' | 'compressed';

export interface DrawioSettings {
  drawioMode: DrawioMode;
  customDrawioUrl: string;
  serverPortMin: number;
  serverPortMax: number;
  serverIdleTimeout: number; // seconds
  followObsidianTheme: boolean;
  showLibraries: boolean;
  storeFormat: StoreFormat;
}

export const DEFAULT_SETTINGS: DrawioSettings = {
  drawioMode: 'offline',
  customDrawioUrl: '',
  serverPortMin: 3000,
  serverPortMax: 3999,
  serverIdleTimeout: 300,
  followObsidianTheme: true,
  showLibraries: true,
  storeFormat: 'xml',
};
```

- [ ] **Step 2: Rewrite `src/main.ts` to load settings and own the ServerManager**

```ts
// src/main.ts
import { Plugin, FileSystemAdapter } from 'obsidian';
import { join } from 'node:path';
import { DrawioSettings, DEFAULT_SETTINGS } from './settings';
import { ServerManager } from './server/ServerManager';

export default class DrawioPlugin extends Plugin {
  settings!: DrawioSettings;
  server!: ServerManager;

  async onload() {
    await this.loadSettings();
    const webappDir = join(this.pluginDir(), 'webapp');
    this.server = new ServerManager(webappDir, {
      min: this.settings.serverPortMin,
      max: this.settings.serverPortMax,
      idleMs: this.settings.serverIdleTimeout * 1000,
    });
    this.register(() => this.server.stop());
  }

  onunload() {
    this.server?.stop();
  }

  /** Absolute path to this plugin's folder on disk. */
  pluginDir(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return join(adapter.getBasePath(), this.manifest.dir ?? '');
    }
    throw new Error('Drawio plugin requires a desktop (FileSystem) vault');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles, `main.js` produced, no TS errors.

- [ ] **Step 4: Manual verify**

Reload Obsidian, enable the plugin. Open the developer console (Ctrl+Shift+I). Expected: no errors on load; toggling the plugin off shows no errors (server stop is safe even if never started).

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts src/main.ts
git commit -m "feat: add settings model and plugin lifecycle with server manager"
```

---

### Task 11: `DrawioModal` + editing wiring (the editor surface)

**Files:**
- Create: `src/editor/DrawioModal.ts`
- Modify: `src/main.ts` (add `openEditor(source)` helper)
- Create: `src/model/DrawioSource.ts`

- [ ] **Step 1: Write `src/model/DrawioSource.ts` (editing target abstraction)**

```ts
// src/model/DrawioSource.ts
/** A thing that can be edited in the drawio editor: a code block or a file. */
export interface DrawioSource {
  /** Human label for the modal title. */
  title(): string;
  /** Current XML. */
  read(): Promise<string>;
  /** Persist new XML. */
  write(xml: string): Promise<void>;
}
```

- [ ] **Step 2: Write `src/editor/DrawioModal.ts`**

```ts
// src/editor/DrawioModal.ts
import { App, Modal, Notice } from 'obsidian';
import { DrawioSource } from '../model/DrawioSource';
import { buildLoadMessage, parseDrawioEvent } from './embedMessages';
import { buildEmbedQuery } from '../constants';

export interface DrawioModalDeps {
  /** Resolve the editor base URL (local server origin or custom URL). */
  resolveBaseUrl(): Promise<string>;
  isDark(): boolean;
  showLibraries(): boolean;
}

export class DrawioModal extends Modal {
  private iframe: HTMLIFrameElement | null = null;
  private onMessage: ((e: MessageEvent) => void) | null = null;
  private origin = '';

  constructor(app: App, private source: DrawioSource, private deps: DrawioModalDeps) {
    super(app);
  }

  async onOpen() {
    this.modalEl.addClass('drawio-modal');
    this.titleEl.setText(this.source.title());
    const base = await this.deps.resolveBaseUrl();
    this.origin = new URL(base).origin;
    const q = buildEmbedQuery({ dark: this.deps.isDark(), libraries: this.deps.showLibraries() });
    const url = `${base}${base.includes('?') ? '&' : '?'}${q}`;

    this.iframe = this.contentEl.createEl('iframe', { cls: 'drawio-iframe' });
    this.iframe.setAttribute('src', url);

    this.onMessage = (e: MessageEvent) => this.handle(e);
    window.addEventListener('message', this.onMessage);
  }

  private async handle(e: MessageEvent) {
    if (e.source !== this.iframe?.contentWindow) return;
    if (this.origin !== 'null' && e.origin !== this.origin) return;
    const ev = parseDrawioEvent(e.data);
    if (!ev) return;
    switch (ev.event) {
      case 'init': {
        const xml = await this.source.read();
        this.post(buildLoadMessage(xml, { dark: this.deps.isDark() }));
        break;
      }
      case 'save':
      case 'autosave': {
        try {
          await this.source.write((ev as { xml: string }).xml);
        } catch (err) {
          new Notice('Drawio: failed to save diagram');
          console.error(err);
        }
        if (ev.event === 'save' && (ev as { exit?: boolean }).exit) this.close();
        break;
      }
      case 'exit':
        this.close();
        break;
    }
  }

  private post(message: string) {
    this.iframe?.contentWindow?.postMessage(message, this.origin === 'null' ? '*' : this.origin);
  }

  onClose() {
    if (this.onMessage) window.removeEventListener('message', this.onMessage);
    this.onMessage = null;
    this.iframe = null;
    this.contentEl.empty();
  }
}
```

- [ ] **Step 3: Add `openEditor` + `resolveBaseUrl` to `src/main.ts`**

Add these methods to the `DrawioPlugin` class (after `pluginDir()`):

```ts
  async resolveBaseUrl(): Promise<string> {
    if (this.settings.drawioMode === 'custom' && this.settings.customDrawioUrl) {
      return this.settings.customDrawioUrl;
    }
    const port = await this.server.ensureStarted();
    this.server.touch();
    return `http://127.0.0.1:${port}/index.html`;
  }

  isDark(): boolean {
    return document.body.hasClass('theme-dark');
  }

  openEditor(source: import('./model/DrawioSource').DrawioSource) {
    const { DrawioModal } = require('./editor/DrawioModal') as typeof import('./editor/DrawioModal');
    new DrawioModal(this.app, source, {
      resolveBaseUrl: () => this.resolveBaseUrl(),
      isDark: () => this.settings.followObsidianTheme && this.isDark(),
      showLibraries: () => this.settings.showLibraries,
    }).open();
  }
```

Add the import at the top of `main.ts`:
```ts
import type { DrawioSource } from './model/DrawioSource';
```
and change the `openEditor` signature to use it directly:
```ts
  openEditor(source: DrawioSource) {
    const { DrawioModal } = require('./editor/DrawioModal') as typeof import('./editor/DrawioModal');
    new DrawioModal(this.app, source, {
      resolveBaseUrl: () => this.resolveBaseUrl(),
      isDark: () => this.settings.followObsidianTheme && this.isDark(),
      showLibraries: () => this.settings.showLibraries,
    }).open();
  }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles with no TS errors.

- [ ] **Step 5: Manual verify (deferred to Task 12)**

The modal has no trigger yet; it is exercised by the code-block edit button in Task 12. Just confirm the build is clean here.

- [ ] **Step 6: Commit**

```bash
git add src/model/DrawioSource.ts src/editor/DrawioModal.ts src/main.ts
git commit -m "feat: add drawio editor modal with embed protocol wiring"
```

---

### Task 12: `drawio` code block processor (preview + edit button)

**Files:**
- Create: `src/codeblock/CodeBlockSource.ts`
- Create: `src/codeblock/DrawioCodeBlock.ts`
- Modify: `src/main.ts` (register processor)

- [ ] **Step 1: Write `src/codeblock/CodeBlockSource.ts`**

```ts
// src/codeblock/CodeBlockSource.ts
import { App, MarkdownPostProcessorContext, TFile } from 'obsidian';
import { DrawioSource } from '../model/DrawioSource';
import { replaceCodeBlockBody } from '../model/codeBlockEdit';

/** Editable source backed by a ```drawio block inside a markdown note. */
export class CodeBlockSource implements DrawioSource {
  constructor(
    private app: App,
    private ctx: MarkdownPostProcessorContext,
    private el: HTMLElement,
    private initialXml: string,
  ) {}

  title(): string { return 'Drawio diagram'; }

  async read(): Promise<string> { return this.initialXml; }

  async write(xml: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
    if (!(file instanceof TFile)) throw new Error('Source note not found');
    const info = this.ctx.getSectionInfo(this.el);
    if (!info) throw new Error('Cannot locate code block in source');
    const doc = await this.app.vault.read(file);
    const next = replaceCodeBlockBody(doc, info.lineStart, info.lineEnd, xml.trim());
    await this.app.vault.modify(file, next);
    this.initialXml = xml;
  }
}
```

- [ ] **Step 2: Write `src/codeblock/DrawioCodeBlock.ts`**

```ts
// src/codeblock/DrawioCodeBlock.ts
import { MarkdownPostProcessorContext, setIcon } from 'obsidian';
import { renderPreview } from '../preview/ViewerRenderer';
import { CodeBlockSource } from './CodeBlockSource';
import type DrawioPlugin from '../main';

export function registerDrawioCodeBlock(plugin: DrawioPlugin) {
  plugin.registerMarkdownCodeBlockProcessor('drawio', (source, el, ctx) => {
    renderCodeBlock(plugin, source, el, ctx);
  });
}

function renderCodeBlock(
  plugin: DrawioPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
) {
  const wrapper = el.createDiv({ cls: 'drawio-codeblock' });
  const preview = wrapper.createDiv({ cls: 'drawio-preview' });
  renderPreview(preview, source, { dark: plugin.settings.followObsidianTheme && plugin.isDark() });

  const editBtn = wrapper.createEl('button', { cls: 'drawio-edit-btn', attr: { 'aria-label': 'Edit diagram' } });
  setIcon(editBtn, 'pencil');
  editBtn.addEventListener('click', () => {
    const src = new CodeBlockSource(plugin.app, ctx, el, source);
    plugin.openEditor(src);
  });
}
```

- [ ] **Step 3: Register in `src/main.ts` `onload()`**

Add after the `this.register(() => this.server.stop());` line:

```ts
    const { registerDrawioCodeBlock } = await import('./codeblock/DrawioCodeBlock');
    registerDrawioCodeBlock(this);
```

- [ ] **Step 4: Build & manual verify**

Run: `npm run build`, reload Obsidian.

Create a note with:
````
```drawio
<mxfile><diagram name="Test"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Hello" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>
```
````
Expected:
- Reading mode shows an SVG box with "Hello".
- An edit (pencil) button appears; clicking it opens the drawio editor modal.
- Move the shape, then use the editor's Save — the code block XML updates and the preview refreshes after reopening/re-rendering.

- [ ] **Step 5: Commit**

```bash
git add src/codeblock/CodeBlockSource.ts src/codeblock/DrawioCodeBlock.ts src/main.ts
git commit -m "feat: render drawio code blocks with edit button"
```

---

### Task 13: `.drawio` file view (`DrawioFileView`)

**Files:**
- Create: `src/file/FileSource.ts`
- Create: `src/file/DrawioFileView.ts`
- Modify: `src/main.ts` (register view + extension + create command)

- [ ] **Step 1: Write `src/file/FileSource.ts`**

```ts
// src/file/FileSource.ts
import { App, TFile } from 'obsidian';
import { DrawioSource } from '../model/DrawioSource';

export class FileSource implements DrawioSource {
  constructor(private app: App, private file: TFile) {}
  title(): string { return this.file.basename; }
  async read(): Promise<string> { return this.app.vault.read(this.file); }
  async write(xml: string): Promise<void> { await this.app.vault.modify(this.file, xml); }
}
```

- [ ] **Step 2: Write `src/file/DrawioFileView.ts`**

```ts
// src/file/DrawioFileView.ts
import { TextFileView, WorkspaceLeaf, setIcon } from 'obsidian';
import { DRAWIO_VIEW_TYPE } from '../constants';
import { renderPreview } from '../preview/ViewerRenderer';
import { FileSource } from './FileSource';
import type DrawioPlugin from '../main';

export class DrawioFileView extends TextFileView {
  private xml = '';

  constructor(leaf: WorkspaceLeaf, private plugin: DrawioPlugin) { super(leaf); }

  getViewType(): string { return DRAWIO_VIEW_TYPE; }
  getIcon(): string { return 'pencil-ruler'; }

  getViewData(): string { return this.xml; }

  setViewData(data: string, _clear: boolean): void {
    this.xml = data;
    this.renderUi();
  }

  clear(): void { this.xml = ''; }

  private renderUi() {
    const c = this.contentEl;
    c.empty();
    c.addClass('drawio-file-view');
    const preview = c.createDiv({ cls: 'drawio-preview' });
    renderPreview(preview, this.xml, {
      dark: this.plugin.settings.followObsidianTheme && this.plugin.isDark(),
    });
    const editBtn = c.createEl('button', { cls: 'drawio-edit-btn', text: 'Edit' });
    setIcon(editBtn.createSpan(), 'pencil');
    editBtn.addEventListener('click', () => {
      if (!this.file) return;
      this.plugin.openEditor(new FileSource(this.app, this.file));
    });
  }
}
```

- [ ] **Step 3: Register the view, extension, and a create command in `src/main.ts` `onload()`**

Add after the code-block registration:

```ts
    const { DrawioFileView } = await import('./file/DrawioFileView');
    this.registerView(DRAWIO_VIEW_TYPE, (leaf) => new DrawioFileView(leaf, this));
    this.registerExtensions([DRAWIO_FILE_EXT], DRAWIO_VIEW_TYPE);

    this.addCommand({
      id: 'create-drawio-file',
      name: 'Create new drawio diagram',
      callback: async () => {
        const path = `Untitled Diagram ${Date.now()}.drawio`;
        const file = await this.app.vault.create(path, EMPTY_DIAGRAM);
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(file);
      },
    });
```

Add imports at top of `main.ts`:
```ts
import { DRAWIO_VIEW_TYPE, DRAWIO_FILE_EXT, EMPTY_DIAGRAM } from './constants';
```

- [ ] **Step 4: Build & manual verify**

Run: `npm run build`, reload Obsidian.
- Run command "Create new drawio diagram" → a `.drawio` file opens showing an (empty) preview + Edit button.
- Click Edit → editor modal opens → draw something → Save → file content updates → close → preview reflects changes.
- Reopen the `.drawio` file from the file explorer → opens in the custom view (not as plain text).

- [ ] **Step 5: Commit**

```bash
git add src/file/FileSource.ts src/file/DrawioFileView.ts src/main.ts
git commit -m "feat: add .drawio file view with create command"
```

---

### Task 14: `![[file.drawio]]` embed rendering

Obsidian renders internal embeds of unknown extensions as a fallback. We post-process the rendered note to replace `.drawio` embeds with an SVG preview + edit button.

**Files:**
- Create: `src/file/EmbedRenderer.ts`
- Modify: `src/main.ts` (register post processor)

- [ ] **Step 1: Write `src/file/EmbedRenderer.ts`**

```ts
// src/file/EmbedRenderer.ts
import { MarkdownPostProcessorContext, TFile, setIcon } from 'obsidian';
import { renderPreview } from '../preview/ViewerRenderer';
import { FileSource } from './FileSource';
import { DRAWIO_FILE_EXT } from '../constants';
import type DrawioPlugin from '../main';

export function registerDrawioEmbeds(plugin: DrawioPlugin) {
  plugin.registerMarkdownPostProcessor(async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const embeds = Array.from(el.querySelectorAll<HTMLElement>('span.internal-embed, div.internal-embed'));
    for (const span of embeds) {
      const src = span.getAttribute('src');
      if (!src || !src.toLowerCase().endsWith('.' + DRAWIO_FILE_EXT)) continue;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
      if (!(file instanceof TFile)) continue;
      await renderEmbed(plugin, span, file);
    }
  });
}

async function renderEmbed(plugin: DrawioPlugin, span: HTMLElement, file: TFile) {
  span.empty();
  span.addClass('drawio-embed');
  const xml = await plugin.app.vault.read(file);
  const preview = span.createDiv({ cls: 'drawio-preview' });
  renderPreview(preview, xml, { dark: plugin.settings.followObsidianTheme && plugin.isDark() });
  const editBtn = span.createEl('button', { cls: 'drawio-edit-btn', attr: { 'aria-label': 'Edit diagram' } });
  setIcon(editBtn, 'pencil');
  editBtn.addEventListener('click', () => plugin.openEditor(new FileSource(plugin.app, file)));
}
```

- [ ] **Step 2: Register in `src/main.ts` `onload()`**

Add after the file-view registration block:

```ts
    const { registerDrawioEmbeds } = await import('./file/EmbedRenderer');
    registerDrawioEmbeds(this);
```

- [ ] **Step 3: Build & manual verify**

Run: `npm run build`, reload Obsidian.
- In a note, add `![[Untitled Diagram ....drawio]]` referencing the file created in Task 13.
- Reading mode shows the diagram preview + edit button.
- Click edit → modal opens → save → embed preview updates after re-render.

- [ ] **Step 4: Commit**

```bash
git add src/file/EmbedRenderer.ts src/main.ts
git commit -m "feat: render ![[file.drawio]] embeds with preview and edit"
```

---

### Task 15: Settings tab

**Files:**
- Create: `src/settingsTab.ts`
- Modify: `src/main.ts` (add settings tab)

- [ ] **Step 1: Write `src/settingsTab.ts`**

```ts
// src/settingsTab.ts
import { App, PluginSettingTab, Setting } from 'obsidian';
import type DrawioPlugin from './main';

export class DrawioSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DrawioPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Editor source')
      .setDesc('Use the bundled offline drawio, or a custom/online URL.')
      .addDropdown((d) => d
        .addOption('offline', 'Offline (bundled)')
        .addOption('custom', 'Custom URL')
        .setValue(this.plugin.settings.drawioMode)
        .onChange(async (v) => {
          this.plugin.settings.drawioMode = v as 'offline' | 'custom';
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.drawioMode === 'custom') {
      new Setting(containerEl)
        .setName('Custom drawio URL')
        .setDesc('Embed URL, e.g. https://embed.diagrams.net/')
        .addText((t) => t
          .setValue(this.plugin.settings.customDrawioUrl)
          .onChange(async (v) => { this.plugin.settings.customDrawioUrl = v.trim(); await this.plugin.saveSettings(); }));
    }

    new Setting(containerEl)
      .setName('Follow Obsidian theme')
      .addToggle((t) => t
        .setValue(this.plugin.settings.followObsidianTheme)
        .onChange(async (v) => { this.plugin.settings.followObsidianTheme = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Show shape libraries')
      .addToggle((t) => t
        .setValue(this.plugin.settings.showLibraries)
        .onChange(async (v) => { this.plugin.settings.showLibraries = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Server idle timeout (seconds)')
      .setDesc('Stop the local drawio server after this idle period.')
      .addText((t) => t
        .setValue(String(this.plugin.settings.serverIdleTimeout))
        .onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) { this.plugin.settings.serverIdleTimeout = n; await this.plugin.saveSettings(); }
        }));
  }
}
```

- [ ] **Step 2: Register the tab in `src/main.ts` `onload()`**

Add at the end of `onload()`:

```ts
    const { DrawioSettingTab } = await import('./settingsTab');
    this.addSettingTab(new DrawioSettingTab(this.app, this));
```

- [ ] **Step 3: Build & manual verify**

Run: `npm run build`, reload Obsidian.
- Open Settings → Drawio. Toggle "Custom URL" → the URL field appears.
- Change idle timeout → value persists across reloads.

- [ ] **Step 4: Commit**

```bash
git add src/settingsTab.ts src/main.ts
git commit -m "feat: add settings tab"
```

---

## Phase 5 — Polish & Release Prep

### Task 16: Styles

**Files:**
- Create: `styles.css`

- [ ] **Step 1: Write `styles.css`**

```css
.drawio-codeblock, .drawio-embed { position: relative; }
.drawio-preview { width: 100%; overflow: auto; text-align: center; }
.drawio-preview svg { max-width: 100%; height: auto; }
.drawio-edit-btn {
  position: absolute; top: 6px; right: 6px;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; cursor: pointer; opacity: 0; transition: opacity .15s;
}
.drawio-codeblock:hover .drawio-edit-btn,
.drawio-embed:hover .drawio-edit-btn,
.drawio-file-view .drawio-edit-btn { opacity: 1; }
.drawio-error {
  padding: 8px 12px; color: var(--text-error);
  border: 1px solid var(--background-modifier-error); border-radius: 6px;
}
.drawio-modal { width: 90vw; height: 90vh; max-width: none; }
.drawio-modal .modal-content { height: 100%; padding: 0; }
.drawio-iframe { width: 100%; height: 100%; border: none; }
.drawio-file-view { display: flex; flex-direction: column; height: 100%; }
.drawio-file-view .drawio-preview { flex: 1; }
```

- [ ] **Step 2: Build & manual verify**

Run: `npm run build`, reload Obsidian. Confirm: edit button appears on hover; modal is large (90vw/90vh); error placeholder is styled.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style: add plugin styles"
```

---

### Task 17: Documentation & manual test checklist

**Files:**
- Create: `README.md`
- Create: `docs/MANUAL_TESTS.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Obsidian Drawio

Embed, preview, and edit [drawio](https://www.drawio.com/) diagrams in Obsidian — fully offline.

## Features
- ` ```drawio ` code blocks: store diagram XML inline, preview as SVG, edit in a modal.
- Standalone `.drawio` files with a dedicated view.
- Embed files with `![[diagram.drawio]]`.
- Offline-first bundled drawio editor; optional custom/online URL.

## Install (manual / dev)
1. `npm install`
2. `npm run fetch-drawio` (downloads the offline drawio webapp)
3. `npm run build`
4. Copy `main.js`, `manifest.json`, `styles.css`, and `webapp/` into
   `<vault>/.obsidian/plugins/obsidian-drawio/`.
5. Enable the plugin in Obsidian (desktop only).

## Development
- `npm run dev` — watch build
- `npm test` — unit tests (vitest)

## Notes
- Desktop only (uses a local HTTP server for the offline editor).
```

- [ ] **Step 2: Write `docs/MANUAL_TESTS.md`**

```markdown
# Manual Test Checklist

Run in a desktop test vault after `npm run build`.

## Code blocks
- [ ] ` ```drawio ` block renders an SVG preview in reading mode.
- [ ] Edit button opens the editor modal.
- [ ] Saving in the editor updates the code block XML and the preview.
- [ ] Invalid XML in the block shows the error placeholder + edit button.
- [ ] Two drawio blocks in one note edit independently (correct block updates).

## Files
- [ ] "Create new drawio diagram" command creates and opens a `.drawio` file.
- [ ] Opening a `.drawio` file uses the custom view (not plain text).
- [ ] Edit → Save persists to the file; preview updates.

## Embeds
- [ ] `![[x.drawio]]` shows a preview + edit button in reading mode.
- [ ] Editing an embed saves to the underlying file.

## Settings / theming
- [ ] Switching Obsidian dark/light updates the editor theme on next open.
- [ ] "Custom URL" mode loads the editor from the configured URL.
- [ ] Server idle timeout setting persists across reloads.

## Server lifecycle
- [ ] First edit lazily starts the local server (check console).
- [ ] Editor still opens if the preferred port range start is occupied.
- [ ] After the idle timeout with no editor open, the server stops.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/MANUAL_TESTS.md
git commit -m "docs: add README and manual test checklist"
```

---

### Task 18: Full verification pass

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: all tests pass (xmlUtils, codeBlockEdit, embedMessages, svgSanitizer, portDetector, serverManager, viewerRenderer).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: no TS errors; `main.js` produced.

- [ ] **Step 3: Lint (if configured)**

Run: `npm run lint` (skip if eslint not set up)
Expected: no errors (warnings acceptable).

- [ ] **Step 4: Execute the manual checklist**

Work through `docs/MANUAL_TESTS.md` in a test vault. Fix any failures by returning to the relevant task.

- [ ] **Step 5: Final commit / tag**

```bash
git add -A
git commit -m "chore: v0.1.0 verification pass" || echo "nothing to commit"
```

---

## Self-Review Notes (for the planner)

**Spec coverage check:**
- Code block embed (§1.1) → Tasks 4, 12. ✓
- Standalone `.drawio` files (§1.2) → Task 13. ✓
- `![[file.drawio]]` embeds (§1.3) → Task 14. ✓
- Offline editor + custom URL (§1.4, §2) → Tasks 2, 8, 11, 15. ✓
- Preview/edit separation insight (§2) → Tasks 9 (viewer) vs 8/11 (server/modal). ✓
- Modal editing (§2) → Task 11. ✓
- Error handling (§6): port conflict (Task 7/8), server fail (preview still works, Task 9 independent), invalid XML (Task 9 error path), desktop-only (Task 1 manifest), XSS (Task 6). ✓
- Security (§7): 127.0.0.1 bind + path traversal (Task 8), origin check (Task 11), DOMPurify (Task 6). ✓
- Settings (§8) → Tasks 10, 15. ✓
- Testing strategy (§9) → unit tasks 3–9, manual checklist Task 17. ✓
- Build/packaging (§10) → Task 2. ✓

**Deferred spec items (§5):** file-view interaction chose option (a) preview+button (Task 13); code-block stores raw XML (Task 12 writes `xml.trim()`); no preview cache (acceptable). All consistent with the spec's stated preferences.

**Type consistency:** `DrawioSource.read()/write()` used identically in CodeBlockSource (Task 12) and FileSource (Task 13). `renderPreview(el, xml, {dark})` signature identical across Tasks 9/12/13/14. `openEditor(source)` / `resolveBaseUrl()` defined in Task 11, used in 12/13/14. `parseDrawioEvent`/`buildLoadMessage` defined Task 5, used Task 11. ✓

**Known follow-ups (not blocking v0.1.0):** compressed storage format, mobile fallback messaging, optional eslint config (the `lint` script assumes eslint is configured — set it up or drop the script before release).
