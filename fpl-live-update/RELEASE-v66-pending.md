# v66 — Discover 合并为工作台首页（本地待确认）

用户要求将 Discover 放到本轮战报前，命名「首页」。当前尚未收到本轮发布确认，生产维持 v65。

- 工作台首页标签排第一，无 hash 时默认显示；旧 weekly/trades 等深链接不变。Logo 切换首页、保留 league 参数。
- `/discover` 和 `/discover/` 302 至 `/${query}#home`。`/discover.html` 仍可提供原模板，供首页按需导入。
- 新 home-tab.js/css 从同源模板只导入 main 和 dialogs，Shadow DOM 隔离样式，不重复页头、页脚、分析脚本；不是 iframe。
- 比赛中心 mount(root) 兼容原独立页和首页；分享弹窗可挂载在 Shadow DOM，图片继续使用现有 Logo 和源时间。
- 首页独立于联赛快照加载，隐藏该标签时关闭比赛中心 SSE，回来后补齐；原十秒/三小时后端采集和十五分钟联赛刷新规则不变。
- 顶部刷新在首页时刷新比赛中心；其他标签仍刷新联赛。league-ready 使用事件仅在实际进入联赛模块时发出；统计增加「首页」标签名。
- 改动运行文件：server.js、analytics-report.js、public/index.html、public/discover.html、public/app.js、public/workspace-ui.js、public/match-centre.js、public/match-centre-share.js，以及新增 public/home-tab.js/css。修改脚本资源版本 v66，未改动的资源保留原版本。

验证：398 项自动测试通过；隔离预览 4320 端口，首页实际比分、战报切换、Logo 返回、1080×1723 分享 PNG、浏览器错误日志均已检查。配置、生产数据、原始用户镜像均未修改；尚未部署。

本地预览：http://127.0.0.1:4320/?league=47275#home
隔离运行目录：/private/tmp/fpl-v65-preview-hiPJy0（沿用测试数据与本地配置，运行代码为 v66）。
