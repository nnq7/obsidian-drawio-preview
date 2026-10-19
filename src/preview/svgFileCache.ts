/**
 * 极简文件缓存 —— **一个文件一个 SVG，不建索引、不做预载** ✓
 *
 * 命名（用户定稿 ✓）：`<文件名>.<页码>.<CRC32>`，例如：
 *   `测试.drawio.0.a1b2c3d4`   ← 第 1 页（页码 0 起）
 *   `测试.drawio.1.a1b2c3d4`   ← 第 2 页
 *
 * 规则（用户定稿 ✓）：
 *  - 存储：**`vault.adapter`**（桌面是 Node fs、移动端是 Capacitor，同一套 API ✓）
 *  - 目录：`<configDir>/plugins/<id>/cache/`（vault 相对路径），首次写时自动创建 ✓
 *  - 容量：**15 MB** 上限，超限按 mtime 删最旧 ✓
 *  - **同一 `<文件名>.<页码>` 只保留最新 1 个** ✓（写新的时删掉旧的 CRC ✓）
 *  - 内容：`XMLSerializer` 序列化的 SVG 文本 ✓（**绝不用 innerHTML** ✗ —— 会带 HTML 实体坑）
 *  - 一切失败软失败 ✓（缓存坏了不能影响预览 ✓）
 *
 * 为什么不用 `fs`：`require('fs')` 只有桌面端存在，bundle 里出现它就等于宣告
 * `isDesktopOnly: true`；而 `vault.adapter` 两端都有实现，缓存因此可以跨平台。
 */
import type { App, DataAdapter } from 'obsidian';

/** 默认最多保留 20 个缓存文件 ✓（按个数：只需读一次目录清单就能判断是否超限） */
export const CACHE_LIMIT_FILES = 20;

/**
 * 缓存位置：**vault 相对目录** + 能访问它的 adapter。
 * adapter 拿不到（测试替身、异常环境）时由 {@link cacheStore} 返回 null，
 * 调用方随即退化成「不缓存」，**绝不影响预览本身** ✗。
 */
export interface CacheStore {
  adapter: DataAdapter;
  /** Vault 相对路径，例如 `.obsidian/plugins/<id>/cache`。 */
  dir: string;
}

/** 拿不到仓库/adapter/configDir 时返回 null ✓。全程软失败。 */
export function cacheStore(app: App | undefined, pluginId: string | undefined): CacheStore | null {
  if (!app || !pluginId) return null;
  const vault = app.vault as unknown as { adapter?: DataAdapter; configDir?: string };
  const adapter = vault?.adapter;
  const configDir = vault?.configDir;
  if (!adapter || typeof adapter.read !== 'function') return null;
  if (typeof configDir !== 'string' || !configDir) return null;
  return { adapter, dir: `${configDir}/plugins/${pluginId}/cache` };
}

/** `<文件名>.<页码>.<CRC>` ✓ */
export function cacheFileName(sourceName: string, page: number, crcHex: string): string {
  return sourceName + '.' + page + '.' + crcHex;
}

async function listCacheFiles(store: CacheStore): Promise<string[]> {
  try {
    return (await store.adapter.list(store.dir)).files;
  } catch {
    return [];
  }
}

function join(store: CacheStore, name: string): string {
  return `${store.dir}/${name}`;
}

/** `adapter.list()` hands back full vault-relative paths; only the leaf matters. */
function baseName(full: string): string {
  const cut = full.lastIndexOf('/');
  return cut === -1 ? full : full.slice(cut + 1);
}

export async function readCache(store: CacheStore | null, fileName: string): Promise<string | null> {
  if (!store) return null;
  try {
    // A truncated file parses as a `parsererror` document, so the caller's SVG
    // check already rejects it — no length heuristic needed here. (No `exists`
    // probe either: a missing file simply rejects and lands in `catch`.)
    return (await store.adapter.read(join(store, fileName))) || null;
  } catch {
    return null;
  }
}

/**
 * 写入缓存，并清理：
 *  ① 同一 `<文件名>.<页码>` 的其他 CRC（只留最新 1 个 ✓）
 *  ② 超过 `limitFiles` 个时按 mtime 删最旧 ✓
 */
export async function writeCache(
  store: CacheStore | null,
  fileName: string,
  svgText: string,
  limitFiles: number = CACHE_LIMIT_FILES,
): Promise<void> {
  if (!store || !svgText) return;
  try {
    if (!(await store.adapter.exists(store.dir))) await store.adapter.mkdir(store.dir);
    await store.adapter.write(join(store, fileName), svgText);
    // 目录只枚举一次，两个清理共用 —— 枚举在移动端是跨桥调用，不便宜。
    const files = await listCacheFiles(store);
    // ① 同名前缀（文件名.页码.）的旧 CRC
    const prefix = fileName.slice(0, fileName.lastIndexOf('.') + 1);
    await pruneSiblings(store, files, prefix, fileName);
    // ② 个数上限
    await pruneToCount(store, limitFiles, files);
  } catch {
    /* 软失败 ✓ */
  }
}

/** 删除同前缀但不同名的文件（同一 file+page 的旧版本 ✓）。 */
async function pruneSiblings(
  store: CacheStore,
  files: string[],
  prefix: string,
  keep: string,
): Promise<void> {
  for (const full of files) {
    const name = baseName(full);
    if (name === keep || !name.startsWith(prefix)) continue;
    try { await store.adapter.remove(full); } catch { /* ignore */ }
  }
}

/**
 * 按 mtime 从旧到新删，直到文件数 ≤ `limitFiles` ✓。
 *
 * 只在**超限时**才 stat：文件数直接来自目录清单，所以正常情况下一次写入的
 * 文件系统调用只有「1 次 write + 1 次 list」。旧实现按体积算，光是为了得到
 * 总量就得 stat 每一个缓存文件（730 个文件就是 730 次）。
 */
export async function pruneToCount(
  store: CacheStore | null,
  limitFiles: number = CACHE_LIMIT_FILES,
  /** Caller may pass an already-listed directory to avoid enumerating twice. */
  knownFiles?: string[],
): Promise<number> {
  if (!store) return 0;
  try {
    const files = knownFiles ?? await listCacheFiles(store);
    if (files.length <= limitFiles) return 0;
    const entries: Array<{ path: string; mtime: number }> = [];
    for (const full of files) {
      try {
        const st = await store.adapter.stat(full);
        entries.push({ path: full, mtime: st ? st.mtime : 0 });
      } catch {
        /* ignore */
      }
    }
    if (entries.length <= limitFiles) return 0;
    entries.sort((a, b) => a.mtime - b.mtime);
    let removed = 0;
    for (let i = 0; i < entries.length - limitFiles; i++) {
      try {
        await store.adapter.remove(entries[i]!.path);
        removed++;
      } catch {
        /* ignore */
      }
    }
    return removed;
  } catch {
    return 0;
  }
}
