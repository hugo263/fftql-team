# v47 — 工作台左上角 TQL Logo

发布时间：2026-09-06 23:01（Asia/Shanghai）。用户明确批准「可以上线，直接应用到 fpl.xiaokailabs.com」。

## 范围

- 仅工作台左上角采用用户上传的浅绿圆角 TQL Logo，原 PNG 不修改，按约 100×46px 原比例展示。
- CSS 关闭旧字标提亮与混合，用圆角遮住原图不透明棋盘格角落。
- discover、admin、favicon、分享图片、数据逻辑均不变。
- 发布 `public/index.html`、`public/compact-header.css`、`public/brand/tql-badge-preview-v47.png`；CSS 和新图片 URL 使用 v47。
- preview 文件名 / 类名沿用本地预览命名，不代表尚未发布。

## 验证

- 完整 Node 测试 253 项通过（含 12 项品牌测试）。
- 本地 1280px / 390px 预览通过，保持紧凑页头。
- 生产 service active，健康接口 ok，页面 / CSS / PNG 均返回 HTTP 200。
- 生产 3 个文件 SHA-256 与本地一致。
- 线上桌面和手机视图确认新 Logo 完整显示；DOM 确认图片已加载、原图宽 1853、显示 100×45.8125、无页面横向溢出。
- 静态增量发布，不重启服务，不写入 config.json 或 data/。

## 回滚

服务器备份：`/opt/fpl-weekly-backups/20260906-v47-before.tgz`。

若获授权需要回滚，在 `/opt/fpl-weekly` 解压该备份恢复 v46 的 `public/index.html` 与 `public/compact-header.css`；新增 PNG 可保留，不再被页面引用。无需重启后端。
