# v77 — 当前联赛经理归属

2026-09-13，用户授权完成后直接上线。

- 动态及事件文字/图片分享显示：球员（球队简称）· 所属经理；确认为无人持有则显示自由球员。
- 归属按当前打开的Draft联赛当前阵容，包括查看历史事件；页内明确标注口径。
- 用官方稳定player code关联，严禁直接合并Classic/Draft element ID。缺失、重复标识或未知manager不视为自由球员。
- 原有联赛快照推送驱动更新，无额外上游查询。首页先后加载两种顺序都能收到归属。
- 旧事件只补code，不改变ID、检测时刻、得分、历史队伍信息。presentationVersion=4触发缓存安全升级。

426项测试通过；真实185条动态匹配、桌面/手机、极简分享图以及线上归属显示均检查完成。

发布文件：match-centre.js，public/app.js、match-centre.js、match-centre-layout.css、home-tab.js、discover.html、index.html。

仅重启fpl-weekly；配置、后台、核心计分逻辑和19个TOTW历史归属文件保持不变。生产比赛采集10秒、联赛900秒及HTTPS SSE正常。

备份：`/opt/fpl-weekly-backups/20260913-v77-before-1789311237201.tgz`。需要回滚时解包到`/opt/fpl-weekly`后仅重启`fpl-weekly`，不清空数据缓存。
