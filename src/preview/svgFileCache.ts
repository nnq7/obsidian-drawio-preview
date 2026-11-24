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
 *  - 命名里的 CRC 来自**文件元数据**（`<mtime>:<size>`），不是文件内容 —— 命中缓存时因此
 *    不必把整份 drawio 读进来（见 `renderPreviewCached` 的 `stamp`）。
 *  - 生命周期：命中记进 `seen.txt`（首行是周期起始日）；启动后由 `pruneExpired` 按保留天数清理。
 *    写路径自己不删任何东西 ✓
 *  - 内容：`XMLSerializer` 序列化的 SVG 文本 ✓（**绝不用 innerHTML** ✗ —— 会带 HTML 实体坑）
 *  - 一切失败软失败 ✓（缓存坏了不能影响预览 ✓）
 *
 * 为什么不用 `fs`：`require('fs')` 只有桌面端存在，bundle 里出现它就等于宣告
 * `isDesktopOnly: true`；而 `vault.adapter` 两端都有实现，缓存因此可以跨平台。
 */
import type { App, DataAdapter } from 'obsidian';


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
    const text = await store.adapter.read(join(store, fileName));
    if (!text) return null;
    // 命中即记账：这是「热度」的唯一来源，清理时靠它决定留下谁。
    markSeen(store, fileName);
    return text;
  } catch {
    return null;
  }
}

/** 写入缓存。清理不在这里做：命中记录与周期清理各管一摊，写路径保持最轻。 */
export async function writeCache(
  store: CacheStore | null,
  fileName: string,
  svgText: string,
): Promise<void> {
  if (!store || !svgText) return;
  try {
    if (!(await store.adapter.exists(store.dir))) await store.adapter.mkdir(store.dir);
    await store.adapter.write(join(store, fileName), svgText);
  } catch {
    /* 软失败：写不进去只意味着下次还得重渲 */
  }
}

/* ---------- 热度白名单：固定 seen.txt，首行是周期起始日期 ---------- */

/**
 * 名单文件（**固定名，不带日期**）：
 *   第 1 行   周期起始日期 `YYYY-MM-DD`
 *   第 2 行起 每个被读过的缓存文件名，一行一个
 *
 * 固定名换来三件事：命中时不必先 `list` 找最新名单、不必 `rename` 换日期、
 * `append` 时也不必知道今天是几号 —— 日期就在首行里。
 */
const SEEN_FILE = 'seen.txt';
/** 命中聚合后多久落盘一次：一批渲染会连续命中很多次，逐次写盘既慢又浪费。 */
const SEEN_FLUSH_MS = 5000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function stampOf(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStamp(): string { return stampOf(new Date()); }

function seenPath(store: CacheStore): string { return join(store, SEEN_FILE); }

/** 周期起始日 → 距今天数；解析不了返回 Infinity（当作早已过期）。 */
function daysSince(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return Infinity;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86400000);
}

/**
 * 读名单。文件不存在、为空、或首行不是合法日期 → `null`（调用方据此跳过清理）。
 * 首行坏了就整轮不动：宁可多留几天缓存，也不要拿一份不可信的名单去删文件。
 */
export async function readSeen(
  store: CacheStore | null,
): Promise<{ day: string; names: Set<string>; lineCount: number } | null> {
  if (!store) return null;
  try {
    const text = await store.adapter.read(seenPath(store));
    if (!text) return null;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const day = lines[0] ?? '';
    if (!DAY_RE.test(day)) return null;
    // lineCount 是「body 行数」（不含日期行）：调用方靠它判断有没有重复行，
    // 这样就不必为了数行数再把整个文件读一遍。
    return { day, names: new Set(lines.slice(1)), lineCount: lines.length - 1 };
  } catch {
    return null;
  }
}

/** 整份覆盖写（首次创建 / 去重压缩 / 周期重置）。写坏最多退化成「无名单」，不会误删。 */
async function writeSeen(
  store: CacheStore, day: string, names: Set<string>,
): Promise<void> {
  try {
    if (!(await store.adapter.exists(store.dir))) await store.adapter.mkdir(store.dir);
    const body = [day, ...names].join('\n') + '\n';
    await store.adapter.write(seenPath(store), body);
  } catch {
    /* 软失败：名单写不进去只影响下次清理的宽严 */
  }
}

/* 命中聚合：先攒内存，5 秒后一次性落盘。 */
const pendingSeen = new Set<string>();
// window.setTimeout 在浏览器返回 number、Node 返回 Timeout；这里只需能传给 clearTimeout。
let seenTimer: ReturnType<typeof setTimeout> | null = null;
let seenStore: CacheStore | null = null;

/** 记一笔命中（不立刻写盘）。 */
export function markSeen(store: CacheStore | null, name: string): void {
  if (!store || !name) return;
  seenStore = store;
  pendingSeen.add(name);
  if (seenTimer !== null) return;
  seenTimer = window.setTimeout(() => {
    seenTimer = null;
    const s = seenStore;
    if (s) void flushSeen(s);
  }, SEEN_FLUSH_MS) as unknown as ReturnType<typeof setTimeout>;
}

/**
 * 落盘。已有名单就只 `append` 新条目（几十字节）；没有才整份写一次（首行放日期）。
 * 重复行无害：`readSeen` 用 `Set` 收，且启动时的去重会压掉。
 */
export async function flushSeen(store: CacheStore | null): Promise<void> {
  const target = store ?? seenStore;
  if (!target || !pendingSeen.size) return;
  const fresh = [...pendingSeen];
  pendingSeen.clear();
  if (seenTimer !== null) { window.clearTimeout(seenTimer); seenTimer = null; }
  try {
    if (await readSeen(target)) {
      await target.adapter.append(seenPath(target), fresh.join('\n') + '\n');
    } else {
      await writeSeen(target, todayStamp(), new Set(fresh));
    }
  } catch {
    /* 软失败 */
  }
}

/** 仅测试用：丢弃聚合状态。 */
export function __resetSeenForTests(): void {
  pendingSeen.clear();
  if (seenTimer !== null) { window.clearTimeout(seenTimer); seenTimer = null; }
  seenStore = null;
}

/**
 * 周期维护（启动后一次）：
 *   ① 先把待写命中落盘；
 *   ② 去重（行数多于去重后的条目就重写一份，首行日期不变）；
 *   ③ 周期起点距今不足 N 天 → 到此为止；
 *   ④ 到期：删掉不在名单里的缓存，再把名单重写成「今天 + 空」。
 */
export async function pruneExpired(
  store: CacheStore | null,
  days: number,
): Promise<number> {
  if (!store) return 0;
  try {
    await flushSeen(store);
    const seen = await readSeen(store);
    // 没有名单（首次安装 / 上一轮刚重置 / 首行损坏）⇒ 什么都不做。
    if (!seen) return 0;

    // ② 去重：只有真出现重复行才重写，避免每次都写盘。行数由 readSeen 一并带回。
    if (seen.lineCount > seen.names.size) await writeSeen(store, seen.day, seen.names);

    // ③ 未到期。
    if (daysSince(seen.day) < days) return 0;

    // ④ 到期：清理 + 重置。
    const files = await listCacheFiles(store);
    let removed = 0;
    for (const full of files) {
      const name = baseName(full);
      if (name === SEEN_FILE || name.endsWith('.tmp')) continue;
      if (seen.names.has(name)) continue;
      try { await store.adapter.remove(full); removed++; } catch { /* ignore */ }
    }
    await writeSeen(store, todayStamp(), new Set());
    return removed;
  } catch {
    return 0;
  }
}
