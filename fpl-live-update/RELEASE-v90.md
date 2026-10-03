# v90 · Draft 首页官方队徽（2026-10-01）

用户要求先把原有球队图标归档到 Obsidian 并打标签，再替换为 FPL 队徽；随后明确「完成后上线」。本次只发布队徽替换，不包含待发布的 v87 趣味榜筛选或 v89 主站首页框架。

## 原图保留

- Vault：`/Users/ken/Documents/Personal Asset/Personal Asset`。
- 笔记：`Resources/FPL/FPL Draft 原创队标归档（2026-10-01）.md`。
- 附件：`Assets/FPL/club-icons-original-2026-10-01/`，25 个 SVG（含 Chelsea 未使用旧狮子）及原字节 Chelsea 大巴 PNG，共 26 个素材。
- 标签：FPL、Draft、设计素材、图标、原创队标；笔记可直接预览图标。
- 附件和原 JS 均有 SHA256 清单；安装只新增文件，不覆盖已有笔记。

## 页面修改

- 用官方 `team.code` 生成 `https://resources.premierleague.com/premierleague/badges/70/t{code}.png`，不使用会随赛季变化的 `team.id` 或缩写猜测。
- 34×34、等比 contain、透明背景、不裁剪轮廓；移除原大巴缩放。
- 无合法代码或图片加载失败时显示球队简称；失败代码在该页面生命周期内保留降级，避免刷新后重复显示坏图。
- 队徽出处和权利说明更新；TQL Logo、favicon、事件图标、球衣、分享、计分和更新机制均不改。
- `match-centre.js`、布局 CSS、discover 模板、home-tab 入口缓存引用更新为 90。

## 验证与发布

- 全套 564 项自动测试通过，新增代码映射、异常代码、轮廓样式、加载失败降级覆盖。
- 真实本地桌面及 375px 浏览器：20 支球队官方图片全部加载成功，34×34 无缩放裁剪，无横向溢出，无捕获的错误日志。
- 只发布 5 个静态文件：index.html、home-tab.js、match-centre.js、match-centre-layout.css、discover.html。index 从当时生产版本生成，只改 home-tab 版本，保留线上其他功能及缓存引用。
- HTTPS 健康检查、五文件字节校验通过；194 项配置、后端、其他静态资源、vhost 和历史快照哈希保留；33 项流量文件保留。生产 PID 3664713 未变，无重启。
- 备份：`/opt/fpl-weekly-backups/20261001-v90-before-1790816288241`。
- 隔离发布源与原图清单：`../fpl-club-icons-20261001/`；带校验与自动回滚的 `deploy-v90.cjs` 只允许指定五文件，校验旧生产哈希后写入，index 最后切换。
- 主站仍为 `https://fftql.team/?league=47275#home`。未修改 DNS、Nginx、证书或主站入口路由，v89 尚未部署。

## 回滚

只恢复上述备份里的五份静态文件，index 最后恢复。不恢复或覆盖 config、server、data、analytics，不重启服务。若文件已被另一任务更新，先核对当前差异，不能覆盖后续改动。
