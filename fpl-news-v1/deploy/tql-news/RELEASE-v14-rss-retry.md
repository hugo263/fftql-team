# v14 · AllAboutFPL RSS 网络恢复

2026-10-03，用户明确授权修复、验证并上线。

## 原因与范围

生产Node v24.18.1双栈连接默认单地址等待250ms，复现IPv4 ETIMEDOUT加IPv6 ENETUNREACH导致外层fetch failed。源站RSS本身可用，IPv4独立试连成功。既有只保存顶层message导致后台无法看到细节；一次失败后按已有规则两小时重试。

只改三个后端运行文件，并附一个回归测试文件：

- lib/network-retry.ts：最多一次、300ms短退避；识别cause/AggregateError内网络码，限制遍历并脱敏。
- lib/http-fetch.ts：新增RSS显式启用选项；第二次直连DNS主机用IPv4，代理优先，不绕过SSR​​F或TLS。所有尝试共享原始请求deadline。
- sources/rss.ts：启用重试，保持60秒上限及ETag/Last-Modified流程。
- tests/rss-network-retry.test.ts：11项新增测试。

默认调用、付费接口、POST、X、HTTP错误、证书错误和安全拒绝不自动重试。不改采集周期、发布规则、source开关、模型预算或数据结构。

## 验证

- 后端225测试全部通过，包括新增11项网络/游标/错误脱敏/安全边界测试；web17测试、typecheck、web build通过。
- 隔离数据库及本地HTTP桩，无测试访问生产库或付费调用。
- 本地与正式31项smoke均通过；主站与后台入口200。
- 生产原构建完全保留，未上传新前端build；web和socket未重启。
- 通过现有fetchNow、带actor `codex-rss-v14-recovery` 的审计提交一次AllAboutFPL采集，job `99105644-9178-42b9-9a17-ed4f4cf7ba94`。
- 真实worker run2395于北京时间23:46:56开始，23:47:02完成；found10/new0，health=ok、fail_count=0、last_error=null，下一次2026-10-04 00:47:02。旧失败记录保留。
- 20个俱乐部X源仍关闭，FFScout保持正常。没有手动清错或提前移动成功游标。

## 发布

当前 `/opt/tql-news/releases/20261003-v14-rss-retry`；此前v13-price-mobile。
备份manifest `/opt/tql-news/backups/v14-1791042379908/before.json`，旧release完整保留。
发布脚本 `scripts/deploy-v14-rss-retry.mjs` 检查原源码/config哈希，复制旧release，仅覆盖allowlist四文件，优雅停止worker、切换current、重启API、启动worker，健康失败自动回滚。无数据库迁移或配置更改。

回滚须核对当前版本后将current指回v13并重启API/worker，不重启web/socket，不恢复数据库或覆盖上线后的采集记录。证据在 `output/tql-v14-rss/`。
