# v84 · 全站刷新与阵容来源说明

2026-09-18 已上线，用户明确要求阵容刷新修复上线，随后追加GW5要尽快展示上线。

## 核查与限制

官方公开接口实查用户entry249175：`/api/entry/249175/my-team` 403；`/event/5` 404；`/event/4` 200且仍为GW4锁定的15个位置。因此截止前修改首发和替补的私人排位不能靠公开抓取同步，不绕过认证、不保存用户登录凭证。平台可以持续更新最新15人归属，但当前位置仅参考最近公开阵容；截止后原有currentGw流程取得新轮公开picks。

GW5实际已由v83发布，生产API及当前浏览器均可见；此次为战报按钮增加“待开赛”以明确。未编造GW5实分或TOTW，也未强制清除手选历史轮。

## 修改

- 右上角刷新取消首页独有早退；首页和其他标签均调用全站POST刷新，再读取最新联赛快照，当前首页另外读取已收集的动态。
- 服务端等待点击前的旧构建结束后再新建，不将旧构建当成手动刷新的结果。重复点击按联赛合并，使用原有查询限流。
- 比赛中心明确强制模式绕过空闲和bootstrap缓存，仍保留并发合并及失败退避；与联赛收集并行。比赛源失败不丢弃成功的新联赛数据，返回可见延迟warning。
- manager新增lineupSourceGw/lineupNote，经理弹窗、阵容对比、分享页以及赛前双球场明确说明位置来自最近公开阵容，不是假称已同步的私人新首发。导出分数、历史计分、交易收益和归属锁定算法均不变。

## 验证与发布

545项完整回归和修改JS语法检查通过。新增强制采集、等待旧构建/重复点击合并、部分失败保留成功结果；原首页刷新测试按新全站要求更新。

本地首页真实点击后按钮恢复且全站快照更新时间前进；GW5待开赛按钮可见，无记录到控制台错误。生产真实POST返回ok且warning为null，随后联赛与比赛源时间均晚于点击时间；14经理有来源说明，weekly/home均5。HTTPS浏览器重载后比赛周明确GW5待开赛，已停留战报供用户查看。

仅发布server.js、match-centre.js、public/app.js、public/match-view.js、public/index.html，app/match-view版本84，timeline仍83。24既有归属文件哈希及20流量文件保留，config/live-scoring/auto-subs/trade-returns/gameweek-rollover/admin/timeline未改。

备份 `/opt/fpl-weekly-backups/20260918-v84-before-1789700396643.tgz`。发布包 `/private/tmp/fpl-v84-release.tgz`，带哈希校验/备份/失败回滚脚本 `/private/tmp/fpl-v84-deploy.cjs`。只重启fpl-weekly；人工回滚解包该五文件备份并重启即可，不清理data。

源码仍在当前work/fpl-live-update；隔离预览4321已同步。未覆盖旧WorkBuddy或4320静态服务。
