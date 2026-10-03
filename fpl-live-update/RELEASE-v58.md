# v58 首次打开与浏览器刷新性能

2026-09-07，用户确认「验证后直接上线」，已发布到 fpl.xiaokailabs.com。

## 改动

- HTML head提前开始快照fetch，boot复用同一次请求，无重复API。初始hash模块在analytics执行前选定，不制造合成点击；保留正确PV归属。
- 首屏只渲染当前模块；隐藏模块首次点击时再生成图表、球衣、分享画布等。按快照对象记忆渲染状态，新数据自动失效。默认经理纯状态初始化，保持旧版无Ken联赛的默认逻辑，不随模块打开顺序改变。
- 静态资源ETag/304；带数字版本URL缓存1小时；HTML始终no-cache重新验证，文件更新后新ETag。文本可gzip，PNG原字节不变。公开快照gzip但仍no-store，后台认证JSON原策略不变。
- public-snapshot.js只包装公开GET：相同league/schema/season、合法events/deadline、快照和得分源均小于5分钟、期间未跨任何deadline，才可先展示旧结果并后台刷新。原始数据和更新时间不修改，副本meta.stale=true/refreshing=true。旧/冷/不兼容/跨deadline数据仍走权威加载。
- 后台加载合并，失败20秒退避；前端显示原更新时间及手机可见的同步提示，refreshing时7.5秒回查。原计分、手动force、比赛详情与源TTL保持。

## 验证与测量

- 298项回归测试全部通过，含身份/schema/赛季/截止时间边界、失败退避、原字段不变、gzip协商/304/no-store、首屏单请求、按需渲染和默认经理/统计顺序。
- 本地九个模块均可切换；赛程首屏0张球衣、对比下拉0个选项（尚未初始化）；点击后自由球员50行、对比30球员、分享15球员正常。
- 经理选择bees后刷新仍保留；未来GW4双球场与复制图片成功。手机390px无横溢，刷新按钮36×36。
- 本地缓存自然过期真实HTTP响应43ms/122644B，stale=true、refreshing=true，updated保持旧值；不是从空缓存首次构建的耗时。
- 发布前节点端快照约1.309MB未压缩，但**线上Nginx原本已有gzip**，HTTPS基线132586B；发布后HTTPS为120201B。不能宣称公网流量从1.3MB缩小91%，主要收益是避免过期缓存阻塞和隐藏模块渲染，及重复访问资源复用。
- 本地脚本gzip31328B；静态脚本/CSS/Logo/HTML条件请求均304且0字节body。Logo首次仍原始1.24MB，后续缓存复用，不改图片。
- 生产六文件哈希与测试源一致，服务active、health ok；HTTPS/API包含14经理、266赛程、7本轮双球场详情，schema5/GW3无变化。线上app引用v58、赛程首屏不再初始化对比/球衣。

## 发布与回滚

文件：server.js、public-http.js、public-snapshot.js、public/index.html、public/app.js、public/loading.css。仅重启fpl-weekly，不动Nginx、其他站点、配置和data。

生产旧代码备份：`/opt/fpl-weekly-backups/20260907-v58-before.tgz`（server/index/app三个原有文件）。获得回滚授权后恢复这三个文件并重启fpl-weekly；三个新增文件会变为未引用，可保留，不需回滚任何数据。HTML no-cache会取回旧资源引用。

新联赛从未缓存或缓存超出安全窗口时仍须等待官方API，不能承诺所有首访秒开。
