import type { FplPriceResponse } from "@aihot/contracts/fpl";
import { Link } from "react-router";
import { SITE, withSubject } from "@aihot/industry/site";
import { data as withHeaders, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { TimelineResponse } from "@aihot/contracts/site";
import { isCategoryKey, isChannelKey } from "@aihot/contracts/taxonomy";
import { loadOr404, queryString, releaseBoundCache } from "../lib/api.server";
import { listPath, organizationLd, pageMeta } from "../lib/seo";
import { Wordmark } from "../components/Logo";
import { Timeline } from "../features/feed/Timeline";
import { HotTopics } from "../features/feed/HotTopics";
import { CategoryTabs, SearchField, SearchIconLink } from "../features/feed/Filters";
import { beijingDate, beijingWeekday } from "../lib/format";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const channelParam = url.searchParams.get("channel") ?? "all";
  const categoryParam = url.searchParams.get("category");
  const channel = isChannelKey(channelParam) ? channelParam : "all";
  const category = categoryParam && isCategoryKey(categoryParam) ? categoryParam : null;
  const tag = url.searchParams.get("tag")?.trim() || null;
  const upstream = new Headers();
  const [data,fpl] = await Promise.all([
    loadOr404<TimelineResponse>(`/api/site/timeline${queryString({ channel: channel === "all" ? null : channel, category, tag })}`, { responseHeaders: upstream, signal: request.signal }),
    loadOr404<FplPriceResponse>("/api/site/fpl/prices", {signal:request.signal}),
  ]);
  return withHeaders({ data, fpl, filters: { channel, category, tag, topic: null } }, { headers: releaseBoundCache(data.refreshAt, 60, Date.now(), upstream) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  const f = loaderData?.filters;
  const path = listPath("/", { channel: f && f.channel !== "all" ? f.channel : null, category: f?.category, tag: f?.tag });
  return pageMeta({ path, jsonLd: path === "/" ? organizationLd() : undefined });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

function TodayLabel() {
  const today = beijingDate(Date.now());
  const [, m, d] = today.split("-").map(Number) as [number, number, number];
  return (
    <span className="text-[12.5px] text-ink-4" suppressHydrationWarning>
      {m}月{d}日 · {beijingWeekday(today).replace("星期", "周")}
    </span>
  );
}

export default function Home() {
  const { data, fpl, filters } = useLoaderData<typeof loader>();
  const title = filters.tag ? `#${filters.tag}` : "精选";
  return (
    <div className="pb-6">
      <div className="tql-hero tql-home-hero"><span className="tql-kicker">TQL NEWSROOM · FANTASY PREMIER LEAGUE</span><h1>为下一轮，掌握每条变化。</h1><p>伤停、首发、赛程、选人与价格变化。在这里看懂，再回到你的球队。</p><div className="tql-hero-meta"><Link to="/all?tag=Classic">Classic 资讯 →</Link><Link to="/all?tag=Draft">Draft 资讯 →</Link><a href="https://fftql.team">TQL 联赛中心 ↗</a></div></div>
      <div className="tql-price-strip"><div><span className="tql-kicker">CLASSIC · 官方现价</span><strong>价格观察</strong></div><p>{fpl.changes.length?`${fpl.changes[0]!.name} ${fpl.changes[0]!.newCost>fpl.changes[0]!.oldCost?"涨价":"跌价"}至 £${fpl.changes[0]!.newCost.toFixed(1)}m` : fpl.checkedAt?`${fpl.playersTotal} 位球员 · 已建立价格基准，持续追踪涨跌`:"正在读取官方价格"}</p><Link to="/prices">查看价格 →</Link></div>
      {/* Phones: brand bar, today's hot topics, then the feed under "最新精选". */}
      <div className="flex h-14 items-center justify-between lg:hidden">
        <Wordmark size={20} className="text-ink" />
        <TodayLabel />
      </div>
      <div className="hidden lg:block">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">{title}</h1>
        <div className="mb-5 mt-4 flex items-center justify-between gap-4">
          <CategoryTabs base="/" category={filters.category} channel={filters.channel} layoutId="home-cat-desk" className="min-w-0" />
          <SearchField variant="track" keep={{ category: filters.category }} />
        </div>
      </div>

      {data.hot && <HotTopics entries={data.hot} />}

      <h2 className="mt-6 text-[20px] font-bold text-ink lg:hidden">{filters.tag ? title : "最新精选"}</h2>
      <div className="-mx-4 mt-3 flex items-center gap-2 pl-4 pr-2 lg:hidden">
        <CategoryTabs base="/" category={filters.category} channel={filters.channel} layoutId="home-cat-mobile" size="sm" className="min-w-0 flex-1" />
        <SearchIconLink />
      </div>

      <Timeline initial={data} filters={data.filters} />
    </div>
  );
}
