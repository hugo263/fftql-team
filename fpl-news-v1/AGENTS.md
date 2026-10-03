# 给 Agent 的说明

## 当前生产 v14 · RSS 网络恢复（2026-10-03）

用户明确“直接修改后上线”。current=`/opt/tql-news/releases/20261003-v14-rss-retry`，主站仍v105。仅RSS opt-in一次瞬时网络错误重试，间隔300ms，直连DNS主机第二次使用IPv4并保留SSRF检查；配置代理时仍走代理。重试/重定向/正文共用原60秒请求预算，HTTP错误、证书错误、SSRF、解析错误不重试，POST及未opt-in调用不变。新增有界/脱敏cause代码说明，后台不再只显示fetch failed。225后端、17web、typecheck/build、本地与正式31项smoke通过。23:47:02北京时间真实worker采集AllAboutFPL成功，10条、0新增，health=ok/fail_count=0/last_error=null，下一次00:47；旧失败记录保留，未伪造状态。只重启API与worker，web/socket及构建不变；配置/预算/20俱乐部X停用状态不变。备份 `/opt/tql-news/backups/v14-1791042379908`；详见 `deploy/tql-news/RELEASE-v14-rss-retry.md`。

## 当前生产 v13 · 价格简报 / 主题索引 / 手机浅色（2026-10-03）

用户明确授权“完成后上线”，下方三个待发布事项均已完成。current=`/opt/tql-news/releases/20261003-v13-price-mobile`，主站同步v105。已有10条逐人价格资讯按2个observation合并成2条公开简报，旧10条转summary-only、旧链接可用；人工编辑/撤回保护与事务回滚已测，无额外模型调用。214后端/17web/typecheck/build/31项smoke与主站575测试通过，线上HTTPS/移动浅色/主题队徽/价格详情复核通过。20个俱乐部X仍停用，其他源和预算不变；配置/env/unit未变，socket不重启。远端缺构建开发依赖，192项构建输入哈希一致后使用本地已验收web构建，没有安装新依赖。代码备份 `/opt/tql-news/backups/v13-1791027117044`；数据快照和完整dump在 `/opt/tql-news/backups/v13-price-batches-20261003/`，含私密信息勿输出。详情 `deploy/tql-news/RELEASE-v13-price-mobile.md`；切旧代码不等于价格可见性数据回滚，必须保留审计与并发编辑保护。

## 本地待发布 · 手机浅色与分类标签（2026-10-03）

用户截图手机变黑，公开工具本来已固定data-theme=light；新增公开页meta/color-scheme:only light，后台主题及用户保存偏好不改。industry/brand/news-categories.css与主站同步去掉标签圆点；主站筛选按钮全部统一36px，既有资讯React PillTabs本身有固定高度。主站配套v105含柔和绿色草坪、单行球员姓名和GW无空格。不能声称已在截图浏览器验证，也不能保证覆盖第三方强制夜间模式。**未测试、未构建、未浏览器验收、未上线**；前两项价格批次合并与主题索引装饰仍待发布，线上仍v12/主站v103。

## 本地待发布 · 价格简报合并（2026-10-03）

用户要求每次价格变化合并一条，列表分上涨/下跌，点开查看原价/现价/涨跌幅；主站重复首条大卡删除。新 `fpl/price-bulletins.ts` 按官方 observation_id 生成一个 rule 简报（无模型调用），以文章raw.priceBatch快照经publication读取层输出。历史逐人资讯同事务转summary-only并留审计，价格记录/旧链接保留；已有人工override的批次跳过，不恢复已撤回内容。worker下一次成功官方采集后会处理最多200批历史，不要描述为已在线合并。共享contract新增可选priceBatch，资讯FeedItem及详情新增PriceBulletin，主站v104配套。新增/更新了回归用例但**未运行任何测试、构建或浏览器验收，也未发布或改生产数据**。前一项主题索引装饰仍待发布；线上仍v12/v103。上线时先备份fpl-official-prices原文章/publications/overrides/ledger和价格观测，验证批次/搜索/分页/旧链接/单向涨跌/手机及人工override保护后再发布；反向恢复需要对应审计，不能只切旧代码就视为数据回滚。

## 本地待发布 · 主题索引卡片装饰（2026-10-03）

用户要求球队卡片右侧淡队徽，其他主题增加图形。新增 `apps/web/app/components/TopicArtwork.tsx`、`features/topics.css`，修改 `routes/topics.tsx`；20支球队沿用比赛中心官方PNG与stable team.code，默认12%透明度、加载失败显示简称；12个玩法/分类使用奖杯、交换、战术板、日历等线条图形，色调对应分类。装饰aria-hidden/pointer-events:none，文字预留空间、懒加载、手机单列与减少动态偏好保留。没有改主题数据/API/计数/导航/生产配置。遵守用户“未说上线就不测试和发布”的约定：**未测试、未构建、未浏览器验收、未上线**。线上仍下方v12；下一次明确授权上线后再验证并只发布这些相关前端文件及构建产物。

## 当前生产 v12 · 发布规则 / 分类配色 / 俱乐部 X 停用（2026-10-03）

current=`/opt/tql-news/releases/20261003-v12-editorial-gate`。新增实质内容门禁与球队复盘/英超快讯分类，10类彩色标签；210后端/17web/主站573回归、typecheck/build通过。日模型300次额度已满，本轮没有额外付费模型重跑；8条无效内容经审核撤下，6条修正文案分类，保留原文与审计。不可将人工修正说成新模型批量验证。主站v103四个静态文件已上线。随后按用户明确要求，生产20个 `x-club-*` 信源全部 enabled=false/health=paused，保留历史文章；Sky Sports PL、Romano、Ornstein及RSS继续开启，X总开关/代理/预算不变。不要按下方v11旧记录重新启用俱乐部源。配置落在生产数据库，seed仅含RSS，不会自动恢复俱乐部；恢复须用户授权并调用updateSource。备份 `/opt/tql-news/backups/retire-club-x-20261003/before.json`；脚本 `scripts/retire-club-x-20261003.mjs`。详见 `deploy/tql-news/RELEASE-v12-editorial-gate.md`。

## 当前生产 v11 · X 代理接入（2026-10-03）

用户本轮明确要求接入Webshare并把X采集恢复顺畅。current=`/opt/tql-news/releases/20261003-v11-x-socks`，基于线上v10，仅新增X专用curl SOCKS5传输和测试；资讯规则、web/socket、预算不改。已有密钥真实试采成功，X总开关已开启，23源分批在原限额内恢复。首次恢复需超过一小时：3源计划北京时间02:25:44—02:26:24执行，不得把尚未运行的源称为已恢复，不人为清除旧错误；实时证据见 `output/tql-x-connect-20261003/status.json`。207项完整最新后端回归/17web/typecheck/build/31项线上HTTPS验证通过。01:32核验20源正常、110条入库；余3源计划02:25—02:26执行，不冒充已成功。正式代理仅在服务器0600 app.env的X_EGRESS_PROXY_URL，未购买套餐。详见 `deploy/tql-news/RELEASE-v11-x-socks.md`；下文v10的“X关闭”及待接入为历史。

## 当前生产 v10（2026-10-03）

已上线资讯规则及后台评分理由，主站v102默认最新资讯，独立精选。current=`/opt/tql-news/releases/20261003-v10-editorial-rules`，配置/预算/X关闭状态/socket全部保留。三条用户指定资讯已重算并通过后台人工修正核对事实与会员边界；36条历史重算已排队，01:05时仍有27条待处理，不得称全部完成，也不要生成新requestId重复收费。RSS两源均刷新成功。202后端/17web/572主站回归通过，另15项定向验证及typecheck/build通过。详见 `deploy/tql-news/RELEASE-v10-editorial-rules.md`。正常发布仍只重启web，不重启socket。下文v9为历史。

## Webshare 出口测试通过，待接入 SOCKS5（2026-10-03）

用户本轮要求先测试 Webshare。已使用现有账号的10个免费代理，从124.222.221.150测试：HTTP代理访问普通HTTPS全部200，但访问api.x.com全部连接重置；本机同一批HTTP代理访问X全部401。官方备用网关IP的80/3128/1080及域名组合也未解决。改用SOCKS5远端DNS（socks5h）后，云服务器10/10普通HTTPS和10/10 X API连接成功，TLS校验正常，X返回预期的401（测试未带密钥）。这是网络连通性通过，不代表X密钥认证、付费权限、实际采集或长期稳定性已验证。补充核验：生产Undici 7.30.0的ProxyAgent已内置SOCKS5支持；服务器上Node TLS链路间歇重置，v11改用X专用curl SOCKS5传输，保留TLS与SSRF保护及原预算回执。此次未部署、未安装代理服务、未购买或保存长期代理凭据、未修改生产配置；服务器与本机临时代理文件已删除。X总开关仍false，23个源自身enabled和历史保留，四个服务active。测试报告和无密钥脚本：`/Users/ken/Documents/个人网站计划/output/tql-webshare-test-20261003/README.md`。下方待提供出口记录已由本次测试进展取代。

## X 采集待网络出口（2026-10-03）

用户要求修复23个X采集错误。已确认云服务器 api.x.com 解析为错误地址128.242.245.125；可信DNS返回162.159.140.229/172.66.0.227，但连接正确公开IP并保持TLS校验仍超时。api.twitter.com也不通，并可能被本地DNS解析为私网地址而被SSRF保护拒绝。现有X密钥被识别，服务器没有EGRESS_PROXY_URL或SocialData密钥；不能据此声称密钥认证有效。已通过现有setXCollection和审计在2026-10-03 00:14北京时间关闭X总开关，避免无效重试；23个信源自身enabled、等级、查询和历史保留，失败状态未人为清除。RSS与独立FPL价格任务仍正常，API/web/socket/worker active。用户待提供现有长期代理或海外服务器配置位置；接入后先无密钥验证连接，再经现有预算和回执验证真实采集成功，最后恢复总开关和23账号健康状态。未购买套餐、未绕过SSRF或TLS、未修改预算或生产代码。证据与维护脚本：`/Users/ken/Documents/个人网站计划/output/tql-x-recovery-20261003/`，服务器`/opt/tql-news/x-recovery-20261003/`。

## TQL 当前生产 v9（2026-10-02 发布，10-03 线上验收）

用户本轮授权测试和上线。公开工具浅色主题与9012 socket激活已发布，current=`/opt/tql-news/releases/20261002-v9-light-mobile`，备份=`/opt/tql-news/backups/v9-1790956403598`。typecheck / build、195后端与17前端测试、隔离smoke通过，重启web期间24请求全200。主站v101手机适配 / 浅色球场同步上线。后续普通web发布只restart web，不restart socket；停止站点要同时stop两者，旧版回滚还须恢复service和停用socket。未改生产env、数据库、API/worker、采集预算或X开关。详见 `deploy/tql-news/RELEASE-v9-light-mobile.md`。下方待发布状态仅为历史记录。

## TQL 本地改动历史（2026-10-02，已由上方发布取代）

用户要求修复资讯工具502并统一主站浅色主题；本地已实现但未测试、未构建、未发布（遵守用户明确的默认约束，优先于下方一般测试指南）。根因由只读生产日志确认：22:51:01/31 web服务重启期间9012连接拒绝。新增 `deploy/tql-news/tql-news-web.socket` 与 server.ts fd3激活支持；首次切换需避免旧进程占端口，回滚也须同步恢复unit。公开工具用public-site.css和共享样式页头，固定light但不清除收藏/偏好，不影响后台主题。完整范围、证据和切换/验证要求见 `deploy/tql-news/PENDING-public-tools-20261002.md`。主站球场v100也尚未测试/发布，别把预览数据覆盖生产。线上仍v8 RSS timeout；X出口异常不在这次改动范围内。

这是一个行业热点网站的框架：采集信源、用模型筛选和写作、归组事件、出日报，并通过网站、RSS、公开 API 和 MCP 对外提供。默认配置是一个 AI 行业的示例站。先读 README，再按任务读 `docs/` 里对应的文档。

## 最常见的任务：改成另一个行业

按 `docs/customize.md` 的顺序做。行业相关的一切都在 `industry/`：站名文案（`site.ts`）、分类标签（`taxonomy.ts`）、主题（`topics.json`）、示范信源（`sources.json`）、提示词（`prompts/`）、门槛（`selection.ts`）、模块开关（`features.ts`）、品牌（`brand/`）、条款页（`pages/`）。通常不需要改 `apps/` 和 `packages/`。

这些事要问使用者本人，不要替他决定：站名；要盯哪些信源；什么消息重要、什么是噪声；分类怎么分；条款和隐私说明的内容（`industry/pages/` 是模板，上线前需要他本人确认）。

改评分标准时保留原有结构（内容类型、五个维度加权、噪声压制、安全边界），替换的是“什么算重要”“什么算噪声”的例子。门槛要用使用者标注的样本重新校准（`docs/selection.md`），不要凭感觉改数字。

## 运行与检查

- Node.js 24 直接运行 TypeScript，后端没有构建步骤。npm workspaces：`apps/*`、`packages/*`、`industry`。
- 本机运行和 Docker 见 `docs/deploy.md`。
- 改完至少跑：
  ```bash
  npm run typecheck
  DATABASE_URL=postgres://127.0.0.1:5432/<名字>_test npm test   # 空库，名字必须以 _test 或 _ci 结尾，先 node scripts/migrate.ts
  npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts
  node scripts/smoke.ts --base http://localhost:3000             # 站点跑起来以后
  ```
- `tests/` 里部分测试用的是示例行业的分类、标签和公司，改了 `industry/taxonomy.ts` 后把这些例子换成新行业的对应项。

## 要守住的规则

- 前端（`apps/web`）只通过 HTTP 读 `apps/api`，数据库、模型调用和密钥只在后端。
- 所有公开出口都从 `packages/backend/src/publication/` 这一个读取层读，新增公开出口也一样。
- 读者打开页面不触发模型调用；模型只在 worker 的任务里调用。
- 付费请求都经过回执（`providers/receipts.ts`）和预算熔断，不要绕开。
- 开发和测试时保持安全阀关闭：`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED`。测试不访问任何外部服务。
- 信源默认只展示摘要和原文链接（`site_fulltext` 关）；只有来源明确允许时才打开全文。
- 公开内容匿名，管理员和访客看到的一样；后台只允许管理员。
- 数据库迁移只做向后兼容的增量，新迁移按编号加在 `database/migrations/` 末尾。
- 不要提交 `.env`、密钥和 `.data/`。
- 不要使用 AIHOT 的名字和 Logo。

## 写代码

匹配周围代码的写法、命名和注释密度。选能清楚解决问题的简单方案，只定义正在使用的抽象。验证改动涉及的重要行为，不为简单的样式改动写测试。
