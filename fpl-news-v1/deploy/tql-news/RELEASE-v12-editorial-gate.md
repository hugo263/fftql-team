# v12 · 资讯规则、分类视觉与信源精简

2026-10-03，用户明确授权上线。生产 current：`/opt/tql-news/releases/20261003-v12-editorial-gate`，前版 `20261003-v11-x-socks`。代码备份 `/opt/tql-news/backups/v12-1791022728053`。主站配套 v103。

## 发布规则与视觉

- prefilter BLOCK / UNKNOWN 都停止后续付费评分及写作；缺内容的 Team news / Watch live 不得靠标题推测。
- 排除国家队祝贺、球队照片、支持口号等宣传；没有转录的媒体不得猜测内容。
- 新增 teams「球队复盘」、news「英超快讯」，结构分类为主分类权威来源。获奖消息不等于新增 FPL 得分。
- 保留原五轴评分、60/65/76门槛及现有预算。topics-only seed现有32主题。
- 10种分类色彩，带文字/圆点；主站、资讯列表/详情/筛选共享样式，手机显示。

## 历史材料处理

`scripts/review-editorial-v12.ts` 使用既有后台override/visibility接口，actor `editorial-v12-user-review`。8条无效内容撤回，6条修正分类和摘要。此前三条用户指定内容不变。

原文、旧评分、人工历史未删除。备份 `/opt/tql-news/backups/editorial-v12-20261003/before.json`。后台可恢复，勿整体覆盖数据库。撤回数据的 eligible 可能仍为 true，公开读取同时判断 visibility，不代表仍公开。

当日300次模型额度已用完，未绕开限额，不宣称完成新提示词的真实模型批量校准。上述14条由已保存原文核对后人工审计修正。

## 20个俱乐部 X 停用（后续用户授权）

`scripts/retire-club-x-20261003.mjs` 已应用生产：20个现有 `x-club-*` disabled/paused，20条 source.update 审计。不删除信源、原文或审核记录，不撤销已有正常发布文章。保留 X：Sky Sports Premier League / Fabrizio Romano / David Ornstein。RSS和官方价格任务不变。

变更前优雅停止worker，检查没有待执行/运行的抓取任务和旧分页backlog；执行后自动启动worker。常规collectSource和批量collectXShard验证均跳过停用源，无提供商请求。后台管理员仍可有意手动force测试，不要将它描述为账号封禁。

原配置 `/opt/tql-news/backups/retire-club-x-20261003/before.json`，结果同目录result.json。其他信源字段、X总开关、环境文件哈希、历史文章计数核对通过；生产五个相关服务active。数据库配置跨代码发布保留；industry/sources.json只有RSS，历史output清单不是当前启用清单。

如用户要求恢复，依据备份的 enabled 值逐条调用 updateSource（当前版本号、理由、新审计）；不要恢复整张表、旧健康状态或覆盖环境文件。

## 验证 / 发布边界

- 210后端、17web、573主站测试通过；typecheck和web构建通过；分类集成8项复验通过。
- 10种配色对比度 ≥ 4.5；浏览器验证主站分类及球队复盘结果。
- 发布期间12次web请求均200，socket未重启；env、Nginx、unit、X专用代理源码、限额保持不变。
- 线上公开页面/teams与news列表检查通过。撤回文章的主站代理URL曾返回502（上游非JSON404被现有代理映射），不是全站502；该既有缺失文章错误呈现问题未包含本次改动，不能将其标为404验证通过。
- 没有新做完整移动端回归；之前v101移动端适配保留。

代码回滚只原子切换到v11，并重启API/web/worker，不重启9012 socket；数据库编辑和信源选择独立保留，回滚代码不等于撤销用户编辑。不要恢复整份旧env或重置X开关。
