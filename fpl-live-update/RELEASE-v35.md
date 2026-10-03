# Draft 工作台 v35 发布记录

2026-09-05（北京时间）已发布至 https://fpl.xiaokailabs.com/ 。

## 发布范围

仅发布已确认的 Draft 工作台及此前要求的实时 GW 支持，共 7 个文件：

- server.js
- live-scoring.js
- public/index.html
- public/app.js
- public/timeline.js
- public/workspace-ui.js
- public/workspace-refined.css

没有发布 discover.html / discover.css、admin 页面或独立资讯首页。`designs/fpl-lab-v1` 保持原有版本，不在发布包内。生产 `config.json`、data/analytics、data/leagues 和历史缓存均保留；端口保持 9090。上述 7 个文件已同步回用户原始 fpl-weekly 项目目录。

## 验收

- 20 项回归测试通过；Node 语法检查通过。
- systemd 服务 active；服务器本机 API 返回 200，14 名经理、652 名球员。
- 线上 GW3 实时战报：平均 4.7，最高 14；TOTW 门将 A.Becker 8 分。
- GW2 历史战报可切换，平均 40.6，最高 55；TOTW B.Fernandes 23 分。
- 实时积分榜 14 行，MustBeRo 本轮 2 分；交易默认 GW3 本轮、已成交 40 笔。
- 8 个模块均可打开；自由球员、30 件对比球衣、1080×1350 分享画布正常显示。
- 390px 手机视口战报与阵容对比没有页面横向溢出，门将在球场上方。
- 自动更新时间从 14:06:41 推进至 14:09:16；控制台未发现错误或警告。

## 回滚备份

服务器代码备份：`/opt/fpl-weekly-backups/20260905-v35-workspace-before.tgz`。

备份包含部署前的 server.js 与 public/，不包含或覆盖运行配置及 data/。如需回滚，将备份还原至 `/opt/fpl-weekly` 后重启 `fpl-weekly`，无需改动 Nginx、DNS 或其他服务。
