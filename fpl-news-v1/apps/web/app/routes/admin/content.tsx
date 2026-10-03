import { CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import { Form, Link, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/content";
import { adminGet } from "../../lib/admin.server";
import { VISIBILITY_LABEL, CONTENT_STATE_LABEL } from "../../features/admin/labels";
import { AdminPage, Badge, Button, Card, DataTable, Input, Pager, Select, Time } from "../../features/admin/ui";
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
  return <AdminPage title="资讯内容" subtitle="浏览、筛选与诊断内容；处理状态、公开状态和精选资格分别展示。">
    <Card pad={false}>
      <div className="space-y-3 border-b border-line p-4"><Form method="get" className="flex max-w-2xl gap-2">{["source","category","processing","visibility","selected","days"].map(key=>sp.get(key)&&<input key={key} type="hidden" name={key} value={sp.get(key)!}/>)}<Input key={sp.get('q')} name="q" defaultValue={sp.get("q")??""} placeholder="内容 ID、URL 或标题关键词" aria-label="搜索内容"/><Button type="submit" tone="primary">查找</Button></Form>
      <div className="flex flex-wrap gap-2">{filter("source","信源",Object.fromEntries(sources.map(s=>[s.id,s.name])))}{filter("category","分类",CATEGORY_LABELS)}{filter("processing","处理状态",{new:"待处理",analyzed:"已分析",skipped:"已跳过",failed:"处理失败",blocked:"已过滤"})}{filter("visibility","公开状态",VISIBILITY_LABEL)}{filter("selected","精选",{yes:"精选",no:"未入选"})}{filter("days","时间",{"7":"最近 7 天","30":"最近 30 天","90":"最近 90 天"})}{sp.size>0&&<Button onClick={()=>navigate("/admin/content")}>清除筛选</Button>}</div></div>
      <DataTable rows={rows} rowKey={r=>r.id} empty="暂无符合筛选条件的资讯。" columns={[
        {key:"title",label:"资讯",render:r=><div className="min-w-[280px] max-w-[520px]"><Link to={`/admin/content/${r.id}`} className="font-semibold text-ink hover:text-accent">{r.title}</Link><div className="mt-1 font-mono text-[11px] text-ink-4">{r.id}</div></div>},
        {key:"source",label:"信源",render:r=>r.source},
        {key:"category",label:"分类 / 标签",render:r=><div className="max-w-[190px]"><span>{r.category?CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS]??r.category:"待分类"}</span><p className="mt-1 text-[11px] text-ink-3">{r.tags?.join(" · ")||"—"}</p></div>},
        {key:"processing",label:"处理状态",render:r=><Badge tone={r.processing_state==='failed'?'bad':r.processing_state==='analyzed'?'ok':'muted'}>{CONTENT_STATE_LABEL[r.processing_state]??r.processing_state}</Badge>},
        {key:"visibility",label:"公开状态",render:r=>r.visibility?<Badge tone={r.visibility==='public'?'ok':'warn'}>{VISIBILITY_LABEL[r.visibility]??r.visibility}</Badge>:<Badge>未发布</Badge>},
        {key:"selected",label:"精选",render:r=>r.selected?<Badge tone="accent">精选</Badge>:<span className="text-ink-4">—</span>},
        {key:"score",label:"分数",align:"right",render:r=>r.score??"—"},
        {key:"time",label:"发现时间",render:r=><Time at={r.discovered_at}/>},
        {key:"action",label:"操作",render:r=><Link className="whitespace-nowrap font-medium text-accent" to={`/admin/content/${r.id}`}>查看处理链 →</Link>},
      ]}/>
    </Card><Pager page={page} hasMore={rows.length===50}/>
  </AdminPage>;
}
