/**
 * 极简文件缓存 —— **一个文件一个 SVG，不建索引、不做预载** ✓
 *
 * 命名（用户定稿 ✓）：`<文件名>.<页码>.<CRC32>`，例如：
 *   `测试.drawio.0.a1b2c3d4`   ← 第 1 页（页码 0 起）
 *   `测试.drawio.1.a1b2c3d4`   ← 第 2 页
 *
 * 规则（用户定稿 ✓）：
 *  - 目录：`<vault>/<configDir>/plugins/<id>/cache/`，首次写时自动创建 ✓
 *  - 容量：**15 MB** 上限，超限按 mtime 删最旧 ✓
 *  - **同一 `<文件名>.<页码>` 只保留最新 1 个** ✓（写新的时删掉旧的 CRC ✓）
 *  - 内容：`XMLSerializer` 序列化的 SVG 文本 ✓（**绝不用 innerHTML** ✗ —— 会带 HTML 实体坑）
 *  - **仅桌面端** ✓；移动端所有调用返回 null / 直接返回 ✓（不报错、不写盘 ✓）
 *  - 一切失败软失败 ✓（缓存坏了不能影响预览 ✓）
 */
import { Platform } from 'obsidian';
import type { App } from 'obsidian';

/** 15 MB ✓ */
export const CACHE_LIMIT_BYTES = 15 * 1024 * 1024;

interface NodeFs {
  promises: {
    mkdir(p: string, o?: { recursive?: boolean }): Promise<unknown>;
    readdir(p: string): Promise<string[]>;
    readFile(p: string, enc: string): Promise<string>;
    writeFile(p: string, d: string, enc: string): Promise<void>;
    unlink(p: string): Promise<void>;
    stat(p: string): Promise<{ size: number; mtimeMs: number }>;
  };
}
interface NodePath {
  join(...p: string[]): string;
}

function nodeMods(): { fs: NodeFs; path: NodePath } | null {
  if (!Platform.isDesktopApp) return null;
  const req = (window as unknown as { require?: (m: string) => unknown }).require;
  if (!req) return null;
  try {
    return { fs: req('fs') as NodeFs, path: req('path') as NodePath };
  } catch {
    return null;
  }
}

/**
 * 缓存目录绝对路径；非桌面端、无 fs、或拿不到仓库根路径时返回 null ✓。
 *
 * 全程软失败：缓存只是加速，任何环境差异（测试替身、非标准 adapter）都必须
 * 退化成「不缓存」，**绝不能让预览本身报错** ✗。
 */
export function cacheDir(app: App | undefined, pluginId: string | undefined): string | null {
  const mods = nodeMods();
  if (!mods || !app || !pluginId) return null;
  const vault = app.vault as unknown as { adapter?: { getBasePath?: () => string } };
  const adapter = vault?.adapter;
  if (typeof adapter?.getBasePath !== 'function') return null;
  try {
    const base = adapter.getBasePath();
    return base ? mods.path.join(base, app.vault.configDir, 'plugins', pluginId, 'cache') : null;
  } catch {
    return null;
  }
}

/** `<文件名>.<页码>.<CRC>` ✓ */
export function cacheFileName(sourceName: string, page: number, crcHex: string): string {
  return sourceName + '.' + page + '.' + crcHex;
}

export async function readCache(dir: string | null, fileName: string): Promise<string | null> {
  if (!dir) return null;
  const mods = nodeMods();
  if (!mods) return null;
  try {
    // A truncated file parses as a `parsererror` document, so the caller's SVG
    // check already rejects it — no length heuristic needed here.
    return (await mods.fs.promises.readFile(mods.path.join(dir, fileName), 'utf8')) || null;
  } catch {
    return null;
  }
}

/**
 * 写入缓存，并清理：
 *  ① 同一 `<文件名>.<页码>` 的其他 CRC（只留最新 1 个 ✓）
 *  ② 超出 `limitBytes` 时按 mtime 删最旧 ✓
 */
export async function writeCache(
  dir: string | null,
  fileName: string,
  svgText: string,
  limitBytes: number = CACHE_LIMIT_BYTES,
): Promise<void> {
  if (!dir || !svgText) return;
  const mods = nodeMods();
  if (!mods) return;
  const { fs, path } = mods;
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, fileName), svgText, 'utf8');
    // ① 同名前缀（文件名.页码.）的旧 CRC
    const prefix = fileName.slice(0, fileName.lastIndexOf('.') + 1);
    await pruneMatching(dir, prefix, fileName);
    // ② 容量上限
    await pruneToLimit(dir, limitBytes);
  } catch {
    /* 软失败 ✓ */
  }
}

/** 删除同前缀但不同名的文件（同一 file+page 的旧版本 ✓）。 */
async function pruneMatching(dir: string, prefix: string, keep: string): Promise<void> {
  const mods = nodeMods();
  if (!mods) return;
  try {
    const names = await mods.fs.promises.readdir(dir);
    for (const n of names) {
      if (n === keep) continue;
      if (!n.startsWith(prefix)) continue;
      try { await mods.fs.promises.unlink(mods.path.join(dir, n)); } catch { /* ignore */ }
    }
  } catch {
    /* ignore */
  }
}

/** 按 mtime 从旧到新删，直到总量 ≤ 上限 ✓。 */
export async function pruneToLimit(
  dir: string | null,
  limitBytes: number = CACHE_LIMIT_BYTES,
): Promise<number> {
  if (!dir) return 0;
  const mods = nodeMods();
  if (!mods) return 0;
  const { fs, path } = mods;
  try {
    const names = await fs.promises.readdir(dir);
    const entries: Array<{ name: string; size: number; mtimeMs: number }> = [];
    let total = 0;
    for (const n of names) {
      try {
        const st = await fs.promises.stat(path.join(dir, n));
        entries.push({ name: n, size: st.size, mtimeMs: st.mtimeMs });
        total += st.size;
      } catch {
        /* ignore */
      }
    }
    if (total <= limitBytes) return 0;
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let removed = 0;
    for (const e of entries) {
      if (total <= limitBytes) break;
      try {
        await fs.promises.unlink(path.join(dir, e.name));
        total -= e.size;
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
