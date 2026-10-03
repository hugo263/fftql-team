# v81 · 赛场动态刷新按钮

2026-09-14 已发布，用户明确授权「上线」。

## 修复

- 手动点击遇到同 GW 后台请求时复用请求，同时开启旋转箭头、busy状态与可见进度，不再静默返回。
- 增加可见状态：同步完成、暂无新动态、后台采集中、源数据延迟、失败可重试。相同内容的 SSE checked 也可结束后台等待提示。
- 手动刷新展示已经收到但为保护阅读位置而暂存的新动态，即使服务器版本没有再次变化。自动推送仍保持原有阅读保护。
- 按钮点击区至少 52×36px，保留原图标文字，禁用仅持续于请求期间，finally恢复。
- 没有增加上游强制请求；依旧读取后端共享缓存和自动采集结果，不承诺官方数据即时变化。

## 验证

- `node --test tests/*.test.js`：529/529通过，无失败或跳过。新增五项覆盖后台请求合并反馈、缓冲事件揭示、失败恢复、普通响应和SSE完成提示。
- 修改的前端JS通过语法检查。
- 本地4320实际点击：完成后显示「已检查，暂无新动态。」，button.disabled=false，aria-busy=false，无记录到的控制台错误。
- 正式HTTPS实际点击：可见「已同步最新可用比赛数据。」，按钮57×36px并恢复可点击；home-tab/match-centre加载v81，无记录到的控制台错误。
- 生产五个资源HTTP200且哈希与发布包一致；health200，服务PID保持2741144。配置、server.js、live-scoring.js、trade-returns.js、admin.html以及v80的app/timeline哈希均未变。

## 发布

只发布五个静态文件：public/match-centre.js、public/match-centre-layout.css、public/discover.html、public/home-tab.js、public/index.html。

发布包：`/private/tmp/fpl-v81-release-20260914.tgz`。
回滚备份：`/opt/fpl-weekly-backups/20260914-v81-before-1789367551778.tgz`。

逐文件原子替换，入口HTML最后切换，验证失败自动恢复。本次无需回滚，无服务重启、无配置或data上传。若需回滚，仅将以上备份解包回 `/opt/fpl-weekly`，不得清除数据或修改其他共享服务。

最新源码保持在 `/Users/ken/Documents/个人网站计划/work/fpl-live-update`，4320本地预览同步；未覆盖旧WorkBuddy目录。
