# v60 · Browser and bookmark icons

2026-09-07. User selected the **before / dark-mode** design and authorized deployment after validation. Published to https://fpl.xiaokailabs.com/.

## Approved identity

Use the original straight-tail Q with pentagon, **#12382A on #D9EF9E**, for both light and dark browsers. Do not use the playful-tail v3 design or the earlier four new-symbol proposals.

Source: `designs/tql-favicon-v2/icon-dark.svg` in the parent workspace (identical to v3 `previous-dark.svg`); SHA-256 `0d230c8152d656d99c0c3a2b6ad077d3864559981fd48c4e019d49a5bccffa42`. The SVG contains the original PNG mask, preserving the ring, pentagon and straight tail. `scripts/build-favicons.cjs` rasterizes this code-native asset with build-time Sharp; no new production dependency.

## Coverage

- All three live HTML entries use the same v60 ICO / 16px / 32px links, 180px apple-touch-icon, and manifest. No `media` attribute or dark/light JavaScript switching.
- Root `favicon.ico`: genuine 32-bit DIB frames at 16, 32 and 48px, with alpha and AND transparency masks.
- Root favicon PNGs: 16 / 32 / 48px. Root `favicon.png` and existing `brand/tql-icon.png` are identical 512px rounded-corner fallbacks. Updating the old path avoids serving the old graphic to clients still requesting that URL.
- `apple-touch-icon.png` / `apple-touch-icon-precomposed.png`: identical 180px original mark and palette, full-bleed lime background for system-managed icon masking. Manifest `icon-192.png` and `icon-512.png` follow the same treatment; `purpose:any`, not an untested maskable crop.
- Manifest display remains `browser`; no start_url or scope override, to avoid replacing saved league URLs. No service worker or standalone application behavior is introduced.
- Server change is only the `.webmanifest` content type. Business scoring, snapshots, schema6, app?v=59, header v47 badge, share exports and independent FFScout prototype are unchanged.

Platform rationale: [Apple Web Clip icon documentation](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html) describes root PNG/touch-icon and 180px sizing. [MDN rel=icon](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel#icon) describes icon selection by format/size/media. Safari pinned-tab mask icons are monochrome and are not substituted with this two-colour artwork ([Apple pinned tabs](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/pinnedTabs/pinnedTabs.html)). This release targets normal tabs, bookmarks/favorites and saved home-screen icons; it does not claim that existing browser bookmark databases refresh instantly.

## Validation

- 327 automated tests pass. Added favicon link, PNG structure/size, ICO structure/transparency and manifest safety checks; prior header/share/league controls remain checked.
- Generated PNGs visually inspected: original straight tail, no playful curl; exact interior forest/lime palette confirmed. Transparent corners for browser icons, opaque full-bleed background for system icons.
- Local HTTP GET/HEAD/304 and actual browser DOM links verified.
- Production `scripts/verify-favicons-http.cjs` executed read-only via SSH stdin from `/opt/fpl-weekly`, with `--loopback` retaining real production Host and TLS certificate validation: **11 assets byte-identical**, correct MIME/HEAD/ETag304, **3 entries unified**, 73,211 total asset bytes. No business APIs or config read by this audit.
- Production code hashes match reviewed local output. Existing production tab reloaded: all icon links v60, header still `/brand/tql-badge-preview-v47.png?v=47`. Service active and health ok.
- Safari/Chrome/Firefox already-saved favorites were not modified or deleted by this task. Their local cached icon refresh timing is controlled by each browser.

## Release and rollback

Deployed exactly 15 files: server.js; public/index.html, discover.html, admin.html; favicon.ico; favicon.png; favicon-16x16.png, favicon-32x32.png, favicon-48x48.png; apple-touch-icon.png, apple-touch-icon-precomposed.png; icon-192.png, icon-512.png; brand/tql-icon.png; site.webmanifest.

Release archive `/tmp/fpl-v60-release.tgz` on server (local `/private/tmp/fpl-v60-release.tgz`), SHA-256 `efcb5b7164b4cbbd2e265508f77453b9b08a7c65d8ef67d5d9f16636e918e7a2`.

Pre-release backup `/opt/fpl-weekly-backups/20260907-v60-before.tgz` contains the 6 pre-existing overwritten files: server.js, 3 HTML entries, brand/tql-icon.png, favicon.png. The 9 other asset paths were verified absent before publication. Only fpl-weekly was restarted. No config, data, Nginx configuration, other sites or shared ports changed.

If explicitly authorized to roll back, restore the 6 backed-up files and restart only fpl-weekly; retire the 9 added root icon/manifest paths as a separately confirmed scoped step because default browser discovery can still find them. Never roll back or clear data/cache, historical TOTW ownership, analytics or config.
