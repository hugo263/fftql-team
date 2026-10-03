# v49 联赛赛程 — 仅本地

## v50 布局迭代（仍未上线）

顶部 THE MATCHUPS 改成紧凑逐轮对阵（桌面约 55px 行高，手机比分不折行）；中间新增独立经理整季对手列表，选择后从最早轮次到赛季末按 GW 排列，滚动容器保留所有轮次；底部总览改名 FDR，仍解释颜色仅参考当前排名、非官方难度。删除「下一轮遇见谁，未来几轮怎么走」。三个模块的选择互不影响。fixtures.js / fixtures.css 版本 50，新增两项回归共 267 项通过；真实 38 行经理赛程与桌面 / 手机均验证。

用户明确先不上线，本次没有服务器部署或生产写入。预览：http://127.0.0.1:3215/?league=47275#fixtures 。

参考 FFScout Fixture Ticker 的队伍 × GW 横向总览组织方式，沿用本站深绿 / 青柠 / 白卡片配色，不复制其素材或评分模型：
https://www.fantasyfootballscout.co.uk/2026/06/19/our-fpl-fixture-ticker-is-free-for-everyone-here-is-how-to-use-it

## 功能

- 导航新增「联赛赛程」，全联赛默认从当前进行中轮或下轮起展示 6 轮。
- 6 / 12 / 至赛季结束范围，可选择起始 GW、前后切换、回到当前赛程。
- 点击球队或筛选，查看该队未来对手与逐轮详情；全部球队时下方展示所选一轮完整对阵。
- 对手当前名次与前 1/3 色块提示，不声称为官方 FDR；当前排名会随快照更新。
- 未赛 VS、已赛真实分数；已赛对阵复用双球场和分享。Draft 无主客场加成。
- 北京时间显示 GW 截止时间，不冒充某场开球时间。未知时间 / 对阵显式留空。
- 手机横向滚动，队伍首列固定；桌面完整展示六轮。Classic 联赛明确没有 H2H 赛程。

## 数据与代码

server.js 从既有 league details 的完整 matches 生成 leagueSchedule（不增加上游请求），两种 entry ID 正确转换；未开始的 API 零分置 null。原 h2hByGw 和战报上限不变。schema5 令旧快照自动刷新，禁止清数据目录。

新增 public/fixtures.js、fixtures.css、tests/fixtures.test.js；修改 server.js、live-scoring.js、public/index.html、app.js、match-view.js、analytics-report.js 和相关回归测试。app / match-view / fixtures 静态引用 v49；其余资源不变。

验证：265 项自动测试通过；本地真实官方赛程、GW4–9 总览、球队筛选、GW3 已赛详情、桌面 / 手机无页面溢出检查通过。不作上线结论，必须等用户另行授权。
