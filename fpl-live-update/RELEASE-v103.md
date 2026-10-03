# v103 · 资讯分类颜色

2026-10-03 用户授权发布。仅4个静态文件：public/news-categories.css、public/portal-news-model.js、public/portal.js、public/portal.html。缓存版本103；备份 `/opt/fpl-weekly/backups/v103-1791022794225`。未重启fpl-weekly、未覆盖config/data。

10类文字标签各有不同浅底色和圆点，新增球队复盘与英超快讯。筛选事件限定在.category-tabs，避免详情标签也被当成筛选按钮。主站与资讯web共享同一CSS，去掉重复的分类tag。

573主站测试通过，最终8项资讯集成复验通过；10种颜色对比度≥4.5。生产分类列表、首页浏览器和球队复盘筛选验证通过；没有新做整站移动端回归。日志在output/fpl-v103。

配套资讯已上线v12-editorial-gate：实质内容门禁、14条审计修正及20个俱乐部X源停用，详见../fpl-news-v1/deploy/tql-news/RELEASE-v12-editorial-gate.md。模型额度已用完，未额外调用模型，不将人工修正描述为模型重跑。

已知边界：撤回文章直达主站/api/news/items/...时，既有代理将非JSON错误响应转换502；公开列表不会返回已撤回文章，本次未改代理错误呈现。

回滚仅恢复上述四个静态文件，不操作生产data或新资讯数据库内容。
