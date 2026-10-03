# v46 — 无色差 Logo、紧凑页头与联赛 ID 搜索

已于 2026-09-06 14:54（北京时间）部署到 https://fpl.xiaokailabs.com。
用户要求 Logo 底色统一并「完成后上线」，包含此前仅本地预览的 v44 / v45。

## 变更

- 原字标 PNG 是不透明浅底，边缘抽样 RGB 240–247。CSS brightness(1.07) 将浅底提升为白，再通过 multiply 融合所在页头；不重新生成或覆盖 Logo，不宣称 PNG 变成透明。工作台、discover 和后台共用这一显示规则，分享画布不变。
- 合并 Logo 栏和高绿色横幅，页头桌面 65px / 手机 89px，导航 45px（均含分隔线）。Logo、真实联赛名称、GW 状态、刷新都保留。
- 去掉右上角「官方 Draft 数据 / 其他联赛」；ID 搜索框位于「查找联赛」按钮左边。原生 GET / 表单通过回车或点击进入 /?league=ID，不增加中间页、预取或 JS 依赖；最多 10 位数字，必填且不允许全零。
- 不改球场布局、统计与计分逻辑、独立 FFScout 原型、域名或后端服务。

## 发布文件与验证

仅 5 个前端文件：public/index.html、public/discover.html、public/admin.html、public/tql-brand.css、public/compact-header.css。
三页品牌 CSS 版本 v46；工作台独有紧凑页头 CSS 版本 v45；其他静态资源版本保持原值。

- 252/252 完整回归通过。
- 本地 8 模块切换：页头 65px，无横向溢出，无损坏图片；390px 手机页头 89px，Logo 无灰块。v45 已验证 320px 小屏与无效 ID / 回车跳转。
- 线上刷新实际加载两个新版样式，字标加载成功，Logo 底色视觉一致，无溢出及控制台 error / warn。
- 线上实际输入 47275 点击查找，直达 /?league=47275 并加载真实联赛，再返回交易中心。
- /、/discover、/admin、两份 CSS 经服务器本地 HTTPS 域名验证均 200 / MIME 正确；未登录 /api/admin/analytics?days=7 仍为 401。
- fpl-weekly active，health 正常；5 个发布文件 SHA-256 与本地一致。
- server.js SHA 保持 15a97fcf42b7e6c1b23f2036384f041a4d862ff48f2392f919626cca031905d9；Logo PNG SHA 保持 761117a572ab10b7cd8f38f208626309a884b59f96be23bad03008241787024e。
- config.json mtime / size 保持 1788322538 / 353；未覆盖 data/、Nginx 或其他应用，不重启服务。

## 回滚

部署包：/tmp/fpl-v46-20260906.tgz。
发布前 4 个旧前端文件备份：/opt/fpl-weekly-backups/20260906-v46-before.tgz。

确认没有后续发布后，可在 /opt/fpl-weekly 恢复备份中的 index.html、discover.html、admin.html、tql-brand.css；新增 compact-header.css 可保留，v43 页面不引用。不要更改配置、数据或后端。备份恢复的是 v43 线上页头，并非曾经仅本地的 v44 / v45。
