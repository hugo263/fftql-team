import { Form, useLoaderData } from "react-router";
import type { Route } from "./+types/prices";
import type { FplPriceResponse } from "@aihot/contracts/fpl";
import { loadOr404,queryString } from "../lib/api.server";
import { pageMeta } from "../lib/seo";

export async function loader({request}:Route.LoaderArgs) {
  const url=new URL(request.url);
  const data=await loadOr404<FplPriceResponse>(`/api/site/fpl/prices${queryString({q:url.searchParams.get("q"),team:url.searchParams.get("team"),direction:url.searchParams.get("direction")})}`,{signal:request.signal});
  return {data,view:url.searchParams.get("view")==="market"?"market":"changes"};
}
export const meta=()=>pageMeta({title:"价格涨跌",path:"/prices"});
const time=(at:string)=>new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(at));
const money=(v:number)=>`£${v.toFixed(1)}m`;
const delta=(v:number)=>`${v>0?"+":v<0?"−":""}£${Math.abs(v).toFixed(1)}m`;
export default function Prices() {
  const {data:d,view}=useLoaderData<typeof loader>();
  return <div className="pb-8">
    <div className="tql-hero"><span className="tql-kicker">FPL PRICE WATCH · CLASSIC</span><h1>价格涨跌</h1><p>用官方现价追踪每次变化，为预算和转会留出余地。</p><div className="tql-hero-meta"><span>{d.season??"等待赛季数据"}</span><span>{d.checkedAt?`更新于 ${time(d.checkedAt)}（北京时间）`:"尚未完成首次采集"}</span></div></div>
    <div className="tql-note">适用于 <strong>Classic</strong>。表中涨跌来自连续官方观测；发生时间在两次成功采集之间。Draft 使用选秀、豁免和交易。</div>
    <Form method="get" className="tql-filters" key={`${d.filters.q}-${d.filters.team}-${d.filters.direction}-${view}`}>
      <label><span>查看</span><select name="view" defaultValue={view}><option value="changes">已记录的涨跌</option><option value="market">球员现价</option></select></label>
      <label><span>球队</span><select name="team" defaultValue={d.filters.team}><option value="">所有球队</option>{d.teams.map(t=><option key={t}>{t}</option>)}</select></label>
      <label><span>方向</span><select name="direction" defaultValue={d.filters.direction} disabled={view==="market"}><option value="all">全部涨跌</option><option value="up">涨价</option><option value="down">跌价</option></select></label>
      <label className="tql-search"><span>球员或球队</span><input name="q" defaultValue={d.filters.q} placeholder="搜索 Haaland、曼城…" /></label><button type="submit">筛选</button>
    </Form>
    {view==="changes"?<section className="tql-panel"><div className="tql-section-head"><h2>已记录的价格变化</h2><span>{d.changesTotal} 条 · 最多显示最近 100 条</span></div>{d.changes.length?<div className="tql-table-wrap"><table className="tql-table"><thead><tr><th>球员</th><th>前价</th><th>现价</th><th>变化</th><th>发现时间（北京）</th></tr></thead><tbody>{d.changes.map(c=><tr key={c.id}><td><strong>{c.name}</strong><small>{c.team} · {c.position}{c.gameweek?` · GW${c.gameweek}`:""}</small></td><td>{money(c.oldCost)}</td><td>{money(c.newCost)}</td><td className={c.newCost>c.oldCost?"tql-up":"tql-down"}>{delta(c.newCost-c.oldCost)}<small>{c.newCost>c.oldCost?"涨价":"跌价"} · 官方确认</small></td><td>{time(c.observedAt)}<small>前次观测 {time(c.previousCheckedAt)}</small></td></tr>)}</tbody></table></div>:<div className="tql-empty"><strong>{d.baselineAt?"暂未记录到符合筛选条件的涨跌":"正在建立第一份价格基准"}</strong><p>{d.baselineAt?`从 ${time(d.baselineAt)} 开始记录；首次采集只建立基准，后续现价变化会自动显示。`:'完成首次采集后即可查看球员现价；下一次成功采集开始比较涨跌。'}</p><a href="/prices?view=market">查看球员现价 →</a></div>}</section>:<section className="tql-panel"><div className="tql-section-head"><h2>球员现价</h2><span>{d.playersTotal} 位 · 按现价排序，最多 100 位</span></div><div className="tql-table-wrap"><table className="tql-table"><thead><tr><th>球员</th><th>球队</th><th>位置</th><th>现价</th><th>赛季累计变化</th></tr></thead><tbody>{d.players.map(p=><tr key={p.code}><td><strong>{p.name}</strong>{p.chance!==null&&p.chance<100?<small className="tql-down">官方下一轮出场概率 {p.chance}%</small>:null}</td><td>{p.team}</td><td>{p.position}</td><td><strong>{money(p.cost)}</strong></td><td className={p.seasonDelta>0?"tql-up":p.seasonDelta<0?"tql-down":""}>{delta(p.seasonDelta)}</td></tr>)}</tbody></table></div><p className="tql-footnote">赛季累计变化是现价相对开季价格的变化，不代表当天涨跌。</p></section>}
    <p className="tql-footnote">来源：<a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">FPL 官方公开数据</a> · 每 10 分钟检查 · 网络失败时保留上次成功数据。</p>
  </div>;
}
