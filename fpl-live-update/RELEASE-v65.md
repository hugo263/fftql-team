# v65 — 后端采集与变更推送（2026-09-13 已发布）

用户明确授权「完成后包括 discover 页面，刷新规则全部上线」。包含原本待确认的 v64 非比赛三小时策略；生产由 v63 直接升级到 v65。

## 规则

- Discover：后端进行中/中场/临近开赛每 10 秒 TTL；无比赛进行时三小时，完整赛季下一开球前一分钟唤醒。官方响应慢时合并请求、不叠加采集，不承诺真实事件十秒内到达。bootstrap 仍十五分钟；失败保留原时间并退避。
- 联赛工作台所有模块：共享十五分钟快照。交易自由市场开放、阵容截止跨界失效；Discover 观察到完场集合变化后追加刷新。默认联赛持续维护，其他已打开联赛在连接存续期间维护；无访客的联赛下次打开时按需补齐。
- 新 `/api/updates?channel=discover[&gw=N]` / `?league=ID` SSE 通道只推版本通知；客户端变化时读已构建缓存，未变化仅同步检查时间，不重绘。不是直接推送整份大快照。官方比赛得分/ID/DEFCON/归属/自动替补逻辑未改。
- 每页一个连接，隐藏时断开，恢复后订阅最新版本；通知合并、失败五秒后重试最新版本。连接不可用时 Discover 降级到原定时检查、工作台十五分钟兜底。手动刷新保留。
- 全局512连接、单IP12连接、160主题限制；历史GW同时最多三个主题，历史纠错十五分钟后台检查不阻塞当前GW采集；超限客户端降级。联赛定时构建两路并发，单联赛原去重保留、失败一分钟退避。
- 双球场停止自己的每分钟自动请求，由工作台快照水合；用户点击打开时保留按需读取真实明细。流量后台的认证/统计刷新不改，也不推送后台隐私数据。

## 验证与发布

- `node --test --test-reporter=tap tests/*.test.js`：394 项通过，含指纹去重、连接上限/隔离/断线补齐、通知重试、十五分钟与交易时间边界、十秒/三小时切换以及原计分回归。
- 隔离真实API预览 `/private/tmp/fpl-v65-preview-hiPJy0`，4320端口，未使用生产配置或数据；Discover 筛选、联赛赛程和双球场实际浏览器正常、无错误日志。
- 发布10个代码文件：server.js、match-centre.js、public-snapshot.js、update-stream.js、public/update-stream.js、public/app.js、public/match-view.js、public/index.html、public/discover.html、public/match-centre.js。
- CSS、Logo、admin、计分与归属模块未发布。只重启 fpl-weekly；现有 Nginx 无需修改，通过应用 `X-Accel-Buffering:no` 和20秒心跳支持 SSE。
- 线上默认GW4，无比赛进行时 refreshSeconds=10800；联赛=900。源站SSE首包6ms/联赛31ms（单次测量，不是上游采集延迟）。通过本机HTTPS域名证书校验和Nginx确认流式返回。config、admin、计分模块哈希未变化；已有19个TOTW历史归属文件哈希完全保留。
- 生产备份：`/opt/fpl-weekly-backups/20260913-v65-before-1789262692715.tgz`。
- 发布脚本：`/private/tmp/fpl-deploy-v65-20260913.cjs`；纯代码包`/private/tmp/fpl-v65-push-20260913.tgz`（禁macOS附加属性）。首次包白名单检查因附加属性拒绝，未改线上；重新打包后成功。

## 回滚

只将上述备份解压回 `/opt/fpl-weekly` 并重启 `fpl-weekly`。新加的未引用模块可留作审计；不删除 data、不覆盖 config、不修改其他服务或端口。
