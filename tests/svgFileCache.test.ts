/**
 * crc32 + svgFileCache 的测试：CRC 用**标准向量**校验 ✓；缓存跑**内存版 DataAdapter** ✓。
 *
 * 缓存已从 `fs` 换成 `vault.adapter`，所以这里的替身和移动端走的是同一条代码路径，
 * 只是底下换成 Map —— 任何一个适配器方法缺失或抛错都会立刻在这里暴露。
 */
import { describe, it, expect, vi } from 'vitest';
import type { DataAdapter } from 'obsidian';

import { crc32, crc32Hex } from '../src/preview/crc32';
import {
  cacheFileName, cacheStore, readCache, writeCache, pruneToCount, CACHE_LIMIT_FILES,
  type CacheStore,
} from '../src/preview/svgFileCache';

/** In-memory `DataAdapter`: mtime increases with every write, which is what
 *  {@link pruneToLimit} orders by. */
function memoryStore(dir = '.obsidian/plugins/drawio-preview/cache') {
  const files = new Map<string, { data: string; mtime: number }>();
  let clock = 1000;
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => {
      const f = files.get(p);
      if (!f) throw new Error('ENOENT ' + p);
      return f.data;
    },
    write: async (p: string, data: string) => { files.set(p, { data, mtime: clock++ }); },
    mkdir: async () => {},
    remove: async (p: string) => { files.delete(p); },
    stat: async (p: string) => {
      const f = files.get(p);
      return f ? { type: 'file', ctime: f.mtime, mtime: f.mtime, size: f.data.length } : null;
    },
    list: async (d: string) => ({
      files: [...files.keys()].filter((k) => k.startsWith(d + '/')),
      folders: [],
    }),
  } as unknown as DataAdapter;
  return { store: { adapter, dir } as CacheStore, files };
}

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

describe('cacheStore', () => {
  it('resolves a vault-relative directory and the adapter', () => {
    const adapter = memoryStore().store.adapter;
    const store = cacheStore(
      { vault: { adapter, configDir: '.obsidian' } } as never,
      'drawio-preview',
    );
    expect(store).not.toBeNull();
    expect(store!.dir).toBe('.obsidian/plugins/drawio-preview/cache');
  });

  it('returns null instead of throwing when anything is missing', () => {
    expect(cacheStore(undefined, 'x')).toBeNull();
    expect(cacheStore({ vault: {} } as never, 'x')).toBeNull();
    expect(cacheStore({ vault: { adapter: {} } } as never, 'x')).toBeNull();
    const adapter = memoryStore().store.adapter;
    expect(cacheStore({ vault: { adapter } } as never, 'x')).toBeNull(); // 无 configDir
    expect(cacheStore({ vault: { adapter, configDir: '' } } as never, 'x')).toBeNull();
  });
});

describe('svgFileCache 命名与读写（内存 adapter ✓）', () => {
  it('文件名 = <文件名>.<页码>.<CRC>', () => {
    expect(cacheFileName('测试.drawio', 1, 'a1b2c3d4')).toBe('测试.drawio.1.a1b2c3d4');
    expect(cacheFileName('test.drawio', 0, 'deadbeef')).toBe('test.drawio.0.deadbeef');
  });

  it('写入后可读回；不同页码/不同 CRC 互不影响', async () => {
    const { store } = memoryStore();
    const svg0 = '<svg xmlns="http://www.w3.org/2000/svg"><text>P0</text></svg>';
    const svg1 = '<svg xmlns="http://www.w3.org/2000/svg"><text>P1</text></svg>';
    await writeCache(store, cacheFileName('a.drawio', 0, '11111111'), svg0);
    await writeCache(store, cacheFileName('a.drawio', 1, '11111111'), svg1);
    expect(await readCache(store, cacheFileName('a.drawio', 0, '11111111'))).toBe(svg0);
    expect(await readCache(store, cacheFileName('a.drawio', 1, '11111111'))).toBe(svg1);
    expect(await readCache(store, cacheFileName('a.drawio', 2, '11111111'))).toBeNull();
    expect(await readCache(store, cacheFileName('a.drawio', 0, '22222222'))).toBeNull();
  });

  it('同一 file+page 只保留最新 1 个（旧 CRC 被删 ✓）', async () => {
    const { store, files } = memoryStore();
    await writeCache(store, cacheFileName('b.drawio', 0, 'aaaaaaaa'), '<svg>A</svg>');
    await writeCache(store, cacheFileName('b.drawio', 0, 'bbbbbbbb'), '<svg>B</svg>');
    const names = [...files.keys()]
      .map((k) => k.slice(k.lastIndexOf('/') + 1))
      .filter((n) => n.startsWith('b.drawio.0.'));
    expect(names).toEqual(['b.drawio.0.bbbbbbbb']);
    expect(await readCache(store, cacheFileName('b.drawio', 0, 'aaaaaaaa'))).toBeNull();
  });

  it('缺文件 / 没有 store 时返回 null（软失败 ✓）', async () => {
    expect(await readCache(memoryStore().store, 'nope.0.00000000')).toBeNull();
    expect(await readCache(null, 'x')).toBeNull();
  });

  it('pruneToCount 按 mtime 删最旧，恢复到个数上限内', async () => {
    const { store, files } = memoryStore();
    const chunk = 'x'.repeat(100);
    for (let i = 0; i < 6; i++) await store.adapter.write(`${store.dir}/f${i}`, chunk);
    const removed = await pruneToCount(store, 4); // 只允许留 4 个 ✓
    expect(removed).toBe(2);
    const left = [...files.keys()].map((k) => k.slice(k.lastIndexOf('/') + 1));
    expect(left.length).toBe(4);
    expect(left).not.toContain('f0'); // 最旧的先删 ✓
    expect(left).toContain('f5'); // 最新的保留 ✓
  });

  it('未超限时一次 stat 都不做（换成按个数的主要收益）', async () => {
    const { store } = memoryStore();
    const stat = vi.spyOn(store.adapter, 'stat');
    await writeCache(store, cacheFileName('c.drawio', 0, '11111111'), '<svg/>');
    expect(stat).not.toHaveBeenCalled();
  });

  it('默认上限是 20 个文件', () => {
    expect(CACHE_LIMIT_FILES).toBe(20);
  });
});
