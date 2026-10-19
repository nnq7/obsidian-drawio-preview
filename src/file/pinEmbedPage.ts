import { App, Notice, TFile, parseLinktext } from 'obsidian';
import { rewriteEmbedSubpath, type EmbedSpan } from '../model/embedLink';

export type PinOutcome = 'pinned' | 'no-match' | 'ambiguous' | 'unsupported-link' | 'error';

/**
 * Persist an embed's currently shown page into the note: rewrite the one
 * embed link that (a) resolves to `targetFile` and (b) carries the subpath
 * this embed instance was created with, so its subpath names `pageName`.
 *
 * Never guesses: zero or multiple matching links leave the note untouched.
 * All user feedback (Notices) happens here; callers react to the outcome
 * only to update their own state.
 */
export async function pinEmbedPage(
  app: App,
  sourcePath: string,
  targetFile: TFile,
  originalSubpath: string | undefined,
  pageName: string,
): Promise<PinOutcome> {
  // A page name with link syntax in it can't round-trip through a wikilink.
  if (/[#|[\]]/.test(pageName)) {
    new Notice(`Drawio: 页面名称「${pageName}」无法用于链接（包含 #、| 或方括号）。`);
    return 'error';
  }
  const note = app.vault.getAbstractFileByPath(sourcePath);
  const cache = app.metadataCache.getCache(sourcePath);
  if (!(note instanceof TFile) || !cache?.embeds) {
    new Notice('Drawio: 无法读取嵌入所在的笔记 —— 页面未固定。');
    return 'error';
  }

  const candidates: EmbedSpan[] = [];
  for (const e of cache.embeds) {
    const { path, subpath } = parseLinktext(e.link);
    const dest = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (dest?.path !== targetFile.path) continue;
    candidates.push({
      original: e.original,
      start: e.position.start.offset,
      end: e.position.end.offset,
      path,
      subpath: subpath || undefined,
    });
  }

  // Assigned inside the process callback; boxed so TS's control-flow
  // narrowing (which ignores closure assignments) tracks the union type.
  const result: { outcome: PinOutcome } = { outcome: 'error' };
  try {
    await app.vault.process(note, (data) => {
      const r = rewriteEmbedSubpath(data, candidates, originalSubpath, pageName);
      if (r.outcome !== 'ok') {
        result.outcome = r.outcome;
        return data;
      }
      result.outcome = 'pinned';
      return r.text;
    });
  } catch (err) {
    new Notice(`Drawio: 更新笔记失败 —— ${String(err)}`);
    return 'error';
  }
  const outcome = result.outcome;

  if (outcome === 'pinned') {
    new Notice(`Drawio: 链接已更新至页面「${pageName}」。`);
  } else if (outcome === 'no-match') {
    new Notice('Drawio: 在笔记中找不到该嵌入的链接 —— 页面未固定。');
  } else if (outcome === 'ambiguous') {
    new Notice('Drawio: 有多条指向此文件且页面相同的链接 —— 请手动修改笔记中的子路径。');
  } else if (outcome === 'unsupported-link') {
    new Notice('Drawio: 该嵌入使用的是 Markdown 风格链接 —— 请手动修改笔记中的页面。');
  }
  return outcome;
}
