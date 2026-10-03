# TQL FPL 网页品牌素材与规范（v43）

来源：用户 2026-09-06 上传的最终 Logo，及引用任务“帮我设计一个我的 FPL 的网站 logo，参考 FF scout 和 FF Fix 的设计，我的网站内容是 fpl.…”最终视觉总结。

## 网页规范

- 森林绿 #12382A：页头结构、主按钮、标题、重点数据。
- 浅黄绿 #D9EF9E：圆点、选中标签和少量重点数据。
- 暖白 #F3F5F1 页面底，白色 #FFFFFF 数据卡，灰绿 #627469 次要文字，#DCE4D9 分隔线。
- 粗直立无衬线标题，正文常规字重，数字 tabular-nums；6–8px 小圆角。
- 不增加炫光、纹理、自动动画；伤病、盈亏、正在比赛等语义色保留。

## 网页素材

由内置 image_gen 编辑原 Logo 得到，原图保留不覆盖。

- public/brand/tql-wordmark.png：2172 × 724，横向色块字标，暖白不透明底。
- public/brand/tql-icon.png：1254 × 1254，Q 足球简化标，用于 favicon / apple-touch-icon。
- 图片是网页衍生版本，不是新品牌设计；保留 Q 足球、TQL 反白色块、FPL 与浅绿圆点。初次透明底输出实际没有 alpha，已弃用，最终使用暖白底，不宣称透明。
- 横向图的上下展示留白通过网页图框裁掉，不裁切字形；导出分享图 contain 显示完整素材，失败时回落 TQL FPL 文本。
- 地址仍是 fpl.xiaokailabs.com；不把展示板上的待申请域名 tqlfpl.site 用作网站链接。

## 最终横向字标提示词（内置 image_gen）

Use case: precise-object-edit / background-extraction.
Input is the FINAL APPROVED TQL FPL logo. Produce a production website wordmark asset, not a presentation board.
Copy exactly the central logo: Q-shaped football ring with central pentagon, green TQL rectangle with white bold TQL letters, green FPL letters and pale-lime circular dot. Keep the exact geometry, original bold upright sans-serif letter shapes and spacing. Remove "01 / BALL" and "tqlfpl.site" and all presentation whitespace.
IMPORTANT: use a completely UNIFORM SOLID opaque warm-white #F3F5F1 background. No checkerboard, no transparency simulation. No texture, grain, shadow, gradient or glow anywhere. Forest green #12382A, offwhite TQL #F3F5F1, dot #D9EF9E. Logo fills nearly all width with 5% safe margin. Wide 3:1 canvas, central logo natural 4.8:1 proportions, vertically centered. Only exact text "TQL FPL". This is extraction for the website, not a redesign.

## 图标提示词（内置 image_gen）

Use case: precise-object-edit / logo-brand.
Asset type: square website favicon / app icon derived from the approved logo.
Input Image 1 is the approved logo. Extract ONLY the Q-shaped football symbol at the left: thick dark forest-green #12382A round Q ring with the existing short diagonal bottom-right tail and one solid centered pentagon, exactly the original silhouette and proportions. Remove ALL lettering, TQL rectangle, FPL, lime dot, domain caption and artboard labels. One centered symbol, fill 82% of a square canvas with safe margins. Uniform flat warm white #F3F5F1 opaque background also inside the Q ring, no checkerboard. Deliver a compact square PNG suitable as a favicon, ideally 256 by 256 pixels. Maintain legibility at 32px. No texture, no gradients, no shadows, no added border or extra football seams. This is not a redesign; preserve the approved Q football shape.

