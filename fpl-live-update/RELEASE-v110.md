# v110 · 球员卡片得分单位

2026-10-08（北京时间）。用户要求球员卡片下方改成「上轮8pts 总分27pts」，完成后上线。本次已发布。

## 范围

- 共用 `comparePlayerCard` 中给已知轮次分和总分补 `pts` 单位，标签在数值前，单位为较小字号；分成两行，避免横向挤占。
- 阵容对比首发与替补、积分榜经理阵容弹窗同步使用该格式。
- 阵容对比仍取 `lastGwPoints`；经理详情仍取 `liveGwPoints` 并保留实际GW标签，不将当前/正在比赛的分数误称上轮。
- 0和负分保留真实数值，null/undefined保持「—」，不补零或「—pts」。计分、阵容、归属与分享逻辑不变。
- 最初320px验证发现五人行个别卡片溢出，增加≤380px的紧凑字号与间距后重测通过。球员姓名仍沿用已有单行规则。

仅发布三份主站静态文件：`app.js`、`pitch.css`、`index.html`。JS及CSS缓存引用110。没有重启应用或修改配置、data、资讯/后台文件；同日v109专题和其他任务后台发布保留。

## 验证

- 发布前与三份生产只读副本逐项diff，确认只含本次单位/排版与缓存引用改动。
- `node --test tests/manager-view.test.js`：6项通过，覆盖15人/首发替补、数据字段范围、0/负数/缺失分、8pts与27pts格式、姓名转义与空态。
- `node scripts/verify-v110-points.cjs`：仅用本地三文件覆盖正式站资源，读取真实快照；统计接口被拦截，测试不写PV。
- `node scripts/verify-v110-points.cjs --live`：正式站发布后复查。
- 本地和线上各1440、768、390、320px；每个尺寸逐一核对30张对比卡和15张经理弹窗卡的数值/单位与原快照一致、两行布局、分数不溢出、球员不被裁剪、经理弹窗可关闭，无pageerror或整页横向溢出。
- 已目视检查390px阵容对比及320px经理球场。截图与结果在 `output/fpl-v110/browser/`。
- 正式HTTPS三个文件SHA256与本地一致，服务active、health正常。本次未重复运行全量业务回归。

## 发布及回滚

脚本 `scripts/deploy-v110-static.cjs` 在prepare阶段校验已审查生产基底，publish再检查原文件、配置及暂存哈希。按pitch.css→app.js→index.html顺序原子替换每个文件，失败可恢复原三个文件。

- 暂存：`/opt/fpl-weekly/releases/v110-20261008`。
- 备份：`/opt/fpl-weekly/backups/v110-1791440544372`，包含原三文件与before.json。
- 发布确认 `configPreserved=true`、`restarted=false`。
- 本轮末次只读检查时，资讯current为 `/opt/tql-news/releases/20261008-v14-admin-workspace`，对应同日其他任务的后台更新。本轮未切换资讯release；不能用旧v14-rss目录覆盖它。

| 文件 | 发布SHA256 |
| --- | --- |
| app.js | c0079160c9be4cc70cbf565a23cd7c521e1c06bc58a4ffc93cd1482ce60d863c |
| pitch.css | 423556c8180cfa5d5b739fb71741798293f0d22412b913982e694029fab7069d |
| index.html | c0d5d899697d90205615f1a519e67c401226744682291df5ed387be7c567924a |

如需回滚，确认当前修改范围后，仅从此备份恢复对应三个 `/opt/fpl-weekly/public/` 文件。不覆盖config/data、资讯或后台，不需要重启应用。
