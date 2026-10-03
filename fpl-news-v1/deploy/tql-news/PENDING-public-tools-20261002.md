# 资讯工具：502 与主站主题对齐（历史待发布记录）

**已于2026-10-02随用户新授权测试并发布为v9，10-03完成线上验收。下方是发布前的调查记录，不再代表当前状态。现状与回滚见 `RELEASE-v9-light-mobile.md`。**

本地实现完成；用户仍要求未明确说上线之前不做测试或发布。
本次只读服务器状态和日志，没有发起网页验收请求、构建、自动测试、重启或写入生产。

## 已确认的故障原因

2026-10-02 北京时间，Nginx `tql-news.error.log`：

- 22:51:01 `/hot` 及两个 JS 资源连接 `127.0.0.1:9012` 被拒绝，返回 502。
- 22:51:31 `/daily` 同样连接被拒绝。
- 对应时刻的 `journalctl -u tql-news-web` 明确记录服务停止、重新启动，随后打印 `web started`。
- 故障前 `/hot` 为 200，故障后22:51:45 `/admin` 为 200；排查时 web/api 都为 active/running，重启计数0。

这是一段发布时间的端口空窗，不是热点 / 日报内容被删除，也没有证据表明接口数据损坏。没有把 RSS / X 抓取问题与网页 502 混为一谈。
当前线上 release 仍 `/opt/tql-news/releases/20261002-v8-rss-timeout`。
实际 Nginx 文件是 `/www/server/panel/vhost/nginx/tql_news.conf`。

## 本地改动

- `apps/web/server.ts`：检测 systemd 的 LISTEN_PID 和单个 LISTEN_FDS，以 fd3 接管监听；普通本地 / Docker 继续原 HOST/PORT。清除激活环境变量，避免传给后续子进程。
- `tql-news-web.socket`：systemd 独立持有原 `127.0.0.1:9012`，web 重启期间保留监听和排队。没有开放公网端口，不提高资源限制。
- `tql-news-web.service`：依赖该 socket，现有账号、工作目录、环境文件、权限和内存限制保持。
- `root.tsx` / `public-site.css` / `Sidebar.tsx` / `more.tsx`：公开资讯工具 SSR 直接是浅色，忽略该子站旧外观偏好与系统暗色；保留偏好存储和收藏。公开页换成主站相同深绿页头、原 TQL Logo、FPL资讯 / Draft 导航、纸白卡片和浅绿选中态，管理员主题独立。
- `hot.tsx` / `report-latest.tsx` / `topics.tsx`：清理本次工具页面残留的 AI 行业文案，主题分组对应既有 industry/topics.json 的球队 / 玩法 / 消息分类，不迁移主题数据。
- `starred.tsx`：导入后的说明不再声称公开页会切换到旧深色主题。收藏 key、导入导出和读取逻辑不变。

没有修改主站 `fpl-live-update` public 文件、数据库、采集预算、密钥、X 开关、新闻内容或后台鉴权。主站球场 v100 仍是另一项待发布改动。

## 获得用户上线授权后再做

1. 先执行类型检查、构建、公开页面 / 收藏 / 后台回归；Linux 隔离环境验证 fd3 激活与重启排队，含错误 descriptor 情况。
2. 备份 current release、原 web unit 与该站 Nginx；保留 build 哈希资源兼容旧页面。不覆盖生产环境文件与数据库。
3. 首次从应用自持端口转为 socket 持有端口存在绑定交接：不要直接启动 socket 和仍绑定9012的旧进程，否则 EADDRINUSE。准备临时 web 实例和就绪检查，单独将该资讯 vhost 平滑切到临时实例后交接9012，再切回；或经确认安排短维护窗口。不要动其他 vhost 或重启无关服务。
4. 发布能识别 fd3 的代码并安装两个 unit，daemon-reload；启用 socket 后由它激活 web。后续普通 web 发布只 restart web，不 restart socket。不要沿用旧脚本反复 restart web/api/worker 的做法。
5. 若需要真正停止站点，要同时停止 socket 与 service；只停 web 可能被新请求重新激活。
6. 回滚到不认识 fd3 的版本时，必须同时恢复旧 service、停用 socket、再让旧 web 自己绑定9012，不能只回滚代码。通过临时实例保持切换过程可用。
7. 验证主站四个资讯工具入口、prices、明暗系统下均为浅色、手机/桌面、日报和主题子页、错误页、收藏导入导出、后台原登录，以及 web 重启期间请求不再连接拒绝。

此机制针对已确认的短暂 web 重启空窗，不承诺上游长期停机或超过代理超时仍可用。数据抓取与付费任务不能为验收擅自触发。
