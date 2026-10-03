import { Link, useRevalidator } from "react-router";
import { adminGet } from "../../lib/admin.server";
import { apiGet } from "../../lib/api.server";
import type { FplPriceResponse } from "@aihot/contracts/fpl";
import type { SourceRuntime } from "../../features/admin/source-tools";
import { AdminPage, Badge, Button, ButtonLink, Card, Stat } from "../../features/admin/ui";
import { bj, num } from "../../features/admin/format";
import type { Route } from "./+types/index";
interface Overview {
  at: string; day: string;
  attention: {sources:number;receipts:number;deliveries:number;feedback:number;failed:number};
  operations: {discovered:number;waiting:number;failed:number};
  prices: {total:number;rises:number;falls:number};
  costs: Array<{day:string;service:string;currency:string;amount:string;estimated:number;actual:number}>;
  runtime: SourceRuntime;
  x: {total:number;failing:number;ever_ok:number;error:string|null};
}
export async function loader({request}:Route.LoaderArgs) {
  const [overview, prices] = await Promise.all([
    adminGet<Overview>(request,"/api/admin/overview"),
    apiGet<FplPriceResponse>("/api/site/fpl/prices", {signal:request.signal}).catch(()=>null),
  ]);
  return {overview,prices};
}
export const meta = () => [{title:"运营总览 · TQL 管理后台"}];
export const headers=()=>({"Cache-Control":"no-store"});
const shortcuts = [
  ["▤","资讯内容","分类、标签与发布状态","/admin/content"],
  ["⇄","信源管理器","添加 · 测试 · 运行","/admin/sources"],
  ["⚙","设置与预算","付费服务频率上限","/admin/settings"],
  ["↻","运行与异常","任务与失败排查","/admin/runs"],
  ["⌁","Agent 接入","MCP / RSS / REST 只读","/admin/agent"],
];
export default function AdminIndex({loaderData}:Route.ComponentProps) {
  const {overview:o,prices:p}=loaderData;
  const revalidator=useRevalidator();
  const todos=[
    ["⛔",o.attention.sources,"个信源采集异常","不稳定或失败，并已有采集错误记录","/admin/sources","去处理"],
    ["◔",o.attention.receipts,"笔付费请求结果未知","需核对提供商回执，不能当作免费失败","/admin/runs","核对回执"],
    ["⇢",o.attention.deliveries,"条通知投递状态不确定","人工核实投递结果后再处理","/admin/runs","人工核实"],
    ["✉",o.attention.feedback,"条新反馈未处理","查看反馈详情、回复与处理状态","/admin/feedback","查看反馈"],
    ["◎",o.attention.failed,"条内容处理失败","按错误归类诊断与重新排队","/admin/content?processing=failed","查看内容"],
  ] as const;
  const today = o.costs.filter(c=>c.day===o.day);
  const sums = (rows:Overview["costs"]) => Object.entries(rows.reduce<Record<string,number>>((a,c)=>{a[c.currency]=(a[c.currency]??0)+Number(c.amount);return a;},{}));
  const todayCost=sums(today).map(([currency,amount])=>`${currency} ${amount.toFixed(4)}`).join(" · ")||"暂无费用记录";
  const currencies=[...new Set(o.costs.map(c=>c.currency))];
  const days=Array.from({length:7},(_,i)=>new Date(new Date(o.day+"T00:00:00Z").getTime()-(6-i)*86400_000).toISOString().slice(0,10));
  return <AdminPage title="运营总览" subtitle={`北京时间 · ${bj(o.at,true)} 更新`} actions={<Button busy={revalidator.state==="loading"} onClick={()=>revalidator.revalidate()}>刷新状态</Button>}>
    {o.runtime.xCollectionEnabled && o.x.failing>0 && <div className="mb-5 rounded-card border border-hot/20 bg-hot-soft px-4 py-3 text-[12.5px] text-hot"><strong>X 采集链路异常：</strong>{o.runtime.xConfigured?"密钥已被进程识别":"尚未识别密钥"}，{o.runtime.xSources.enabled} 个账号已启用，其中 {o.x.failing} 个有采集错误。{o.x.ever_ok===0?"尚无成功采集记录。":"请检查失败记录。"} <Link to="/admin/runs" className="underline">查看运行与异常</Link>{o.x.error && <p className="mt-1 break-words text-[12px]">最近错误：{o.x.error}</p>}</div>}
    <div className="admin-section-head !mt-0"><h2>需要处理的事项</h2><p>当前待办，点击进入对应操作页</p></div>
    {todos.filter(t=>t[1]>0).map(([icon,count,label,note,to,action])=><Link className="admin-todo" to={to} key={label}><span className="admin-todo-icon" aria-hidden="true">{icon}</span><div className="admin-todo-copy"><strong>{num(count)} {label}</strong><p>{note}</p></div><span className="admin-todo-link">{action}</span></Link>)}
    {todos.every(t=>t[1]===0) && <Card><p className="text-ok">目前没有待处理异常或新反馈。</p></Card>}
    <div className="admin-section-head"><h2>官方价格观测</h2><p>独立系统任务 · 每 10 分钟检查</p></div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Stat label="官方球员价格" value={p?.playersTotal??"—"} hint={p?.season?`${p.season} 赛季`:"等待采集"}/><Stat label="累计观测涨跌" value={p?.changesTotal??"—"} hint="首次采集建立基线后记录"/><Stat label="今日涨跌" value={num(o.prices.total)} hint={<span>▲ {o.prices.rises} 涨 · ▼ {o.prices.falls} 跌</span>}/><Stat label="最近价格采集" value={<span className="!text-[17px]">{p?.checkedAt?bj(p.checkedAt):"等待采集"}</span>} hint={p?.checkedAt?<Badge tone={Date.now()-new Date(p.checkedAt).getTime()<30*60_000?"ok":"warn"}>{Date.now()-new Date(p.checkedAt).getTime()<30*60_000?"观测正常":"检查更新时间"}</Badge>:"等待基线"}/></div>
    <div className="admin-section-head"><h2>今日运营</h2><p>资讯按发现时间，待处理与失败按当前状态统计</p></div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Stat label="今日新增资讯" value={num(o.operations.discovered)} hint="去重后的入库条目"/><Stat label="等待处理" value={num(o.operations.waiting)} hint="包括待重试条目"/><Stat label="处理失败" value={num(o.operations.failed)} tone={o.operations.failed?"bad":undefined}/><Stat label="今日已记录费用" value={<span className="!text-[14px] break-words">{todayCost}</span>} hint="分币种 · 结果未知未计入"/></div>
    <div className="mt-5 grid gap-4 xl:grid-cols-[1.4fr_1fr]"><Card title="近 7 日付费费用记录" right={<ButtonLink to="/admin/settings" size="sm">预算设置 →</ButtonLink>}>
      <p className="mb-4 text-[12px] text-ink-3">按请求尝试统计已记费用，包含估算。结果未知和未定价调用未计入，最终以提供商账单为准；不同币种不合并。</p>
      {currencies.length?currencies.map(currency=>{const values=days.map(day=>sums(o.costs.filter(c=>c.day===day&&c.currency===currency))[0]?.[1]??0);const max=Math.max(...values,0.000001);return <div key={currency} className="mb-4"><div className="mb-2 flex justify-between text-[12px]"><strong>{currency}</strong><span className="num">合计 {values.reduce((a,b)=>a+b,0).toFixed(4)}</span></div><div className="flex h-[110px] items-end gap-3" role="img" aria-label={`${currency} 近七日费用：${days.map((day,i)=>`${day} ${values[i]?.toFixed(4)}`).join('，')}`}>{days.map((day,i)=><div className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" key={day}><span className="num text-[10px] text-ink-3">{values[i]!.toFixed(3)}</span><div className="w-full rounded-t bg-accent/70" style={{height:`${Math.max(2,values[i]!/max*70)}px`}}/><span className="num text-[10px] text-ink-4">{day.slice(5)}</span></div>)}</div></div>}):<p className="py-10 text-center text-ink-3">近 7 日暂无已记费用。未知回执请前往运行页核对。</p>}
    </Card><Card title="快捷入口"><div className="grid gap-2">{shortcuts.map(([icon,label,note,to])=><Link key={to} to={to!} className="flex items-center gap-3 rounded-control p-2 hover:bg-accent-soft"><span className="admin-todo-icon" aria-hidden="true">{icon}</span><span><strong className="text-[13px]">{label}</strong><small className="block text-[12px] text-ink-3">{note}</small></span><span className="ml-auto text-accent">→</span></Link>)}<a href="https://fftql.team/admin" className="flex items-center gap-3 rounded-control p-2 hover:bg-accent-soft"><span className="admin-todo-icon">▦</span><span><strong>Draft 数据</strong><small className="block text-ink-3">切换到数据统计模块</small></span><span className="ml-auto text-accent">→</span></a></div></Card></div>
  </AdminPage>;
}
