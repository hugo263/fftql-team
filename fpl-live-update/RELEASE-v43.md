# v43 — TQL FPL 品牌应用

已于 2026-09-06 12:11（北京时间）部署到 https://fpl.xiaokailabs.com，12:12 起完成线上资源和浏览器核验。用户明确要求引用 Logo 任务的视觉规范并上线。

## 范围

- 使用用户提供的 Q 足球 / TQL 色块 / FPL / 浅绿圆点标识；内置 image_gen 整理网页字标和简化标签图标，原图不覆盖。来源、素材和最终提示词见 `BRAND-v43.md`。
- 森林绿 #12382A、浅黄绿 #D9EF9E、暖白 #F3F5F1、白卡、灰绿文字；无衬线粗标题、等宽数字、小圆角，保留实时 / 伤病 / 盈亏语义色。
- 工作台、discover、后台、favicon / apple-touch-icon、阵容交易名片、双球场分享图统一品牌。真实联赛名称、经理、网址和二维码保留。
- 不改独立 FFScout 原型，不切换 tqlfpl.site 域名，不改球场几何、门将顺序、业务数据和统计口径。导出尺寸保持 1080×1350 / 1080×1808。

## 验证

- 249/249 自动回归通过；app.js、match-share.js、admin.js 语法检查通过。
- 本地桌面与 390px 手机布局、discover、对比球场、阵容分享画布已检查，无横向溢出和损坏球衣。
- 线上工作台实际加载 tql-brand.css?v=43、2172px 原始字标；动态标题以 TQL FPL 结尾，无控制台 error / warn；后台新品牌及数据卡正常显示。
- HTTPS `/`、`/discover`、`/admin`、品牌 CSS、两个 PNG、三个 JS 均 200，Content-Type 正确。真实后台统计接口 `/api/admin/analytics?days=7` 未登录仍 401。
- fpl-weekly 服务 active，/api/health 正常。9 个发布文件 SHA-256 与本地完全一致。
- 后端 server.js SHA-256 保持 `15a97fcf42b7e6c1b23f2036384f041a4d862ff48f2392f919626cca031905d9`；config.json mtime / size 保持 `1788322538 / 353`。未覆盖配置、data/ 或 Nginx；仅静态前端发布，未重启服务。

## 发布与回滚

发布包：`/tmp/fpl-v43-20260906.tgz`。

只发布以下 9 个文件：

- public/index.html、public/discover.html、public/admin.html
- public/app.js、public/match-share.js、public/admin.js
- public/tql-brand.css、public/brand/tql-wordmark.png、public/brand/tql-icon.png

原 6 个前端文件备份：`/opt/fpl-weekly-backups/20260906-v43-before.tgz`。

需要回滚时，在 `/opt/fpl-weekly` 恢复上述备份中的六个文件；三个新增品牌静态资源可保留，旧页面不再引用。无需修改配置、统计历史或计分模块。应先检查是否存在后续发布，再决定回滚，不自动覆盖后续用户修改。
