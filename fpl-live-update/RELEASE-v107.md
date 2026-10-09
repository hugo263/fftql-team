# v107 · 资讯按钮视觉修复

2026-10-08（北京时间）。用户暂停发布后，明确「现在上线」，仅发布本轮两项主站视觉修改。

## 改动及范围

- 资讯详情弹窗：字体 `×` 改对称内联 SVG，grid 居中、零内边距，保留32px圆形按钮、原ID、无障碍名称与关闭逻辑。
- 顶部分类筛选：全部及10类使用与消息标签相同的11px字号、1.5行高、上下3px内边距与1px边框，取消36px固定高度。实测24.5px，同高；颜色、选中态、筛选逻辑不改。
- 仅发布 `public/portal.html`、`public/portal.css`、`public/news-categories.css`；两份样式缓存引用107。
- 无服务重启，不修改config/data、业务计分、资讯内容或资讯后端。资讯release保持 `/opt/tql-news/releases/20261003-v14-rss-retry`，同级资讯v15筛选/去重仍未发布。

## 验证

- 发布前生产三个文件与只读副本逐项diff；差异仅上述改动。
- `node scripts/verify-v107-dialog.cjs`：本地HTML/两份样式覆盖，其他资源及资讯均读正式站；拦截统计接口，不写浏览器测试PV。
- `node scripts/verify-v107-dialog.cjs --live`：正式站真实资源复查。
- 本地及线上各1440、768、390、320px：11个按钮高度等于消息标签；关闭图标中心偏差0px；无横向溢出；真实分类筛选、关闭、Esc、焦点恢复正常；无pageerror。
- 已目视检查手机弹窗、桌面筛选、线上手机筛选和桌面弹窗。截图及JSON：`output/fpl-v107/browser/`。
- HTTPS入口通过服务器TLS请求读取三个资源，SHA256均与本地一致；服务active、`/api/health`正常。
- 本次小范围静态视觉改动只执行针对性浏览器验证，没有重复运行579项全量业务回归。

## 发布与备份

发布驱动：`scripts/deploy-v107-static.cjs`；暂存 `/opt/fpl-weekly/releases/v107-20261008`。
发布前核对已审核生产基底、配置及暂存文件哈希，备份原文件，按样式→HTML顺序原子替换每个文件。

备份：`/opt/fpl-weekly/backups/v107-1791420145058`，包含原三个文件与before.json。发布驱动确认config哈希未变化，没有重启服务。

| 文件 | 发布SHA256 |
| --- | --- |
| portal.html | 31eb93cb75caf182278d375c9430cac4283bb28bfe748e53787082157796f876 |
| portal.css | da29769c820c261f1763fa68683fde24ff4e20e032c01e45f6b32310b7081557 |
| news-categories.css | 80649d136a65725bf0473b00390f191d013784d99bbcd3a97c748adf7527a100 |

需要回滚时，仅从上述备份恢复对应三个 `/opt/fpl-weekly/public/` 文件，确认当前修改范围后再执行；不覆盖config/data，不回滚资讯后端，不需要重启服务。
