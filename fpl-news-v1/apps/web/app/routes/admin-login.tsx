// Admin sign-in: the admin password (ADMIN_PASSWORD), and Feishu when it is configured. The form posts
// straight to the API, which sets the session cookie and sends the browser on.
import { useLoaderData } from "react-router";
import type { Route } from "./+types/admin-login";
import "../features/admin/admin.css";
import "../features/admin/workspace.css";
import { SITE } from "@aihot/industry/site";
import { apiGet } from "../lib/api.server";
import { buttonClass } from "../components/ui/Controls";

const ERRORS: Record<string, string> = {
  "sso-expired": "登录凭据已失效，请从 TQL 管理后台重新进入。",
  wrong: "密码不对，再试一次。",
  unset: "还没有设置管理员密码：在 .env 里设置 ADMIN_PASSWORD（至少 12 位），重启后再登录。",
  "too-many": "尝试次数太多，请 15 分钟后再试。",
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("return") ?? "/admin";
  const options = await apiGet<{ password: boolean; feishu: boolean; draftSso?: boolean }>("/api/auth/options", { signal: request.signal }).catch(() => ({ password: true, feishu: false, draftSso: false }));
  return { returnTo: returnTo.startsWith("/admin") ? returnTo : "/admin", error: url.searchParams.get("error"), ...options, mainAdminUrl: process.env.TQL_MAIN_ADMIN_URL || "https://fftql.team/admin" };
}

export const meta: Route.MetaFunction = () => [{ title: `登录 · ${SITE.name} 后台` }, { name: "robots", content: "noindex, nofollow" }];

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });

export default function AdminLogin() {
  const { returnTo, error, password, feishu, draftSso, mainAdminUrl } = useLoaderData<typeof loader>();
  const message = error ? (ERRORS[error] ?? ERRORS.wrong) : !password && !draftSso ? ERRORS.unset : null;
  return (
    <div className="admin-login tql-workspace flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[360px]">
        <a className="admin-brand" href={mainAdminUrl}><span className="admin-mark">TQL.</span><span><strong>TQL 管理后台</strong><small>TEAM WORKSPACE</small></span></a><h1 className="text-[25px] font-semibold text-ink">欢迎回到内容工作空间</h1><p className="mt-3 text-[12px] text-ink-3">聚合、核验与编辑，让每条资讯都有据可查。</p>
        {draftSso && <div className="card mt-8 p-6">
          <h2 className="text-[18px] font-semibold text-ink">资讯管理</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-3">与 Draft 数据共用管理员登录。</p>
          {message && <p role="alert" className="mt-3 text-[12px] text-hot">{message}</p>}
          <a href={`${mainAdminUrl}/news`} className={`${buttonClass("primary", "lg")} mt-5 w-full`}>使用 TQL 管理后台登录</a>
          <a href={mainAdminUrl} className="mt-4 block text-center text-[12px] text-ink-3">前往 Draft 数据</a>
        </div>}
        {!draftSso && <form method="post" action="/api/auth/password" className="card mt-8 p-6">
          <input type="hidden" name="return" value={returnTo} />
          <label htmlFor="password" className="block text-[13px] font-medium text-ink-2">
            管理员密码
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            className="mt-2 h-10 w-full rounded-full border border-line-strong bg-surface px-4 text-[14px] text-ink outline-none transition-colors focus:border-accent"
          />
          {message && (
            <p role="alert" className="mt-3 text-[12.5px] leading-relaxed text-hot">
              {message}
            </p>
          )}
          <button type="submit" className={`${buttonClass("primary", "lg")} mt-5 w-full`}>
            登录
          </button>
          {feishu && (
            <a href={`/api/auth/feishu?${new URLSearchParams({ return: returnTo })}`} className={`${buttonClass("secondary", "lg")} mt-3 w-full`}>
              用飞书登录
            </a>
          )}
        </form>}
        <p className="mt-6 text-center text-[12px] text-ink-4">
          <a href="/" className="hover:text-ink-2">
            回到 {SITE.name}
          </a>
        </p>
      </div>
    </div>
  );
}
