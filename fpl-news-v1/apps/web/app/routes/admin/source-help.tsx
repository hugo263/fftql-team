import { SITE } from "@aihot/industry/site";
import { Link } from "react-router";
import type { Route } from "./+types/source-help";
import { adminGet } from "../../lib/admin.server";
import { AdminPage, ButtonLink, Card, Json } from "../../features/admin/ui";
import { SourceWorkflow } from "../../features/admin/source-tools";

export async function loader({request}: Route.LoaderArgs) { await adminGet(request,"/api/admin/me"); return null; }
export const meta: Route.MetaFunction = () => [{title:`信源添加方法 · ${SITE.name} 后台`}];
const examples = [
  {name:'RSS / Atom（优先使用）',method:'复制网站公开的 feed 地址，填写名称和唯一 ID，点测试检查结果。RSS 能直接提供标题、链接、时间和摘要，通常无需写解析规则。',config:{feedUrl:'https://www.fantasyfootballscout.co.uk/feed/',_aihot:{initialBackfillLimit:6}}, note:'Fantasy Football Scout 与 AllAboutFPL 已在监控；重复地址会提示已有信源。'},
  {name:'公开网页列表',method:'填写新闻列表 URL，再用 CSS 选择器定位每条新闻、链接和标题。先测试，确认抓到的是新闻而不是菜单。此模板是结构示例，须按目标网站 HTML 调整。',config:{url:'https://example.com/news/',itemSelector:'article',linkSelector:'a',titleSelector:'h2',publishedAtSelector:'time',publishedAtUtcOffset:'+00:00',allowUrlPrefixes:['https://example.com/news/'],_aihot:{initialBackfillLimit:6}},note:'仅浏览器运行 JavaScript 后才出现的新闻不适用于通用 HTML 采集；优先找该站 RSS 或 JSON 接口。'},
  {name:'公开 JSON 接口',method:'列表路径指向新闻数组，标题和摘要字段用点号路径，链接模板取完整 URL 或文章 ID。模板示例对应 {data:{items:[{title,url,summary,published_at}]}}。',config:{url:'https://example.com/api/posts',mode:'json_api',method:'GET',itemsPath:'data.items',titlePaths:['title'],urlTemplate:'{raw:url}',summaryPaths:['summary'],publishedAtPath:'published_at',_aihot:{initialBackfillLimit:6}},note:'顶层是数组时 itemsPath 留空。Unix 时间在高级配置加入 publishedAtUnit: "epoch_s" 或 "epoch_ms"。请求头 headers 和 bodyJson 可在高级 JSON 配置。'},
  {name:'X 账号 / 搜索',method:'服务器配置 X_BEARER_TOKEN 与 x_api 预算即可使用 X 官方 API；也兼容原有 SocialData 接入。填写 from:账号 -filter:replies，可选精选或氛围。',config:{query:'from:OfficialFPL -filter:replies',searchType:'Latest',_aihot:{initialBackfillLimit:6}},note:'在信源管理器顶部用“X 采集总开关”控制采集与费用；关闭后测试和手动采集也不再提交 X 请求。官方 API 读取最近 7 天的公开帖子，每页默认 10 条，按返回帖子与作者计费。测试与采集共用回执及预算，余额不足时暂停请求。长文链接仅在正文可验证时参与分析。'},
  {name:'微信公众号',method:'服务器需配置 DAJIALA_KEY 与 dajiala 预算，然后填写公众号原始 ID ghid（gh_ 开头），不能只填昵称。',config:{ghid:'gh_xxxxxxxxxxxx',nickname:'公众号名称'},note:'测试提取历史列表与摘要；正式采集再获取文章内容，默认仍只公开摘要与原文链接。'},
];
export default function SourceHelp() {
 return <AdminPage title="信源添加方法" subtitle="把可运行的配置、操作步骤和排错方法留在后台，添加信源时随时查看。" actions={<><ButtonLink to="/admin/sources">信源管理器</ButtonLink><ButtonLink tone="primary" to="/admin/sources/new">添加信源</ButtonLink></>}>
  <SourceWorkflow/>
  <Card title="现有 FPL 信源与适用方式" className="mb-5"><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-[13px] text-ink-2"><thead className="border-b border-line text-ink-3"><tr><th className="pb-2">来源</th><th>地址</th><th>运行方法</th></tr></thead><tbody>
    <tr className="border-b border-line"><td className="py-3"><Link className="text-accent" to="/admin/sources/rss-ffscout">Fantasy Football Scout</Link></td><td><a className="text-accent" href="https://www.fantasyfootballscout.co.uk/feed/" target="_blank" rel="noreferrer">RSS feed</a></td><td>RSS，已接入</td></tr>
    <tr className="border-b border-line"><td className="py-3"><Link className="text-accent" to="/admin/sources/rss-allaboutfpl">AllAboutFPL</Link></td><td><a className="text-accent" href="https://allaboutfpl.com/feed/" target="_blank" rel="noreferrer">RSS feed</a></td><td>RSS，已接入</td></tr>
    <tr><td className="py-3"><Link className="text-accent" to="/admin/sources/fpl-official-prices">FPL 官方价格与状态</Link></td><td><a className="text-accent" href="https://fantasy.premierleague.com/api/bootstrap-static/" target="_blank" rel="noreferrer">官方 bootstrap-static</a></td><td>系统任务每 10 分钟检查，不需新建 JSON 新闻信源</td></tr>
  </tbody></table></div></Card>
  <div className="grid gap-5 xl:grid-cols-2">{examples.map(e=><Card key={e.name} title={e.name}><p className="text-[13px] leading-relaxed text-ink-2">{e.method}</p><div className="my-3"><Json label="可复制配置示例" value={e.config}/></div><p className="text-[12.5px] leading-relaxed text-ink-3">{e.note}</p></Card>)}
  <Card title="外部上报与 Agent"><p className="text-[13px] leading-relaxed text-ink-2">外部上报来源没有采集地址，通过受保护的上报 API 接收数据。新建上报客户端或接入方法在 <Link className="text-accent" to="/admin/agent">Agent 接入</Link> 中管理，不能用“立即采集”主动抓取。</p></Card></div>
  <Card title="配置字段与常见问题" className="mt-5"><dl className="space-y-4 text-[13px] leading-relaxed text-ink-2">
    <div><dt className="font-semibold text-ink">采集成功但新增为 0</dt><dd>已读过的原文会去重，这是正常结果；看“发现 / 新增”与提取数据。测试成功只证明列表可解析，正文提取和模型分析可能仍需处理。</dd></div>
    <div><dt className="font-semibold text-ink">测试 0 条或抓到菜单</dt><dd>检查是否填写 feed、列表路径、itemSelector / linkSelector / titleSelector。高级 allowUrlPrefixes、denyUrlPrefixes 限制链接范围；ingestNoiseFilter 的 dropMarkers / dropMarkersTitleOnly 去掉广告关键词，keepIfMatches 可豁免。</dd></div>
    <div><dt className="font-semibold text-ink">发布时间或正文缺失</dt><dd>网页可设置 publishedAtSelector、publishedAtUtcOffset；JSON 可设置 publishedAtPath 和 publishedAtUnit。高级 detail 可配置 titleSelector、publishedAtSelector、summarySelector 和 maxFetches（建议 3）；列表测试不会请求详情页。正式提取的数据在信源详情和内容详情查看。</dd></div>
    <div><dt className="font-semibold text-ink">保存后怎样持续运行</dt><dd>默认暂停，先点“立即采集”验证入库，再点“启用自动采集”。运行进程每分钟检查到期信源，按采集间隔执行；系统会按近期活跃度调整间隔。失败会退避重试，暂停会保留历史。修改未保存时可以测试当前表单，但正式采集始终使用已保存配置。</dd></div>
    <div><dt className="font-semibold text-ink">分类、标签与首页展示</dt><dd>入库后在现有预算内分析摘要、分类和标签，包括伤停、阵容、赛程、转会、球员、策略、规则、价格，以及 Classic / Draft、球队、球员和可信度。模型筛选通过后才进入精选；来源等级、一手身份需有依据。测试数据与正文样本仅在管理员后台可见。</dd></div>
    <div><dt className="font-semibold text-ink">全文展示与历史导入</dt><dd>默认只公开摘要与原文链接；有明确授权再开启全文。首次导入建议 6 条，按原文时间归档，旧新闻不会改成今天的消息。FPL 涨跌基于前后两次官方价格观测，首次基线不会伪造涨跌。</dd></div>
  </dl><p className="mt-4 text-[12.5px] text-ink-3">运行异常看 <Link className="text-accent" to="/admin/runs">运行记录</Link>；分类或摘要失败可在 <Link className="text-accent" to="/admin/content">内容管理</Link> 查看完整处理链并重跑。</p></Card>
 </AdminPage>;
}
