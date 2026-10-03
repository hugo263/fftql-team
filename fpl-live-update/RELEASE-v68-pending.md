# v68 — 自由球员轮次、榜单对齐与交易筛选（本地）

承接未发布的 v66/v67，生产仍 v65，本次无发布指令。

- 自由球员得分表头使用 FPLTimeline.reportGw，与战报一致；该列读取 liveGwPoints，不再把 lastFinishedGw/lastGwPoints 用作当前轮。兼容旧快照仅在报告轮等于上一完赛轮时回退 lastGwPoints，否则显示缺失而非跨轮冒用。预测列仍使用原 upcomingGw。
- style.css 中提高 th.ta-r/th.ta-c 与 td 的对齐规则优先级，修复 `.table th` 覆盖类名造成的左/右错位；手机 th 与 td 统一9px水平padding。覆盖标准自由球员、积分榜等 table；原赛程和交易对比专用表已有一致列规则，不改业务。
- 将已有 tcGwSel 从交易评价总标题移入左侧交易收益／损失卡片，添加「轮次」可见标签。沿用 currentByGw[G]、自动最新有得分轮次及手动选择保持逻辑，不另造重复筛选器。历史榜仍按选定轮次回看，说明同步更新。
- app.js、style.css、workspace-refined.css引用版本68，其余资源保留原版本。

409 项测试通过。真实浏览器：GW4表头、自由球员11列和积分榜10列表头/body对齐与padding核验，GW2选择实际显示收益29/损失-6/净23，恢复自动。隔离预览4320已更新，无生产或原始镜像写入。

预览：http://127.0.0.1:4320/?league=47275#trades
