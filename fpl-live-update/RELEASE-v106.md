# v106 — 筛选留白与 GW 栏交互

2026-10-05，用户明确授权“可以上线了”，已发布 https://fftql.team。

## 内容

- 比赛中心事件/比分筛选去除通用高特异性 padding:0 覆盖；桌面18px、手机16px，与标题对齐。
- 删除 discover 模板底部长段刷新说明及容器，ShadowRoot 工作台同步生效；真实轮询/SSE和计分说明未改。
- 联赛赛程独立保存七轮窗口：内部点击不重排、不替换按钮节点；点击首尾移动一格露出相邻轮次。普通数据刷新、经理切换稳定；季初季末不越界，跳转、回到本轮和手机最小滚动保留。

## 验证

- `node --test tests/*.test.js`：579通过，0失败。
- `scripts/verify-v106-browser.cjs`：本地及生产均通过；1440/768/390/320px筛选与标题左边缘一致，无整页横向溢出，长段说明不存在。
- 真实浏览器验证GW内部节点/坐标不变、两端单步移动、数据刷新/经理切换稳定、GW1/38边界及手机选中项可见。
- 五个公网静态文件SHA256与本地一致；`/api/health`正常，fpl-weekly保持active。
- 证据：`output/fpl-v106/local-checks.json`、`production-checks.json`及截图。初次回归只有home-tab缓存版本旧断言失败，更新为106后全量通过。

## 发布与回滚

只发布 `night-ui.css`、`fixtures.js`、`discover.html`、`home-tab.js`、`index.html`；依赖先、index最后。线上原文件与下载审阅基线一致、上传文件哈希一致后才发布；发布脚本再次拒绝并发修改。

- 暂存：`/opt/fpl-weekly/releases/v106-20261005`
- 备份：`/opt/fpl-weekly/backups/v106-1791171944431`
- 驱动：`scripts/deploy-v106-static.cjs`
- 配置哈希保持一致，不涉及data、后台、资讯v14或其他站点；无服务重启。

需回滚时，仅将上述备份中五个同名静态文件恢复至 `/opt/fpl-weekly/public/`；先检查是否已有更新版本，不恢复配置、数据或整个目录。
