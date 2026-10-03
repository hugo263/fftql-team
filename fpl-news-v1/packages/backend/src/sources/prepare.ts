import { allowed } from "./web-list.ts";
import type { Candidate, SourceRow } from "./types.ts";

export function noiseFiltered(c: Candidate, source: SourceRow): boolean {
  const f = source.config.ingestNoiseFilter;
  const cats: string[] = c.categories ?? [];
  if (source.config.denyCategories?.some((d: string) => cats.includes(d))) return true;
  if (source.config.allowCategories?.length && !source.config.allowCategories.some((a: string) => cats.includes(a))) return true;
  if (!f) return false;
  // Case-insensitive: the exemption "agent" keeps "Agent" (words in the lists are lower case).
  const has = (text: string, words: string[] | undefined) => (words ?? []).some((k) => text.includes(k.toLowerCase()));
  const title = c.title.toLowerCase();
  const hay = `${title}\n${(c.excerpt ?? "").toLowerCase()}`;
  if (has(hay, f.keepIfMatches)) return false;
  return has(title, f.dropMarkersTitleOnly) || has(hay, f.dropMarkers);
}

export function rewriteUrl(c: Candidate, source: SourceRow): Candidate {
  const rw = source.config.itemUrlPrefixRewrite;
  if (rw?.from && rw?.to && c.url.startsWith(rw.from)) return { ...c, url: rw.to + c.url.slice(rw.from.length) };
  return c;
}

/** The same filters and first-import window are used in tests and collection. */
export function prepareCandidates(input: Candidate[], source: SourceRow, now = Date.now()): Candidate[] {
  let items = input.filter(c => allowed(c.url, source)).map(c => rewriteUrl(c, source)).filter(c => !noiseFiltered(c, source));
  if (source.config.sortByPublishedAt) items.sort((a,b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  if (!source.cursor?.initializedAt) {
    const limit = Number(source.config._aihot?.initialBackfillLimit ?? 30);
    const cutoff = now - Number(source.config._aihot?.initialBackfillMonths ?? 12) * 30 * 86400000;
    items = items.filter(c => !c.publishedAt || c.publishedAt.getTime() >= cutoff).slice(0, limit);
  } else if (source.kind !== "x_search") items = items.slice(0,60);
  return items;
}
