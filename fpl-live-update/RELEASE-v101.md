# v101 · 浅色弹窗、统一球场与手机适配

发布：2026-10-02；线上验收：2026-10-03（北京时间）。用户明确要求完成后上线。

## 范围

- 双球场、经理阵容、交易明细、趣味榜、帮助 / 反馈等弹窗统一纸白卡片、浅灰绿底和清晰深色文字。品牌页头仍保留深绿。
- `pitch.js` 统一 SVG / Canvas 透视投影：边线、中线、中圈、两端禁区 / 小禁区 / 罚球弧；门将在上，真实球员与计分不变。球场浅绿、替补席浅底，分享 PNG 同步。
- 320px 起手机适配：导航 / 宽表格仅区域内横滑、筛选换行、弹窗屏内滚动、双球场上下排列、长球员名可换行。新 CSS 也加载到首页 ShadowRoot。
- 更新13个静态文件：pitch.js/css、light-surfaces.css、responsive.css、app.js、match-share.js、home-tab.js、share-styles.js、index.html、portal.html、admin.html、discover.html、share-styles.html。最终新依赖版本101.2。
- 不修改评分、GW、交易、刷新、历史归属、登录鉴权或生产配置 / 运行数据。

## 验证

- `node --test tests/*.test.js`：572通过、0失败。
- 本地11个 Draft hash × 320/390/768px，整页无横向溢出；榜单 / FDR 的区域内滚动保留全部列。
- 经理阵容、交易经理明细、双球场手机视觉；正式站桌面 / 手机双球场、趣味榜白色弹窗与前端错误日志核验。
- 实际下载1080×1440 PNG 已目视核对，浅色球场 / 两队15人 / 正确禁区和品牌网址均保留；页面报告复制图片成功，未向真实微信群发送。
- 正式 HTTPS 主站、Draft、后台、新静态文件和关联资讯工具各入口返回200；核心文件 SHA256 与本地一致。
- 截图 / 导出 / 测试日志：`output/fpl-v101/`。
- 资讯 v9 另有195后端、17前端、typecheck、build、smoke通过；独立实例及正式 web 重启各24个请求全200。

## 部署与恢复

主站发布脚本：`scripts/deploy-v101-static.cjs`。仅显式名单静态文件；预检当前哈希、备份、原子替换模板最后；未重启主站。

- 生产：`/opt/fpl-weekly/public`
- 暂存：`/opt/fpl-weekly/releases/v101-20261002`
- 回滚备份：`/opt/fpl-weekly/backups/v101-1790956461327`
- 配置文件发布前后哈希一致，未向 config/data 写入。

回滚只恢复备份中原有静态文件（模板最后），新增无引用的 CSS / pitch.js 可保留；勿覆盖任何config/data，勿使用旧预览目录整包覆盖。

资讯服务为独立项目，release `/opt/tql-news/releases/20261002-v9-light-mobile`，备份 `/opt/tql-news/backups/v9-1790956403598`。不可只回滚代码：旧版不支持fd3，必须同步恢复旧web service并停用新socket。详见 `../fpl-news-v1/deploy/tql-news/RELEASE-v9-light-mobile.md`。

主站继续 `https://fftql.team`；Draft同域`/draft/`，未配置draft子域名。
