# v13 · 价格批次简报、主题装饰与手机浅色

2026-10-03，用户授权测试并发布。当前 `/opt/tql-news/releases/20261003-v13-price-mobile`；之前为 `20261003-v12-editorial-gate`。主站配套v105。

## 范围

- 价格按官方observation_id聚合；列表分上涨/下跌、详情逐人显示原价现价差额。人工override批次跳过，历史逐人文章保留并转summary-only，同事务写入审计。
- 20队主题卡淡队徽、12个玩法/分类图形；不修改主题API或计数。
- 公开工具only light和分类标签去圆点；后台主题偏好不变。
- 20个x-club源保持停用，其他X/RSS、预算、环境、代理与systemd units不变。

## 验证及生产结果

- 214后端测试、17web测试、typecheck/build、31项隔离smoke通过；主站575测试通过。
- 包含合并幂等、不同观测、人工编辑/撤回保护、事务失败回滚及单向涨跌测试。
- 使用隔离本地Postgres，安全阀关闭；预览数据未部署。
- 发布后2个价格简报public，共10条变动；10篇旧文summary-only，全部旧链接仍可读取。
- 生产主站/资讯详情/主题页/后台入口HTTP200，移动视图无JS异常；共享socket保留，切换期间12次web探测全部200。
- 远端缺react-router构建开发依赖，未安装依赖；192项本地与远端构建输入零差异后上传已验证本地build。
- 正常worker恢复运行；这次历史合并未触发外部采集或额外模型调用。

## 备份与操作记录

- 代码备份 `/opt/tql-news/backups/v13-1791027117044`。
- 发布前scoped JSON及完整数据库dump：`/opt/tql-news/backups/v13-price-batches-20261003/`，目录700、文件600；不得公开内容。
- `scripts/deploy-v13-price-mobile.mjs`负责allowlist覆盖/切换/健康检查；`scripts/price-batch-release-v13.ts`负责snapshot/apply/status。
- 构建输入比较：`scripts/compare-v13-build-inputs.mjs`。
- 主站证据目录 `../fpl-live-update/output/fpl-v105/`。

## 回滚注意

代码可在检查当前状态后切回v12并重启API/web/worker，不重启web.socket；不改其他服务、环境或数据。

价格可见性不能靠切代码回滚：若需恢复逐人展示，必须依据before.json核对当前版本，通过带审计与并发保护的管理操作隐藏2条批次、恢复原10条可见性，不能覆盖上线后的人工修改。完整dump只用于经确认的灾难恢复，不可为UI回滚整库恢复。
