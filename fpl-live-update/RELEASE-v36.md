# v36 对战详情与分享图片

## 范围

战报每一场真实 H2H 对阵可点击，打开双球场浮窗，显示所选 GW 两队锁定阵容、每名球员得分与分钟、出战人数、剩余赛程人数和独立替补席。桌面并排，手机纵向排列。小型分享按钮位于右上角，生成可发到微信群的 PNG，不自动发送。

不修改独立资讯首页、discover、admin、生产配置或运行数据。与其他阵容对比功能的“当前持有阵容”口径明确分离。

发布文件：server.js、match-detail.js、public/app.js、public/index.html、public/match-view.js、public/match-view.css、public/match-share.js。

## 上线前验证

- 45 项测试通过，包括原有 20 项以及新接口、缓存、球员出战口径、历史阵容、PNG 绘制与异步快照测试。
- 实际 GW3 MustBeRo 对 Ken：2 比 8，各出战 1/11，剩余赛程各 10 人；球员实际 GW 分钟为 83 / 90。
- 实际 GW2 老A 对不倒翁：55 比 41，各出战 11/11，剩余赛程 0；每侧包含 15 名球员。Aina 出场 85 分钟得 0 分，正确算已出战。
- 官方 GW3 fixture 21 的 finished=false、finished_provisional=true，故单人剩余赛程按足球完场计算，不等 FPL 结算；得分仍可继续更新。
- 浏览器实际 PNG 已下载并进行本地图片视觉检查：1600×1166，双透视球场、门将在上、30 名球员、两队得分/分钟、独立替补席、快照时间与网址齐全。
- 手机宽 390px：弹窗宽 374px，无横向溢出，分享按钮宽 78px；桌面弹窗居中。
- 独立审查通过；浏览器控制台无错误或警告。

## 发布结果

2026-09-05 14:36（北京时间）已部署至 https://fpl.xiaokailabs.com/，仅更新上述 7 个文件并重启现有 fpl-weekly 服务。

- 线上健康接口 HTTP 200，服务 active；7 个文件 SHA-256 与审核后的本地文件一致。
- 线上 GW3 对战接口返回 2 比 8，双方各 15 人、出战 1/11、还有赛程 10 人；得分合计与阵容一致。
- 相同玩家请求返回 400，非本轮对手返回 404，响应 no-store。
- 线上浏览器打开对战成功，全部 30 件球衣加载完成，图片生成成功，控制台无错误或警告。
- 生产 config.json 的时间与大小未变，discover HTML/CSS 哈希未变；未覆盖 data/，未变更 Nginx、端口或独立资讯首页。
- 7 个已验证的功能文件已同步回原 WorkBuddy 项目目录。

可回滚备份：`/opt/fpl-weekly-backups/20260905-v36-match-before.tgz`。备份还原代码后仅重启 fpl-weekly，保留 config.json 和 data/。
