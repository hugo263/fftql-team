import { useState, type ReactNode } from "react";
import { IconChart, IconDoc, IconTrendUp, IconUsers } from "./icons";

// Stable FPL team.code values from the site's existing 2026/27 club catalog,
// not season-specific team.id values. Match Centre uses the same official assets.
const CLUBS: Record<string, { code: number; color: string }> = {
  ars: { code: 3, color: "#bb2438" }, avl: { code: 7, color: "#79364c" },
  bou: { code: 91, color: "#a6202c" }, bre: { code: 94, color: "#bd2e36" },
  bha: { code: 36, color: "#2871af" }, che: { code: 8, color: "#275da7" },
  cov: { code: 9, color: "#5699b9" }, cry: { code: 31, color: "#4163a5" },
  eve: { code: 11, color: "#326399" }, ful: { code: 54, color: "#263c36" },
  hul: { code: 88, color: "#b78525" }, ips: { code: 40, color: "#396cb0" },
  lee: { code: 2, color: "#a78928" }, liv: { code: 14, color: "#b92938" },
  mci: { code: 43, color: "#67a6bd" }, mun: { code: 1, color: "#b62b37" },
  new: { code: 4, color: "#39423f" }, nfo: { code: 17, color: "#b43831" },
  tot: { code: 6, color: "#344760" }, sun: { code: 56, color: "#bd3b3c" },
};
const TONES: Record<string, string> = {
  classic: "#8b742d", draft: "#286a4b", prices: "#176344", injuries: "#A22F42",
  lineups: "#285D96", fixtures: "#7D5715", transfers: "#804098", players: "#086B72",
  teams: "#485899", news: "#4B6275", strategy: "#9B4A1F", rules: "#8D4668",
};
export const topicAccent = (slug: string, group: string) =>
  (group === "company" ? CLUBS[slug]?.color : TONES[slug]) ?? "#286a4b";

function Drawing({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}

function TopicSymbol({ slug }: { slug: string }) {
  switch (slug) {
    case "classic": return <Drawing><path d="M15 7h18v10a9 9 0 0 1-18 0V7ZM15 10H8v5a8 8 0 0 0 9 8m16-13h7v5a8 8 0 0 1-9 8M24 26v9m-8 5h16m-13-5h10l3 5H16z" /><path d="m24 11 1.6 3.2 3.5.5-2.6 2.5.7 3.5-3.2-1.7-3.2 1.7.7-3.5-2.6-2.5 3.5-.5z" /></Drawing>;
    case "draft": return <Drawing><circle cx="15" cy="16" r="5" /><circle cx="33" cy="32" r="5" /><path d="M6 30v-3a9 9 0 0 1 14-7m22-2v3a9 9 0 0 1-14 7M27 8h11l-3-3m3 3-3 3M21 40H10l3-3m-3 3 3 3" /></Drawing>;
    case "prices": return <IconTrendUp size={88} strokeWidth={1.2} />;
    case "injuries": return <Drawing><rect x="7" y="13" width="34" height="27" rx="5" /><path d="M17 13V9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M24 21v11m-5.5-5.5h11" /></Drawing>;
    case "lineups": return <Drawing><rect x="9" y="5" width="30" height="38" rx="3" /><path d="M9 24h30M19 5v7h10V5m-10 38v-7h10v7" /><circle cx="24" cy="24" r="5" /><circle cx="16" cy="18" r="1.5" /><circle cx="32" cy="30" r="1.5" /></Drawing>;
    case "fixtures": return <Drawing><rect x="7" y="10" width="34" height="31" rx="5" /><path d="M16 6v8m16-8v8M7 20h34m-25 8h2m7 0h2m7 0h1m-19 7h2m7 0h2" /></Drawing>;
    case "transfers": return <Drawing><path d="M7 16h32l-8-8m8 8-8 8M41 32H9l8-8m-8 8 8 8" /></Drawing>;
    case "players": return <Drawing><path d="m17 7-10 6 5 10 5-3v21h14V20l5 3 5-10-10-6a7 7 0 0 1-14 0Z" /><path d="M21 21h6m-3 0v12" /></Drawing>;
    case "teams": return <IconChart size={88} strokeWidth={1.2} />;
    case "news": return <Drawing><rect x="6" y="8" width="30" height="32" rx="3" /><path d="M36 17h6v20a3 3 0 0 1-3 3H24M12 15h18m-18 18h18m-8-11h8m-8 5h8" /><rect x="12" y="22" width="6" height="6" rx="1" /></Drawing>;
    case "strategy": return <Drawing><circle cx="12" cy="35" r="4" /><circle cx="35" cy="13" r="4" /><path d="M14 26V15a5 5 0 0 1 5-5h5m-5-5 5 5-5 5M24 33h14m-5-5 5 5-5 5M7 8l5 5m0-5-5 5M25 22l5 5m0-5-5 5" /></Drawing>;
    case "rules": return <IconDoc size={88} strokeWidth={1.2} />;
    default: return <IconUsers size={88} strokeWidth={1.2} />;
  }
}

/** Decorative only: no extra announcement, tab stop or interaction over the card link. */
export function TopicArtwork({ slug, group }: { slug: string; group: string }) {
  const [failed, setFailed] = useState(false);
  const club = group === "company" ? CLUBS[slug] : undefined;
  return (
    <span className={`topic-card-art${club ? " topic-card-art--club" : ""}`} aria-hidden="true">
      {club ? failed ? <span className="topic-card-monogram">{slug.toUpperCase()}</span> : (
        <img src={`https://resources.premierleague.com/premierleague/badges/70/t${club.code}.png`}
          alt="" width="88" height="88" loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onError={() => setFailed(true)} />
      ) : <TopicSymbol slug={slug} />}
    </span>
  );
}
