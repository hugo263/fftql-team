# v108 / v108.1 · 国际比赛日原创专题

2026-10-08（北京时间）。用户确认带图预览后授权直接上线。主站生产为 v108.1；资讯运行版本仍是 `/opt/tql-news/releases/20261003-v14-rss-retry`，本次没有切换资讯 runtime，也没有发布待验证的 v15 范围筛选/去重改动。

## 内容与展示

发布原创《FPL 资讯｜英超回来了！国际比赛日盘点与 GW6 队长参考》，固定文章 ID `tql-international-20261008`。

- 主站全文：<https://fftql.team/articles/fpl-international-20261008.html>。
- 资讯归档：<https://news.fftql.team/items/tql-international-20261008>。
- 正式资讯数据库新增本篇内容及必要的来源、公开投影、搜索和审计记录；分类 `strategy`，搜索包含 30 个球员中英文/拼写别名。
- `selected=false`、`silent=true`：进入普通资讯池，不进入精选，不发送通知，不调用模型，不排正文处理任务。不修改发布时刻来置顶。
- 主站仅当真实 API 返回本篇时，将其渲染为批准的专题卡。`2026-10-10T10:00:00Z`（10 月 10 日北京时间 18:00）之前，把当前已载入列表中的本篇移至首条，其他条目相对顺序不变；截止时起恢复 API 原顺序。没有跨页补取或绕过分类、频道、搜索。
- 普通资讯、分页、价格简报与右侧真实官方价格继续走现有接口。专题可在主站弹窗阅读，也可直接打开静态全文；资讯站保存可读的全文归档。
- 正文保留四张配图、八行国家队窗口球员统计、独立单场亮点、伤情、媒体队长意见和截止提醒。统计范围、来源链接与确定程度沿用审核稿。

## 静态文件与 v108.1 修复

v108 仅发布以下五个 `public/` 路径：

1. `editorial-roundup.css`
2. `editorial-roundup.js`
3. `articles/fpl-international-20261008.html`
4. `portal.js`
5. `portal.html`

线上复核发现封面图具有 `width` / `height` 属性，原样式仅设宽度和比例，导致保留 810px 高度。v108.1 为专题封面补 `height:auto`，同时将门户的样式引用更新为 `editorial-roundup.css?v=108.1`；仅再次发布 CSS 和 `portal.html`。针对性实测封面约 188×117.5px、专题卡约 224.2px 高。独立静态文章仍引用同一 CSS 文件的 `?v=108`，本次两文件热修没有改动其 HTML；后续更新独立文章时同步缓存引用。

主站服务未重启；配置和主站 `data/` 未改。资讯端是有审计的单篇内容发布，不是零数据库变更；没有改运行代码、采集开关、模型预算或消息配置。

## 验证记录

- `tests/news-integration.test.js` 与 `tests/public-http.test.js` 共 14 项通过。
- 专题排序边界 3 项断言通过。
- 静态文章在 320、390、1280px 无整页横向溢出，四张图片加载完成；带图正文和八行表格已核对。
- 静态发布驱动在隔离临时目录验证正常发布/回滚、部分失败恢复、文件和配置并发保护。v108.1 另验证第二文件失败后恢复已替换的 CSS。
- 服务器通过公网 HTTPS 读取最终五文件，SHA256 与合并 `expected.json` / `expected-fix.json` 后的清单全部一致；`/api/health` 为 true。公开详情 `readingMode=full`，哈兰德搜索可找到本篇，资讯归档 HTTP 200。
- 正式站 1280px 封面实测 188×117.5px、专题卡高224.2px；加载更多后72条中只有一篇专题。搜索“哈兰德”返回4条且包含本篇，X/一手来源频道不出现本篇。
- 原价格详情正常显示2行，切换后没有残留专题样式类；关闭详情后焦点回到阅读链接。专题四节目录滚动有效，截止提醒显示18:00。
- 正式站390px页面和弹窗无横向溢出，表格适配、四图 naturalWidth 均大于0，封面响应式高度154.5px；320px独立静态全文检查通过。
- 最终浏览器控制台 warning/error 列表为空；结构化验收结果保存在本次发布目录的 `verification.json`。
- 本次没有运行主站全部业务回归，也没有运行/发布资讯 v15 测试或构建。

## 发布文件与备份

本次审核预览、源码、构建产物、内容 payload 和驱动位于：

`/Users/ken/Documents/ChatGPT/fftql.team/deploy/international-20261008/`

其中 `expected.json` 保存初次 v108 五文件哈希，`expected-fix.json` 保存 v108.1 两文件哈希；勿用热修结果覆盖前者。`deploy-static.cjs`、`deploy-static-fix.cjs` 仅操作各自白名单静态路径，检查生产基底、配置和暂存哈希，备份后逐文件原子替换，失败恢复并保留并发变化。

| 范围 | 暂存 / 备份 |
| --- | --- |
| v108 静态暂存 | `/opt/fpl-weekly/releases/v108-editorial-20261008` |
| v108 原五路径备份（含新增文件的缺失状态） | `/opt/fpl-weekly/backups/v108-editorial-1791422929352-b0c4efd02d3c` |
| v108.1 热修暂存 | `/opt/fpl-weekly/releases/v1081-editorial-20261008` |
| v108.1 原 CSS / HTML 备份 | `/opt/fpl-weekly/backups/v1081-editorial-1791423082455-677e44b3f5f4` |
| 资讯发布前内容快照 | `/opt/tql-news/backups/editorial-international-20261008/before.json` |

资讯发布脚本 `publish-editorial.ts` 固定 v14 runtime 和已审核 payload，使用事务锁与审计，重复同内容返回 `already-published`；同 ID 不同内容或后续人工修改会拒绝覆盖。没有数据库迁移或服务重启。

## 回滚边界

静态回滚使用对应驱动的 `--rollback`，要求当前文件仍符合本次发布状态。若需完整退回 v107，应先回滚 v108.1，再回滚 v108；三项新增文件恢复为缺失，旧门户文件从备份恢复。不得用过期文件覆盖后续并发部署。

静态回滚不撤回数据库文章。需要撤回本篇时，使用既有管理员 `setVisibility` / `POST /api/admin/content/:id/visibility`，读取当前 override version 并写入新审计；保留文章、归档和发布前快照，不直接删库。待发布 v15 始终独立于本次内容发布。
