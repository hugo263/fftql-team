# v48 — 完赛状态和交易轮次

2026-09-07 09:39（北京时间）发布至 https://fpl.xiaokailabs.com 。用户确认：验证后直接上线。

## 原因与更新

官方 GW3 的 10 场比赛已全部 finished_provisional:true，但 finished:false，event.finished / data_checked 也仍为 false。旧判定只认 finished，因此 Live 一直不消失。

- 按真实完场标志停止 Live；待官方结算期间明确标「已完赛 · 待结算」，每分钟继续同步修正，不能提前冻结分数。
- 战报、积分榜、TOTW、双球场统一状态；最近完赛轮 GW3、预测 GW4。
- 交易收益以最新真实有得分的 GW 为默认；下一轮 deadline 或全零占位分不切换。零分出场同样算已产生数据。
- 收益 GW 和交易明细 GW 两个独立选择器；收益可以切到历史 GW，再选「自动」恢复跟随；明细可以提前看下轮已成交交易。
- 仅改变收益统计截止轮，不改变球员贡献、持有期或经理净收益算法。
- snapshotSchema=4，旧快照自动重建；app / timeline / match-view JS URL 使用 v48。

## 验证

261 项 Node 测试全部通过，包括最后一场完赛、剩余 / 延期 / 双赛赛程、结算前不写固定得分缓存、零分占位、真实零分出场、历史选择保留、独立选择器与全流程状态。

本地真实数据与桌面 / 手机页面检查：GW3 已完赛，7 场双球场均 finished:true / live:false / finalizing:true；预测 GW4；收益默认 GW3（+40 / -30 / +10 为当时数据）；明细可选 GW4。历史收益与明细选择互不影响，无页面横向溢出。

生产服务 active，健康接口 ok；默认与专属联赛快照均 schema4 / reportGw3 / lastFinishedGw3 / upcomingGw4 / reportLive:false / throughGw3。浏览器线上验证标记与两个选择器正确。8 个生产文件 SHA-256 与测试源一致。

## 发布 / 回滚

发布文件：server.js、live-scoring.js、trade-returns.js、match-detail.js、public/index.html、public/app.js、public/timeline.js、public/match-view.js。

仅重启 fpl-weekly；config.json、data/、其他服务和 vhost 保持不变。

生产代码备份：`/opt/fpl-weekly-backups/20260907-v48-before.tgz`。如获回滚授权，在 `/opt/fpl-weekly` 解压恢复这 8 个旧文件并重启 fpl-weekly；不要回滚配置或流量数据。schema4 快照在旧版本自动失效并重建。
