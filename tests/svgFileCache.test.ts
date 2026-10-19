/**
 * crc32 + svgFileCache 的测试：CRC 用**标准向量**校验 ✓；文件缓存跑**真实 fs 临时目录** ✓。
 * 桌面端环境用 mock 打开（`Platform.isDesktopApp` + `window.require`）✓。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('obsidian', () => ({ Platform: { isDesktopApp: true } }));

import { crc32, crc32Hex } from '../src/preview/crc32';
import { cacheFileName, readCache, writeCache, pruneToLimit, CACHE_LIMIT_BYTES } from '../src/preview/svgFileCache';

let tmp = '';
let dir = '';

beforeAll(async () => {
  (window as unknown as { require: (m: string) => unknown }).require = (m: string) => {
    if (m === 'fs') return { promises: fsPromises };
    if (m === 'path') return path;
    throw new Error('unexpected module ' + m);
  };
  tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'drawio-filecache-'));
  dir = path.join(tmp, 'cache');
});
afterAll(async () => {
  try { await fsPromises.rm(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  delete (window as unknown as { require?: unknown }).require;
});

describe('crc32（标准向量 ✓）', () => {
  it('matches zlib reference values', () => {
    expect(crc32('')).toBe(0);
    expect(crc32('123456789')).toBe(0xcbf43926);
    expect(crc32('a')).toBe(0xe8b7be43);
    expect(crc32Hex('123456789')).toBe('cbf43926');
  });
  it('UTF-8 based: Chinese changes the value', () => {
    expect(crc32('测试')).not.toBe(crc32('测试1'));
    expect(crc32('测试')).toBe(crc32('测试')); // 稳定 ✓
  });
});

describe('svgFileCache 命名与读写（真实 fs ✓）', () => {
  it('文件名 = <文件名>.<页码>.<CRC>', () => {
    expect(cacheFileName('测试.drawio', 1, 'a1b2c3d4')).toBe('测试.drawio.1.a1b2c3d4');
    expect(cacheFileName('test.drawio', 0, 'deadbeef')).toBe('test.drawio.0.deadbeef');
  });

  it('写入后可读回；不同页码/不同 CRC 互不影响', async () => {
    const svg0 = '<svg xmlns="http://www.w3.org/2000/svg"><text>P0</text></svg>';
    const svg1 = '<svg xmlns="http://www.w3.org/2000/svg"><text>P1</text></svg>';
    await writeCache(dir, cacheFileName('a.drawio', 0, '11111111'), svg0);
    await writeCache(dir, cacheFileName('a.drawio', 1, '11111111'), svg1);
    expect(await readCache(dir, cacheFileName('a.drawio', 0, '11111111'))).toBe(svg0);
    expect(await readCache(dir, cacheFileName('a.drawio', 1, '11111111'))).toBe(svg1);
    expect(await readCache(dir, cacheFileName('a.drawio', 2, '11111111'))).toBeNull();
    expect(await readCache(dir, cacheFileName('a.drawio', 0, '22222222'))).toBeNull();
  });

  it('同一 file+page 只保留最新 1 个（旧 CRC 被删 ✓）', async () => {
    await writeCache(dir, cacheFileName('b.drawio', 0, 'aaaaaaaa'), '<svg>A</svg>');
    await writeCache(dir, cacheFileName('b.drawio', 0, 'bbbbbbbb'), '<svg>B</svg>');
    const names = (await fsPromises.readdir(dir)).filter((n) => n.startsWith('b.drawio.0.'));
    expect(names).toEqual(['b.drawio.0.bbbbbbbb']);
    expect(await readCache(dir, cacheFileName('b.drawio', 0, 'aaaaaaaa'))).toBeNull();
  });

  it('缺文件返回 null（软失败 ✓）', async () => {
    expect(await readCache(dir, 'nope.0.00000000')).toBeNull();
    expect(await readCache(null, 'x')).toBeNull();
  });

  it('pruneToLimit 按 mtime 删最旧，恢复到上限内', async () => {
    const big = path.join(tmp, 'prune');
    await fsPromises.mkdir(big, { recursive: true });
    const chunk = 'x'.repeat(4096);
    for (let i = 0; i < 6; i++) {
      const p = path.join(big, 'f' + i);
      await fsPromises.writeFile(p, chunk, 'utf8');
      const t = new Date(Date.now() - (100 - i) * 1000);
      await fsPromises.utimes(p, t, t); // 越靠前越旧 ✓
    }
    const total = 6 * 4096;
    const removed = await pruneToLimit(big, total - 2 * 4096); // 只允许留 4 个 ✓
    expect(removed).toBeGreaterThanOrEqual(2);
    const left = await fsPromises.readdir(big);
    expect(left.length).toBeLessThanOrEqual(4);
    expect(left).not.toContain('f0'); // 最旧的先删 ✓
    expect(left).toContain('f5'); // 最新的保留 ✓
  });

  it('默认上限是 15 MB', () => {
    expect(CACHE_LIMIT_BYTES).toBe(15 * 1024 * 1024);
  });
});
