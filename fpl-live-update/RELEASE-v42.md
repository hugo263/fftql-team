# v42 — 历史联赛使用补录

已于 2026-09-05 23:48（北京时间）部署到 fpl.xiaokailabs.com。
用户追加要求：联赛使用次数包含历史记录；承接前条完成后直接上线授权。

## 结果

- 从本站 Nginx access log 补录 366 次历史工作台打开，涉及 11 个联赛。
- 覆盖已匹配访问：2026-09-01 18:22:20 至 2026-09-05 23:18:48，北京时间。
- 新旧来源合并后核验时累计 11 个联赛、369 次打开；后续新访问会继续累加。
- 后台显示今日 PV / UV、累计联赛、累计打开、每行历史打开次数及推断来源。
- 识别 6 个本人匿名身份（长期排除标记 + 历史成功后台登录/读取统计），不保留或输出原始 IP / UA。
- 原 JSONL 保持不变；补录不制造 PV / UV。历史新识别 owner 的过滤会合理降低旧 PV/UV。

## 统计规则与限制

工作台文档成功 GET（200/304）后，同一 HMAC(IP|UA) 在 120 秒内成功 GET 对应联赛数据（200），推断一次打开。默认页面必须匹配 /api/snapshot；显式 league 参数必须匹配 /api/league/ID。API 单独请求、失败请求、机器人、已识别本人不计。一次 API 仅确认最新待匹配文档，清空更早竞争文档，防止定时刷新追认旧文档。

只补 collection-v2.json 中新采集起点 2026-09-05 23:22:43.676 之前的文档及 API。稳定 backfillId 去重，多份重叠日志与重复运行幂等。首次写入后再次执行 --write 得到 changed=false、saved=false。

这是保守历史推断，并非完整精确用户测量；日志缺失、浏览器缓存、并发标签/同秒访问及共享身份会造成遗漏或误差。不能保证识别所有历史本人访问。联赛名称只从已存在快照取显示值，快照存在本身不是使用证据。

## 实现与验证

- 线上代码：server.js、analytics-report.js、analytics-history.js、analytics-backfill.js、scripts/backfill-league-usage.cjs、public/admin.html、public/admin.js。
- 新派生数据：data/analytics/league-history-v1.json，0600 权限，与原始 JSONL 分开保存。
- admin.js?v=42；其余未改资源版本保留，不改公开工作台与 FFScout 设计稿。
- 232/232 自动回归通过，包括解析 25 项、历史边界、PV/UV 不增、幂等、owner 追溯、API 鉴权和旧 FPL 功能。
- 线上 health 正常；未认证后台 API 仍 401；7/30 天今日指标与累计联赛一致，PV = 日趋势总计，打开次数 = 明细行之和。
- 线上浏览器实际登录后已确认显示 11 个联赛、366 次补录、今日 PV 104 / UV 64（核验时点值）。
- config.json mtime/size 保持 1788322538 / 353；discover.css SHA-256 保持 30ff55d3dfb4c6df289f1b429620fc5eb2b674ba080229e593e81beb67d59053。

## 备份与维护

v41 代码备份：/opt/fpl-weekly-backups/20260905-v42-before.tgz。
本次发布包：/tmp/fpl-v42-20260905.tgz。
需要回滚时恢复上述备份中的四个旧代码文件并重启 fpl-weekly；新增派生文件和模块无需删除，v41 不会读取历史派生文件。保留 config.json 与所有 data/。

补录工具默认 dry-run：

```bash
cd /opt/fpl-weekly
node scripts/backfill-league-usage.cjs /www/wwwlogs/fpl_weekly.access.log
# 明确需要写入时才加 --write；支持多份绝对路径和 .gz。
```

CLI 只写派生文件，已有文件变化时先备份再原子替换；输入日志留在服务器，不下载原始日志或生产配置。
