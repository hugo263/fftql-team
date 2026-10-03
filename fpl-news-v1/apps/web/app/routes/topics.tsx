import { Link, useLoaderData } from "react-router";
import type { CSSProperties } from "react";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { TopicArtwork, topicAccent } from "../components/TopicArtwork";
import "../features/topics.css";

interface TopicSummary {
  slug: string;
  name: string;
  group: "company" | "field" | "genre";
  definition: string;
  total: number;
  recent: number;
  indexable: boolean;
  latestAt: string | null;
}

export async function loader({ request }: { request: Request }) {
  return apiGet<{ topics: TopicSummary[] }>("/api/site/topics", { signal: request.signal });
}

export function meta() {
  return pageMeta({ title: "主题索引", description: "按球队、Classic 与 Draft 玩法及消息分类浏览 FPL 资讯。", path: "/topics", image: "/og/pages/topics.png" });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" };
}

const GROUPS = [
  { key: "company", name: "球队", blurb: "按球队追踪球员与阵容资讯" },
  { key: "field", name: "玩法", blurb: "区分 Classic 与 Draft" },
  { key: "genre", name: "消息分类", blurb: "按决策需要查找消息" },
] as const;

export default function TopicsPage() {
  const { topics } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <header className="pb-2 pt-5 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">FPL 主题索引</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          按球队、玩法和消息分类浏览 <span className="num">{topics.length}</span> 个主题，持续汇集近期焦点与精选。
        </p>
      </header>
      {GROUPS.map((g) => (
        <section key={g.key} aria-labelledby={`topics-${g.key}`} className="pt-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 id={`topics-${g.key}`} className="text-[15px] font-bold text-ink">
              {g.name}
            </h2>
            <p className="text-[12px] text-ink-4">{g.blurb}</p>
          </div>
          <ul className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {topics
              .filter((t) => t.group === g.key)
              .map((t) => (
                <li key={t.slug}>
                  <Link
                    to={`/topics/${t.slug}`}
                    prefetch="intent"
                    aria-label={`查看${t.name}相关精选文章`}
                    className="card card-hover topic-card group flex h-full flex-col"
                    style={{ "--topic-accent": topicAccent(t.slug, t.group) } as CSSProperties}
                  >
                    <TopicArtwork slug={t.slug} group={t.group} />
                    <span className="topic-card-copy">
                      <span className="topic-card-title text-[15px] font-bold text-ink transition-colors group-hover:text-accent">{t.name}</span>
                      <span className="mt-1.5 line-clamp-2 flex-1 text-[12.5px] leading-[1.7] text-ink-3">{t.definition}</span>
                      <span className="mono mt-3 text-[11.5px] text-accent">
                        查看 {t.total} 条精选 <span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
