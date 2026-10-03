# v88 — fftql.team 正式主站

2026-09-30用户授权配置上线。新主站：https://fftql.team，后台：https://fftql.team/admin。域名fftql.com为用户笔误，不在范围内。

## 已发布

- fftql.team A解析124.222.221.150，用户手动完成；无AAAA记录。
- 新域名Let's Encrypt ECDSA证书，2026-09-30签发，有效至2026-12-29；复用已有ACME账户。Certbot renewal webroot `/var/lib/letsencrypt`，既有enabled timer与Nginx reload hook生效。
- 新vhost `/www/server/panel/vhost/nginx/fftql_team.conf`：HTTP308至HTTPS，HTTPS代理同一9090，保留代理headers/安全headers，关闭buffering以支持实时推送。
- 旧vhost `fpl_weekly.conf`：旧HTTP/HTTPS同路径与query308至新站，HTTP ACME例外继续允许旧证书续期。原合法旧TLS证书保留。浏览器自动保留fragment，实测`/?league=47275#fun`。
- index、discover模板、admin最下方加入备案链接 https://beian.miit.gov.cn/，文字「粤ICP备2026075584号-3」。
- app、match-share、match-centre、match-centre-share、fun-rankings中的所有业务分享网址改fftql.team；首页按需加载链引用88。
- 九份静态文件：index.html、admin.html、discover.html、app.js、home-tab.js、match-share.js、match-centre.js、match-centre-share.js、fun-rankings.js。均从生产v86下载后修改，隔离于本地pending v87，不夹带v87逻辑。
- 应用目录/端口/进程和所有历史数据保持；以后仅维护此套新主站。旧域名无第二份应用。

## 验证

- 六个JS文件与部署脚本语法通过；三份HTML各有唯一正确备案号及工信部链接。
- Nginx配置校验、真实TLS主机名验证、HTTP/HTTPS路由通过。
- 九份资源线上字节哈希与发布manifest一致。
- 14经理联赛快照读取成功；数据reportGw5、展示GW6待开赛符合原有规则。
- 后台session未登录false、analytics未登录401、Cookie为HttpOnly/Secure/SameSiteStrict；原密码配置未变。
- 工作台与首页两条HTTPS SSE分别观察到update和20秒heartbeat。
- 浏览器新站首页完整加载、原链接保留league及#fun、旧/admin转新/admin登录页，前后台备案显示通过。未记录前台控制台错误。
- 74个配置/其他vhost/历史归属与趣味快照文件哈希保持；32个既有流量文件保留；应用PID不变，未重启。
- 未运行整套业务测试；本次业务算法未改，验证覆盖域名/分享常量/HTML/TLS/推送/权限。

## 备份与回滚

最终发布前备份：`/opt/fpl-weekly-backups/20260930-domain-before-1790762188500`，包含九份旧静态文件、旧fpl_weekly.conf、protected.json和result.json。

前三次校验未通过已自动回滚：Nginx重载瞬间旧worker仍接流量；完整快照超过execFile默认缓冲；HTTP重载也需等待。部署脚本已使用有界就绪重试、32MiB缓冲，未禁用TLS校验。正式第四次通过。

回滚仅需从备份恢复九份旧public文件和旧fpl_weekly.conf，将fftql_team.conf移至独立可恢复备份目录，`nginx -t`成功后reload。证书可保留，不删除data/config/analytics，不改其他vhost，不重装/重启其他应用。

本地准备/发布脚本、manifest、配置和截图见 `../fpl-domain-20260930/`。部署脚本要求新vhost不存在及原v86哈希，不可直接重新执行于已迁移站点。

## 跨域浏览器状态

新域名后台需重新登录，密码保持。原域名cookies/localStorage不会自动跨域，经理偏好和非卖品本地标注可能需重新设置。服务端历史流量及排除文件全部保留；不能保证新域名匿名访客ID与旧域名localStorage ID自动合并。
