import { App, Notice, TFile, parseLinktext } from 'obsidian';
import { rewriteEmbedSubpath, type EmbedSpan } from '../model/embedLink';
import { fmt, strings } from '../i18n';

type PinOutcome = 'pinned' | 'no-match' | 'ambiguous' | 'unsupported-link' | 'error';

/**
 * Persist an embed's currently shown page into the note: rewrite the one
 * embed link that (a) resolves to `targetFile` and (b) carries the subpath
 * this embed instance was created with, so its subpath becomes `anchor`.
 *
 * `anchor` is the `pN` ordinal from {@link pageAnchor}, never the diagram's page
 * name — names are free-form text and cannot round-trip through a wikilink
 * safely, while `pN` cannot contain link syntax at all.
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
  anchor: string,
): Promise<PinOutcome> {
  const note = app.vault.getAbstractFileByPath(sourcePath);
  const cache = app.metadataCache.getCache(sourcePath);
  if (!(note instanceof TFile) || !cache?.embeds) {
    new Notice(strings().noticeNoteUnreadable);
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
      const r = rewriteEmbedSubpath(data, candidates, originalSubpath, anchor);
      if (r.outcome !== 'ok') {
        result.outcome = r.outcome;
        return data;
      }
      result.outcome = 'pinned';
      return r.text;
    });
  } catch (err) {
    new Notice(fmt(strings().noticeUpdateNoteFailed, { error: String(err) }));
    return 'error';
  }
  const outcome = result.outcome;

  if (outcome === 'pinned') {
    new Notice(fmt(strings().noticeLinkUpdated, { anchor }));
  } else if (outcome === 'no-match') {
    new Notice(strings().noticeLinkNotFound);
  } else if (outcome === 'ambiguous') {
    new Notice(strings().noticeDuplicateLinks);
  } else if (outcome === 'unsupported-link') {
    new Notice(strings().noticeMarkdownLink);
  }
  return outcome;
}
