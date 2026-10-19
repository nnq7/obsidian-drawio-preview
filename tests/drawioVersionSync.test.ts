import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DRAWIO_VERSION } from '../src/constants';

// The build-time fetch script (scripts/fetch-drawio.mjs) vendors the drawio
// viewer (viewer.min.txt) that ships in main.js; the pinned version must stay
// in step or the documented version drifts from the vendored bundle.
describe('drawio version pinning', () => {
  it('matches the version pinned in scripts/fetch-drawio.mjs', () => {
    const script = readFileSync('scripts/fetch-drawio.mjs', 'utf8');
    const m = script.match(/DRAWIO_VERSION = '([^']+)'/);
    expect(m?.[1]).toBe(DRAWIO_VERSION);
  });

  it('matches drawio-version.json (README badge source)', () => {
    const json = JSON.parse(readFileSync('drawio-version.json', 'utf8')) as { version: string };
    expect(json.version).toBe(DRAWIO_VERSION);
  });

  // Ordering guard for the build-time path: the checksum must be checked before
  // the script touches webapp/ or unpacks anything. Anchored on call-site tokens
  // (not log text) — if any of them is renamed, update this list with it.
  it('verifies the archive in scripts/fetch-drawio.mjs before touching webapp/', () => {
    const script = readFileSync('scripts/fetch-drawio.mjs', 'utf8');
    const verifiedAt = script.indexOf('await verifyWarChecksum(');
    const clearedAt = script.indexOf('rmSync(OUT_DIR');
    const extractedAt = script.indexOf('extractWithUnzip(war,');
    expect(verifiedAt).toBeGreaterThan(-1);
    expect(clearedAt).toBeGreaterThan(-1);
    expect(extractedAt).toBeGreaterThan(-1);
    expect(verifiedAt).toBeLessThan(clearedAt);
    expect(verifiedAt).toBeLessThan(extractedAt);
  });
});
