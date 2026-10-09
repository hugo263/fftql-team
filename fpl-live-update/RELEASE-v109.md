# v109 · 国际比赛日专题补充价格涨跌

2026-10-08（北京时间）。用户要求将价格涨跌加入已上线的同一篇专题，并授权直接更新线上。本次已发布主站四个静态文件，既有文章 `tql-international-20261008` 已从 revision 1 更新为2。资讯运行版本仍是 `/opt/tql-news/releases/20261003-v14-rss-retry`；待发布v15未包含在本次更新中。

## 内容与展示

保留原题《FPL 资讯｜英超回来了！国际比赛日盘点与 GW6 队长参考》和国家队、伤情、队长内容，在截止提醒前加入第4节“价格涨跌”，截止提醒顺延为第5节。主站弹窗、独立静态全文和资讯归档同步修订。

- 主站全文：<https://fftql.team/articles/fpl-international-20261008.html>。
- 资讯归档：<https://news.fftql.team/items/tql-international-20261008>。
- 统计范围为**2026年9月21日至10月8日**，现价核验截至**10月8日09:40（北京时间）**，包含国际比赛日后至更新时的变动，不将10月7—8日误写成国家队比赛日期。
- 全区间76人、76次变动：**13人净上涨、63人净下跌，每人净幅均为£0.1m**，没有重复变动或涨跌抵消。人数不是转入/转出人数。
- 展示全部13名上涨球员和8名重点下跌球员：B.Fernandes、João Pedro、Eze、Reece James（切尔西）、Szoboszlai、De Ligt、Aït-Nouri、Greaves，共21行；63是全体下跌人数，8行只是重点名单。
- 每行列出本期首次变动前的价格、截至核验时的现价及净幅，单位£m。现价为09:40的观测快照，不是持续自动刷新的报价，也没有用赛季累计涨跌替代区间变动。
- 正文现为五节、五张图片，原八行国家队统计保留，价格表另计21行；门户摘要/主题标签加入价格，阅读时长约7分钟。
- 真实API流、分类/频道/搜索、分页去重、独立价格观察及普通详情逻辑保留。原置首规则继续只作用于API已返回的本篇，到 `2026-10-10T10:00:00Z`（北京时间18:00）恢复原排序。

## 数据来源与核验

完整历史来自 [FPL.page 已确认价格记录](https://fpl.page/price-changes)。公开HTML内的 `priceChangesHistory` 包含明确的 `playerElementId`、`oldCost`、`newCost`、`changeDate`；仅解析JSON，没有执行页面代码。旧价和净幅是原始字段计算结果，不是按£0.1m步长猜测。

本站 [FPL官方数据](https://fantasy.premierleague.com/api/bootstrap-static/) 观测始于**9月30日21:20:50**，截至**10月8日09:40:27**共有1096次观测、26条变动。本站没有9月21日基准，故完整区间必须归因于FPL.page，不能描述成全部由本站官方采集历史支持。

- 数据库查询采用 `REPEATABLE READ READ ONLY`，确认 `transaction_read_only=on`；仅读取既有价格数据，没有触发采集或模型。
- 本站667名球员首尾均存在，26条旧/新价与各自前后快照一致；按赛季＋稳定player code的连续链、净额和现价检查通过。
- FPL.page的18个日历日期完整，76条记录全部经Classic ID映射到本站稳定code，姓名一致。
- 两源重叠26条按稳定code、北京时间日期和旧/新价逐项比对，**26/26相符**；各自发现时间不同，不宣称精确官方调价时刻相同。
- 76名变价球员均与9月30日官方基准端点、10月8日09:40官方现价吻合，**76/76通过**；无重复、方向错误或断链。独立网页逐日核数同样为13涨、63跌。

证据和复查代码在本次发布目录：`price-raw.json`、`price-evidence.json`、`fpl-page-price-changes.html`、`fpl-page-history.json`、`full-window-evidence.json`，以及 `read-prices.mjs`、`analyze-prices.cjs`、`analyze-full-window.cjs`。完整证据的 `.rows` 为展示的21行。

## 实际发布范围与修订

只发布四个 `public/` 路径：`editorial-roundup.css`、`editorial-roundup.js`、`articles/fpl-international-20261008.html`、`portal.html`。门户和独立文章专题资源引用同步为109，保留v108.1封面 `height:auto`；`portal.js` 和主站后端未改。四份构建产物已同步回主站源码目录的 `public/`。

主站无重启、配置保留、主站data未改。资讯端通过v14既有接口执行有审计的正文修订，没有切runtime或修改采集配置、预算；保持普通池 `selected=false`、`silent=true`，不发通知、不调用模型、不排正文处理任务。

实际article revision、publication revision、override version均为**2**。原 `published_at`、`discovered_at`、`timeline_at` 均保留为 `2026-10-08T01:28:49.840Z`；公开排序时刻及backfill状态由事务检查保留。没有另建文章或通过改时间置顶。重复 `--dry-run` 返回 `already-updated`、`changed=false`，未生成第三版。

## 验证记录

- `tests/news-integration.test.js` 共10项通过。
- 本地1280、390、320px价格表无整页或表格溢出。
- 正式四静态资源经公网HTTPS读取，SHA256与本次 `expected.json` 全部一致；health HTTP 200。
- 正式首页摘要、价格主题标签及约7分钟显示正确；弹窗五图加载、五项目录、价格锚点和21行价格表检查通过。
- 正式站390px专题弹窗检查通过：页面宽度与scrollWidth均390px，两张价格表clientWidth与scrollWidth均332px，共21行；主站弹窗价格概览与上涨表截图保存为本次发布目录的 `live-prices.png`，已浏览检查。320px仅进行了上条本地检查，没有将其记为线上验收。
- 资讯归档实际浏览确认五节、五图、21行价格表、价格目录和原09:28发布时间。公开详情API为revision2、完整body、总计29行数据（原国家队8行＋价格21行）；按英文名与证据逐行比对，21行旧价/现价/净变化均正确，结果保存在 `live-content-checks.json`。
- 最终公网四文件哈希及health HTTP 200结果保存在 `live-http-checks.json`，发布结果与备份创建记录保存在 `release-result.json`。
- 本次未重复运行主站全部业务回归，也未测试或发布资讯v15；v108的验收不能代替本次新增内容验收。

## 发布文件与备份

本地脚本、payload、四静态构建产物与证据：

`/Users/ken/Documents/ChatGPT/fftql.team/deploy/international-prices-20261008/`

| 范围 | 位置 |
| --- | --- |
| 主站静态暂存 | `/opt/fpl-weekly/releases/v109-editorial-prices-20261008` |
| 原四静态文件备份 | `/opt/fpl-weekly/backups/v109-editorial-prices-1791424404348-e5629cf78a60` |
| 正文修订前快照 | `/opt/tql-news/backups/editorial-international-prices-20261008/before.json` |
| 服务器内容脚本暂存 | `/opt/tql-news/editorial-international-prices-20261008/` |

`deploy-static.cjs` 固定v108.1四文件基底、配置与暂存哈希，备份后逐文件原子替换，失败恢复并保留并发变化。`update-editorial.ts` 校验原revision/override/正文/payload，在事务内修订与写审计；对后续人工或并发修改拒绝覆盖。没有数据库迁移。

## 回滚边界

静态回滚使用本次 `deploy-static.cjs --rollback`，校验当前文件后恢复v108.1四文件基底；静态回滚不会还原数据库正文。

如需撤销正文修订，应读取当前article/publication/override版本，通过有审计的后续修订恢复快照正文并保留原时序，不能直接删版本、覆盖并发编辑或把旧静态文件当作数据库回滚。若目标为撤下整篇，则通过既有可见性接口写新审计。待发布v15始终与本次内容修订分开处理。
