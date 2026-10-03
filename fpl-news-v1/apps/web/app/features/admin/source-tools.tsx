import { Link } from "react-router";
import { bj } from "./format";
import { Badge, Button, Card, Empty, Field, Input, Json, Textarea } from "./ui";
import { useAdminAction } from "./action";

export interface SourceRuntime {
  collectEnabled: boolean; modelEnabled: boolean; workerAlive: boolean; workerAt: string | null;
  xConfigured: boolean; xProvider?: "x_api" | "socialdata" | null; mpConfigured: boolean; kinds: string[];
  xCollectionEnabled: boolean; xCollectionInitialized: boolean;
  xSources: { total: number; enabled: number; ok?: number; failing?: number }; xUsage: { usd: number; reserved: number; requests: number }; xDailyBudgetUsd: number | null;
}
export interface SourceTestResult {
  status: "ok" | "empty" | "failed"; testedAt: string; ms: number; count: number; acceptedCount: number;
  configHash: string; matchesSavedConfig?: boolean; error: string | null; warnings: string[];
  items: Array<{title:string;url:string;publishedAt:string|null;author:string|null;language:string|null;excerpt:string;bodyText:string;bodyStatus:string;categories:string[];mediaCount:number}>;
}
export const SOURCE_TEMPLATES: Record<string,Record<string,unknown>> = {
  rss: {feedUrl:"",_aihot:{initialBackfillLimit:6}},
  web_list: {url:"",itemSelector:"article",linkSelector:"a",titleSelector:"h2",_aihot:{initialBackfillLimit:6}},
  json_list: {url:"",mode:"json_api",method:"GET",itemsPath:"data.items",titlePaths:["title"],urlTemplate:"{raw:url}",summaryPaths:["summary"],_aihot:{initialBackfillLimit:6}},
  x_search: {query:"from:OfficialFPL -filter:replies",searchType:"Latest",_aihot:{initialBackfillLimit:6}},
  mp_account: {ghid:"",nickname:""}, external:{},
};

export function SourceWorkflow() {
  return <Card className="mb-5" title="添加后怎样开始运转" right={<Link className="text-accent" to="/admin/sources/help">完整方法与示例 →</Link>}>
    <ol className="grid gap-3 text-[13px] text-ink-2 sm:grid-cols-4">
      {[['1 · 填写信源','优先 RSS，填订阅地址；网页和 JSON 填解析规则。'],['2 · 测试提取','检查标题、链接、发布时间和摘要，测试结果不进入资讯库。'],['3 · 保存并运行','默认先保存为暂停，测试通过后立即采集，再启用自动采集。'],['4 · 查看结果','采集去重后进入分析、分类和打标签；在提取数据与内容管理查看。']].map(([a,b])=><li key={a}><strong className="block text-ink">{a}</strong><p className="mt-1 text-ink-3">{b}</p></li>)}
    </ol>
  </Card>;
}
export function SourceRuntimeCard({runtime,showX=true}: {runtime:SourceRuntime;showX?:boolean}) {
  const { run, busy } = useAdminAction();
  const enabled = runtime.xCollectionEnabled;
  const canStart = runtime.xConfigured && runtime.collectEnabled && runtime.workerAlive && runtime.kinds.includes('x_search');
  return <>{showX && <Card title="X 采集与费用" className="mb-5" right={<Badge tone={enabled?'ok':'muted'}>{enabled?'采集已开启':'采集已关闭'}</Badge>}>
    <div className="admin-state-chain mb-4" aria-label="X 采集状态链">
      <Badge tone={runtime.xConfigured?'ok':'bad'}>1 · 密钥{runtime.xConfigured?'已配置':'未配置'}</Badge><span aria-hidden="true">→</span>
      <Badge tone={enabled?'ok':'muted'}>2 · 总开关{enabled?'开启':'关闭'}</Badge><span aria-hidden="true">→</span>
      <Badge tone={runtime.collectEnabled&&runtime.workerAlive?'ok':'bad'}>3 · 采集进程{runtime.collectEnabled&&runtime.workerAlive?'在线':'未就绪'}</Badge><span aria-hidden="true">→</span>
      <Badge tone={runtime.xSources.enabled>0?'ok':'muted'}>4 · 已启用 {runtime.xSources.enabled} 个账号</Badge><span aria-hidden="true">→</span>
      <Badge tone={(runtime.xSources.failing??0)>0?'bad':(runtime.xSources.ok??0)>0?'ok':'muted'}>5 · {(runtime.xSources.failing??0)>0?`${runtime.xSources.failing} 个采集异常`:(runtime.xSources.ok??0)>0?`${runtime.xSources.ok} 个有成功记录`:'尚无成功采集记录'}</Badge>
    </div>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl"><p className="font-medium text-ink">X 采集总开关</p>
        <p className="mt-1 text-[13px] text-ink-3">开启后按信源配置采集。关闭后，定时采集、立即采集和测试都不再提交新的 X 请求；已提交的请求可能完成。</p>
        {!runtime.xCollectionInitialized && <p className="mt-2 text-[12.5px] text-ink-2">首次开启会启用已配置的 {runtime.xSources.total} 个 X 信源；之后会保留各信源的启停设置。</p>}
        {enabled && <p className="mt-2 text-[12.5px] text-ink-2">已启用 {runtime.xSources.enabled} / {runtime.xSources.total} 个 X 信源。</p>}
      </div>
      <Button role="switch" aria-label="X 采集总开关" aria-checked={enabled} tone={enabled?'danger':'primary'} busy={busy} disabled={!enabled && !canStart}
        onClick={()=>run('POST','/api/admin/x-collection',{enabled:!enabled},{label:'x-collection',success:enabled?'X 采集已关闭。':'X 采集已开启，开始按信源配置采集。'})}>
        {enabled?'关闭 X 采集':'开启 X 采集'}
      </Button>
    </div>
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-3 text-[12.5px] text-ink-2">
      <span>近 24 小时已记费用 <strong className="num text-ink">${runtime.xUsage.usd.toFixed(2)}</strong></span>
      {runtime.xUsage.reserved>0 && <span>待完成请求预留 <strong className="num">${runtime.xUsage.reserved.toFixed(2)}</strong></span>}
      <span>近 24 小时请求 <strong className="num text-ink">{runtime.xUsage.requests}</strong> 次</span>
      {runtime.xDailyBudgetUsd!==null && <span>24 小时费用上限 <strong className="num text-ink">${runtime.xDailyBudgetUsd.toFixed(2)}</strong></span>}
    </div>
    <p className="mt-2 text-[12px] text-ink-3">费用为 API 回执估算，最终以提供商账单为准。采集后的分类与摘要使用独立模型预算。</p>
    {!enabled && !canStart && <p className="mt-2 text-[12.5px] text-hot">需配置 X 密钥、启用服务器采集并保持采集进程在线后才能开启。</p>}
  </Card>}<Card title="采集环境" className="mb-5"><div className="flex flex-wrap gap-2">
    <Badge tone={runtime.workerAlive?'ok':'bad'}>采集进程{runtime.workerAlive?'在线':'离线'}</Badge>
    <Badge tone={runtime.collectEnabled?'ok':'warn'}>自动采集{runtime.collectEnabled?'开启':'关闭'}</Badge>
    <Badge tone={runtime.modelEnabled?'ok':'warn'}>分类与摘要{runtime.modelEnabled?'开启':'关闭'}</Badge>
    <Badge>X {runtime.xConfigured ? runtime.xProvider==='x_api' ? '官方 API 已配置' : '已配置' : '未配置'}</Badge><Badge>公众号{runtime.mpConfigured?'已配置':'未配置'}</Badge>
  </div><p className="mt-2 text-[12.5px] text-ink-3">RSS、公开网页和 JSON 使用现有服务器。X 与公众号需要对应提供商密钥和预算；采集后的模型分析使用现有预算。</p></Card></>;
}

/** Common fields preserve advanced adapter options rather than replacing them. */
export function SourceConfigEditor({kind,value,onChange}: {kind:string;value:string;onChange:(v:string)=>void}) {
  let config:Record<string,any> = {}; let valid = true;
  try { const parsed:unknown=JSON.parse(value); if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw Error(); config=parsed; } catch { valid=false; }
  const set=(key:string,v:unknown)=>onChange(JSON.stringify({...config,[key]:v},null,2));
  const field=(label:string,key:string,hint:string,placeholder='')=><Field key={key} label={label} hint={hint}><Input aria-label={label} disabled={!valid} value={String(config[key]??'')} placeholder={placeholder} onChange={e=>set(key,e.target.value)} /></Field>;
  return <div className="space-y-4">
    {kind==='rss' && field('RSS / Atom 订阅地址','feedUrl','这里填 feed 地址，不是网站首页。','https://example.com/feed/')}
    {kind==='web_list' && <div className="grid gap-4 sm:grid-cols-2">
      {field('新闻列表地址','url','需能直接返回新闻 HTML；仅浏览器执行脚本才出现的内容不适用。','https://example.com/news/')}
      {field('每条新闻的 CSS 选择器','itemSelector','每张新闻卡片的外层元素。','article')}
      {field('链接选择器','linkSelector','新闻卡片内的链接元素。','a')}
      {field('标题选择器','titleSelector','新闻卡片内的标题元素。','h2')}
    </div>}
    {kind==='json_list' && <div className="grid gap-4 sm:grid-cols-2">
      {field('JSON 接口地址','url','接口需返回 JSON，默认 GET。','https://example.com/api/posts')}
      {field('列表路径','itemsPath','用点号定位新闻数组；顶层就是数组时留空。','data.items')}
      <Field label="标题字段路径" hint="多条候选路径用逗号分隔"><Input disabled={!valid} value={(Array.isArray(config.titlePaths)?config.titlePaths:[]).join(', ')} onChange={e=>set('titlePaths',e.target.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))}/></Field>
      {field('原文链接模板','urlTemplate','完整链接字段用 {raw:url}；文章 ID 可用 https://example.com/posts/{id}。','{raw:url}')}
      <Field label="摘要字段路径" hint="多条候选路径用逗号分隔"><Input disabled={!valid} value={(Array.isArray(config.summaryPaths)?config.summaryPaths:[]).join(', ')} onChange={e=>set('summaryPaths',e.target.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))}/></Field>
      {field('发布时间字段路径','publishedAtPath','例如 published_at；默认按 ISO 日期读取。','published_at')}
    </div>}
    {kind==='x_search' && field('X 搜索条件','query','支持 X 官方 API 或 SocialData；测试会消耗对应采集预算。','from:OfficialFPL -filter:replies')}
    {kind==='mp_account' && field('公众号原始 ID','ghid','需先配置 Dajiala 密钥；不是公众号显示名称。','gh_xxxxxxxxxxxx')}
    {!['mp_account','external'].includes(kind) && <Field label="首次导入条数" hint="建议 6 条，范围 1–60。首次导入会按原文时间归档。"><Input type="number" min={1} max={60} disabled={!valid} value={config._aihot?.initialBackfillLimit??30} onChange={e=>set('_aihot',{...config._aihot,initialBackfillLimit:Number(e.target.value)})}/></Field>}
    {kind==='external' && <p className="text-[13px] text-ink-3">外部脚本通过上报接口提交内容，无主动采集或列表测试。保存后请在添加方法中查看接入要求。<Link className="ml-2 text-accent" to="/admin/sources/help">上报说明 →</Link></p>}
    {!valid && <p className="text-[13px] text-hot">高级 JSON 格式有误，请先修复再填写。</p>}
    <details className="rounded-card bg-bg-sunk p-3"><summary className="cursor-pointer text-[13px] text-ink-2">高级配置 JSON（可编辑全部规则）</summary>
      <Textarea aria-label="高级采集配置 JSON" className="mt-3 font-mono !text-[12px]" rows={12} value={value} onChange={e=>onChange(e.target.value)} spellCheck={false}/>
      <Link className="mt-2 inline-block text-[12.5px] text-accent" to="/admin/sources/help">字段、模板和排错说明 →</Link>
    </details>
  </div>;
}
export function SourceTestPanel({result,stale=false}: {result:SourceTestResult|null;stale?:boolean}) {
  return <Card title="测试与提取数据" right={result && <Badge tone={result.status==='ok'?'ok':result.status==='empty'?'warn':'bad'}>{result.status==='ok'?'提取成功':result.status==='empty'?'没有匹配条目':'测试失败'}</Badge>}>
    {!result ? <Empty>填写地址和规则后点“测试提取”。结果包含标题、原文链接、时间、作者、摘要与结构化字段。</Empty> : <div className="space-y-3 text-[13px]">
      <p className="text-ink-3">{bj(result.testedAt,true)} · {result.ms} ms · 列表发现 {result.count} 条 · 规则处理后 {result.acceptedCount} 条 · 最多展示 20 条 · 未入库</p>
      {stale && <p className="rounded-card bg-amber/10 p-3 text-amber">配置已变更，下面是之前的测试结果，请重新测试。</p>}
      {result.matchesSavedConfig===false && <p className="text-amber">测试使用未保存配置，正式采集仍使用已保存版本。</p>}
      {result.error && <p role="alert" className="break-words rounded-card bg-hot-soft p-3 text-hot">{result.error}</p>}
      {result.warnings.map(w=><p key={w} className="text-ink-3">{w}</p>)}
      {!result.error && !result.items.length && <Empty>地址可以读取，但没有符合规则的条目。检查选择器、字段路径和过滤规则。</Empty>}
      <div className="max-h-[640px] space-y-3 overflow-y-auto">
        {result.items.map((item,index)=><details key={`${item.url}-${index}`} className="rounded-card border border-line p-3">
          <summary className="cursor-pointer font-medium text-ink">{item.title}</summary>
          <div className="mt-3 space-y-2 break-words text-ink-3">
            <a href={/^https?:\/\//i.test(item.url)?item.url:undefined} target="_blank" rel="noreferrer" className="break-all text-accent">{item.url}</a>
            <p>{item.publishedAt?bj(item.publishedAt,true):'无发布时间'} · 作者 {item.author||'未提供'} · 语言 {item.language||'未提供'}</p>
            <p className="whitespace-pre-wrap">{item.excerpt || '列表未提供摘要'}</p>
            {item.bodyText && <details><summary className="cursor-pointer">列表提供的正文（最多 8,000 字符）</summary><p className="mt-2 whitespace-pre-wrap">{item.bodyText}</p></details>}
            <Json value={item} label="结构化提取数据"/>
          </div>
        </details>)}
      </div>
    </div>}
  </Card>;
}
