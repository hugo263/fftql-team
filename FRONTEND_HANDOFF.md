# 前端重新设计交接

备份日期：2026-10-09（北京时间）。目标是重新设计 fftql.team 的前端视觉、布局和交互，保留现有数据与业务能力。

## 先看哪些文件

| 页面或能力 | 主要源码 |
| --- | --- |
| 主站 FPL 资讯门户 `/` | `fpl-live-update/public/portal.html`、`portal.js`、`portal.css`、`portal-news-model.js` |
| Draft 工作台 `/draft/` | `fpl-live-update/public/index.html`、`app.js`、`workspace-ui.js` |
| 全站页头、导航与视觉变量 | `fpl-live-update/public/night-tokens.css`、`night-shell.css`、`night-shell.js`、`tql-brand.css` |
| 当前覆盖样式与手机适配 | `night-workspace.css`、`night-ui.css`、`light-surfaces.css`、`responsive.css`、`workspace-refined.css`（均在主站 `public/`） |
| 比赛中心 | `public/home-tab.js`、`discover.html`、`match-centre.js`、`match-centre*.css`、`night-match.css` |
| 球场、阵容对比与分享图 | `public/pitch.js`、`pitch.css`、`match-view.js`、`match-share.js`、`night-share.js` |
| 联赛赛程、交易及趣味榜 | `public/fixtures.*`、`trade-countdown.*`、`trade-manager-details.*`、`fun-rankings.*` |
| 主站管理后台 `/admin` | `public/admin.html`、`admin.js`、`admin-workspace.css` |
| 小红书工作区 `/admin/xhs` | `fpl-live-update/xhs/ui.html`、`ui.js`、`ui.css` |
| 资讯站 React 前端 | `fpl-news-v1/apps/web/app/routes/`、`components/`、`features/`、`app.css`、`public-site.css` |
| 资讯站品牌与内容配置 | `fpl-news-v1/industry/site.ts`、`taxonomy.ts`、`brand/` |
| API 契约 | `fpl-news-v1/packages/contracts/`、`reference/public-v1.openapi.json`；主站路由见 `server.js`、`site-routing.js` |

除另有前缀外，表内 `public/` 均指 `fpl-live-update/public/`。主站是原生 HTML/CSS/JavaScript，不是 React；资讯站是独立 React / React Router 项目。不要误把资讯站组件当作主站页面。

## 本地预览

主站启动见根目录 README。配置示例绑定 `127.0.0.1`，运行数据会写到被 Git 忽略的本地 `data/`。页面需要动态 API，直接双击 HTML 或只用静态服务器不能完整展示业务功能。

资讯站需要 Node.js >=24.11、npm、PostgreSQL 16/17：

1. 在 `fpl-news-v1/` 执行 `npm ci`，复制 `.env.example` 为 `.env`。
2. 使用独立的本地空数据库配置 `DATABASE_URL`；填写仅供本地使用的 `ADMIN_PASSWORD`、`SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET`。不要使用生产数据库或凭据。
3. 保持 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_CONTENT_PUSH_ENABLED`、`FEISHU_INTERNAL_ENABLED`、`INDEXNOW_SUBMIT_ENABLED` 为 `false`。前端设计无需启动采集 worker 或配置付费模型密钥。
4. 运行 `node --env-file=.env scripts/migrate.ts` 初始化本地数据库，再分别运行 `npm run dev:api` 和 `npm run dev:web`。
5. API 默认 `3001`，资讯网页默认 `3000`。若与主站同时运行，将主站本地 `config.json` 的 `port` 改为 `3100`，主站资讯代理用 `TQL_NEWS_PUBLIC_ORIGIN=http://127.0.0.1:3001`。

空数据库不会自带生产新闻、管理员会话或统计数据。演示数据应单独标注，不应写入生产。部署文档中的上游项目示例不是本次前端交接的启动要求。

## 设计时保留的行为

- 保留联赛 ID、现有 hash 路由、旧分享 URL、筛选、GW 选择、刷新状态及键盘/弹窗行为。
- 主站大量脚本依赖既有 DOM ID 和全局对象；先梳理绑定再改结构。比赛中心使用 ShadowRoot，外部 CSS 不会自动进入其中。
- 样式有多层覆盖，按 HTML 中真实加载顺序调整。球场 DOM 与导出 Canvas 共用几何逻辑，网页和分享图应保持一致。
- 不改变 Draft/Classic ID 对应、稳定 player code、计分、自动换人、交易收益、倒计时与缺失值含义。
- 管理后台继续鉴权；不把密码、密钥、真实后台数据或私有小红书素材放进前端。
- 建议交付桌面和移动端方案，覆盖资讯、Draft 六大模块、阵容弹窗/分享图及后台。可分阶段提交，不必一次改完。

## 当前版本边界

主站源码已包含发布记录中的 v111。资讯站是当前本地源码备份，包含**尚未上线的 v15 筛选与去重改动**；前端重新设计不能将这些后端改动顺带视为已验收或已授权部署。历史脚本存在生产路径，请只在隔离副本工作。

本次备份只做文件完整性和敏感内容检查，没有重新执行应用测试或部署。后续测试及上线应按项目负责人的指示安排。

## 可直接交给另一个 AI 的任务

> 请读取 https://github.com/hugo263/fftql-team 的 README.md 和 FRONTEND_HANDOFF.md，分析现有主站和资讯站前端，提出并实现新的视觉与交互设计。重点修改 fpl-live-update/public/ 和 fpl-news-v1/apps/web/app/，保留现有数据接口、业务计算、DOM 绑定、路由及分享功能。请先给出设计方向和关键页面方案，明确桌面与移动端表现；使用本地副本，不部署生产，不启用采集/付费模型，不修改生产数据。资讯 v15 后端尚未发布，请单独保留这一状态。

AI 无法浏览目录时可先读取纯文本入口：[README 原文](https://raw.githubusercontent.com/hugo263/fftql-team/main/README.md)、[交接文档原文](https://raw.githubusercontent.com/hugo263/fftql-team/main/FRONTEND_HANDOFF.md)，或下载仓库 ZIP。
