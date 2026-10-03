export const CATEGORIES = [
  {
    "key": "prices",
    "label": "价格变动",
    "section": "价格变动",
    "guide": "已发生的 Classic 球员价格涨跌，价格预测须明确标注预测"
  },
  {
    "key": "injuries",
    "label": "伤停与复出",
    "section": "伤停与复出",
    "guide": "球员伤病、停赛、缺阵、康复与复出"
  },
  {
    "key": "lineups",
    "label": "首发与轮换",
    "section": "首发与轮换",
    "guide": "已确认首发、出场时间和轮换风险，预测阵容须标预测"
  },
  {
    "key": "fixtures",
    "label": "赛程变化",
    "section": "赛程变化",
    "guide": "比赛改期、空白轮、双赛轮和赛程难度变化"
  },
  {
    "key": "transfers",
    "label": "转会与新援",
    "section": "转会与新援",
    "guide": "现实转会、注册、球员加盟离队和新增球员"
  },
  {
    "key": "players",
    "label": "球员与选人分析",
    "section": "球员与选人分析",
    "guide": "以单个球员或候选人比较为核心的数据、角色、性价比和 Draft 排名；不收球队整体复盘、获奖快讯或球员宣传"
  },
  {
    "key": "teams",
    "label": "球队复盘",
    "section": "球队复盘",
    "guide": "球队阶段表现、攻防数据与 xG/xGC、战术体系、阵容稳定性及角色趋势，帮助经理判断球队资产；如 FPL half-term report。不是单个球员买卖建议，也不是球队宣传"
  },
  {
    "key": "news",
    "label": "英超快讯",
    "section": "英超快讯",
    "guide": "有具体事实的英超获奖、纪录等信息更新，通常低决策优先级；不是选人分析或新增 FPL 得分，不接收球队宣传/合影/祝贺/空链接"
  },
  {
    "key": "strategy",
    "label": "FPL 策略",
    "section": "FPL 策略",
    "guide": "Classic 队长筹码换人、Draft 豁免交易和玩法策略"
  },
  {
    "key": "rules",
    "label": "规则与公告",
    "section": "规则与公告",
    "guide": "官方玩法、计分、截止时间和规则说明"
  }
] as const;
export const ITEM_TYPES = [
  "price_change",
  "availability_update",
  "lineup_update",
  "fixture_update",
  "transfer_news",
  "opinion_analysis",
  "team_analysis",
  "news_update",
  "rules_update",
  "tutorial_explainer"
] as const;
export const CATEGORY_TAGS = [
  "价格变动",
  "伤停与复出",
  "首发与轮换",
  "赛程变化",
  "转会与新援",
  "球员与选人分析",
  "球队复盘",
  "英超快讯",
  "FPL 策略",
  "规则与公告"
] as const;
export const TOPIC_TAGS = [
  "Classic",
  "Draft",
  "通用",
  "官方确认",
  "媒体报道",
  "预测",
  "待核实",
  "公开部分摘要",
  "涨价",
  "跌价",
  "缺阵",
  "复出",
  "停赛",
  "轮换风险",
  "首发确认",
  "首发预测",
  "双赛轮",
  "空白轮",
  "队长",
  "筹码",
  "豁免",
  "交易",
  "国际比赛日",
  "GW1",
  "GW2",
  "GW3",
  "GW4",
  "GW5",
  "GW6",
  "GW7",
  "GW8",
  "GW9",
  "GW10",
  "GW11",
  "GW12",
  "GW13",
  "GW14",
  "GW15",
  "GW16",
  "GW17",
  "GW18",
  "GW19",
  "GW20",
  "GW21",
  "GW22",
  "GW23",
  "GW24",
  "GW25",
  "GW26",
  "GW27",
  "GW28",
  "GW29",
  "GW30",
  "GW31",
  "GW32",
  "GW33",
  "GW34",
  "GW35",
  "GW36",
  "GW37",
  "GW38"
] as const;
export const ENTITY_TAGS = [
  "阿森纳",
  "阿斯顿维拉",
  "伯恩茅斯",
  "布伦特福德",
  "布莱顿",
  "切尔西",
  "考文垂",
  "水晶宫",
  "埃弗顿",
  "富勒姆",
  "赫尔城",
  "伊普斯维奇",
  "利兹联",
  "利物浦",
  "曼城",
  "曼联",
  "纽卡斯尔",
  "诺丁汉森林",
  "热刺",
  "桑德兰"
] as const;
export const TAG_SYNONYMS: Readonly<Record<string,string>> = {"伤病":"伤停与复出","伤停":"伤停与复出","球员分析":"球员与选人分析","规则":"规则与公告","价格":"价格变动","FPL策略":"FPL 策略","首发":"首发与轮换","转会":"转会与新援"};
export const CATEGORY_BY_ITEM_TYPE: Readonly<Record<string,string>> = {
  "price_change": "价格变动",
  "availability_update": "伤停与复出",
  "lineup_update": "首发与轮换",
  "fixture_update": "赛程变化",
  "transfer_news": "转会与新援",
  "opinion_analysis": "球员与选人分析",
  "team_analysis": "球队复盘",
  "news_update": "英超快讯",
  "tutorial_explainer": "FPL 策略",
  "rules_update": "规则与公告"
};
export const ENTITIES: Record<string,{name:string;displayTag:string|null;aliases:string[]}> = {
  "ars": {
    "name": "阿森纳",
    "displayTag": "阿森纳",
    "aliases": [
      "Arsenal",
      "阿森纳",
      "ARS"
    ]
  },
  "avl": {
    "name": "阿斯顿维拉",
    "displayTag": "阿斯顿维拉",
    "aliases": [
      "Aston Villa",
      "阿斯顿维拉",
      "AVL"
    ]
  },
  "bou": {
    "name": "伯恩茅斯",
    "displayTag": "伯恩茅斯",
    "aliases": [
      "Bournemouth",
      "伯恩茅斯",
      "BOU"
    ]
  },
  "bre": {
    "name": "布伦特福德",
    "displayTag": "布伦特福德",
    "aliases": [
      "Brentford",
      "布伦特福德",
      "BRE"
    ]
  },
  "bha": {
    "name": "布莱顿",
    "displayTag": "布莱顿",
    "aliases": [
      "Brighton",
      "布莱顿",
      "BHA"
    ]
  },
  "che": {
    "name": "切尔西",
    "displayTag": "切尔西",
    "aliases": [
      "Chelsea",
      "切尔西",
      "CHE"
    ]
  },
  "cov": {
    "name": "考文垂",
    "displayTag": "考文垂",
    "aliases": [
      "Coventry City",
      "考文垂",
      "COV"
    ]
  },
  "cry": {
    "name": "水晶宫",
    "displayTag": "水晶宫",
    "aliases": [
      "Crystal Palace",
      "水晶宫",
      "CRY"
    ]
  },
  "eve": {
    "name": "埃弗顿",
    "displayTag": "埃弗顿",
    "aliases": [
      "Everton",
      "埃弗顿",
      "EVE"
    ]
  },
  "ful": {
    "name": "富勒姆",
    "displayTag": "富勒姆",
    "aliases": [
      "Fulham",
      "富勒姆",
      "FUL"
    ]
  },
  "hul": {
    "name": "赫尔城",
    "displayTag": "赫尔城",
    "aliases": [
      "Hull City",
      "赫尔城",
      "HUL"
    ]
  },
  "ips": {
    "name": "伊普斯维奇",
    "displayTag": "伊普斯维奇",
    "aliases": [
      "Ipswich Town",
      "伊普斯维奇",
      "IPS"
    ]
  },
  "lee": {
    "name": "利兹联",
    "displayTag": "利兹联",
    "aliases": [
      "Leeds",
      "利兹联",
      "LEE"
    ]
  },
  "liv": {
    "name": "利物浦",
    "displayTag": "利物浦",
    "aliases": [
      "Liverpool",
      "利物浦",
      "LIV"
    ]
  },
  "mci": {
    "name": "曼城",
    "displayTag": "曼城",
    "aliases": [
      "Man City",
      "Manchester City",
      "曼城",
      "MCI"
    ]
  },
  "mun": {
    "name": "曼联",
    "displayTag": "曼联",
    "aliases": [
      "Man Utd",
      "Manchester United",
      "曼联",
      "MUN"
    ]
  },
  "new": {
    "name": "纽卡斯尔",
    "displayTag": "纽卡斯尔",
    "aliases": [
      "Newcastle",
      "纽卡斯尔",
      "NEW"
    ]
  },
  "nfo": {
    "name": "诺丁汉森林",
    "displayTag": "诺丁汉森林",
    "aliases": [
      "Nott'm Forest",
      "Nottingham Forest",
      "Nottm Forest",
      "诺丁汉森林",
      "NFO"
    ]
  },
  "tot": {
    "name": "热刺",
    "displayTag": "热刺",
    "aliases": [
      "Spurs",
      "Tottenham",
      "Tottenham Hotspur",
      "热刺",
      "TOT"
    ]
  },
  "sun": {
    "name": "桑德兰",
    "displayTag": "桑德兰",
    "aliases": [
      "Sunderland",
      "桑德兰",
      "SUN"
    ]
  }
};
// Match every spelling, not just the first two; codes are case-sensitive and Latin names need word boundaries.
export const IDENTITY_LEXICON: ReadonlyArray<{id:string;name:string;patterns:RegExp[]}> = Object.entries(ENTITIES).map(([id,e])=>({id,name:e.name,patterns:e.aliases.map(a=>{
  const literal=a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  return /[一-鿿]/.test(a) ? new RegExp(literal,"u") : new RegExp(`(?:^|[^\\p{L}\\p{N}])${literal}(?=$|[^\\p{L}\\p{N}])`,/^[A-Z]{2,3}$/.test(a)?"u":"iu");
})}));
export const PUBLISHER_DOMAINS: ReadonlyArray<{entityId:string;domains:readonly string[]}> = [];
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{entityId:string;pattern:RegExp}> = [];
