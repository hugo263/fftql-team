export const SITE = {
  name: "TQL 资讯", subject: "FPL",
  homeTitle: "TQL 资讯 · FPL 新闻、伤停与价格变化",
  description: "聚合 FPL 与英超资讯，提供中文摘要、来源链接、分类标签和官方价格变化，兼顾 Classic 与 Draft。",
  tagline: "为下一轮，掌握每条变化", locale: "zh-CN",
  defaultUrl: "https://news.fftql.team", mcpPrefix: "tql_news",
  contactEmail: null as string | null, footerNote: "TQL · FPL 新闻与数据",
  icp: "粤ICP备2026075584号-3",
  organization: { name: "TQL", founder: null as null | { name: string; url?: string; description?: string } },
  crawlerName: "TQLNewsBot",
} as const;
export const ABOUT = {
  kicker: `关于 ${SITE.name}`, headline: ["下一轮的决定，", "从掌握变化开始。"] as [string, string],
  lead: "汇集公开 FPL 资讯与官方球员数据，保留原文出处，用中文摘要和标签帮助你找到相关信息。无需注册。",
  steps: {
    collect: "读取公开 RSS 和 FPL 官方数据，持续检查新增资讯与球员状态。",
    store: "保留来源和发布时间，将同一事件的报道归在一起。价格以官方数据的连续观测为准。",
    select: "生成中文标题与摘要，按伤停、首发、赛程、价格等分类，区分 Classic、Draft、事实与预测。",
    publish: "最新资讯随采集更新；日报在有足够收录内容时生成。来源文章只展示摘要和原文链接。",
  },
  maker: null as null | { name: string; greeting: string[]; avatarSourceId?: string | null; wechat?: {title:string;note:string}; feishu?: {title:string;note:string} },
  copyright: "本站是独立资讯索引，与英超及 Fantasy Premier League 无官方隶属关系。原文版权归来源所有。更正或下架可通过",
} as const;
export function withSubject(noun: string): string { return `${SITE.subject} ${noun}`; }
