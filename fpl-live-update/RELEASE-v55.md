# v55 手机刷新按钮

2026-09-07 按用户「完成后直接上线」发布。

根因：手动刷新用 textContent 替换按钮全部内容，破坏手机隐藏文字的 span。现保留 SVG/文字节点，更新期间隐藏文字并居中旋转图标（1.8秒/圈），桌面保留文字占位避免宽度跳变。尊重系统减少动态效果；aria-busy、aria-label、disabled 在成功/失败后恢复。

275项测试通过；本地手机实测前/中/后36×36，无横向溢出；线上确认 busy=true、文字 display:none、动画1.8s 生效，静态文件哈希与本地一致，健康检查ok。

仅发布 public/index.html、public/app.js、public/compact-header.css；app和compact-header缓存v55。未重启服务，配置/联赛/流量数据不变。

生产备份 `/opt/fpl-weekly-backups/20260907-v55-before.tgz`：包含上述3个原文件。获得回滚授权后在 /opt/fpl-weekly 解压恢复，无需回滚数据或重启后端。
