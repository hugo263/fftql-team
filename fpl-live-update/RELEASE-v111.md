# v111 · 单行球员得分与球场图例

2026-10-08（北京时间）。用户要求得分改为单行，允许英文缩写、球场角落解释；随后明确「上线」。本次已发布。

## 范围

- 阵容对比首发和替补共用「LW 8 · T 27」格式，LW为上轮、T为赛季总分，单位pts写在球场右下角。
- 积分榜经理详情仍取真实轮次 `liveGwPoints`，显示「GW 8 · T 27」；图例明确例如「GW＝GW5得分」，不将当前轮次误称上轮。
- 0和负分保留真实数值，null/undefined仍「—」；title与ARIA保留完整中文和pts单位。
- 球场底部预留28px，图例不遮球员。320px五人行一处溢出在收紧≤380px的间距后重测通过。
- 不改计分、阵容、归属、球场几何、分享逻辑或数据。

仅发布 `app.js`、`pitch.css`、`index.html`；JS/CSS缓存引用111。没有应用重启、配置/data写入、资讯/后台发布；同日v109专题和新后台保持。

## 验证

- 下载线上三份基线逐项diff，仅有本次排版/图例/缓存引用差异；部署脚本再次检查生产基线及配置哈希。
- `node --test tests/manager-view.test.js`：6项通过，断言已更新为单行/缩写/完整无障碍说明，覆盖15人阵容、数据取分范围、零/负/缺失分、8和27示例、转义与空态。
- `node scripts/verify-v111-points.cjs`：三份本地资源覆盖正式页面、只读真实快照；统计请求拦截，不写PV。
- `node scripts/verify-v111-points.cjs --live`：上线后正式页面复查。
- 本地/线上各1440、768、390、320px；每个尺寸30张对比卡、15张经理弹窗卡的原值/标签/ARIA/title/单行/无溢出/不裁切均通过；图例在球场内且不遮球员，弹窗可关闭，无pageerror或整页横向溢出。45张球衣/尺寸全部载入。
- 已目视检查桌面经理球场及390/320px阵容对比；截图、检查结果位于 `output/fpl-v111/browser/`。
- 服务器正式HTTPS三资源200且SHA256一致，health200/ok。本次没有重复全量业务回归。

## 发布与回滚

部署脚本 `scripts/deploy-v111-static.cjs` 仅允许三份文件，按pitch.css→app.js→index.html逐份原子替换；publish前检查配置、原文件和暂存内容哈希。发布报告configPreserved=true、restarted=false。

- 暂存：`/opt/fpl-weekly/releases/v111-20261008`。
- 备份：`/opt/fpl-weekly/backups/v111-1791442514398`，保存原三文件与before.json。
- 资讯current仍 `/opt/tql-news/releases/20261008-v14-admin-workspace`，未切换release，待发布v15仍独立保留。

| 文件 | 发布SHA256 |
| --- | --- |
| app.js | 6efaaaf0a0d2bfa5304268a001ff8b3f0cd1aff2b77f70d845f281027a21d176 |
| pitch.css | 251b0851394c29ccdbcbe0165d51172f1981aa5bb397d81642149b666c269bdd |
| index.html | 9d25a96c934c7d94500413407bcf506fb642422257dbd64057d83f35fd54a4ab |

如需回滚，先检查生产是否有后续更新，仅从该备份恢复对应三个public文件。不要覆盖config/data、资讯、后台或其他服务；静态文件回滚无需重启。
