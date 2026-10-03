import { CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import { SITE } from "@aihot/industry/site";
import { useEffect, useState } from "react";
import { Link, useRevalidator, useBlocker, useBeforeUnload } from "react-router";
import type { Route } from "./+types/source";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { SourceConfigEditor, SourceTestPanel, SourceRuntimeCard, type SourceRuntime, type SourceTestResult } from "../../features/admin/source-tools";
import { bj, duration, num } from "../../features/admin/format";
import { sourceHealthLabel, HEALTH_LABEL, KIND_LABEL, MODE_LABEL, TIER_LABEL, VISIBILITY_LABEL, CONTENT_STATE_LABEL } from "../../features/admin/labels";
import { AdminPage, Badge, Button, Card, DataTable, Dot, Empty, Field, healthTone, Input, Json, KV, ReasonDialog, Select, Stat, Textarea, Time } from "../../features/admin/ui";

interface Source {
  id: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  tags: string[];
  first_party: boolean;
  owner_entity_id: string | null;
  tier: string;
  participation_mode: string;
  signal_group_id: string | null;
  interval_minutes: number;
  site_fulltext: boolean;
  syndicate_fulltext: boolean;
  enabled: boolean;
  health: string;
  fail_count: number;
  last_fetch_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  cursor: Record<string, unknown> | null;
  next_fetch_at: string | null;
  created_at: string;
  updated_at: string;
}

/** X runs: pages read, and older stretches still to read (backlog) or given up (dropped). */
interface RunDetail {
  pages?: number;
  backlog?: number;
  dropped?: number;
}

interface Detail {
  runtime: SourceRuntime;
  tests: Array<{id:number;created_at:string;matchesSavedConfig:boolean;result:SourceTestResult}>;
  jobs: Array<{id:string;state:string;created_on:string;started_on:string|null;completed_on:string|null;output:string|null}>;
  source: Source;
  runs: Array<{ id: number; started_at: string; finished_at: string | null; status: string; found_count: number | null; new_count: number | null; error: string | null; detail: RunDetail | null }>;
  items: Array<{ id: string; title: string; url: string; discovered_at: string; published_at: string | null; processing_state: string; selected: boolean | null; visibility: string | null; title_zh: string | null; author:string|null; language:string|null; excerpt:string|null; body_text:string|null; body_status:string; media_count:number; category:string|null; publication_tags:string[]|null; summary_zh:string|null }>;
  stats: { total: number; last7d: number; selected: number };
  history: Array<{ created_at: string; actor: string; action: string; reason: string | null; before: unknown; after: unknown }>;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return adminGet<Detail>(request, `/api/admin/sources/${encodeURIComponent(params.id)}`);
}

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.source.name ?? "信源"} · ${SITE.name} 后台` }];

type Draft = Pick<Source, "name" | "interval_minutes" | "tier" | "participation_mode" | "signal_group_id" | "first_party" | "owner_entity_id" | "site_fulltext" | "syndicate_fulltext"> & { tags: string; config: string };

function draftOf(s: Source): Draft {
  return {
    name: s.name,
    interval_minutes: s.interval_minutes,
    tier: s.tier,
    participation_mode: s.participation_mode,
    signal_group_id: s.signal_group_id,
    first_party: s.first_party,
    owner_entity_id: s.owner_entity_id,
    site_fulltext: s.site_fulltext,
    syndicate_fulltext: s.syndicate_fulltext,
    tags: s.tags.join(", "),
    config: JSON.stringify(s.config, null, 2),
  };
}

export default function SourceDetail({ loaderData }: Route.ComponentProps) {
  const { source: s, runs, items, stats, history, runtime, tests, jobs } = loaderData;
  const { run, pending } = useAdminAction();
  const [draft, setDraft] = useState<Draft>(() => draftOf(s));
  const [draftFor, setDraftFor] = useState(s.updated_at);
  const [editVersion, setEditVersion] = useState(s.updated_at);
  const [savedSettings,setSavedSettings] = useState(()=>JSON.stringify(draftOf(s)));
  const [preview, setPreview] = useState<SourceTestResult | null>(null);
  const [testedConfig,setTestedConfig] = useState<string|null>(null);
  const [watch,setWatch] = useState<string|null>(null);
  const revalidator = useRevalidator();
  const [tab, setTab] = useState("config");
  const systemSource = s.id === "fpl-official-prices";
  useEffect(()=>{
    if(!watch) return;
    const job=jobs.find(j=>j.id===watch);
    if(job && !["created","active","retry"].includes(job.state)) {setWatch(null);return;}
    const timer=setInterval(()=>revalidator.revalidate(),3000);
    return ()=>clearInterval(timer);
  },[watch,jobs,revalidator]);
  const [dialog, setDialog] = useState<null | "save" | "toggle">(null);
  const [configError, setConfigError] = useState<string | null>(null);
  if (draftFor !== s.updated_at) {
    // A collection cursor update must not discard unsaved settings while task polling refreshes.
    const nextSaved=JSON.stringify(draftOf(s));
    const locallyChanged=JSON.stringify(draft)!==savedSettings;
    if(nextSaved===savedSettings || !locallyChanged){
      setEditVersion(s.updated_at);
      if(nextSaved!==savedSettings){setDraft(draftOf(s));setSavedSettings(nextSaved);setPreview(null);}
    }
    setDraftFor(s.updated_at);
  }
  const base = `/api/admin/sources/${encodeURIComponent(s.id)}`;

  const patch = (): Record<string, unknown> | null => {
    let config: unknown;
    try {
      config = JSON.parse(draft.config);
      setConfigError(null);
    } catch (e) {
      setConfigError(`配置不是合法 JSON：${(e as Error).message}`);
      return null;
    }
    const next: Record<string, unknown> = {
      ...draft,
      tags: draft.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      config,
      interval_minutes: Number(draft.interval_minutes),
      signal_group_id: draft.signal_group_id || null,
      owner_entity_id: draft.owner_entity_id || null,
    };
    const before = draftOf(s) as Record<string, unknown>;
    const changed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) {
      const was = k === "tags" ? s.tags : k === "config" ? s.config : before[k];
      if (JSON.stringify(v) !== JSON.stringify(was)) changed[k] = v;
    }
    return changed;
  };
  const changes = (() => {
    try {
      return Object.keys(patchPreview(draft, s)).length;
    } catch {
      return 1;
    }
  })();

  const blocker = useBlocker(({currentLocation, nextLocation}) => changes > 0 && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => { if (blocker.state === "blocked") { if (window.confirm("有未保存的信源设置。离开会放弃这些改动，确认离开？")) blocker.proceed(); else blocker.reset(); } }, [blocker]);
  useBeforeUnload(e => { if (changes > 0) { e.preventDefault(); e.returnValue = ""; } });

  return (
    <AdminPage
      title={
        <span className="flex flex-wrap items-center gap-2">
          {s.name}
          <Badge>{KIND_LABEL[s.kind] ?? s.kind}</Badge>
          <Badge tone={s.participation_mode === "editorial" ? "accent" : s.participation_mode === "isolated" ? "violet" : "muted"}>{MODE_LABEL[s.participation_mode]}</Badge>
        </span>
      }
      subtitle={<span className="font-mono text-[12px]">{s.id}</span>}
      actions={
        <>
          <Button
            busy={pending === "preview"}
            onClick={async () => {
              if(!patch()) return;
              const r = await run<SourceTestResult>("POST", `${base}/preview`, {config:JSON.parse(draft.config),version:new Date(editVersion).toISOString()}, { label: "preview" });
              if (r) {setPreview(r);setTestedConfig(draft.config);setTab("test");}
            }}
          >
            测试提取
          </Button>
          {!systemSource && s.kind!=="external" && <>
          <Button disabled={!!pending || changes>0 || !runtime.collectEnabled || !runtime.workerAlive} busy={pending === "fetch"} onClick={async()=>{
            const result=await run<{jobId:string|null;status:string;message:string}>("POST",`${base}/fetch`,{},{label:"fetch",success:"已提交采集，请查看任务和提取数据"});
            if(result?.jobId){setWatch(result.jobId);setTab("runs");}
          }}>立即采集</Button>
          <Button tone={s.enabled ? "danger" : "primary"} disabled={!!pending || changes>0} onClick={() => setDialog("toggle")}>
            {s.enabled ? "暂停自动采集" : "启用自动采集"}
          </Button></>}
          <Button onClick={()=>revalidator.revalidate()} disabled={revalidator.state==='loading'}>刷新状态</Button>
          <Link className="text-[13px] text-accent" to="/admin/sources/help">添加方法</Link>
        </>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="健康"
          value={
            <span className="inline-flex items-center gap-2 text-[18px]">
              <Dot tone={s.enabled ? healthTone(s.health) : "muted"} />
              {systemSource ? "独立系统任务" : sourceHealthLabel(s.health,s.enabled,s.last_error)}
            </span>
          }
          hint={s.fail_count ? `连续失败 ${s.fail_count} 次` : `上次成功 ${s.last_ok_at ? bj(s.last_ok_at) : "—"}`}
        />
        <Stat label="累计条目" value={num(stats.total)} />
        <Stat label="近 7 天" value={num(stats.last7d)} />
        <Stat label="入选精选" value={num(stats.selected)} />
      </div>
      {s.last_error && s.health !== "ok" && <div className="mb-5 rounded-card bg-hot-soft px-4 py-3 text-[13px] text-hot ring-1 ring-hot/20">{s.last_error}</div>}

      <div role="tablist" aria-label="信源详情" className="admin-tabs" onKeyDown={e=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;e.preventDefault();const keys=["config","test","data","runs","history"];let i=keys.indexOf(tab);i=e.key==="Home"?0:e.key==="End"?4:(i+(e.key==="ArrowRight"?1:-1)+5)%5;setTab(keys[i]!);e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[i]?.focus();}}>{[["config","配置"],["test","测试"],["data",`提取数据 · ${items.length}`],["runs","运行记录"],["history","修改历史"]].map(([key,label]) => <button type="button" role="tab" tabIndex={tab===key?0:-1} key={key} id={`source-tab-${key}`} aria-controls={`source-panel-${key}`} aria-selected={tab===key} onClick={() => setTab(key!)}>{label}</button>)}</div>
      <div className={tab==="config"?"":"hidden"}><SourceRuntimeCard runtime={runtime} showX={s.kind==="x_search"}/></div>
      {systemSource && <Card className="mb-5" title="官方价格系统任务"><p className="text-[13px] text-ink-2">每 10 分钟读取官方价格并与上一观测比较。独立于通用信源开关，首次建立基线不产生涨跌；测试只检查当前接口，不改观测记录。<Link className="ml-2 text-accent" to="/prices">查看球员与涨跌</Link></p></Card>}
      {JSON.stringify(draftOf(s))!==savedSettings && changes>0 && <p role="alert" className="mb-3 rounded-card bg-amber-soft p-3 text-[13px] text-amber">已保存配置在别处发生变化。你的表单改动已保留；先还原并重新编辑当前版本，避免覆盖其他改动。</p>}
      {changes>0 && <p className="mb-4 text-[13px] text-amber">有未保存设置。测试使用当前表单，正式采集前请先保存。</p>}
      <div role="tabpanel" id="source-panel-test" aria-labelledby="source-tab-test" className={tab==="test"?"mb-5":"hidden"}><SourceTestPanel result={preview ?? (tests[0]?{...tests[0].result,matchesSavedConfig:tests[0].matchesSavedConfig}:null)} stale={!!preview && draft.config!==testedConfig}/></div>

      <div className="contents">
        <div className="contents">
          <div role="tabpanel" id="source-panel-config" aria-labelledby="source-tab-config" className={tab==="config"?"":"hidden"}><Card title="设置" right={<span>编辑版本 {bj(editVersion, true)}</span>}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="名称">
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="采集间隔（分钟）">
                <Input type="number" min={1} max={1440} value={draft.interval_minutes} onChange={(e) => setDraft({ ...draft, interval_minutes: Number(e.target.value) })} />
              </Field>
              <Field label="参与方式" hint="氛围只作热点讨论证据，不单独成为内容">
                <Select value={draft.participation_mode} onChange={(e) => setDraft({ ...draft, participation_mode: e.target.value })}>
                  {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="等级">
                <Select value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })}>
                  {Object.entries(TIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="讨论分组 ID" hint="同一机构的多个账号共用，热度只算一次">
                <Input value={draft.signal_group_id ?? ""} onChange={(e) => setDraft({ ...draft, signal_group_id: e.target.value })} />
              </Field>
              <Field label="运营主体 ID">
                <Input value={draft.owner_entity_id ?? ""} onChange={(e) => setDraft({ ...draft, owner_entity_id: e.target.value })} />
              </Field>
              <Field label="标签（逗号分隔）">
                <Input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
              </Field>
              <div className="flex flex-col justify-end gap-2 text-[13px] text-ink-2">
                {([
                  ["first_party", "一手信源（官方账号或官网）"],
                  ["site_fulltext", "站内可展示全文"],
                  ["syndicate_fulltext", "对外接口可带全文"],
                ] as const).map(([k, label]) => (
                  <label key={k} className="inline-flex items-center gap-2">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <SourceConfigEditor kind={s.kind} value={draft.config} onChange={value=>setDraft({...draft,config:value})}/>
              {configError && <div className="mt-1 text-[12.5px] text-hot">{configError}</div>}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              {changes > 0 && <span className="text-[12.5px] text-ink-3">{changes} 项改动未保存</span>}
              <Button tone="ghost" disabled={!changes} onClick={() => {setDraft(draftOf(s));setSavedSettings(JSON.stringify(draftOf(s)));setEditVersion(s.updated_at);}}>还原</Button>
              <Button tone="primary" disabled={!changes} onClick={() => patch() && setDialog("save")}>保存</Button>
            </div>
          </Card>

          </div>
          <div role="tabpanel" id="source-panel-data" aria-labelledby="source-tab-data" className={tab==="data"?"":"hidden"}><Card title={`正式采集的提取数据 · 最近 ${items.length} 条`}>
            <p className="mb-3 text-[12.5px] text-ink-3">这里展示已入库的数据与分析结果。点击展开摘要、正文样本和结构化字段；完整处理链在内容详情中查看。</p>
            {items.length ? <div className="space-y-3">{items.map(item=><details key={item.id} className="rounded-card border border-line p-3">
              <summary className="cursor-pointer text-[13px] font-medium text-ink">{item.title_zh||item.title} <Badge>{CONTENT_STATE_LABEL[item.processing_state]||item.processing_state}</Badge>{item.selected && <Badge tone="accent">精选</Badge>}</summary>
              <div className="mt-3 space-y-2 break-words text-[13px] text-ink-3">
                <p>发现 {bj(item.discovered_at,true)} · 原文 {item.published_at?bj(item.published_at,true):'时间未提供'}</p>
                <p>作者 {item.author||'未提供'} · 语言 {item.language||'未提供'} · 正文 {({ok:"已提取",pending:"待提取",none:"未提供",unconfirmed:"未确认"} as Record<string,string>)[item.body_status]||item.body_status}</p>
                <p>{item.category?(CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS]||item.category):'分类待处理'} · {item.publication_tags?.join(' / ')||'标签待处理'}</p>
                {item.summary_zh && <p className="whitespace-pre-wrap text-ink-2">{item.summary_zh}</p>}
                <p className="whitespace-pre-wrap">{item.excerpt||'列表未提供摘要'}</p>
                {item.body_text && <details><summary className="cursor-pointer">提取正文样本（最多 8,000 字符）</summary><p className="mt-2 whitespace-pre-wrap">{item.body_text}</p></details>}
                <Json value={item} label="已入库结构化字段"/>
                <div className="flex flex-wrap gap-4"><Link className="text-accent" to={`/admin/content/${item.id}`}>完整数据与处理链 →</Link><a className="text-accent" href={/^https?:\/\//i.test(item.url)?item.url:undefined} target="_blank" rel="noreferrer">原文 →</a></div>
              </div>
            </details>)}</div>:<Empty>还没有入库条目。保存设置后点“立即采集”，再刷新查看结果。</Empty>}
          </Card></div>
        </div>

        <div className="contents">
          <Card title="状态" className={tab==="config"?"":"hidden"}>
            <KV
              items={[
                ["上次抓取", s.last_fetch_at ? bj(s.last_fetch_at, true) : null],
                ["上次成功", s.last_ok_at ? bj(s.last_ok_at, true) : null],
                ["下次抓取", s.next_fetch_at ? bj(s.next_fetch_at, true) : null],
                ["创建", bj(s.created_at, true)],
              ]}
            />
            {s.cursor && <div className="mt-3"><Json value={s.cursor} label="游标" /></div>}
          </Card>
          <div role="tabpanel" id="source-panel-runs" aria-labelledby="source-tab-runs" className={tab==="runs"?"space-y-5":"hidden"}><Card title="采集任务状态">
            {watch && <p className="mb-2 text-[12.5px] text-accent">正在追踪任务，每 3 秒刷新。</p>}
            {jobs.length?<ul className="space-y-3 text-[12.5px] text-ink-3">{jobs.map(job=><li key={job.id}><Badge tone={job.state==='completed'?'ok':job.state==='failed'?'bad':'muted'}>{({created:'排队中',active:'采集中',retry:'等待重试',completed:'任务结束',failed:'任务失败',cancelled:'已取消'} as Record<string,string>)[job.state]||job.state}</Badge><span className="ml-2">{bj(job.created_on,true)}</span>{job.output && <Json value={job.output} label="任务输出（含采集结果）"/>}</li>)}</ul>:<Empty>暂无手动任务</Empty>}
          </Card>
          </div>
          <Card title="最近测试记录" className={tab==="test"?"":"hidden"}>
            {tests.length?<ul className="space-y-3 text-[12.5px] text-ink-3">{tests.map(test=><li key={test.id}><button className="w-full text-left hover:text-accent" onClick={()=>{setPreview({...test.result,matchesSavedConfig:test.matchesSavedConfig});setTestedConfig(test.matchesSavedConfig?JSON.stringify(s.config,null,2):null);setTab("test");}}>{bj(test.created_at,true)} · {test.result.status==='ok'?'成功':test.result.status==='empty'?'无条目':'失败'} · {test.result.acceptedCount} 条{!test.matchesSavedConfig?' · 配置已不同':''}</button></li>)}</ul>:<Empty>测试结果会保存在这里，刷新后仍可查看。</Empty>}
          </Card>
          <Card title="采集记录" pad={false} className={tab==="runs"?"":"hidden"}>
            <DataTable
              dense
              rows={runs}
              rowKey={(r) => r.id}
              empty="还没有采集记录"
              columns={[
                { key: "at", label: "时间", render: (r) => <span className="num whitespace-nowrap">{bj(r.started_at)}</span> },
                {
                  key: "st",
                  label: "结果",
                  render: (r) => (
                    <span className="inline-flex gap-1">
                      <Badge tone={r.status === "ok" ? "ok" : r.status === "failed" ? "bad" : "muted"} title={r.error ?? undefined}>{({ok:"成功",failed:"失败",running:"运行中"} as Record<string,string>)[r.status]||r.status}</Badge>
                      {!!r.detail?.dropped && <Badge tone="bad" title="有一段更早的帖子没能读完，其中的内容可能漏采">可能漏采</Badge>}
                      {!r.detail?.dropped && !!r.detail?.backlog && <Badge tone="warn" title="帖子多于一轮能读的页数，余下的在后面几轮接着读">续读 {r.detail.backlog} 段</Badge>}
                    </span>
                  ),
                },
                { key: "n", label: "发现/新增", align: "right", render: (r) => `${r.found_count ?? "—"}/${r.new_count ?? "—"}` },
                { key: "ms", label: "耗时", align: "right", render: (r) => duration(r.started_at, r.finished_at) },
              ]}
            />
          </Card>
          <div role="tabpanel" id="source-panel-history" aria-labelledby="source-tab-history" className={tab==="history"?"":"hidden"}><Card title="修改记录">
            {history.length ? (
              <ul className="space-y-3 text-[12.5px]">
                {history.map((h, i) => (
                  <li key={i}>
                    <div className="text-ink-2"><span className="font-medium">{h.action}</span> · {h.actor} · {bj(h.created_at)}</div>
                    {h.reason && <div className="text-ink-3">{h.reason}</div>}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>没有人工修改</Empty>
            )}
          </Card></div>
        </div>
      </div>

      <ReasonDialog
        open={dialog === "save"}
        title="保存信源设置"
        description={`将修改：${Object.keys(patchPreview(draft, s)).join("、") || "无"}`}
        busy={pending === "save"}
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => {
          const p = patch();
          if (!p) return false;
          const r = await run("PATCH", base, { patch: p, version: new Date(editVersion).toISOString(), reason }, { label: "save", success: "已保存" });
          if(r!==null){setSavedSettings(JSON.stringify(draft));}
          return r !== null;
        }}
      />
      <ReasonDialog
        open={dialog === "toggle"}
        title={s.enabled ? "暂停自动采集" : "启用自动采集"}
        description={s.enabled ? "暂停后不再采集，已有内容和历史保留。" : "启用后由调度器每分钟检查，按采集间隔执行。模型分类和摘要使用现有预算。"}
        danger={s.enabled}
        confirmLabel={s.enabled ? "暂停" : "启用"}
        busy={pending === "toggle"}
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => {
          const r = await run("PATCH", base, { patch: { enabled: !s.enabled }, version: new Date(s.updated_at).toISOString(), reason }, { label: "toggle", success: s.enabled ? "已暂停" : "已恢复" });
          return r !== null;
        }}
      />
    </AdminPage>
  );
}

/** Field names that differ from the saved source (for the confirmation text). */
function patchPreview(draft: Draft, s: Source): Record<string, true> {
  const out: Record<string, true> = {};
  const saved = draftOf(s);
  for (const k of Object.keys(draft) as Array<keyof Draft>) {
    if (k === "config") {
      try {
        if (JSON.stringify(JSON.parse(draft.config)) !== JSON.stringify(s.config)) out.config = true;
      } catch {
        out.config = true;
      }
    } else if (String(draft[k] ?? "") !== String(saved[k] ?? "")) out[k] = true;
  }
  return out;
}


