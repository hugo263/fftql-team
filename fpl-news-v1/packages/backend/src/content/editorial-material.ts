// Source-aware removal of article chrome for editorial use. Never fetches member-only content.
import * as cheerio from "cheerio";
import { stripTags } from "../lib/text.ts";

export const PUBLIC_EXCERPT_MARKER = "【资料范围：公开部分，后续为会员内容】";
export const PUBLIC_EXCERPT_TAG = "公开部分摘要";
export const isScout = (url: string) => {
  try { return /(^|\.)fantasyfootballscout\.co\.uk$/i.test(new URL(url).hostname); } catch { return false; }
};

export function hasMemberBoundary(html: string, url: string): boolean {
  return isScout(url) && /This content is restricted to (?:Chief Scout |Premium )?Members|This article is (?:for|restricted to) members/i.test(stripTags(html));
}

/** Only explicit source chrome is removed; data tables, quotes and mixed prose/link paragraphs stay. */
export function editorialHtml(html: string, url: string): string {
  if (!isScout(url)) return html;
  const $ = cheerio.load(html, null, false);
  $("h2,h3,h4").each((_, el) => {
    const heading = $(el);
    if (!/^(?:USE THE SCOUT TOOLKIT|JOIN (?:THE )?SCOUT|SUBSCRIBE (?:TO|FOR) .+)$/i.test(heading.text().trim())) return;
    heading.nextUntil("h2,h3,h4").remove();
    heading.remove();
  });
  $("ul,ol").each((_, el) => {
    const list = $(el), links = list.find("a");
    const linkedText = links.toArray().map(a => $(a).text()).join("").replace(/\s/g, "");
    if (links.length > 0 && linkedText === list.text().replace(/\s/g, "")) list.remove();
  });
  $("p").each((_, el) => {
    const p = $(el), text = p.text().trim();
    if (/^(?:READ MORE:|Share:|Subscribe to become|Remember, you can get full Chief Scout access)/i.test(text)) p.remove();
  });
  $("figure").each((_, el) => {
    if ($(el).find('a[href*="bit.ly/FFScoutEditorial"],a[href*="/pricing"]').length) $(el).remove();
  });
  return $.html();
}

export function editorialText(input: { url: string; bodyHtml?: string | null; bodyText?: string | null }): string | null {
  if (!input.bodyHtml || !isScout(input.url)) return input.bodyText ?? null;
  return stripTags(editorialHtml(input.bodyHtml, input.url));
}
