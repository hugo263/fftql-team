# v86 — 六项导航与联赛趣味榜

发布日期：2026-09-21。用户明确授权实现、验证并直接上线。

## 功能

- 一级：首页、本轮战报、联赛榜单、联赛赛程、交易中心、阵容工具。
- 联赛榜单：积分榜 / 趣味榜。
- 交易中心：交易动态与收益 / 自由球员 / 交易评估。
- 阵容工具：阵容对比 / 阵容分享 / 下轮预测。
- 旧叶子 hash 保留，键盘导航、选中态和对应面板保持一致。
- 趣味榜支持单轮、赛季累计、轮次选择、经理明细与PNG复制；不支持复制时提供预览/保存入口，不自动发送微信。
- 战报底部增加板凳榜摘要，点击进入对应GW趣味榜。

## 数据口径

- 板凳大亨：官方当轮15人名单，经现有自动换人规则后的4名替补原始Draft得分，含负分；赛季累加各轮。
- 最惨高分：单轮输球者按得分降序；赛季累计输球轮次得分，平局不计。
- 险胜之王：单轮按正胜差升序；赛季按不超过3分的获胜次数降序，同次数平均胜差小者优先。
- 仅统计真实经理；Classic无H2H结果不虚构对手；未开始、缺失、暂定均明确显示。
- 复用快照构建的raw live、历史picks和当前matchDetails，不增加客户端采集轮询。
- 官方event finished、data_checked非false、所有比赛完赛、所有经理完整且无预判换人后才冻结。
- 缓存：`data/cache/fun-round-v1-league{leagueId}-season{season}-gw{gw}.json`；结算raw live为`fun-live-v1-season{season}-gw{gw}.json`。不覆盖TOTW归属文件。
- 旧工作台缓存缺少funRankings.version=1时按原SWR触发重建。

## 验证

- 完整自动测试560通过、0失败，包括新增14条趣味榜测试。
- 本地真实官方数据：GW1–4完整结算、GW5完整但暂定；独立核对224个历史替补球员原始分，当前14队与双球场替补一致。
- 桌面与375px手机导航无横向溢出；原功能入口、经理明细、Esc焦点/滚动恢复、战报跳转通过。
- PNG生成与剪贴板写入成功反馈已验证；工具拒绝blob预览导航，未绕过，未声称完成导出PNG的目视检查。
- 线上HTTPS：六项导航、历史GW选择、赛季累计、经理明细正常，无记录到的控制台错误。
- 线上截至GW4板凳榜：英超不倒翁31分，明细2+3+16+10。

## 发布

发布8文件：server.js、fun-rankings.js、public/app.js、public/index.html、public/workspace-ui.js、public/fun-model.js、public/fun-rankings.js、public/fun-rankings.css。

仅重启fpl-weekly（9090），不修改共享服务器其他应用/vhost。配置、计分核心、后台、v85交易明细资产哈希不变；43个旧归属文件和23个流量文件保留。GW1–4各14经理已冻结；GW5有14经理暂定结果，与14侧当前对战替补一致。首次生产历史补齐构建51秒，随后强制构建约24秒；读取使用共享快照缓存。

备份：`/opt/fpl-weekly-backups/20260921-v86-before-1789959499261.tgz`。

如需回滚：恢复备份中4个被修改的既有文件（server.js、public/app.js、public/index.html、public/workspace-ui.js），将4个v86新增代码资产移入独立可恢复备份目录，重启fpl-weekly并核对HTTPS。新增fun数据缓存可保留供以后复用；勿删除配置、analytics、TOTW、整个data或工作目录。

最新源码位于本工作副本。原WorkBuddy目录仍旧版，不可用于覆盖生产。
