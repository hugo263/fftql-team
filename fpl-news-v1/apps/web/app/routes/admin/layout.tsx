import { FEATURES } from "@aihot/industry/features";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigation, type ShouldRevalidateFunction } from "react-router";
import type { Route } from "./+types/layout";
import { NavigationProgress } from "../../components/shell/Chrome";
import type { AdminMe } from "../../features/admin/action";
import { Toaster } from "../../features/admin/toast";
import { adminGet } from "../../lib/admin.server";
import "../../features/admin/admin.css";
import "../../features/admin/workspace.css";

type Counts = Partial<Record<"feedback" | "sources" | "runs" | "monitor", number>>;
export async function loader({ request }: Route.LoaderArgs) {
  const [me, counts] = await Promise.all([adminGet<AdminMe>(request, "/api/admin/me"), adminGet<Counts>(request, "/api/admin/nav-counts").catch(() => ({}) as Counts)]);
  return { me, counts, mainAdminUrl: process.env.TQL_MAIN_ADMIN_URL || "https://fftql.team/admin" };
}
export const shouldRevalidate: ShouldRevalidateFunction = () => true;
export const meta: Route.MetaFunction = () => [{ title: "TQL 管理后台" }, { name: "robots", content: "noindex, nofollow" }];
export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
const NAV: Array<{ group: string; items: Array<{ to: string; label: string; icon: string; count?: keyof Counts }> }> = [
  { group: "日常运营", items: [
    { to: "/admin", label: "总览", icon: "▣" },
    { to: "/admin/content", label: "资讯内容", icon: "▤" },
    { to: "/admin/sources", label: "信源管理器", icon: "⇄", count: "sources" },
    { to: "/admin/feedback", label: "反馈", icon: "✉", count: "feedback" },
  ] },
  { group: "系统管理", items: [
    { to: "/admin/runs", label: "运行与异常", icon: "↻", count: "runs" },
    { to: "/admin/models", label: "模型与评测", icon: "◈" },
    { to: "/admin/selectbench", label: "SelectBench", icon: "⚖" },
    { to: "/admin/settings", label: "设置与预算", icon: "⚙" },
    { to: "/admin/audit", label: "审计记录", icon: "≡" },
    ...(FEATURES.codexResetMonitor ? [{ to: "/admin/monitor", label: "Codex 重置", icon: "◷", count: "monitor" as const }] : []),
  ] },
  { group: "说明", items: [
    { to: "/admin/source-directory", label: "数据来源", icon: "?" },
    { to: "/admin/agent", label: "Agent 接入", icon: "⌁" },
    { to: "/admin/about", label: "关于", icon: "i" },
  ] },
];
export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { me, counts, mainAdminUrl } = loaderData;
  const navigation = useNavigation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState("");
  const menu = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const current = [...NAV.flatMap(g => g.items)].reverse().find(i => i.to === location.pathname || (i.to !== "/admin" && location.pathname.startsWith(i.to + "/")));
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }));
    tick(); const timer = setInterval(tick, 60_000); return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); menu.current?.focus(); }
      if (e.key === "Tab") {
        const nodes = sidebar.current?.querySelectorAll<HTMLElement>("a,button");
        if (!nodes?.length) return;
        if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes[nodes.length - 1]?.focus(); }
        else if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) { e.preventDefault(); nodes[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", key); if(sidebar.current?.contains(document.activeElement))menu.current?.focus(); };
  }, [open]);
  const preserveFeedback = location.pathname === "/admin/feedback" || location.pathname.startsWith("/admin/feedback/");
  return <div className={`admin-shell ${preserveFeedback ? "" : "tql-workspace"}`}>
    <NavigationProgress active={navigation.state === "loading"} />
    <a href="#admin-main" className="admin-skip">跳到正文</a>
    {open && <button className="admin-shade" aria-label="点击遮罩关闭导航" onClick={() => { setOpen(false); menu.current?.focus(); }} />}
    <aside ref={sidebar} id="admin-navigation" className={`admin-side ${open ? "is-open" : ""}`} aria-label="管理后台导航">
      <button className="admin-menu-close" aria-label="关闭导航菜单" onClick={() => { setOpen(false); menu.current?.focus(); }}>×</button>
      <a href="/admin" className="admin-brand"><span className="admin-mark">TQL.</span><span><strong>TQL 管理后台</strong><small>{preserveFeedback ? "Admin Console" : "TEAM WORKSPACE"}</small></span></a>
      {preserveFeedback ? <nav aria-label="后台模块" className="admin-modules"><a href="https://fftql.team/admin">Draft 数据</a><NavLink to="/admin" aria-current="page" className="on">资讯管理</NavLink></nav> : <nav aria-label="后台模块" className="admin-modules"><p className="admin-nav-group">内容运营</p><a href={`${mainAdminUrl}/xhs`}><span className="admin-nav-icon" aria-hidden="true">▤</span>小红书内容</a><NavLink to="/admin/content" className="on"><span className="admin-nav-icon" aria-hidden="true">▧</span>FPL 资讯管理</NavLink><a href={`${mainAdminUrl}/xhs#calendar`}><span className="admin-nav-icon" aria-hidden="true">▦</span>发布日历</a><p className="admin-nav-group">资源管理</p><a href={`${mainAdminUrl}/xhs#accounts`}><span className="admin-nav-icon" aria-hidden="true">♙</span>账号与通道</a><a href={`${mainAdminUrl}/xhs#assets`}><span className="admin-nav-icon" aria-hidden="true">▧</span>素材库</a><p className="admin-nav-group">数据洞察</p><a href={mainAdminUrl}><span className="admin-nav-icon" aria-hidden="true">▥</span>Draft 数据总览</a></nav>}
      <nav className="admin-side-nav">{NAV.map(g => <div key={g.group}><p className="admin-nav-group">{g.group}</p>{g.items.map(i => <NavLink key={i.to} to={i.to} end={i.to === "/admin"} prefetch="intent" className={({ isActive }) => `admin-nav-link ${isActive ? "on" : ""}`}><span className="admin-nav-icon" aria-hidden="true">{i.icon}</span><span>{i.label}</span>{!!(i.count && counts[i.count]) && <span className={`admin-nav-count ${i.count !== "feedback" ? "alert" : ""}`}>{counts[i.count!]}</span>}</NavLink>)}</div>)}</nav>
      <div className="admin-side-foot">{preserveFeedback ? <>北京时间展示 · no-store / noindex<br />密钥与模型调用只在后端</> : <><div className="workspace-note"><strong>让每一篇内容，有序发布</strong><small>创作 → 确认 → 排期 → 复盘</small></div><div className="workspace-profile"><span className="admin-avatar">{me.name.slice(0,1).toUpperCase()}</span><div>{me.name}<small>TQL 工作空间</small></div></div></>}{me.dev && <div className="mt-2 text-amber">开发环境 · 采集和付费调用关闭</div>}</div>
    </aside>
    <div className="admin-workspace">
      <header className="admin-topbar"><button ref={menu} className="admin-menu" aria-label="打开导航菜单" aria-expanded={open} aria-controls="admin-navigation" onClick={() => setOpen(true)}>☰</button><span className="admin-crumb">资讯管理 / <b>{current?.label ?? "总览"}</b></span><span className="admin-clock">北京 {clock || "—"}</span><a href="/" className="admin-front-link">查看前台 ↗</a><span className="admin-identity"><span className="admin-avatar">{me.name.slice(0, 1).toUpperCase()}</span><span className="admin-name">{me.name}</span></span><form method="post" action="/api/auth/logout"><button className="admin-logout" type="submit">退出</button></form></header>
      <main id="admin-main" className="admin-main"><Outlet /></main>
    </div><Toaster />
  </div>;
}
