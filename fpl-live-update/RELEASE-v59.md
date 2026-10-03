# v59 Team of the Week 历史归属快照

2026-09-07，用户确认「验证后直接上线」，已发布到 fpl.xiaokailabs.com。

## 原因与口径

旧buildDreamTeam通过playerLite拷贝了最新element-status.owner；刷新时重建全部totwByGw，后来的签约因此覆盖了历史归属。前端又按当前managers解析名字。

新规则：以各GW截止后官方 `/entry/{entry_id}/event/{gw}` 完整15人picks为准，包含替补，不是只看首发或当前ownership。只有整个联赛名单完整且无冲突时，名单外球员才确认为自由球员。符合官方[Draft阵容与截止规则](https://www.premierleague.com/en/news/1245444)；每队15人、自由签约截止于GW deadline。

归属独立于得分：归属在截止后即可冻结，比赛进行中最佳XI和得分仍动态更新；末场结束取消Live，官方结算前继续修正分数。不是将所有分数提前定稿。

## 历史修正

| GW | 球员（Draft ID） | 旧显示 | 修正为 |
|---|---|---|---|
| 1 | Mendy（586） | 罡罡 | 自由球员 |
| 1 | Ajayi（279） | 加布惊焰软糖形态 | 自由球员 |
| 1 | M.Sangaré（556） | 加布惊焰软糖形态 | 自由球员 |
| 2 | Dedić（595） | Eve2026 | 自由球员 |

GW3原归属0差异；Mitchell、Bogle当轮自由身份一起冻结。各轮自由人数3/1/2。

独立脚本 `scripts/audit-totw-ownership.cjs` 不依赖新业务模块，用44个官方请求（联赛、当前归属及42份历史阵容）交叉检查；当前归属只用于差异对比，不作历史证据。每轮14经理×15人=210，3轮630席位，位置1–15完整、无跨经理重复，TOTW每轮11人。官方entry_history为{}，请求entry/GW envelope及存在的subs.event均验证。

上线后2026-09-07T04:01:01.995Z再次运行独立脚本：44请求成功、0请求/完整性失败，GW1/2/3的33人归属全部0差异。

## 实现与安全降级

- `totw-ownership.js` 纯函数验证并映射；缓存按league/season/GW/schema隔离。保存完整owner表、历史成员15人名单、当次采集名称、lockedAt（GW截止）和capturedAt（真实回补时间）。历史回补不能声称还原经理曾用名；entry_id归属来自历史API，显示名为首次捕获时的名称并以后保留。
- 当前GW复用已抓取的确切GW原始picks，不误用前轮fallback；旧轮首次分批4并发抓取，缓存成功后以后不重复请求。已有合法快照在后续改名、退出联赛或新交易后也不重写。持久化原子替换，写前复查已有合法版本优先保留。
- 不完整/错ID/错GW/重复/非法位置/未知球员引用不冻结，不用空名单推断自由球员；前端为unknown显示“归属待确认”。未来刷新可重试，不污染成功历史缓存。
- 只将完整校验成功的payload复用给Classic得分路径，不把被拒绝的归属数据传进已有计分缓存。当前阵容、自由市场、经理积分等继续原逻辑。
- 前端直接转义历史ownerName；自由球员必须由明确的ownershipStatus=free标识。旧/缺失字段显示待确认，不回退当前归属。
- schema6使旧版整体快照重建，保留计分缓存、流量、配置、各联赛数据。新公开缓存/加载性能逻辑继续有效。

## 验证

312项测试通过：当轮锁定/替补/自由状态持久、后来交易/改名/成员消失、字段不完整/身份和轮次错误、原得分仍更新、冷历史仅首次抓取、缓存文件内容不变、HTML转义与unknown，以及全部旧计分/自动替补/DEFCON/交易/分享/性能回归。

本地真实接口schema6，3份归属快照完整；重启并强制刷新后三文件SHA256完全不变。浏览器本地和线上分别切GW1/2/3，每轮11人，自由人数3/1/2，0个待确认。线上服务active/health ok，14经理、266赛程，6文件哈希与测试源一致。

## 发布和回滚

部署6个文件：server.js、live-scoring.js、totw-ownership.js、public/index.html、public/app.js、scripts/audit-totw-ownership.cjs。只重启fpl-weekly，未改其他站点或Nginx，未上传本地data/config。

旧代码备份：`/opt/fpl-weekly-backups/20260907-v59-before.tgz`，内含server.js/live-scoring.js/index.html/app.js。获得回滚授权后恢复这4文件并重启fpl-weekly；schema5会自行重建整体快照。新增模块/脚本可保留但不再引用。归属快照也保留，后续恢复v59可继续使用，不需回滚任何数据。
