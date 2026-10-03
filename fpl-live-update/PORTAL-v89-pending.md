# 主站首页框架 v89 — 本地，未测试，未上线

2026-09-30：用户要求主站包含「FPL 新闻聚合」「Draft 联赛」，并补充只搭框架，深度聚合由另一个任务完成。本次不采集、不翻译、不聚合新闻，不新增新闻 API、订阅或轮询。无自动测试、浏览器验证或生产配置操作。

隔离本地预览：http://127.0.0.1:4323/portal ，副本 `/private/tmp/fpl-portal-v89-KwY5by`，不复制 config、data 或测试。仅启动供用户查看，不以启动代替验证。该副本后台没有密码配置，不是线上后台。

## 页面与域名分工

- `fftql.team` 根页面：新 `public/portal.html`，TQL 原 Logo / 深绿青柠品牌，新闻栏目在主区域、联赛 ID 入口在右侧，下方保留 Draft 功能导航。
- `draft.fftql.team` 根页面：现有 `public/index.html` 完整工作台。原六项导航、数据、分享、计分逻辑不改。
- 本地 `/portal`：查看新首页；本地 `/?league=ID`：进入原工作台。
- `site-routing.js` 已写主站主机名识别，未来部署后主站旧 `/?league=ID` 跳转到 Draft 子域名，保留查询参数；302 未覆盖 hash，使浏览器沿用旧 fragment。
- `www.fftql.team` 仅是路由兼容，不代表本次配置了 DNS 或证书。
- 页面保留备案链接、微信反馈、联赛 ID 说明；无公共后台入口。

## 交给新闻聚合任务的接入位置

入口：`public/portal.html`、`public/portal.css`、`public/portal.js`。

页面当前显示「即将上线」，不是加载动画或伪新闻。CSS 已有标题、来源、日期、分类、置顶卡片与资讯列表样式。现有骨架不发出任何新闻请求。

可选择沿用渲染接口，聚合任务自行负责请求 / 推送、中文处理、存储和数据状态：

```js
window.TQLPortal.setNews({
  statusText: '新闻内容已接入',
  items: [
    // {title, url, source, sourceId, publishedAt, category}
  ]
});
// 或 document.dispatchEvent(new CustomEvent('tql:portal-news', {detail: payload}));
```

`publishedAt` 为真实发布时间，`url` 必须 HTTPS 原文 URL。`category` 支持 `team-news` / `analysis` / `captain` / `fixtures` / `transfers`。骨架只做安全文本渲染、排序、主题 / 来源 / 关键词筛选与展开。最多显示 200 条传入数据，无独立内容缓存。

也可直接接入 DOM 插槽：`#featuredNews`（置顶）、`#newsList`（列表）、`#newsStatus`（状态）、`#newsCount`（条数）、`#newsSource`（来源选择）。新闻内容组件需要更大改动时可替换整块 `.news-column`，不影响 Draft 入口。

## 发布前仍待做

用户尚未授权本次测试 / 上线。未来获得授权后检查路由、联赛入口、手机布局和历史分享网址；确认 draft 子域名 DNS、HTTPS 和 Nginx；将所有 Draft 分享网址切到子域名。生产 config、历史 data、流量日志必须保留。本地 v87 趣味榜「所有轮次」改动仍未发布，不要误当作本次已经上线。
