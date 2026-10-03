# v83 · 完赛24小时后切换下一GW

2026-09-18 已上线。用户先提出战报切换，随后追加首页实时比分相同规则并明确「完成后直接上线」。

## 规则与数据边界

- 战报默认轮次和首页比赛中心采用共同展示时间线：当前轮全部官方fixtures finished/finished_provisional后保留24小时，再默认下一GW；下一轮deadline先到则按原规则及时进入。
- `gameweek-rollover.js` 在 `data/cache/gameweek-rollover-v1.json` 按赛季保存首次确认整轮完赛的时间。共享服务与联赛快照读取同一记录，不随刷新或重启延后。
- 官方接口没有终场时间字段。旧轮次在首次部署前已经完赛时，只有全轮官方完赛且最后开球+3小时保守比赛窗口+24小时已经过去，才回填 `legacy-estimate`；这不是准确的终场时刻。正常跟踪采用 `observed`，不能把迟结束且已观察过的比赛回填成旧时间。
- 未完赛、延期或待定比赛不提前切换；官方恢复未完赛状态重置计时，GW38不生成GW39。
- 实际计分 `reportGw/currentGw` 保持deadline逻辑，不改Draft得分、DEFCON、自动替补、积分榜、交易收益或历史归属。新增展示元数据 `weeklyPolicyVersion/weeklyDefaultGw/weeklySwitchAt/nextWeeklyGw/weeklyFinishedAt/weeklyFinishBasis`。
- 战报新轮来自完整leagueSchedule，未开赛不显示假0分、旧轮分或虚假TOTW。可打开原赛前双球场。手选历史轮在刷新期间保留。
- 首页默认已为GW5，手选GW4仍可查看原结果。首页缓存策略版本3，在展示切换/下一deadline处唤醒；工作台缓存同样在切换边界过期并通知。前端战报可在已知时间边界本地切换。

## 验证

- 全套542项通过（含6项新回归），语法检查通过。
- 测试覆盖24小时边界前后、持久化重启、延迟完赛/延期、旧数据回填、赛季隔离/GW38、工作台缓存边界及首页默认切换；未来轮不请求live分数。
- 更新旧测试夹具：比赛中心deadline改为逐周有效日期，流量缓存夹具增加展示策略版本；流量四项最初因旧夹具主动触发升级抓取而失败，修正夹具后全部通过。
- 本地真实API：GW5联赛7场全部VS；空TOTW明确待比赛；双球场30人均待开赛；历史GW4有最终比分与5-3-2最佳阵容；首页GW5含10场、无伪得分/事件。
- 手机375px无横向溢出；正式HTTPS战报GW5、全部VS、无记录到控制台错误。生产首页已接收GW5赛程；页面重载后页头同步GW5。
- 生产核心报告轮仍GW4，展示轮与首页均GW5。24份既有归属快照哈希不变，20个既有流量文件保留；config/live-scoring/auto-subs/trade-returns/admin及首页前端脚本哈希不变。health/admin均200。

## 发布和回滚

仅发布7文件：gameweek-rollover.js、server.js、match-centre.js、update-stream.js、public/timeline.js、public/app.js、public/index.html。app/timeline资源版本83，其余不动。

包：`/private/tmp/fpl-v83-release-20260918.tgz`。
执行脚本：`/private/tmp/fpl-v83-deploy.cjs`（服务器副本 `/tmp/fpl-v83-deploy.cjs`）。
备份：`/opt/fpl-weekly-backups/20260918-v83-before-1789699680833.tgz`（6个既有运行文件）。

先比对生产旧文件哈希、白名单包文件、新文件不存在，再备份和原子替换，仅重启fpl-weekly。首次包检查发现macOS附带属性文件，在任何线上改动前停止；重打纯代码包后发布成功。失败会自动解包备份并重启。人工回滚也仅恢复该备份六文件并重启，未引用的新模块可保留，禁止清理data。

最新源在 `work/fpl-live-update`；隔离预览 `/private/tmp/fpl-v83-preview-dz1L2U`，端口4321。没有覆盖旧WorkBuddy目录、其他静态预览或部署配置。
