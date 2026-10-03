# v53 — 分享 Logo 与赛程/战报累计更新

2026-09-07 已发布，用户明确授权「完成后把之前的改动也上线」。

最终同批补强为 **v54**：线上首次导出偶现 Logo 二次请求超时退回文字，现两种分享器复用已加载页头 img，失效时保留原有限时加载。app/match-share 缓存 v54，最终272项测试通过；线上下载 `FPL-Draft-交易名片-加布惊焰软糖形态 (5).png` 目视确认浅绿 TQL Logo，仍1080×1350。仅追加3个前端文件，无额外服务重启；下面v53记录为主发布过程。

## 内容

- 阵容交易名片 Canvas 预览、下载/复制/系统分享，与双球场 PNG 都使用页头当前浅绿 TQL 图。沿用同源原图 URL，等比显示，圆角裁剪棋盘格边角；失败保留文字降级，加载超时 5 秒。原图片尺寸、球员信息、网站链接及二维码不变。
- 累计发布 v49/v50：完整官方 Draft H2H 赛程、顶部紧凑逐轮对阵、中部按经理查看全部赛季对手、底部 FDR；三个筛选独立。FDR 颜色依据当前排名，不冒充官方难度。
- 累计发布 v51/v52：战报赢家比分深绿白字，胜标记；统一等宽双格，无冒号、无平局底部文字，缺失分数显示破折号。
- snapshotSchema=5，旧缓存正常失效并重建，不清空数据。

## 验证

- 270 项 Node 回归测试通过。
- 本地阵容 PNG 实际下载并视觉确认新版 Logo；双球场生成返回成功。浏览器安全策略禁止打开 blob 图片标签，未绕过；双球场构图/Logo URL/错误降级由可执行 Canvas 测试验证。
- 线上服务 active、健康 ok。真实 league47275 快照：schema5、GW3 非 Live、14 位经理、266 场、38 轮；未来赛程分数均 null。
- 线上新资源版本生效，战报全部七场比分均为两格；经理 bees 选择后显示38行，手机无页面横向溢出；分享导出触发成功。

## 发布和回滚

仅上传10个代码文件：

server.js、live-scoring.js、analytics-report.js、public/index.html、public/app.js、public/match-view.js、public/match-share.js、public/fixtures.js、public/fixtures.css、public/match-results.css。

现有 Logo 文件已在生产，SHA256 与本地一致。新资源 app/match-share v53、fixtures v50、match-results v52、match-view v49。只重启 fpl-weekly，未修改 nginx、config.json、data/ 或其他站点。

生产旧代码备份：`/opt/fpl-weekly-backups/20260907-v53-before.tgz`，包含7个既有文件。需回滚时，获得授权后在 /opt/fpl-weekly 恢复该包并重启 fpl-weekly；新增的3个静态资源可保留，旧 HTML 不再引用。旧 schema4 逻辑会自动重建不兼容快照，勿回滚联赛/流量数据。
