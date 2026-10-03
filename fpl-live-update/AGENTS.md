# CLAUDE.md — AI 客户端交接说明

> 关联资讯后端2026-10-03已更新v14-rss-retry，仅修复RSS瞬时网络错误的IPv4回退/单次重试/详细错误。AllAboutFPL 23:47北京时间真实采集恢复正常，主站前端仍v105、未改。后续资讯源码和发布详情见同级fpl-news-v1，不可用旧v13覆盖该修复。

> 当前生产 v105（2026-10-03）：用户明确“完成后上线”，下方 v104/v105 待发布事项已合并发布；资讯 current 同步 v13-price-mobile。主站17静态文件、无重启、配置/data不变；575回归通过。柔和绿草坪/浅色场外、全球场姓名单行省略、分类按钮36px去圆点、GW6无空格、公开页only light；手机浏览器手动强制夜间仍不能保证覆盖。去重复首条大卡，价格10条合并2批并保留旧链接；资讯主题索引装饰同步发布。214后端/17web/typecheck/build/smoke通过，21项本地浏览器检查与线上资源哈希/移动页面复核通过；实际PNG生成已验收，但本轮剪贴板写入为测试桩，不等于真实系统剪贴板验收。备份 `/opt/fpl-weekly/backups/v105-1791027251694`。详见 `RELEASE-v105.md`。下方待发布说明仅作历史记录，不可重复上线旧版。

> 本地v105待发布（2026-10-03，手机视觉）：共享pitch.js改柔和绿色草坪/白场线，保持浅色场外、投影和计分不变，DOM/Canvas同源；移除responsive的两行姓名规则，全球场含替补姓名单行省略并保留完整文字/title，低人数行不再挤成五人行宽度。分类胶囊含“全部”统一36px、去圆点；portal/Draft/比赛中心及分享统一GW6无空格。公开HTML+light-surfaces（含ShadowRoot）声明only light；截图疑似浏览器强制夜间，不能保证覆盖所有浏览器手动夜间模式。资讯公开工具同步声明，后台主题不改。未测试、未构建、未浏览器验收、未上线；遵守用户未说上线不测试约定。v104价格合并/首条大卡移除和news主题装饰仍待发布，线上仍v103/news v12。资源引用105，未改API/配置/data/生产。

> 本地v104待发布（2026-10-03）：去掉FPL资讯重复展示第一条的featuredNews大卡；价格消息消费资讯后端按observation_id合并的priceBatch，外层上涨/下跌两行姓名+球队，弹窗逐人原价/现价/差额，保留官方观测时间说明。portal.html/js、portal-news-model.js、新price-bulletin.css；需与news price-bulletins/contract/publication及React界面一起发布，不能仅发主站就宣称价格已合并。前一项news主题卡片装饰也待发布。已编写回归用例但未运行测试、未构建、未浏览器验收、未上线，遵守用户默认约定。线上仍下方v103。详见RELEASE-v104-pending.md。

> 当前生产v103（2026-10-03）：资讯10类彩色标签及新增「球队复盘/英超快讯」已上线，仅portal.html/js、portal-news-model.js、news-categories.css四个静态文件，无重启；573回归通过。资讯current为v12-editorial-gate，8条撤回/6条人工修正；20个俱乐部官方X源按用户要求停用，其他三X/RSS不变。详见RELEASE-v103.md和同级news v12记录。下方v102及更早为历史。

> 当前生产v102（2026-10-03）：仅portal.html/js默认“最新资讯”，保留“精选推荐”；同步资讯后端v10规则、评分理由和三条人工核查发布。两路RSS已刷新；36条历史资讯已排队，尚在原有模型限额下分批重算，不得称全部完成。572回归通过，配置/data未动，备份见RELEASE-v102.md。以下v101及更早记录保留为历史。

> 给任何接手本项目的 AI 客户端（Claude Code / Cursor / Codex / WorkBuddy 等）。
> 先读 `README.md` 了解全貌，本文件只写 README 之外的现状、约定和坑。

## 项目是什么

FPL Draft 联赛（英超无双第二届，league_id=47275）周报工作台。
零依赖 Node.js 服务：`node server.js` 即可跑（Node ≥ 18，无需 npm install）。
前端单页 `public/`，Chart.js 已本地化在 `public/vendor/`。

## 服务器现状（已部署，勿重装）

| 项 | 值 |
|---|---|
| 实例 | 腾讯云 Lighthouse `lhins-r0exrfgo`，公网 `124.222.221.150`，OpenCloudOS 9.6 |
| SSH | `ssh -i ~/.ssh/eplens_lighthouse_ed25519 root@124.222.221.150` |
| 应用目录 | `/opt/fpl-weekly` |
| 进程 | systemd 服务 `fpl-weekly`，**生产端口 9090**（本地开发 3000；服务器上 3000 被他人应用 ai-huazhang 占用，勿改） |
| Nginx | 新主站vhost `/www/server/panel/vhost/nginx/fftql_team.conf`（`fftql.team` → `127.0.0.1:9090`）；旧 `fpl_weekly.conf` 仅做308跳转并保留ACME验证 |
| 域名 | 主站 `fftql.team`，DNSPod A → 124.222.221.150；Let's Encrypt HTTPS/Certbot自动续期。旧 `fpl.xiaokailabs.com` HTTP/HTTPS 跳转至同路径/参数的新域名 |
| 日志 | `/var/log/fpl-weekly.log`（logrotate 已配） |

## 共享服务器红线

该服务器是共享的，**绝对不要动**：
- 80/443 上的其他 vhost：`aiexp` / `diet` / `eplens`（在 `/www/server/panel/vhost/nginx/`）
- 端口 8888（宝塔面板）、端口 3000（他人应用）

## 改动 → 上线流程

**当前生产 v101，已测试 / 已上线（2026-10-02，10-03 线上验收完成）**：用户本轮明确授权发布，v100 球场与资讯修复一起完成。13 个主站静态文件，config 哈希不变，无服务重启；备份 `/opt/fpl-weekly/backups/v101-1790956461327`。新增 light-surfaces / responsive 必须在旧主题之后加载，home-tab 的 ShadowRoot 也载入两者；最终缓存版本101.2。共享 pitch.js 的 DOM / Canvas 几何与浅绿配色一致，经理 / 双球场 / 交易 / 趣味 / 帮助 / 反馈弹窗统一浅色；门将在上和全部业务逻辑不改。572 主站回归通过；320/390/768px 的11个工作台视图、资讯14路由、桌面 / 手机弹窗和实际1080×1440导出PNG已核验。生产资讯 current 已是 v9-light-mobile，socket 单独持有9012，后续只重启 web、不重启 socket；回滚旧版必须同步停用 socket 和恢复旧 service。195 API + 17 web 测试、构建、smoke 和 web 重启期间24请求全200通过。详情 `RELEASE-v101.md` 及同级资讯发布记录。下两条待发布说明已经过时，保留仅作历史记录；23个X信源出口异常仍未解决，不得混为502已修复。

**关联资讯工具修复待发布（2026-10-02）**：用户随后要求资讯工具502修复、由深色改为主站主题。改动在同级 `../fpl-news-v1`，不是本项目的public；详情见其 `deploy/tql-news/PENDING-public-tools-20261002.md`。只读日志证实502是资讯web重启的9012端口空窗；本地新增socket激活和公开工具浅色页头/配色。尚未测试、构建、发布，不能声称线上已应用。球场v100仍待发布，线上主站v99/资讯v8未变。

**本地统一球场 v100，未测试、未上线（2026-10-02）**：按用户截图修正禁区边线缺失、中线越界与两端透视不一致。新增 public/pitch.js 共享投影几何，DOM 内联 SVG 与 Canvas 导出共用边界、条纹、中线、中圈、禁区、小禁区、罚球弧和点；不再使用被 clip-path 裁掉侧边的 CSS 矩形。pitch.css 最后加载，统一克制深绿草坪、纸白名牌 / 浅绿分数和暗色替补席；比赛中橙色与非卖紫色保留。覆盖 TOTW、阵容对比、经理阵容、阵容分享、双球场弹窗及两种 PNG；样式图库同步。门将在上、阵容 / 计分 / 状态 / 归属逻辑均不改，空 TOTW 缩短。index 和 share-styles 必须先加载 pitch.js 再加载消费脚本，版本100；只同步隔离4323的public文件，不改config/data。遵守用户默认不测试、不上线规则，没有运行自动测试、语法检查或浏览器验收；生产仍v99。

**当前生产 v99（2026-10-02）**：按用户要求暂移除重复的顶层「首页」，三处共享导航只保留「FPL 资讯 / Draft」，Logo 与根路径继续打开资讯；未构建/发布新的首页。portal.js?v=99 固定资讯选中态。仅 4 个静态文件，无重启；备份 `/opt/fpl-weekly/backups/v99-20261002-1790952594963`。同次资讯服务升级为 `20261002-v8-rss-timeout`，RSS 全程限时 60 秒、直连建立限时 30 秒（更短调用方限时仍有效），195 测试及 typecheck 通过。AllAboutFPL 正式采集成功（10 条、0 新增、0 修订），2 RSS 正常；23 个 X 信源仍因国内服务器无法连接官方 API 失败，等待用户提供授权海外出口，不得描述为全部恢复，不得自行提高预算或清空错误。未改 X 密钥/预算/启停开关，旧资讯 release 可回滚。

**当前生产 v98，已测试、已上线（2026-10-02）**：此前 v91–97 待发布改版已随本次资讯合并上线。无 league 的 fftql.team 根路径是资讯首页；`/draft/` 及旧 `/?league=...#...` 是工作台，旧收藏和分享仍可用。draft.fftql.team 没有 DNS/TLS，不得直接把导航指向该子域名；现用同域安全过渡。资讯公开代理 news-proxy.js → 固定本机 9011 白名单 GET/HEAD，不传 Cookie，不触发模型/采集。已发布的新 admin 20261002a 和 admin-news-sso 保留，不要用 night-admin 或旧 admin62 覆盖；主站页脚才放管理入口。571 测试 / 73 HTTP 检查 / 1280、390px / 实际分享 PNG 与 clipboard / 后台范围切换和共享登录验收通过。34 个代码文件，复制期间 194 个 config/data 哈希一致。主站回滚备份 `/opt/fpl-weekly/backups/v98-20261002-1790951699605`；资讯 release 仍 `20261002-v7-admin-redesign`，X 采集现有异常并非本次修复范围。发布记录 `output/fpl-v98`，详见 RELEASE-v98。以下 v91–97 的「未测试/未上线」只表示当时状态，已由本条取代。

**本地组件细节统一 v97，未测试、未上线（2026-10-02）**：参照用户指定 draft-home.html，仅小元素视觉统一，保持已接受层级和 Banner96。night-ui.css97 必须在所有旧布局 / night-workspace 之后加载，home-tab97 的 ShadowRoot 和 discover97 也载入此层（主模板 night-match 类）；否则旧 CSS 仍会覆盖胶囊 / 状态 / 行距。app97 仅排名徽标、经理稳定色块和图表配色，fun-rankings97 仅真实前三名展示类，match-centre97 仅事件时间 / 类型展示包装。countdown97 仅卡片 DOM/CSS，nextWindow/windowsFromDraft/parts 和真正自由市场开放 / 阵容截止规则不改；真实进度未知时仍不展示。不接原型 demo JS、虚拟交易规则 / 比分 / QR，不改 SSE / API / 计分 / 配置或历史数据。只同步4323 public 静态预览，无测试、语法检查、浏览器验收或上线。

**本地统一 Banner v96，未测试、未上线（2026-10-02）**：用户反馈 Draft / FPL 资讯页头及 Logo 大小不同。Draft header 改用与 portal 相同的共享 night-* 结构，移除会被 compact-header75 高优先级覆盖的旧类；保留 brandLogo / btnRefresh / 原刷新状态和图标类。night-shell96统一1480容器、62px/34px桌面和56px/30px手机、同一700/360断点、网格导航与固定右侧列，滚动条槽固定；日期和刷新各自功能仍保留。index/portal/share-styles 引用96，其他功能 / 层级不变。仅4323静态预览，无测试、浏览器验收或生产发布。

**本地参考稿统一 v95，未测试、未上线（2026-10-02）**：按用户指定 fixtures.html 延伸全站视觉，维持 v93 已确认的同行三链接 / 六模块 / 联赛右栏层级，无额外标题栏、面包屑或英文 kicker。fixtures.js/css95 接真实 leagueSchedule / managers / events，新增七轮胶囊导航（仍有全季原生 select）、五档当前排名 FDR、同比赛中心的经理色块及紧凑卡片；经理仍点选后内联看整季、独立筛选 / localStorage / 双球场分享契约不改，不复制原型硬编码经理 / 比分 / QR。night-shell/workspace/portal/match/admin CSS95统一卡片、胶囊、字体 / 页头；home-tab95载入discover/night-match95，match-centre功能JS仍94。只同步 public 静态文件至4323隔离预览，不执行测试、语法检查、浏览器验收或生产发布。不得从preview覆盖任何config/data，生产仍v90。

**本地比赛中心 v94，未测试、未上线（2026-10-02）**：用户先要求删除 THE FPL FEED / THE SCORES / 比分×FPL动态等副标题，再提供双列比赛中心参考图。保留此前无装饰副标题要求、YOUR LEAGUE 明确例外；按图改事件短行 / 姓名+球队简称 / 下置经理色条标签 / 分项分与短分享按钮，比分改五列横排（时间、主队、比分、客队、状态）与独立关注。match-centre 仅改展示 markup / 日期标签，事件过滤、观测批次合并、来源 / 分享内容和 SSE 不变；官方 minutes 原字段有值才显示，不估算时钟。home-tab / discover 载入版本94 night-match，workbench CSS94隐藏装饰 kicker，v93 侧栏布局保留。只同步4323静态预览，不运行测试 / 浏览器验收 / 部署；生产仍v90。

**本地布局 v93，未测试、未上线（2026-10-01）**：按用户反馈让资讯导航回门户页头 `#top`；Draft 删除独立 league context 和 breadcrumb 两层，不再占行。联赛入口改右侧原生 details 卡片，合并 leagueName / seasonBadge / gwBadge / gwStateBadge / updatedAt 原绑定 ID；btnRefresh 在顶部保留，所有原 hash / 业务逻辑不变。≥1200px 右栏默认展开，较小屏幕单列紧凑默认收起，断点变化由 night-shell 同步。工作台主内容扩大容器以容纳右栏；仅本地静态改动，无测试 / 浏览器验证 / 生产操作。v91–92 待发布记录按本次布局更新理解，生产仍 v90。

**本地导航 v92，未测试、未上线（2026-10-01）**：用户要求「首页 / FPL 资讯 / Draft」与 Logo 齐平，首页承载资讯页面，Draft 直达现有工作台，「YOUR LEAGUE, YOUR GAME」在工作台内可见。三处共享页头改同行三链接；night-shell 的无历史联赛回退也直达工作台，不再指向 portal#draft。入口表单复用 headerLeagueId / headerLeagueGuideOpen 和原说明弹窗，顶部联赛上下文与刷新保持绑定 ID。门户删除原联赛输入 / 介绍区和相关 JS，保留资讯接口与筛选。仅静态文件同步隔离 4323，不做测试 / 浏览器验证 / 上线；v91 其余待发布改版保留，生产仍 v90。详见 README 顶部。

**本地 Match Night v91，未测试、未上线（2026-10-01）**：用户提供另一个 AI 的 DESIGN.md，要求全站按稿改版，未授权测试/上线。共享 night-tokens/night-shell，门户重做、两级导航与面包屑、ShadowRoot 的 night-match、工作台全模块 night-workspace、后台 night-admin、真实双倒计时与暗色双球场、3:4 分享与 QR 共用 night-share；旧 DOM/global API/hash/SSE/后端保持。原型只有四页，其余模块沿 token 延伸；没有接新闻采集，没有动生产/DNS/证书/计分/config/data。分享长历史等比缩小、Safari 队徽及移动端实际布局尚待授权验收。preview4323复用隔离runtime，仅同步 public 静态文件；主项目源码在本目录，禁止从旧 WorkBuddy 或 preview 的 config/data 覆盖生产。详情见 README 顶部。

**当前队徽 v90 已发布（2026-10-01）**：用户要求原球队图标先保存 Obsidian 并打标签，随后授权上线。26 个原素材及 JS/SHA256 清单已新增至 Personal Asset vault 的 Resources/FPL 笔记和 Assets/FPL 附件，未覆盖旧笔记。Draft 首页比分改 FPL 官方 badges/70/t{team.code}.png，34px contain、不裁剪、不猜 team.id，加载失败显示简称；TQL 品牌、事件图标、球衣/分享/计分不改。564 测试、本地桌面/375px 20队图像通过；仅5静态文件，index 使用生产基底仅更新 home-tab?v90；194 项保护文件哈希与33流量文件保留，无重启。备份 `/opt/fpl-weekly-backups/20261001-v90-before-1790816288241`，见 RELEASE-v90.md 与 `../fpl-club-icons-20261001/`。v87、v89仍未发布，不可整目录同步。

**本地首页框架 v89，未测试、未上线（2026-09-30）**：主站 fftql.team 拆新闻 / Draft 双栏目，原工作台归 draft.fftql.team；用户随后明确只搭架子，另一个任务负责深度聚合。新增 public/portal.html/css/js 与 site-routing.js，server 只接页面路由；无新闻 API / 采集 / 轮询 / 正文。/portal 本地预览，现有本地 /?league= 不改；新首页可输入数字 ID 直达，保留反馈、备案和原品牌。TQLPortal.setNews / tql:portal-news 与 DOM 插槽供另一任务接入。未改现有工作台数据、生产 DNS / Nginx / 证书，线上仍 v88。详见 PORTAL-v89-pending.md；用户未说上线，不运行测试或浏览器验证。

**当前域名迁移v88已发布（2026-09-30）**：主站 https://fftql.team，后台 /admin；旧fpl.xiaokailabs.com的HTTP/HTTPS全部应用路径308跳转，浏览器实测league参数及#fun保留。证书有效至2026-12-29，沿用已启用Certbot定时续期和重载hook。index/discover/admin页底备案「粤ICP备2026075584号-3」链接工信部；所有文字、阵容/对战/事件/趣味PNG分享网址改fftql.team。发布九份生产v86基础静态文件，缓存引用88，不包含本地待发布v87功能。新域名仍同一 `/opt/fpl-weekly`/9090，后续只维护该应用与新主站，不另建旧域名站点。74项配置/其他vhost/历史归属和趣味快照哈希保留，32流量文件保留，应用未重启。HTTPS、静态字节、14经理快照、后台鉴权/安全Cookie、双SSE20秒心跳和真实浏览器前后台通过。备份 `/opt/fpl-weekly-backups/20260930-domain-before-1790762188500`，迁移记录与隔离生产文件见 `../fpl-domain-20260930/README.md`、RELEASE-v88.md。新域名后台需重新登录，密码未变；浏览器localStorage偏好不自动跨域迁移。旧域名文档记录均为历史。

**本地 v87，未测试、未发布（2026-09-21）**：用户要求趣味榜默认所有轮次、可选单轮。本次无新上线指示，遵守默认不测试/上线约定。移除单轮/赛季累计双按钮，统一轮次选择器为「所有轮次」默认项与各GW；所有轮次随快照包含最新GW，选择某GW只统计该轮且刷新保留，战报摘要仍进入对应单轮。仅public/fun-rankings.js、index.html，资源版本87；补充回归断言未运行。线上仍v86。

**当前 v86 已发布（2026-09-21）**：一级导航整合为首页/本轮战报/联赛榜单/联赛赛程/交易中心/阵容工具，保留旧hash和全部功能；联赛榜单新增趣味榜（板凳大亨、最惨高分、险胜之王），单轮/赛季累计、经理明细、PNG复制及保存入口，战报底部增加本轮板凳摘要。新增fun-rankings.js后端与public/fun-model.js、fun-rankings.js/css，复用官方历史picks/rawlive与自动换人，不增加浏览器轮询；完整且官方结算的历史轮次按联赛/赛季/GW冻结，缺失不伪造零分。560测试通过，本地桌面/375px及线上历史累计/经理明细验证通过。8文件发布并重启本服务，GW1–4各14经理已冻结，GW5各14经理暂定；43归属和23流量文件保留，配置/计分核心/后台/v85交易明细不变。备份 `/opt/fpl-weekly-backups/20260921-v86-before-1789959499261.tgz`。详见RELEASE-v86.md；最新代码仍在本工作副本，勿从旧WorkBuddy目录覆盖。

**当前 v85 已发布（2026-09-18）**：按经理历史引援交易明细改紧凑四列（来源、换入当轮分、换出当轮分、单笔差），按GW分组保留轮次净收益和全部明细/缺失警告。桌面1280×720实测用户经理12笔、+44分，高650px一屏无滚动；手机375px无横向溢出，保留纵向滚动，不裁剪历史。546测试通过、线上HTTPS验证通过；只发布public/trade-manager-details.js、.css、index.html，JS?v=85/CSS?v=85.1，不重启、不改计分/后台/配置/data。24归属、20流量文件保留。备份 `/opt/fpl-weekly-backups/20260918-v85-before-1789701834042.tgz`。见RELEASE-v85.md。

**当前 v84 已发布（2026-09-18）**：用户反馈官方改首发后本站未更新并要求上线，随后催GW5。公开官方实查：entry/249175/my-team 403，event/5 404，event/4仍返回锁定位置；不能承诺截止前排位已同步，不绕鉴权。修复首页右上角refresh原来只读比分的早退，现在所有标签均POST全站刷新、应用新快照，再读取首页动态。服务端manualRefreshes合并点击，等待旧构建后强制新建；并行强制重取比赛中心bootstrap/fixtures/live（已结算历史分仍冻结），部分比赛源失败明确warning，增加原有公开查询限流。所有当前阵容附lineupSourceGw/lineupNote，比较/分享/经理/赛前双球场明确位置参考最近公开GW。GW5按钮增加待开赛标记，历史选择不重置。app/match-view引用84。545测试与本地真实点击及线上POST通过，线上14经理、weekly/homeGW5；公开新首发仍待官方截止后提供。仅server/match-centre/app/match-view/index五文件，备份 `/opt/fpl-weekly-backups/20260918-v84-before-1789700396643.tgz`，24归属与20流量文件保留。见RELEASE-v84.md。

**当前 v83 已发布（2026-09-18）**：用户要求本轮战报与首页实时比分在上轮完赛一天后转下一轮，并明确直接上线。新增共享 `gameweek-rollover.js`，在 `data/cache/gameweek-rollover-v1.json` 按赛季持久记录首个确认全轮完赛时间，满24小时推进展示轮次；旧已完赛数据无终场时间时，严格所有fixtures已完赛且最后kickoff+3h+24h已过才保守回填，basis明确legacy-estimate。未完/延期阻止、状态重开重计时、GW38不越界。`meta.weeklyDefaultGw/weeklySwitchAt/nextWeeklyGw`只管展示，`reportGw`计分/历史归属/交易收益不改。首页refreshPolicy3，缓存到切换/截止边界失效，默认与历史选择分离；战报新GW从leagueSchedule显示VS，TOTW待开赛、历史手选固定，页头显示GW5。app/timeline引用83；7运行文件发布并重启本服务，542测试、本地375px/历史/赛前双球场及生产HTTPS通过。24归属快照、20流量文件保留，config/计分/交易/admin/前端首页脚本哈希不变。备份 `/opt/fpl-weekly-backups/20260918-v83-before-1789699680833.tgz`。隔离预览4321 `/private/tmp/fpl-v83-preview-dz1L2U`；旧4320目前是其他静态服务，未动。详见RELEASE-v83.md。

**当前 v82 已发布（2026-09-15）**：用户要求历史引援收益榜按经理点击浮窗，随后明确「完成后上线」。经理榜整行原生button打开交易明细dialog；按排名截至GW分组，展示Trade对方经理/自由市场Waiver或自由签约、每笔换入换出球员生效当轮Draft原始分、单笔差与原账本轮次净收益。trade-returns新增transactionDetails，从已归一化成交记录生成双方视角并复用livePointsByGw，保留同轮中转明细但不改变原排行/持有期算法；未来分null，历史截止不泄露未来，旧快照缺字段提示待同步。弹窗无需额外API、打开时快照固定，Esc/关闭/背景与焦点/滚动恢复。新增public/trade-manager-details.js/css（JS82、CSS82.1），app82，其他资源保留。536项测试、本地桌面/375px/历史筛选/关闭恢复和生产真实弹窗通过；服务器124条明细、47经理轮次逐笔和与账本一致。仅发布5文件，重启fpl-weekly，20归属快照与17流量文件保留，配置/计分核心/后台/v81首页不变。备份 `/opt/fpl-weekly-backups/20260915-v82-before-1789443438050.tgz`，见 RELEASE-v82.md。最新工作副本与4320预览同步，旧WorkBuddy目录仍未覆盖。

**当前 v81 已发布（2026-09-14）**：用户随后明确「上线」，覆盖下方未发布记录。刷新按钮修复及可见反馈已上线；另补相同内容SSE checked也能结束后台同步提示。529项完整测试、JS语法检查、本地/正式浏览器真实点击通过，按钮恢复可点击，生产加载v81且无记录到的控制台错误。只发布match-centre.js/layout.css/discover.html/home-tab.js/index.html五个静态文件，无重启；配置、后端计分、后台、v80交易app/timeline哈希不变。备份 `/opt/fpl-weekly-backups/20260914-v81-before-1789367551778.tgz`，见 RELEASE-v81.md。原WorkBuddy目录仍未覆盖。

**本地 v81，未测试、未发布（2026-09-14）**：用户反馈赛场动态刷新按了无反应，本次没有上线授权。代码检查发现同GW在途后台请求被复用时手动点击没有busy反馈；完成提示仅sr-only；相同revision时手动刷新不揭示已缓冲事件。新增manualRefreshSequence升级共享请求的展示意图，不重复请求；可见refreshStatus提示刷新/无变化/延迟/失败，沿用旋转箭头和finally恢复；主动刷新揭示已有缓冲，静默更新仍保留阅读位置。扩大刷新点击区，显式click wrapper。match-centre/layout/home-tab/discover/index引用链v81，app/timeline仍v80。4条新回归已编写但未运行，资源版本断言同步；只同步4320静态预览，无浏览器验证、无生产操作，线上仍v80。

**当前 v80 已发布（2026-09-14）**：用户随后明确「可以上线」。交易评价轮次由已计分 GW + 实际交易 GW + 非空成交账本合并降序去重，支持 GW5 提前选择，不按日历凭空增加未来轮。自动模式仍跟最新有真实比赛得分的 throughGw；显式选择随数据刷新保留，交易明细选择独立。未来球员贡献/经理收益/合计强制待计分或破折号，不能把缓存占位 0 当实分；历史榜最多到 throughGw。只发布 public/timeline.js、app.js、index.html，app/timeline 引用 v80，无重启；后端计分/配置/后台/历史数据不变。524项测试通过，本地真实GW5双方、刷新保留、375px无溢出及生产浏览器验证通过。备份 `/opt/fpl-weekly-backups/20260914-v80-before-1789366430107.tgz`，见 RELEASE-v80.md。最新源码仍在当前工作副本，未覆盖原 WorkBuddy 目录。

**源码位置提醒**：v79 生产已成功，但原 WorkBuddy 项目目录的批量同步被本机权限策略拒绝，未执行覆盖。最新源码、测试与发布记录在当前 `work/fpl-live-update`；原目录仍为v78，后续同步需确认，不可从旧目录覆盖线上。

**当前 v79 已发布（2026-09-14）**：用户明确授权首页/全站刷新优化「验证通过后上线」。首页预取并行、有界SWR、keyed DOM/新动态缓冲；SSE心跳20s/失联55s/退避恢复和真实revision确认；实际双球场独立Draft60s采集；赛后未结算60s、历史15m、非比赛3h。历史watch due独立于三轮payload缓存，跨GW不触发淘汰重采；跨联赛build gate2并发/24排队/30s。514测试通过、真实浏览器0px阅读跳动/手机375无溢出/GW切换/筛选保留验证；生产三通道与HTTPS心跳正常。14文件发布，新依赖refresh-control.js和public/live-render.js不可漏；计分核心/配置/后台哈希不变，20归属快照、16流量文件保留。首次部署对正常旧缓存SWR的校验过严曾自动回滚，修正等待采集后第二次成功。备份 `/opt/fpl-weekly-backups/20260914-v79-before-1789354892989.tgz`，详见RELEASE-v79.md。原始镜像仅同步审核代码/文档/测试，不同步data/config。

**当前 v78 已发布（2026-09-13）**：用户随后明确「可以直接上线」。赛场动态经理名加淡绿底描边标签；自由球员浅灰、归属未知灰色虚线。eventPlayerIdentity共享名称，页面titleHtml分别escape姓名/经理名，单事件和合并成员均生效；纯文本title与文字/Canvas分享保持v77内容不变。前端home/match-centre/layout/模板v78，app仍v77。427项测试通过，本地及线上经理/自由球员标签实际显示核验通过。仅5个静态文件发布、不重启，配置/后台/数据/计分逻辑不变；原始镜像同步。备份 `/opt/fpl-weekly-backups/20260913-v78-before-1789311715991.tgz`。

**当前 v77 已发布（2026-09-13）**：赛场动态及文字/PNG分享球员名追加当前Draft联赛归属，使用与其他模块一致的manager.entryName，严格owner===null才标自由球员；缺失/未知/重复code显示归属待确认，不能按Classic/Draft原始ID或名字匹配。后端事件player.code来自Classic官方稳定code，旧历史只补code（presentationVersion4），不改事件ID/时刻/分数。前端以snapshot.players[].photo（Draft code）关联owner→manager.entryId；校验URL联赛ID，跨联赛不混用。applySnapshot和SSE检查经TQLHome.setLeagueSnapshot送入延迟挂载首页，无新增请求；归属变化才重绘feed，注明历史事件也是当前归属。426测试通过，本地185条事件全匹配、PNG/375px及生产实际经理/自由标签验证。仅7代码文件，重启fpl-weekly，19归属快照与配置/计分核心保留；HTTPS双通道推送正常。备份 `/opt/fpl-weekly-backups/20260913-v77-before-1789311237201.tgz`。

**当前 v76 已发布（2026-09-13）**：用户随后明确「上线」。首页比分按进行中→未开赛（开球时间升序、待定最后）→已完赛分组，已完赛置底默认折叠/显示数量；原比分/球衣与队标/事件作用域不变。展开状态在同GW刷新/筛选间保留，新GW重置；官方finished或finished_provisional后自动移组，原生按钮支持键盘及焦点保留。5个静态文件，首页加载链v76，422项测试通过（新增排序、折叠、完场迁移、跨GW、全完赛覆盖）；实际进行中1场/未开赛2场/完赛7场及375px检查通过。无重启、配置/后台不变。备份 `/opt/fpl-weekly-backups/20260913-v76-before-1789310626048.tgz`。

**当前 v75 已发布（2026-09-13）**：公共页头联赛ID输入框左侧新增「怎么查找联赛ID」非提交按钮，原生dialog展示管理员Edit网址数字示例、普通成员找管理员/Network进阶说明，区别联赛ID/球队ID/邀请码。独立league-id-guide.js无数据依赖，关闭/原生Esc/背景点击恢复滚动与焦点，完成按钮聚焦输入框。手机页头搜索整行不溢出。compact-header/guide引用v75，419测试通过、桌面与375px/线上开关验证。仅3静态文件，无重启/配置/后台改动。备份 `/opt/fpl-weekly-backups/20260913-v75-before-1789271871040.tgz`。

**当前 v74 已发布（2026-09-13）**：用户确认大巴车预览后授权上线，仅CHE图标改为确认的原PNG `public/brand/chelsea-bus-v74.png`（按字节保留），CSS显示层scale1.2消除图内留白，其他队SVG不变。match-centre/layout/home-tab/模板缓存v74；416测试通过，实际34px图片加载正常。6静态文件发布、不重启、不动配置/数据。备份 `/opt/fpl-weekly-backups/20260913-v74-before-1789271497203.tgz`。

**用户最新工作规则**：除非用户明确说「上线」，否则只修改代码和更新本地预览，不运行自动测试、不进行浏览器验证、不部署。用户希望减少等待时间；不得沿用历史发布授权。

**当前 v73 已发布（2026-09-13）**：用户明确要求修复两栏滚动并测试上线全部待发布改动；v66–72 以下待发布记录已被本次覆盖。移除首页右侧比分栏 sticky，两栏正常随文档滚动，等宽布局不变。全部首页整合、队标、事件合并/其他筛选、扑点罚丢计分、文字/极简图片分享和球队简称、GW/交易轮次/表格对齐一并发布。415 项测试通过，桌面两栏 computed position static、375px 无溢出、文字复制/PNG、线上首页与无控制台错误已检查。14 个审核运行文件发布，仅重启 fpl-weekly；config、计分核心和19个归属快照哈希保留，双通道及HTTPS SSE通过。备份 `/opt/fpl-weekly-backups/20260913-v73-before-1789271174147.tgz`。未发布无关旧 public/discover.css。详见 RELEASE-v73.md。

**本地 v72（未测试、未发布）**：承接v71分享，赛场动态及所有文字/图片分享球员名追加球队short_name，如Saka (ARS)。统一eventPlayerName按事件fixture与player.team匹配，未知队伍不乱填；合并成员逐人标注。match-centre/home-tab/模板引用v72，静态文件已同步4320，无测试和上线。

**本地 v71（未测试、未发布）**：动态每条右上角「文字分享」「图片分享」。文字同步取当前事件/合并成员，逐行“球员 emoji ±分数”+固定https://fpl.xiaokailabs.com，writeText失败弹出原文供手动复制，不虚报成功。图片单事件使用compact分享模式：800px自适应高度，仅事件图标/姓名/分项分数+URL，不画Logo/标题/比分/时间/状态/解释；合并进球助攻拆分展示所有成员不截断。顶部分享比赛日仍保留原完整模板。新的按钮布局和前端资源v71，已同步4320静态文件，没有测试/浏览器验证/生产操作。

**本地 v70（未测试、未发布）**：首页取消DC/Bonus独立筛选，改「其他」收DC、Bonus、扑点和罚丢点球，默认全部排除other。后端从官方explain增加penalties_saved/missed及差分，presentationVersion=3，旧缓存新增项按baseline迁移不冒充刚发生。前端按同fixture+team+观测批次+修订方向合并同时有goal/assist的记录，保留每个球员分项，不伪造逐球配对；无助攻记录不补造。默认baseline按同队累计合并。分享复用合并结果，分项不相加冒充单人得分。红黄牌改倾斜SVG、assist钉鞋、DC拦截人物，分享Canvas也用对应矢量。match-centre/share/home-tab/模板/layout资源v70，已同步4320并重启本地以启用新后端；无测试、无浏览器检查、未访问生产，生产仍v65。v69和以前测试的旧版本/筛选/元数据断言待授权测试时更新。

**本地 v69（未测试、未发布）**：调整首页8队原创SVG轮廓：FUL三个F、NEW喜鹊、LIV独立liverBird、TOT球上公鸡、ARS火炮车轮、CRY展翼鹰、NFO前后3树、AVL独立跃狮（不影响CHE原lion）。match-centre/home-tab/模板引用v69；已同步隔离4320预览静态文件。无计分改动，无测试或浏览器检查，原始镜像及生产仍未动。既有资源版本断言待用户授权测试上线时同步。

**本地 v68 待确认（2026-09-13）**：自由球员表头切TIMELINE.reportGw并同时用liveGwPoints，旧快照只同轮可回退lastGwPoints；修复.table th覆盖ta-r/ta-c、手机th/td统一9px。既有tcGwSel移入左侧收益卡片，加可见「轮次」，复用currentByGw与保持选择逻辑，不重复创建selector。app/style/workspace-refined v68。409项通过、实际GW4与11/10列对齐、GW2收益筛选已检查。生产仍v65，v66–68只在工作副本与4320预览，原镜像未动。详见RELEASE-v68-pending.md。

**本地 v67 待确认（2026-09-13）**：承接v66首页。动态左/比分右等宽，手机单列横排比分；原创队色SVG意象代替缩写，当前官方red_cards逐侧汇总放队名后。事件按observedAt倒序、同批源顺序、baseline底部且明示无法还原先后；图标和分类色块，新增Bonus只读取explain.bonus，绝不用BPS推算。meta.presentationVersion=2触发旧缓存补齐，旧bonus导入为baseline，保持历史。分享标题「比赛进展」。新match-centre-layout.css和home/match-centre资源v67。405项通过、桌面/375手机/分享图核验。生产仍v65、原始镜像不动，本地4320预览，未收到此次上线授权。详见RELEASE-v67-pending.md。

**本地 v66 待发布确认（2026-09-13）**：Discover 已并入工作台第一标签「首页」，默认首页、Logo回首页，旧联赛hash保留；`/discover` 302至同query的 `/#home`。home-tab按需导入同源discover.html的main/dialogs到Shadow DOM，避免重复页头/样式污染/analytics；match-centre与share支持root参数，首页隐藏断开该通道，回来补齐。原v65采集策略不改；顶部刷新按当前页路由，首页访问不报league_use。398项通过、实际图片分享与切换检查通过。只在work/fpl-live-update和隔离4320预览有改动，生产及原始镜像仍v65。详见RELEASE-v66-pending.md，等待本轮确认，不复用上一轮上线授权。

**当前 v65 已发布（2026-09-13）**：用户授权 discover 与其他前台页面刷新规则全部上线，已覆盖下面v64待确认记录。Discover后端10秒/非比赛3小时，开赛前1分钟唤醒；工作台15分钟快照+交易开放/截止/观察完场追加同步。新生产依赖 `update-stream.js`、public同名脚本，SSE只推指纹通知，有变化客户端读取共享缓存；不按采集时间重绘。连接隐藏暂停/重连补齐/失败重试/降级轮询；原score与match鉴权60秒规则不改。public-snapshot额外注入工作台fresh策略，不能把15分钟作用到实际计分缓存。双球场停止独立分钟轮询、继续hydrate/按需打开；admin不变。app/match-view/match-centre/update-stream JS v65。394项测试通过、真实API预览/生产HTTPS SSE核验通过，19历史归属哈希与配置保留。仅发布10个审核文件、重启fpl-weekly、无需Nginx改动。详见RELEASE-v65.md。

**本地 v64 待本次上线确认，生产仍v63**：discover非比赛3小时/比赛60秒；全季赛程在下一场开球前1分钟唤醒，含跨GW；浏览器按meta.nextRefreshAt到期才请求，后台隐藏暂停。新增6项时序测试，全量384项通过。只改后端match-centre、前端同名JS及discover HTML（JS v64），CSS/share仍v63。不实施1秒请求，未同步生产或原始镜像。详见RELEASE-v64-pending.md；等待用户本次确认，不沿用上一轮发布授权。

**当前 v63 已发布（2026-09-13）**：用户要求Logo首页改实时比分/FPL事件中心，随后明确直接上线。只替换 `/discover`，新增 `match-centre.js` 后端、public/match-centre.js/css/share.js（?v=63）；原工作台/后台/图标不变。Classic三接口同一ID空间，60秒比赛/15分钟bootstrap缓存、3轮且pin当前GW、上游并发4，独立 `data/cache/match-centre-v1.json` 保存累计基线和观测差分。首次不是刚发生，右栏时间是本站检测时间，非逐球时刻；DC/CS只信官方explain分，CS撤销需此前真实观察过正分，不能从最终比分回填历史撤销。分享最多5条，保留源时间、该项分、结算/延迟和网站地址。378项回归通过，真实GW3/4、桌面/手机、PNG与复制验证。只发布六文件并重启本服务，config/旧data保留。发布备份和回滚见RELEASE-v63.md。旧discover纯入口约定被本次用户明确改版取代，ID直接进入工作台/说明/反馈/无后台链接仍保留。

**当前 v62 已发布（2026-09-08）**：后台页头/登录改v47新版Logo，后台独立暖橙#F4BB76原Q favicon在public/admin-icons，admin HTML的icon/apple/manifest引用v62；前台保持v60浅绿。admin.css/js v62。新后端依赖analytics-matchdays.js，取完整380场官方Classic全季fixtures按北京时间开球日期分类，覆盖外/未定日期为unknown；15分钟内存缓存/并发合并/失败1分钟退避，过期有缓存则明示。analytics-report.hourly保留value并增加matchday/nonMatchday/unknown，三类总和=value，过滤/时段不变；admin堆叠柱橙/蓝/灰，提供天数、图例和ARIA明细，不冒充日均或赛中流量。349项测试通过，生产489PV拆分一致；config/data/schema7/前台业务不变。见RELEASE-v62.md。

**当前 v61 已发布（2026-09-08）**：用户确认自由球员开放/阵容截止口径并授权验证后直接上线。战报 KPI 改双倒计时，`public/trade-countdown.js` 共享官方 Draft `events.data` 标准化与纯时间逻辑，`tradeWindows[].opensAt/closesAt` 直接来自 `waivers_time/deadline_time`（不是 `trades_time`，不得用 Classic 倒推）。两个事件独立滚到未来时间，历史 GW 不控制它们。快照 schema7；app / countdown JS / CSS v61，图标维持 v60、其他功能未变。336 项测试通过，线上38轮窗口/手机显示/健康检查通过。部署6个代码文件；保留 config 和整个 data，不能清理 TOTW 归属文件。见 RELEASE-v61.md。

**当前 v60 已发布（2026-09-07）**：用户选定「调整前暗色」原直尾 Q（浅绿 #D9EF9E 底 / 深绿 #12382A 图形），所有浏览器亮暗统一，不采用 v3 微翘尾巴。index/discover/admin 的 icon/apple-touch/manifest 引用均 v60，无 media 分流；PNG16/32/48、ICO3帧、Apple180、manifest192/512。根 favicon.png 和旧 brand/tql-icon.png 也更新为同图，避免旧收藏路径命中老标；历史原始图保留在设计v2 original.png和v60发布前备份。浏览器图标透明圆角，Apple/应用图标相同图形配色但满铺浅绿底，由系统裁圆角。server只加.webmanifest MIME，不改任何计分/业务/schema（仍6，app仍v59）。页头和分享PNG仍使用v47横向TQL徽标，独立FFScout原型不动。327项测试通过，线上11资产字节/MIME/HEAD/304及3页引用验证通过。仅15个审核文件发布，只重启fpl-weekly，配置/data完全不上传。详见RELEASE-v60.md；浏览器已保存收藏图标缓存不能承诺即时刷新。

**当前 v59 已发布（2026-09-07）**：TOTW按GW历史归属固定。新生产依赖totw-ownership.js，schema6自动使旧快照失效；app.js?v=59。从所有经理对应GW完整15人官方picks（含替补）建owner表，不能用element-status或当前managers[].picks回填。当前GW复用确切squadGwByEntry，历史GW一次性分批4并发补取，完整/唯一/身份/GW/球员引用全部校验后冻结到data/cache/totw-ownership-v1-league{id}-season2026-27-gw{gw}.json。已保存合法快照读时不与当前经理名单比较，保留后来离队经理；内含完整历史成员/owners/采集显示名，league/season/GW/deadline/schema及内部一致性仍严格验证。Classic仅复用通过验证的历史payload。原scores/live缓存不冻结提前、不变计分。applyOwnership覆写owner/ownerName/ownershipStatus，缺数据为unknown而非free；前端esc历史ownerName，不再ownerName(p.owner)回查当前经理。归属与分数分开冻结，capturedAt是真实回补时间，lockedAt为官方GW截止。GW1–3全33人线上官方核验0差异，312项测试，服务/原数据保留。发布、备份与回滚见RELEASE-v59.md；保留所有totw-ownership文件，后续刷新/重启/部署不得清除。

**当前 v58 已发布（2026-09-07）**：性能优化不改计分/schema5。新增生产依赖 public-http.js、public-snapshot.js，部署不可漏掉。公开GET可对同league/schema/season、updated和reportSourceUpdated均<5min且未跨deadline的有效缓存做有界SWR，返回副本meta.stale/refreshing，保留所有分数/源时间；20秒失败退避。不替换getSnapshot/getLeagueSnapshot/getMatchSnapshot的权威TTL和force语义。公开快照gzip且no-store；静态文本gzip/ETag304，数字版本URL缓存1小时，HTMLno-cache。app.js?v=58仅渲染active tab并以快照引用失效，后台同步时7.5秒查询；头部提前fetch，初始hash标签在analytics前选定，applySnapshot纯状态初始化默认经理避免打开顺序影响。新增loading.css?v=58手机可见延迟提示。298项测试、9模块/经理记忆/剪贴板/手机/线上数据与压缩缓存验证通过。6代码文件已发布，仅重启fpl-weekly；配置和data保留。见RELEASE-v58.md。

**当前 v57 已发布（2026-09-07）**：经理 localStorage 键 `fpl-fixtures-manager:{leagueId}`，卡片与FDR选择均保存，只恢复有效entryId，存储受限不阻断功能。赛程未来对阵可点击，match-view.previewDetail 只用于 gw>reportGw 且属于官方 leagueSchedule 的两经理，当前15人 picks 转为 preview:true、分数null、分钟0、未开赛；明确当前持有而非锁定、不发未来GW API；快照水合更新预览，跨deadline转真实GW读取。两球场导出也标非锁定预览。复制按钮在点击内直接 clipboard.write(ClipboardItem Promise<PNG>) 保留Safari用户激活；成功提示Ctrl+V/⌘V，失败仅提供下载链接，绝不谎报成功或自动发送微信。fixtures/match-view/match-share JS v57，CSS和app版本不变。282项测试通过，线上记忆/30人预览/剪贴板写入成功。4个前端文件，无后端重启，见 RELEASE-v57.md。

**当前 v56 已发布（2026-09-07）**：赛程 THE MATCHUPS 两侧加当前排名，所有名字在各自单元格居中、桌面对阵限宽920px。移除 fxManager select，改 fxManagerChoices 原生按钮组，aria-pressed 单选；电脑网格换行/手机横滑，选中经理标题当前排名、整季赛程保持。选择状态继续存 state.manager，FDR点击经理仍联动；rankText 缺失排名不补数。fixtures JS/CSS v56，277项测试与线上14排名/38轮验证通过。仅3个前端文件发布，未重启后端。见 RELEASE-v56.md。

**当前 v55 已发布（2026-09-07）**：手机刷新按钮修正，禁止恢复 btn.textContent 替换完整结构。SVG 图标保留，is-refreshing 控制居中旋转（1.8s linear），隐藏文字但桌面保留占位；aria-busy/label 和 disabled 在 finally 恢复，防重复点击。app / compact-header 引用v55；275项测试通过，手机实际刷新前/中/后36×36，线上旋转生效。仅3个前端文件，未重启服务。回滚见 RELEASE-v55.md。

**当前 v54 已发布（2026-09-07）**：v53 同次上线复查发现 Logo 二次请求可能超时降级，两种分享器现优先复用已完整加载、同源同 URL 的页头 img；无就绪图片时仍有5秒超时/文字降级。app / match-share 缓存 v54，272项回归通过；线上实际导出 PNG 目视为新版 Logo。最终状态以本条优先，发布回滚沿用 RELEASE-v53.md。

**当前 v53 已发布（2026-09-07）**：用户最新「完成后把之前的改动也上线」解除 v49–52 禁止发布。10 个代码文件部署并仅重启 fpl-weekly，保留配置和 data；270 项测试通过。分享预览/PNG 和双球场 PNG 采用页头同一 `/brand/tql-badge-preview-v47.png?v=47`，Canvas 等比 contain 加圆角裁剪，不修改原图；移除旧白底字标卡。app / match-share 引用 v53，fixtures v50，match-results v52，match-view v49。完整赛程 schema5；线上 266 场 / 38 轮、经理整季 38 行、战报双格比分、PNG 导出验证通过。备份及回滚见 RELEASE-v53.md。以下本地记录仅为历史，勿误认生产仍是 v48。

**本地 v52，仍禁止上线**：按用户反馈移除 weekly 比分中间冒号和平局底部文字，统一等宽双格；保留胜方高亮、胜标记与 aria-label 胜负说明。app / match-results.css 引用 v52，其他资源不变。预览沿用 3215，生产仍 v48。

**本地 v51 战报胜负强调，禁止上线**：只修改 weekly 的 matchCardHtml 和独立 match-results.css（ID 选择器限制 #lastGwMatchList），胜方比分深绿白字 / 队名加粗 /「胜」标记，负方比分弱化，平局单独标识。缺失分不补零、不判胜负；进行中不标赢家。app 与新样式 v51；fixtures 仍 v50。269 项测试通过；真实 GW3 六场胜负一场平局、桌面和手机无溢出验证完成。生产仍 v48，本地预览 http://127.0.0.1:3215/?league=47275#weekly 。

**本地 v50 布局调整，仍禁止上线**：用户最新要求顶部 THE MATCHUPS 紧凑对阵，中间 Manager 整季列表，底部 FDR。移除介绍文案；新 fxMatchGw 只控制顶部，fxManager 只控制中间全部官方轮次，fxGw / fxRange 只控制底部；FDR 点击队伍可定位经理模块、点击 GW 可定位顶部。fixtures JS / CSS 引用 v50，其余不变。267 项测试通过；桌面约 55px 对阵行高，手机比分不折行；线上依旧 v48，不得发布本地 v49/v50。

**本地 v49 赛程预览，禁止上线（2026-09-07）**：用户重复明确「先不上线」。新增 fixtures 标签、public/fixtures.js / fixtures.css；app 和 match-view 资源 v49。完整官方 leagueSchedule 单独输出，保留未来对阵；未来 0:0 置 null，不动原战报 h2hByGw。snapshotSchema=5（仅本地），不要把此版本当成已发布。支持 6 / 12 / 剩余赛季窗口、起始 GW、球队筛选、当前排名提示和已赛双球场详情；Classic 无 H2H 提示、不编造轮空赛程。265 项测试及真实 14 队 / 38 轮预览通过。当前可看 http://127.0.0.1:3215/?league=47275#fixtures ，线上仍 v48。不要因以下历史授权而发布 v49。

**当前 v48 已发布（2026-09-07 09:39）**：用户确认「验证后直接上线」，261 项完整测试通过。GW 完赛与结算分离：当前 GW 所有赛程 `finished || finished_provisional` 即停止 Live，并更新 lastFinishedGw / upcomingGw；未完成官方结算则 reportFinalizing:true，快照与双球场继续 60 秒刷新修正。比赛周固定分数缓存依旧仅 event.finished 且 data_checked!==false 才写入。snapshotSchema 升至 4，旧缓存自动失效；数据目录不清空。trade-returns.latestScoringGw 用真实出场分钟 / 非零分 / explain 判断新轮有得分，deadline 后全零占位不推进 throughGw。前端 txEvalGw=null 自动跟随最新有分轮次，tcGwSel 只控制收益与历史榜；独立 tcTxGwSel 控制交易明细和已成交筛选。app / timeline / match-view 资源 v48。部署仅 8 个审核代码文件，不覆盖配置、流量或联赛数据；回滚见 RELEASE-v48.md。后文 v47 及更早规则冲突时以本条为准。

```bash
# 1. 本地改代码后同步到服务器（排除运行时数据）
rsync -av --exclude 'config.json' --exclude 'data/' \
  /path/to/fpl-weekly/ root@124.222.221.150:/opt/fpl-weekly/
# 2. 重启并验证（在服务器上验证，不要在本机 curl 服务器 IP——本机有 TUN 代理会假阳性）
ssh -i ~/.ssh/eplens_lighthouse_ed25519 root@124.222.221.150 \
  "systemctl restart fpl-weekly && sleep 2 && curl -s http://127.0.0.1:9090/api/health"
```

更新前保留可回滚的生产代码备份；仅同步审核过的代码。不得覆盖生产 `config.json`，不得上传本地预览配置、固定快照或测试运行时数据。除 `server.js` 和 `public/` 外，必须带上新依赖 `live-scoring.js`；前端必须包含 `timeline.js`、`workspace-ui.js`、`workspace-refined.css`。

## 前端缓存约定

**当前 v47 已发布（2026-09-06 23:01）**：用户最新「可以上线，直接应用到 fpl.xiaokailabs.com」解除本次预览的禁止发布要求。浅绿圆角 TQL Logo 仅替换工作台左上角；原样 PNG `public/brand/tql-badge-preview-v47.png`（1853×849、不透明），index 添加 `tql-logo-preview` 类，compact-header.css 引用 v47。约 100×46px contain / height:auto 显示，filter:none、mix-blend-mode:normal 保留原色，CSS 圆角遮掉原图棋盘格角落。旧字标 / favicon / 分享图片和 discover / admin 保持原样。253 项完整测试通过；本地桌面 / 手机及线上显示确认正常。仅发布 index、compact-header.css、新 PNG，不改后端 / 配置 / data，不重启服务。文件名和 CSS 中 preview 是历史命名，当前已上线。回滚见 `RELEASE-v47.md`。

**当前 v46 已发布（2026-09-06 14:54，包含 v44 / v45）**：用户最新「完成后上线」解除此前暂停发布要求。252 项完整回归通过，8 模块、手机与线上联赛搜索检查通过。`tql-brand.css?v=46` 的字标 img 使用 brightness(1.07) 后 multiply，将原 PNG 的 RGB 240–247 浅底提升为白后融合到页面，不改 PNG、图标或分享画布。三类页面更新品牌 CSS 版本；紧凑页头仍用 `compact-header.css?v=45`，桌面 65px / 手机 89px（含边线），导航 45px。移除「官方 Draft 数据 / 其他联赛」，原生 `GET /` 搜索表单 `name=league` 支持回车 /「查找联赛」直达 `/?league=ID`，必填、最多 10 位数字、排除全零，无额外 JS 或预取。保留数据绑定 ID；手机刷新仅图标但有无障碍名称。仅发布 5 个前端文件，不改后端 / 配置 / data，不重启服务。回滚与核验见 `RELEASE-v46.md`。

**v43 已发布（2026-09-06 12:11 北京时间）**：249 项回归通过。TQL FPL 品牌覆盖工作台、discover、admin、favicon / apple-touch-icon、阵容交易名片和双球场分享 PNG。新增 `public/tql-brand.css` 与 `public/brand/tql-wordmark.png` / `tql-icon.png`；三类页面最后加载品牌 CSS。`app.js`、`match-share.js`、`admin.js` 与新品牌资源引用 v43，其余资源版本保留。域名仍为 fpl.xiaokailabs.com，不改独立 FFScout 原型、计分/交易/统计逻辑、球场几何和原分享尺寸；仅前端发布，未重启服务。规范和内置图像处理提示词见 `BRAND-v43.md`，发布和回滚见 `RELEASE-v43.md`。

**v42 已发布（2026-09-05 23:48 北京时间）**：232 项回归通过，应用户追加要求，将本站访问日志中可匹配的 366 次历史联赛打开补入累计，涉及 11 个联赛；方法、发布和回滚见 `RELEASE-v42.md`。新依赖 `analytics-history.js`，离线补录依赖 `analytics-backfill.js` 和 `scripts/backfill-league-usage.cjs`。v41 于 23:22 发布今日 PV / UV、去重联赛使用数与本人访问排除，195 项回归通过，记录见 `RELEASE-v41.md`；下面 v40 为工作台历史功能。

**v40 已发布（2026-09-05）**：最新用户明确要求「完成后上线刚刚的几项更新」，已解除上一轮「先不测试和发布」。本轮统一验证并发布 v38 自动替补/预计算、v39 逐人交易贡献和 v40 按经理交易净收益历史排名。136 项测试通过，线上公开快照 14 位经理 / 7 场双球场数据核验通过。发布和回滚记录见 `RELEASE-v40.md`；`RELEASE-v38-pending.md` 仅保留当时未获发布授权的历史记录，不是当前状态。

v38 新增 `auto-subs.js`：每次从原始锁定 picks 先尊重官方换人，再预判本轮全部赛程已完且零分钟无牌的首发替补；门将独立、合法阵型、严格替补优先序。尚有赛程的替补可以预占换入位置但不预测得分，明确标预判/待上场。战报/积分榜与双球场共享有效 XI，DEFCON/奖励分不重复加。`snapshotSchema=3`；`matchDetails[]` 仅预计算当前报告轮真实对战，原始完整 live 只在正式结算后存 `draft-live-detail-v1-gw{n}.json`。

刷新快照复用已取到的完整 squads/live/fixtures，不能递归调用 matchDetailService.get；`prime(snapshot)` 只写有界内存缓存。前端 `FPLMatchView.hydrate(snapshot)` 接收明细并同步已打开的同一场，历史轮保留按需回退。明细 updated 使用最老得分源的请求开始时间，不能因预计算或水合续期。`match-view.js` / `match-view.css` / `match-share.js` 引用为 v40，其他未改资源仍保留既有版本。赛程必须先校验原始 event 再筛选 GW，防止缺失轮次被误判为空白轮；明确的 event:null 可表示未安排赛程。

同批已发布交易评价逐人贡献：`trade-returns.js` 在 `currentByGw[].rows[].playersIn/Out[]` 加 `gwPoints`（所选 GW 原始分）和 `contribution`（换入为原始分，换出取反），原净收益/排序算法不变。待开赛或未知贡献不用 0 代替；账目不一致不分摊净收益。前端球员姓名后显示贡献 ± 分，逐人相加对应行净收益。此次 `app.js` 与 `workspace-refined.css` 缓存版本为 v40。

历史引援榜新增 `按球员 / 按经理` 小 tab。原球员榜继续使用 acquisitions 持有期得分；经理榜只读 `tradeReturns.managerRankingByGw[min(所选GW, throughGw)]`，由各生效 GW 的 currentByGw 净收益累计，不引用持有期分数。传入全部 managers，零交易经理也显示 0；同分同名次，历史缺失不伪造总分或排名。GW 切换和快照刷新保留 tab。仍是球员原始分（含替补），不是实际 XI 得分增量。

2026-09-05 已按用户最后指示测试并部署 **v37**：TOTW 自适应加高、比分框居中、交易评价双卡、积分榜经理球场详情（无 EP）。`workspace-refined.css`、`app.js` 与新增 `manager-view.css` 引用为 v37；新后端依赖 `trade-returns.js`。81 项测试与线上检查通过，生产配置和 data/ 保留。

同批包含对战状态/性能与手机分享图：`match-view.js`、`match-view.css`、`match-share.js` 引用也为 v37。无出场得分显示「—」，赛中高亮，1080×1808 竖版；前端短期缓存/意图预读，后端共享资源与有界快照捷径。验证记录见 `RELEASE-v37.md`。

每次改 `public/` 下文件，必须更新对应 HTML 静态资源的 `?v=N` 版本号（当前 app.js、match-share.js、admin.js 与品牌资源为 v43，未变资源保留原版本），
服务端已设 `Cache-Control: no-cache`，但旧版本号仍可能导致浏览器/CDN 缓存旧文件。

## 本机网络坑（Mac 开发环境）

- 本机开着 TUN 代理，DNS 查询返回 fake-IP（198.18.0.0/15），curl 本机探测公网服务会假阳性。
  验证公网一律：`curl --noproxy "*"`、公共 DNS 直查（`dig @119.29.29.29`）、或 SSH 到服务器上验证。
- macOS `sed -i ''` 多表达式会报错，改文件用编辑工具；BSD `grep -o` 不支持 `\|`，用 `grep -oE`。

## 业务/数据约定

- 两套 ID 空间：`standings[].league_entry` ↔ `league_entries[].id`；`transactions[].entry` / `element-status[].owner` ↔ `league_entries[].entry_id`，通过 `league_entries` join。改数据逻辑前先弄清用哪套。
- Draft 与经典 FPL 的球员 `id` 会错位，跨 API 球员合并必须使用稳定的 `code`；每 GW 实际分使用 Draft `/api/event/{gw}/live`。
- 下轮阵容以 `element-status.owner` 为准，picks 只用于保留位置顺序；否则 deadline 后的交易会滞后一轮。
- 下轮预计得分只汇总 `position <= 11` 的 Draft 首发 XI；替补席不计分，且 Draft 无队长倍率。
- waiver / 自由签约来自 `transactions`；直接玩家交易来自独立的 `trades` 接口。所有交易按时间相对 GW deadline 计算生效 GW；`result: 'a'` = 已成交，`'di'/'do'` = 被拒。
- 时间线由 `live-scoring.js` 计算：`meta.reportGw` 是战报轮次（deadline 到达立即进入当前 GW），`lastFinishedGw` 是最近完赛轮次，`upcomingGw` 是预测目标（最近完赛轮次 + 1）。不要再用 `lastFinishedGw` 作为实时战报、积分榜或 TOTW 的上限。
- 进行中按该 GW 锁定的 Draft 首发 XI 和 Draft live 实际分计算，不使用交易后的当前持有阵容；Draft 的 15 人 multiplier 可能全为 1，不能据此累加替补。尊重官方换人，但 picks 已换位时不能重复换人；奖励分已包含在 `total_points` 中。
- 实时 H2H 积分榜由历史和当前唯一对阵重建，按当前比分暂计胜平负；不能在可能已计入本轮的官方总分上再次相加。Classic 按各 GW 锁定阵容累计得分。
- 浏览器每 60 秒 GET 快照；服务端进行中快照 TTL 为 60 秒，非实时默认 15 分钟，并在下一 deadline 强制失效。刷新保留历史 GW、筛选及阵容选择，不合成标签点击、不重绑事件；获取失败保留旧快照并显示延迟。
- TOTW 随当前 GW 得分更新。全部比赛 `finished` 后取消 LIVE；官方 `event.finished` 且 `data_checked !== false` 后冻结该轮 Draft 分数至 `data/cache/draft-live-v1-gw{n}.json`，待官方结算期间仍允许常规刷新修正。交易动态将进行中 GW 标为“本轮”，不标“下轮”。
- 快照结构见 `data/snapshot.json`：`meta`、`managers[].history`、`gwHistory`、`transactions`、`totwByGw`、`h2hByGw`。
- v36 战报对战卡可点击打开原生 dialog。`match-detail.js` 提供按需 GET `/api/league/{leagueId}/match/{gw}/{entry1Id}/{entry2Id}`，只取实际对手两队该轮 picks/live，校验联赛及 GW，不使用当前 ownership 或赛季 minutes。详情缓存为有界内存，失败保留旧时间并标 stale，不落盘阵容明细。
- 明细 `playedCount` 只计有效 XI 中 GW minutes > 0 的球员；0 分出场也计入。`remainingCount` 按未实际完场的赛程统计，finished_provisional 可确认足球完场，但不提前冻结奖励分；双赛周这两个人数可能重叠。替补分不计总分，官方换人不重复应用。
- 前端新增 `match-view.js` / `match-view.css` / `match-share.js`。分享按钮生成双球场 PNG 下载，不自动发送；图片冻结点击时的数据，保留 GW、更新时间、双方出战人数和专属联赛网址。图片与页面使用相同的同源球衣接口，加载失败有超时降级。
- 交易评价读取 `snapshot.tradeReturns`，不再由 `lastFinishedGw` 隐藏进行中 GW。左侧按所选 GW 成交操作的经理净换入/换出计分，同轮中转球员抵消；右侧每次引援持有段从生效 GW 起至转出前一 GW 截止，按所选 GW 裁切后累计排名。二者均是 Draft 球员原始分（含替补），不是经理真实首发积分增量。缺失或不完整历史不代填 0；旧 `tradeImpact` 保留兼容但不用于新卡片。
- 2026-09-05 DEFCON 审计确认 GW1–3 官方 Draft `total_points` 已包含防守贡献分，且与 Classic 稳定 code 对照和 explain 累加一致，禁止再额外 +2。证据见 `DEFCON-AUDIT-20260905.md`。积分榜经理详情展示当前持有阵容、本轮球员原始分与总分，不冒充本轮锁定 XI，不展示 EP。
- 匿名流量事件按天追加到 `data/analytics/YYYY-MM-DD.jsonl`，不保存原始 IP；部署时必须保留该目录。后台入口 `/admin`，密码哈希与会话密钥仅放生产 `config.json`，不要提交到代码。
- v41 流量统计依赖 `analytics-report.js`、`analytics-identity.js`：先统一排除 bot / internal / 已识别管理员匿名 ID，再算所有 PV、UV、会话、趋势和联赛数。今日以北京时间 00:00 起算，7/30/90 天是包含今天的自然日；累计联赛数独立于筛选，仅保留日志范围（400 天），不是历史缓存文件数。
- 联赛采用只认成功渲染工作台后每页面一次的 `league_use`，服务端还要验证内存里的联赛快照。公共 `analytics.js` 同时用于工作台和 discover；只采允许的页面路径，不采未知 SPA fallback 探测路径、不把每分钟刷新记作 PV/采用。
- 自己访问：已认证后台 login/session/analytics 登记当前 HMAC(ip|ua)，签名长期 `fpl_analytics_internal` cookie（400 天、HttpOnly、SameSiteStrict、生产 Secure）。签名目的域与 admin session 分离，不能用于认证；退出后台不清排除标记。仍需其他设备登录一次，历史只能排除匹配匿名 ID，不应声称所有旧访问都识别。
- `data/analytics/internal-visitors.json` 只含匿名排除 ID / 起点；`collection-v2.json` 保存联赛埋点起点，两者应保留。公开采集忽略客户端 internal 字段，只有服务端能标记本人。
- v42 历史补录仅使用本站 Nginx 日志的成功工作台文档 + 同匿名身份 120 秒内对应成功数据请求，严格早于 collection-v2 起点。派生记录单存 `league-history-v1.json`，稳定 backfillId 去重、重复执行幂等；不制造 PV / UV。历史已认证后台请求也可识别匿名 owner 并追溯过滤。必须标明历史推断/不完整限制，不能用快照缓存文件数或 API 请求数代替采用量，也不能宣称已识别所有旧本人流量。
- `/discover` 接受公开 Draft 联赛 ID，`/api/league/{id}` 动态构建联赛快照并缓存到 `data/leagues/`；`/?league={id}` 复用完整工作台。兼容 `league.scoring = h/c` 两种计分方式，部署时必须保留 `data/leagues/`。
- `/discover` 是纯联赛入口，提交有效 ID 必须直接跳转 `/?league={id}`，不要恢复中间联赛总览；公开首页不展示 `/admin` 链接。
- `/discover` 同时接受纯数字 ID 和包含 `/league/{id}/` 的官方 Draft URL，并保留联赛 ID 查找说明。
- `/` 和 `/?league={id}` 均通过 `html.scout-workspace` 启用浅色主题，样式顺序为 `style.css` → `workspace-scout.css` → `workspace-refined.css`。深绿 `#12382a`、浅青柠 `#d9ef9e`、白卡片与 `/discover` 一致，不恢复默认首页旧深色皮肤。
- 专属工作台导航下方直接进入模块内容，不再显示“联赛数据工作台”介绍区；联赛名称、赛季和 GW 状态由顶部品牌栏承担。
- 自由球员模块以 `players[].owner == null` 为未持有口径；默认排除 `status == "u"` 的不可用球员，必须保持搜索、球队/位置/状态筛选、排序和分页可用。
- 阵容分享模块用“首发球场 + 替补席”展示全部 15 名球员，球衣可点击标注非卖品，并按联赛 ID + entry ID 写入 localStorage；导出的 1080×1350 PNG 必须包含球队阵容状态、`fpl.xiaokailabs.com` 专属联赛链接和可扫码二维码，不向服务端上传标注。二维码通过支持 CORS 的 `api.qrserver.com` 载入，失败时保留文字网址降级。
- Team of the Week、阵容分享、阵容对比及导出的交易名片统一使用远端窄、近端宽的 FPL 式透视球场，并按门将、后卫、中场、前锋自上而下排列，不恢复为俯视矩形草坪或反向站位。
- 页面和导出交易名片统一通过同源 `/api/kit/{teamCode}[-gk].png` 使用 FPL 官方球衣；服务端仅代理白名单数字球队代码，避免跨域图片污染 Canvas。
- 工作台与 `/discover` 页脚均保留“问题反馈”入口，弹窗显示公开静态资源 `/wechat-feedback.jpg`，不得将联系方式拆成额外的数据采集接口。

## 其他

- 回归测试：`node --test tests/*.test.js`；覆盖 GW deadline / 完赛 / 跨轮、缓存 TTL、锁定 XI 和已应用自动换人、奖金只计一次、14 队官方观测对照及前端默认选择。另用浏览器验证实时战报 / 积分榜 / TOTW / 交易 GW 标签、自动刷新状态保留和手机布局；单元测试不能代替线上验证。

- 凭证：SSH 私钥在 `~/.ssh/eplens_lighthouse_ed25519`；后台密码哈希与会话密钥仅存在服务器 `config.json`，项目代码不存明文密码或 token。
- 改联赛：只改 `config.json` 的 `leagueId` / `leagueName`，重启服务即可。
- WorkBuddy 侧另有应用发布链接（sites 托管），与 Lighthouse 部署相互独立，换客户端后以 Lighthouse 部署为准。
