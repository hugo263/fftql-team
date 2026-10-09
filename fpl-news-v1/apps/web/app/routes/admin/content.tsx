import { CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import { Form, Link, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/content";
import { adminGet } from "../../lib/admin.server";
import { VISIBILITY_LABEL, CONTENT_STATE_LABEL } from "../../features/admin/labels";
import { AdminPage, Badge, Button, Card, DataTable, Input, Pager, Select, Stat, Time } from "../../features/admin/ui";
interface Row {id:string;title:string;url:string;source:string;discovered_at:string;processing_state:string;visibility:string|null;selected:boolean|null;score:number|null;category:string|null;tags:string[]|null}
export async function loader({request}:Route.LoaderArgs) {
  const url=new URL(request.url);
  const [{rows},sources]=await Promise.all([adminGet<{rows:Row[]}>(request,`/api/admin/content${url.search}`),adminGet<{rows:Array<{id:string;name:string}>}>(request,"/api/admin/sources")]);
  return {rows,sources:sources.rows,page:Math.max(1,Number(url.searchParams.get("page"))||1)};
}
export const meta = () => [{title:"资讯内容 · TQL 管理后台"}];
export default function Content({loaderData}:Route.ComponentProps){
  const {rows,sources,page}=loaderData;const [sp]=useSearchParams();const navigate=useNavigate();
  const change=(key:string,value:string)=>{const next=new URLSearchParams(sp);value?next.set(key,value):next.delete(key);next.delete("page");navigate(`?${next}`,{preventScrollReset:true});};
  const filter=(name:string,label:string,options:Record<string,string>)=><Select className="!w-auto max-w-full" aria-label={label} value={sp.get(name)??""} onChange={e=>change(name,e.target.value)}><option value="">全部{label}</option>{Object.entries(options).map(([key,text])=><option key={key} value={key}>{text}</option>)}</Select>;
  return <AdminPage title="FPL 资讯管理" subtitle="聚合、核验、编辑与发布。处理进度、公开状态和精选资格分别记录。">
    <div className="news-page-stats grid grid-cols-2 gap-4 xl:grid-cols-4 mb-5"><Stat label="本页资讯" value={rows.length} hint="跟随当前筛选与分页"/><Stat label="本页待处理" value={rows.filter(r=>r.processing_state==='new').length} hint="等待进入内容处理流程"/><Stat label="本页处理失败" value={rows.filter(r=>r.processing_state==='failed').length} hint="查看处理链与失败原因"/><Stat label="本页公开内容" value={rows.filter(r=>r.visibility==='public').length} hint="不代表已发布到小红书"/></div>
    <div className="news-content-layout"><div><Card pad={false}>
      <div className="space-y-3 border-b border-line p-4"><Form method="get" className="flex max-w-2xl gap-2">{["source","category","processing","visibility","selected","days"].map(key=>sp.get(key)&&<input key={key} type="hidden" name={key} value={sp.get(key)!}/>)}<Input key={sp.get('q')} name="q" defaultValue={sp.get("q")??""} placeholder="内容 ID、URL 或标题关键词" aria-label="搜索内容"/><Button type="submit" tone="primary">查找</Button></Form>
      <div className="flex flex-wrap gap-2">{filter("source","信源",Object.fromEntries(sources.map(s=>[s.id,s.name])))}{filter("category","分类",CATEGORY_LABELS)}{filter("processing","处理状态",{new:"待处理",analyzed:"已分析",skipped:"已跳过",failed:"处理失败",blocked:"已过滤"})}{filter("visibility","公开状态",VISIBILITY_LABEL)}{filter("selected","精选",{yes:"精选",no:"未入选"})}{filter("days","时间",{"7":"最近 7 天","30":"最近 30 天","90":"最近 90 天"})}{sp.size>0&&<Button onClick={()=>navigate("/admin/content")}>清除筛选</Button>}</div></div>
      <DataTable rows={rows} rowKey={r=>r.id} empty="暂无符合筛选条件的资讯。" columns={[
        {key:"title",label:"资讯",render:r=><div className="min-w-[180px] max-w-[340px]"><Link to={`/admin/content/${r.id}`} className="font-semibold text-ink hover:text-accent">{r.title}</Link><div className="mt-1 font-mono text-[11px] text-ink-4">{r.id}</div></div>},
        {key:"source",label:"来源 / 主题",render:r=><div className="max-w-[170px]"><span>{r.source}</span><p className="mt-2 text-[11px] text-ink-3">{r.category?CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS]??r.category:"待分类"}</p><p className="mt-1 text-[10px] text-ink-4">{r.tags?.join(" · ")||"—"}</p></div>},
        {key:"processing",label:"处理 / 公开状态",render:r=><div className="space-y-2"><div><Badge tone={r.processing_state==='failed'?'bad':r.processing_state==='analyzed'?'ok':'muted'}>{CONTENT_STATE_LABEL[r.processing_state]??r.processing_state}</Badge></div><div>{r.visibility?<Badge tone={r.visibility==='public'?'ok':'warn'}>{VISIBILITY_LABEL[r.visibility]??r.visibility}</Badge>:<Badge>未发布</Badge>}</div><Time at={r.discovered_at}/></div>},
        {key:"score",label:"评分 / 精选",render:r=><div><strong>{r.score??"—"}</strong><div className="mt-2">{r.selected?<Badge tone="accent">精选</Badge>:<span className="text-[10px] text-ink-4">未入选</span>}</div></div>},
        {key:"action",label:"操作",render:r=><Link className="whitespace-nowrap font-medium text-accent" to={`/admin/content/${r.id}`}>查看处理链 →</Link>},
      ]}/>
    </Card><Pager page={page} hasMore={rows.length===50}/></div><aside className="news-editor-checks"><Card title="编辑检查清单"><div className="news-check"><b>01 · 来源可追溯</b><p>核对原文链接、来源与发现时间。</p></div><div className="news-check"><b>02 · 区分事实与预测</b><p>检查正文证据、摘要与适用规则。</p></div><div className="news-check"><b>03 · 保留状态边界</b><p>处理完成不等于已公开；精选资格单独确认。</p></div></Card><p className="mt-4 px-1 text-[11px] leading-6 text-ink-4">通过“查看处理链”检查原文、评分理由和发布记录。修改操作沿用原有审核与审计机制。</p></aside></div>
  </AdminPage>;
}
