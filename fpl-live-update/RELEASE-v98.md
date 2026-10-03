# v98 · FPL 资讯与全站改版合并发布

上线时间：2026-10-02 22:35（北京时间）。用户本次授权测试与发布，包含此前 v91–97 视觉修改。

## 路由与入口

- `https://fftql.team/`：真实资讯首页，分类、渠道、精选/全部、服务端搜索、分页、资讯详情与原文追溯；保留价格观察、热点/简报/主题/收藏入口。
- `https://fftql.team/draft/`：当前完整 Draft 工作台；原 `/?league=47275#weekly` 等路径与 hash 保留，不丢收藏或分享。
- `https://fftql.team/admin`：已发布的新 Draft 后台，首页页脚小字「管理」；认证和本人排除逻辑保留。
- `/admin/news`：原有认证后一次性 POST SSO 到资讯后台，已在正式浏览器验证。
- `draft.fftql.team` 当前无 DNS/TLS，本次不发布指向该未配置域名的链接，也未修改 DNS、证书、Nginx 或其他 vhost。待用户登录 DNSPod 后可以单独配置。

## 安全和数据

新增 news-proxy.js 只转发匿名公开读取白名单到 `127.0.0.1:9011/api/site/*`。GET/HEAD、8 秒超时、2 MB 上限，拒绝路径穿越/写入/后台路径；不转发 Cookie、Authorization 或 Set-Cookie。资讯前端使用 textContent 安全渲染，失联明确报错，不伪造文章/价格。来源时间缺失时标注收录时间，不冒充发布时间。浏览请求不触发模型或采集。

服务器只发布差异 34 个文件：30 个静态文件，以及 server.js、site-routing.js、news-proxy.js、analytics-report.js。新后台四个文件已与生产一致，未重新覆盖。原 admin-news-sso.js 没有字节变化。main config/data 的 194 个文件在停止主站、复制、启动之间逐个校验一致；无密码更改、无数据库迁移，无模型/预算/采集设置更改。资讯版本、worker 和服务均保持 `20261002-v7-admin-redesign`。

## 验收

- 571 项 Node 回归测试全部通过；旧测试的缓存号、Canvas尺寸和 DOM 样式断言随已批准设计调整，数据规则、分数、未知值、替补、全部 30 人、鉴权、请求竞争与旧快照语义继续验证。
- 73 项生产 HTTPS 检查，56 个实际静态资源及公开 API / 匿名后台 401 / SSO 匿名门禁 / 拒绝写入 / 旧域名 308 跳转通过。
- 正式资讯 7 条精选可读；分类、搜索、浮窗、原文链接及真实价格正常。
- 正式 1280px 和 390px 布局无横向溢出，页头/Logo 分别 62/34 与 56/30。Draft 六模块、联赛侧栏、赛程和交易筛选保持。
- 实际双球场图片成功复制为 PNG，1080×1440，30 人及替补、未知分数、官方球衣、Logo、链接和二维码均展示。
- 实际后台 7 天范围切换与资讯 SSO 成功，四个服务 active；新 admin 文件 SHA 与原 release 相同。
- 已有 X 采集异常依然显示在资讯总览（23 个账号有错误），本次没有承诺修复采集。价格观测独立正常。

证据：`/Users/ken/Documents/个人网站计划/output/fpl-v98/` 下 tests.log、http-verification.json、deployment-receipt.json、portal-live.jpg、match-share.png。

## 备份与回滚

成功发布备份：`/opt/fpl-weekly/backups/v98-20261002-1790951699605`。
代码包与 manifest：`/opt/fpl-weekly/releases/v98-20261002`。
manifest 每个文件记录 before/after SHA；需要回滚时停止 fpl-weekly，仅恢复 manifest 中 before 非空的旧文件，将 before 为空的新代码文件移到独立恢复目录，重启并验证。不能覆盖 config/data，也不能切换资讯 release。发布曾因 Node fetch 不接受 Host 覆盖导致健康检查误判，已自动回滚；改为显式 /portal 就绪和 curl Host 校验后成功发布，服务未遗留失败状态。
