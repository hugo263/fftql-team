# v9 · 资讯工具浅色主题与重启空窗修复

发布2026-10-02，验收2026-10-03。用户在Draft弹窗 / 全站手机适配请求中授权完成后上线，同步发布此前待处理资讯工具修复。

## 已发布

- 公开站SSR固定light；与主站相同TQL页头、FPL资讯 / Draft导航、浅色卡片、绿色选中态和手机布局。后台现有主题逻辑不变，收藏和偏好不清空。
- server.ts支持systemd fd3监听；`tql-news-web.socket`独立持有127.0.0.1:9012。web重启时连接排队，避免先前22:51部署时已确认的connection refused / 502。
- web service保留DynamicUser、原环境路径、资源限制和安全配置。只增加socket依赖；不新增公网监听。
- 行业残留文案修正，采集 / 模型 / API / worker / DB / 预算 / 账号未改。

## 验证与部署

- typecheck、生产build通过；195后端、17web测试全通过；隔离数据库命名以_test结束，全部付费与采集安全阀关闭。
- 完整smoke通过；本地14个公开 / 登录路由320px无整页横向溢出；正式站/hot确认light、手机浅色卡片正常。
- Linux隔离19012实例和正式9012均验证socket接管；web重启期间每组24个请求全部200。
- HTTPS `/`、`/hot`、`/daily`、`/topics`、`/prices`、`/admin/login`全部200；web/socket/api/worker active，socket enabled。
- 发布脚本 `scripts/deploy-v9-web.mjs`：预检hash、就绪临时实例、仅资讯vhost临时切19012、交接9012、恢复原vhost。保留旧build哈希资产。API / worker没有重启。
- current=`/opt/tql-news/releases/20261002-v9-light-mobile`
- 上一release=`/opt/tql-news/releases/20261002-v8-rss-timeout`
- 备份=`/opt/tql-news/backups/v9-1790956403598`
- Nginx=`/www/server/panel/vhost/nginx/tql_news.conf`，切换结束已恢复原9012配置；其他vhost未改。

## 运维 / 回滚

普通发布只重启`tql-news-web.service`，不重启socket。真正停止网站需同时停止service和socket，以免新连接重新激活。

旧v8不支持fd3，不能只改current：先准备可服务的临时web并把本资讯vhost切过去，然后停止web和socket、disable socket、从备份恢复旧web.service和current、daemon-reload、启动旧web自行绑定9012，健康确认后恢复本资讯vhost。严禁覆盖.env或数据库；勿改其他vhost，勿重启API / worker。

独立验证`/run/systemd/system/tql-news-v9-check.*`已停止；无需参与生产启动。

这修复短暂web重启的端口空窗，不保证长期故障或超时无502。23个X信源仍待授权网络出口，不能说全部信源已恢复。
