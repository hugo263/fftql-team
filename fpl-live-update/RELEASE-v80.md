# v80 · 交易评价自动增加新交易轮次

2026-09-14 已发布。用户明确授权「可以上线」。

## 变化

- 修正前端只允许 `GW <= throughGw` 的限制。轮次取已计分历史轮、实际交易记录及非空成交账本的并集，按 GW 降序去重，限制有效整数 1–38。
- 已出现 GW5 交易，即可选择 GW5 查看双方换入/换出球员，无须等待开赛。评价仍只展示已成交操作；未成交提案不会冒充成交。
- 自动模式仍保留最新有实际得分的一轮，不因未来交易自动跳走。手选 GW 在数据刷新后保留，和下方交易明细筛选独立。
- 未产生比赛得分的球员贡献和收益均显示「待计分」或「—」，即使旧缓存有占位零也不使用。历史球员榜及经理榜都最多算到实际得分 `throughGw`。
- 不修改后端、计分算法、交易生效轮次算法、刷新周期和其他页面。

## 验证

- `node --test tests/*.test.js`：524/524 通过，无失败/跳过；新增 10 项轮次、真实后端 pending 账本、选择保留、历史上限、伪零与缺失明细回归。
- 两个修改脚本通过 `node --check`。
- 本地真实联赛 47275 显示 GW5：林良鋒换入 Okafor/Evanilson、换出 Gakpo/Ekitiké，Eve2026 为对应反向交易；双方全部待计分。右侧历史截至 GW4。
- 手动刷新结束后仍选择 GW5；下方明细仍可独立选择 GW4。375px 视口文档宽度 375px，轮次筛选不溢出。
- 正式 HTTPS 浏览器同样显示 GW5 及上述双方交易，加载 app/timeline v80，无记录到的控制台错误。
- 生产三个资源 HTTP 200 且字节哈希与审核包一致，health 200，进程 PID 不变；config/server/live-scoring/trade-returns/admin HTML 哈希不变。

## 发布与回滚

发布包 `/private/tmp/fpl-v80-release-20260914.tgz`，只含：

- `public/timeline.js`
- `public/app.js`
- `public/index.html`

先安装向后兼容 helper，最后替换 HTML 版本引用；逐文件原子替换，无重启。未上传 config、data、测试或预览代码。

备份：`/opt/fpl-weekly-backups/20260914-v80-before-1789366430107.tgz`。

回滚只需在服务器解包以上三个前端文件到 `/opt/fpl-weekly`，不需重启，不得清除 data 或覆盖配置。发布脚本在静态资源/健康/保护文件检查失败时自动恢复，本次全部检查成功。

最新源码位于 `/Users/ken/Documents/个人网站计划/work/fpl-live-update`；4320 本地预览同步了三个静态文件。未覆盖旧 WorkBuddy 原目录。
