# v104 本地待发布：价格简报与资讯列表

2026-10-03 用户本轮未授权测试/上线。本地实现，未运行测试、类型检查、构建、浏览器验收；没有远程操作或生产数据变更。前一项主题卡片队徽也仍待发布。

## 改动

- 删除featuredNews DOM和相关JS分支。此前没有独立头条筛选，只重复items[0]；保留列表第一条、所有筛选与搜索。
- 后端按fpl_price_changes.observation_id合并同次官方观测，非按显示页、球员或自然日拼接。不同批次不会混合，未调价不发消息。
- 一个可追溯简报包含该批全部上涨/下跌球员，列表分别展示名字和球队；详情显示位置、原价、现价、差额与观测区间。只代表官方已观测价格，非预测/精确调价时间。
- 主站与资讯工具共用price-bulletin视觉，手机详情行改两列；没有给每个球员再造单独新闻卡。
- 可选priceBatch字段来自官方规则生成raw快照，经既有publication层输出；不开放任意raw。搜索/分页/主题计数以合并文章为单位，球员名字保留在摘要与标签可检索。

## 历史合并与保护

news的新publishFplChanges由现有价格采集任务调用，单次最多处理200个未建简报的观测。读取全部成员后按批锁，事务内创建规则分析/发布简报/把旧逐人文章改为summary-only/重建公开投影及ledger，并记录rule:price-batch-v2审计。旧文章及价变记录不删除，原发现时间不改，不发送历史简报通知，也不调用模型。

有人工visibility或字段override的旧批次跳过，不将撤回的球员内容重新纳入；并发手动改动导致当前合并事务回滚。已有简报不重复生成，常规旧链接仍能看摘要。

上线前必须备份价格源相关文章、publications、analyses、editorial_overrides、ledger/state、价格观测/变动。先做隔离测试再执行生产合并，记录真实数量和跳过项；本地尚未处理生产历史。回滚文章显示方式需根据审计恢复旧visibility并重新发布，不能仅回滚代码或覆盖全库。

## 文件 / 验证待办

主站：public/portal.html、portal.js、portal-news-model.js、price-bulletin.css（版本104），tests/news-integration.test.js。

news：fpl/collect.ts、新fpl/price-bulletins.ts、publication/items.ts；contracts/fpl.ts及site.ts；FeedItem.tsx、routes/item.tsx、新features/fpl/PriceBulletin.tsx与CSS、tests/fpl-collect.test.ts。

待验证：多球员同批一条、跨批同日不混合、单向涨跌空状态、历史合并及人工override跳过、失败回滚、幂等与缺失投影修复；pool/timeline搜索与分页数量、旧链接及手机两列；主站无featuredNews空指针；新字段在收藏/海报等老路径兼容。源码已有部分用例但尚未执行，不应声称通过。

公开队徽主题卡片另见news/AGENTS.md，采集开关、俱乐部X停用配置、环境/预算/socket与Draft业务均不改。
