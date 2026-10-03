# v61 · 战报交易双倒计时

2026-09-08。用户确认自由球员市场开放 / 本轮阵容截止，并授权验证后上线。

## 范围

- 移除战报顶部平均分、最高分、最低分、TOTW 最高分和交易笔数五张卡；其余战报和趋势图保留。
- 开始使用官方 Draft bootstrap `events.data[].waivers_time`；截止使用同一数据源 `deadline_time`，不使用经理互换的 `trades_time`。
- 每张卡独立选择第一个尚未到达的事件。GW4 开放时，左卡变 GW5，右卡仍 GW4；GW4 截止时右卡才变 GW5。不限于固定轮次。
- 显示北京时间绝对时间和天/时/分/秒。历史 GW 选择不改变未来倒计时；隐藏页签停止刷新，恢复立即校准。无后续官方时间时诚实显示空态，不造 GW39。
- schema7 使旧快照自然重建以带上 `tradeWindows`；不删除任何缓存/流量/归属数据。

## 验证

- 336 项 Node 测试通过：边界前后、独立跨轮、时间调整、缺失/赛季结束、实际 buildSnapshot 接线、既有计分和功能回归。
- `node --check public/app.js`、`node --check server.js` 通过。
- 本地实际服务 3217 读取官方 API：38 个时间窗口、14 队、reportGw3、schema7。
- 官方 GW4 开放 2026-09-11 20:30、截止 2026-09-12 20:30（北京时间）；GW5 开放 9/18 01:30、截止 9/19 01:30。
- 本地手机 433px 单列与 1280px 双列无溢出；切 GW1 保持未来 GW4 倒计时。
- 官方规则参考：https://www.premierleague.com/en/news/1245444 。自由球员市场在 Waiver 处理后开放，至阵容 deadline。

## 发布清单与回滚

仅6个代码文件：server.js、live-scoring.js、public/index.html、public/app.js、public/trade-countdown.js、public/trade-countdown.css。

发布前备份既有4个文件，新增2个文件回滚时可保留但不引用。恢复备份后重启 fpl-weekly，schema6 会正常重建其快照。不回滚 config.json 或 data/。

生产发布状态：2026-09-08 15:53（北京时间）完成。systemd active，health ok；实际快照 schema7 / reportGw3 / 14队 / 38窗口。生产浏览器已确认两张GW4倒计时、正确北京时间与手机单列布局，旧KPI已移除。

备份：`/opt/fpl-weekly-backups/20260908-v61-before.tgz`；原始项目镜像备份：`/private/tmp/fpl-original-v61-before-20260908.tgz`。
