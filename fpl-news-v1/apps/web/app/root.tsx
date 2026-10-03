import { titled } from "./lib/seo";
import { SITE } from "@aihot/industry/site";
import {
  isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData, useLocation, useNavigation, useRouteError, useRouteLoaderData,
  type ShouldRevalidateFunction,
} from "react-router";
import { useEffect, type ReactNode } from "react";
import type { Route } from "./+types/root";
import "./app.css";
import "./public-site.css";
import "../../../industry/brand/news-categories.css";
import { Sidebar } from "./components/shell/Sidebar";
import { MobileTabBar } from "./components/shell/MobileTabBar";
import { BackToTop, NavigationProgress } from "./components/shell/Chrome";
import { RingMark } from "./components/Logo";
import { buttonClass } from "./components/ui/Controls";
import { resolvedTheme, THEME_BOOT_SCRIPT } from "./lib/local-state";
import { apiGet } from "./lib/api.server";
import { useHydratedFlag } from "./lib/hydration";

export const links: Route.LinksFunction = () => [
  { rel: "apple-touch-icon", href: "/apple-icon.png" },
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "alternate", type: "application/rss+xml", title: `${SITE.name} — 精选`, href: "/feed.xml" },
];

interface SiteMeta {
  changelogVersion: string | null;
}

export async function loader({ request }: Route.LoaderArgs) {
  try {
    return await apiGet<SiteMeta>("/api/site/meta", { signal: request.signal });
  } catch {
    return { changelogVersion: null } satisfies SiteMeta;
  }
}

export const shouldRevalidate: ShouldRevalidateFunction = () => false;

export function Layout({ children }: { children: React.ReactNode }) {
  const admin = useLocation().pathname.startsWith("/admin");
  // Public tools follow fftql.team, not the old news-only saved/system appearance.
  // Keep admin preferences and stored bookmarks intact, including client-side navigation.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", admin ? resolvedTheme() : "light");
  }, [admin]);
  return (
    <html lang={SITE.locale} data-theme={admin ? undefined : "light"} data-public-site={admin ? undefined : "tql"} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {!admin && <meta name="color-scheme" content="only light" />}
        <meta name="theme-color" content={admin ? "#faf9f6" : "#0b1f17"} />
        {admin && <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />}
        <link rel="icon" href={admin ? "/admin-icon.svg" : "/favicon.ico"} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration getKey={(location) => location.key} />
        <Scripts />
      </body>
    </html>
  );
}

/** Only a page nobody matched falls back to this; every page names itself. */
export function meta({ error }: Route.MetaArgs) {
  if (!error) return [];
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return [{ title: titled(notFound ? "页面不存在" : "暂时无法加载") }, { name: "robots", content: "noindex" }];
}

/** Sidebar, main column and phone tab bar around a page (or an error). */
function SiteShell({ changelogVersion, children }: { changelogVersion: string | null; children: ReactNode }) {
  const navigation = useNavigation();
  return (
    <div className="tql-public-site">
      <NavigationProgress active={navigation.state === "loading"} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-control focus:bg-surface focus:px-3 focus:py-2">
        跳到正文
      </a>
      <header className="tql-site-header">
        <div className="tql-site-header-inner">
          <a className="tql-site-logo" href="https://fftql.team/" aria-label="TQL FPL 主站首页">
            <img src="https://fftql.team/brand/tql-badge-preview-v47.png?v=47" width="1853" height="849" alt="TQL" />
            <span>FPL<span className="tql-brand-dot">.</span></span>
          </a>
          <nav className="tql-global-nav" aria-label="站点栏目">
            <a href="https://fftql.team/" aria-current="page">FPL 资讯</a>
            <a href="https://fftql.team/draft/">Draft</a>
          </nav>
          <span className="tql-header-note">资讯工具</span>
        </div>
      </header>
      <div className="tql-tools-layout">
        <Sidebar changelogVersion={changelogVersion} />
        {/* Preserve the tool routes' reading layouts below the shared masthead. */}
        <main id="main" className="min-w-0 flex-1 pb-[calc(72px+env(safe-area-inset-bottom))] lg:px-7 lg:pb-[72px] lg:pt-6">
          <div className="mx-auto w-full max-w-[640px] px-4 lg:max-w-[var(--page-max-wide)] lg:px-0">{children}</div>
        </main>
      </div>
      <footer className="tql-tools-footer">
        <span>TQL FPL · 资讯与 Draft 联赛</span>
        <a href="https://fftql.team/">返回主站</a>
        {SITE.icp && <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{SITE.icp}</a>}
      </footer>
      <MobileTabBar changelogVersion={changelogVersion} />
      <BackToTop />
    </div>
  );
}

export default function App() {
  const meta = useLoaderData<typeof loader>();
  useHydratedFlag();
  const { pathname } = useLocation();
  // The admin has its own chrome.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return <Outlet />;
  return (
    <SiteShell changelogVersion={meta.changelogVersion}>
      <Outlet />
    </SiteShell>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const site = useRouteLoaderData<typeof loader>("root");
  const { pathname } = useLocation();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const notFound = status === 404;
  const body = (
    <div className="flex min-h-[70vh] items-center justify-center px-2 py-16">
      <div className="max-w-sm text-center">
        <RingMark className="mx-auto mb-5 size-10 text-accent" />
        <div className="mono text-[12px] text-ink-4">{status}</div>
        <h1 className="mt-1.5 text-[20px] font-bold text-ink">{notFound ? "这里没有内容" : "暂时无法加载"}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">
          {notFound ? "你访问的页面不存在，或内容已不再公开。" : "服务暂时繁忙，请稍后再试。已经加载过的内容不受影响。"}
        </p>
        <div className="mt-6 flex justify-center gap-2.5">
          <Link to="/" className={buttonClass("primary")}>
            回到精选
          </Link>
          <Link to="/all" className={buttonClass("secondary")}>
            浏览全部动态
          </Link>
        </div>
      </div>
    </div>
  );
  // Admin errors stay inside the admin's own chrome.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return body;
  return <SiteShell changelogVersion={site?.changelogVersion ?? null}>{body}</SiteShell>;
}
