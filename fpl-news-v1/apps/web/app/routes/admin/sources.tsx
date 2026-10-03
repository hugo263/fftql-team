import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import { Form, Link, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/sources";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { SourceRuntimeCard, SourceTestPanel, SourceWorkflow, type SourceRuntime, type SourceTestResult } from "../../features/admin/source-tools";
import { num } from "../../features/admin/format";
import { HEALTH_LABEL, KIND_LABEL, MODE_LABEL, sourceHealthLabel } from "../../features/admin/labels";
import { AdminPage, Badge, Button, ButtonLink, Card, DataTable, Dot, FilterChips, healthTone, Input, Pager, Select, Stat, Time } from "../../features/admin/ui";

interface SourceRow {
  id: string;
  name: string;
  kind: string;
  tier: string;
  participation_mode: string;
  enabled: boolean;
  health: string;
  fail_count: number;
  interval_minutes: number;
  last_ok_at: string | null;
  last_fetch_at: string | null;
  last_error: string | null;
  first_party: boolean;
  next_fetch_at: string | null;
  items_7d: number;
  selected_30d: number;
}

interface SourcesData {
  runtime: SourceRuntime;
  page: number;
  rows: SourceRow[];
  totals: { total: number; enabled: number; failing: number; degraded: number; issues?: number };
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return adminGet<SourcesData>(request, `/api/admin/sources${url.search}`);
}

export const meta: Route.MetaFunction = () => [{ title: `信源管理器 · ${SITE.name} 后台` }];

export default function Sources({ loaderData }: Route.ComponentProps) {
  const { rows, totals, page, runtime } = loaderData;
  const { run, pending } = useAdminAction();
  const [test, setTest] = useState<{name:string; result:SourceTestResult}|null>(null);
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  return (
    <AdminPage
      title="信源管理器"
      subtitle="手动添加、测试解析、查看提取数据和运行记录。失败的信源优先显示。"
      actions={<><ButtonLink to="/admin/sources/help">添加方法</ButtonLink><ButtonLink to="/admin/sources/new" tone="primary">添加信源</ButtonLink></>}
    >
      <SourceRuntimeCard runtime={runtime}/>
      {test && <div className="mb-5"><p className="mb-2 text-[13px] text-ink-2">{test.name}</p><SourceTestPanel result={test.result}/></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="全部" value={num(totals.total)} />
        <Stat label="启用" value={num(totals.enabled)} />
        <Stat label="采集异常" value={num(totals.issues??totals.failing)} tone={(totals.issues??totals.failing) ? "bad" : "ok"} />
        <Stat label="不稳定" value={num(totals.degraded)} tone={totals.degraded ? "warn" : undefined} />
      </div>
      <Card pad={false}>
        <div className="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between">
          <Form method="get" className="flex w-full max-w-md gap-2" preventScrollReset>
            {["kind", "health", "mode", "enabled"].map((k) => sp.get(k) && <input key={k} type="hidden" name={k} value={sp.get(k)!} />)}
            <Input name="q" defaultValue={sp.get("q") ?? ""} placeholder="名称、ID 或地址" aria-label="搜索信源" />
          </Form>
          <div className="flex flex-wrap items-center gap-3">
            <FilterChips param="health" options={[{ value: "", label: "全部" }, { value: "failing", label: "失败" }, { value: "degraded", label: "不稳定" }, { value: "paused", label: "暂停状态" }]} />
            <Select aria-label="启停" className="!w-auto" value={sp.get("enabled")??""} onChange={e=>{const next=new URLSearchParams(sp);e.target.value?next.set("enabled",e.target.value):next.delete("enabled");next.delete("page");navigate(`?${next}`,{preventScrollReset:true});}}><option value="">全部启停</option><option value="true">已启用</option><option value="false">已暂停</option></Select>
            <Select aria-label="参与方式" className="!w-auto" value={sp.get("mode")??""} onChange={e=>{const next=new URLSearchParams(sp);e.target.value?next.set("mode",e.target.value):next.delete("mode");next.delete("page");navigate(`?${next}`,{preventScrollReset:true});}}><option value="">全部参与方式</option>{Object.entries(MODE_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</Select>
            <Select
              aria-label="类型"
              className="!w-auto"
              value={sp.get("kind") ?? ""}
              onChange={(e) => {
                const next = new URLSearchParams(sp);
                if (e.target.value) next.set("kind", e.target.value);
                else next.delete("kind");
                next.delete("page");
                navigate(`?${next}`, { preventScrollReset: true });
              }}
            >
              <option value="">全部类型</option>
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>
        </div>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/admin/sources/${encodeURIComponent(r.id)}`)}
          columns={[
            {
              key: "name",
              label: "信源",
              render: (r) => (
                <div className="min-w-[220px]">
                  <Link to={`/admin/sources/${encodeURIComponent(r.id)}`} className="font-medium text-ink hover:text-accent" onClick={(e) => e.stopPropagation()}>
                    {r.name}
                  </Link>
                  <div className="font-mono text-[11.5px] text-ink-4">{r.id}</div>
                  {r.health !== "ok" && r.last_error && <div className="mt-1 line-clamp-1 text-[12px] text-hot">{r.last_error}</div>}
                </div>
              ),
            },
            { key: "kind", label: "类型", render: (r) => <Badge>{KIND_LABEL[r.kind] ?? r.kind}</Badge> },
            {
              key: "mode",
              label: "参与",
              render: (r) => (
                <div className="flex gap-1">
                  <Badge tone={r.participation_mode === "editorial" ? "accent" : r.participation_mode === "isolated" ? "violet" : "muted"}>{MODE_LABEL[r.participation_mode] ?? r.participation_mode}</Badge>
                  <Badge tone="info">{r.tier.replace("_", ".")}</Badge>
                  {r.first_party && <Badge tone="ok">一手</Badge>}
                </div>
              ),
            },
            {
              key: "health",
              label: "健康",
              render: (r) => (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <Dot tone={r.enabled && (r.kind!=='x_search' || runtime.xCollectionEnabled) ? healthTone(r.health) : "muted"} />
                  {r.id === "fpl-official-prices" ? "系统任务" : sourceHealthLabel(r.health,r.enabled,r.last_error)}
                  {r.fail_count > 0 && <span className="num text-[11.5px] text-ink-4">×{r.fail_count}</span>}
                </span>
              ),
            },
            {key:"enabled",label:"启用",render:r=><Badge tone={r.id==="fpl-official-prices"||r.enabled?"ok":"muted"}>{r.id==="fpl-official-prices"?"系统任务":r.enabled?"已启用":"已暂停"}</Badge>},
            { key: "ok", label: "上次成功", render: (r) => <Time at={r.last_ok_at} /> },
            { key: "interval", label: "频率", align: "right", render: (r) => r.id === "fpl-official-prices" ? "10 分" : `${r.interval_minutes} 分` },
            { key: "items", label: "7 天条目", align: "right", render: (r) => num(r.items_7d) },
            {key:"actions",label:"操作",render:r=><div className="flex gap-2 whitespace-nowrap" onClick={e=>e.stopPropagation()}>
              <Button disabled={!!pending || (r.kind==='x_search' && !runtime.xCollectionEnabled)} busy={pending===`test-${r.id}`} onClick={async()=>{const result=await run<SourceTestResult>("POST",`/api/admin/sources/${encodeURIComponent(r.id)}/preview`,{},{label:`test-${r.id}`,revalidate:false});if(result)setTest({name:r.name,result});}}>测试</Button>
              <ButtonLink to={`/admin/sources/${encodeURIComponent(r.id)}`}>数据与运行</ButtonLink>
            </div>},
            { key: "sel", label: "30 天精选", align: "right", render: (r) => num(r.selected_30d) },
          ]}
        />
      </Card>
      <Pager page={page} hasMore={rows.length === 100} />
      <div className="mt-5"><SourceWorkflow/></div>
    </AdminPage>
  );
}
