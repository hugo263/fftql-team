import { adminGet } from "../lib/admin.server";
import { pageMeta } from "../lib/seo";
export async function loader({request}:{request:Request}) { await adminGet(request,"/api/admin/me"); return null; }
export function headers() { return {"Cache-Control":"no-store", "X-Robots-Tag":"noindex, nofollow"}; }
export const meta=()=>pageMeta({title:"数据来源",path:"/admin/source-directory",noindex:true});
const sources=[
  {name:"Fantasy Football Scout",url:"https://www.fantasyfootballscout.co.uk/",use:"公开 RSS · 伤停、赛程、首发与选人分析",status:"自动采集"},
  {name:"AllAboutFPL",url:"https://allaboutfpl.com/",use:"公开 RSS · 球员、队长与 Classic 策略",status:"自动采集"},
  {name:"FPL 官方数据",url:"https://fantasy.premierleague.com/api/bootstrap-static/",use:"球员、现价、出场状态及截止时间",status:"自动采集"},
  {name:"Premier League FPL 新闻",url:"https://www.premierleague.com/en/fantasy-news",use:"官方资讯与规则",status:"原站阅读"},
  {name:"The Draft Society",url:"https://www.thedraftsociety.com/fpl-draft-rankings",use:"FPL Draft 排名与策略；阅读时注意区分 Fantrax",status:"原站阅读"},
  {name:"Premier Injuries",url:"https://www.premierinjuries.com/injury-table.php",use:"伤停汇总与预计复出日期",status:"原站阅读"},
  {name:"Fantasy Football Hub",url:"https://www.fantasyfootballhub.co.uk/",use:"FPL 分析与阵容；付费内容请在原站订阅",status:"原站阅读"},
];
export default function Sources(){return <div className="mx-auto max-w-6xl p-5 lg:p-8"><div className="tql-hero"><span className="tql-kicker">SOURCES & METHOD</span><h1>数据来源</h1><p>每条资讯保留出处。事实、媒体观点与预测分别标记。</p></div><section className="tql-panel">{sources.map(s=><div className="tql-source-row" key={s.name}><div><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name} ↗</a><p>{s.use}</p></div><span>{s.status}</span></div>)}</section><div className="tql-note">自动收录只展示中文摘要及原文链接。源站发布时间缺失时不会补造时间；历史文章按原时间归档。价格追踪从本站首次成功采集开始，初始价格不是当天涨跌。</div></div>}
