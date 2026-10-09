# fftql.team · TQL FPL

[线上网站](https://fftql.team) · [Draft 工作台](https://fftql.team/draft/) · [资讯站](https://news.fftql.team) · [前端设计交接](FRONTEND_HANDOFF.md)

这是 **2026-10-09（北京时间）的源码备份与前端设计交接版本**。设计者和 AI 请先阅读 [FRONTEND_HANDOFF.md](FRONTEND_HANDOFF.md)，再查看对应页面源码。

## 版本与范围

- `fpl-live-update/`：主站资讯门户、Draft 工作台、管理后台和小红书内容工作区；主站前端为 v111，包含 10 月 8 日专题和后台更新。
- `fpl-news-v1/`：资讯站 React 前端、API、采集 worker、数据库迁移及行业配置。备份当前本地源码，**其中 v15 资讯范围筛选/同事件去重尚未发布**；最近部署记录中的线上后端仍为 v14，前端已含 10 月 8 日后台更新。
- 版本依据项目最新发布记录；本次只备份源码和配置示例，没有重新部署生产或运行业务测试。
- 不包含实际 `config.json`、`.env`、数据库、访问统计、用户上传、私有反馈、Cookie、密钥、依赖安装目录或生成的构建产物。它是源码备份，不能单独还原生产运行数据。
- 各子项目中保留的 README、AGENTS、发布记录和 `MIGRATION.txt` 包含历史说明；涉及当前备份范围与前端交接时，以本页和交接文档为准。不要直接执行历史部署脚本。

## 获取代码

```bash
git clone https://github.com/hugo263/fftql-team.git
cd fftql-team
```

也可以 [下载 ZIP](https://github.com/hugo263/fftql-team/archive/refs/heads/main.zip)。无需 GitHub 账号即可读取公开仓库；提交修改可通过 Fork / Pull Request。

## 主站本地启动

建议使用 Node.js 24.11 或更高版本，兼容两个子项目。主站自身为零依赖 Node.js 服务。

```bash
cd fpl-live-update
cp config.example.json config.json
node server.js
```

打开 `http://127.0.0.1:3000/` 和 `http://127.0.0.1:3000/draft/`。Draft 数据需要能访问 FPL 官方公开 API；首次加载可能需要等待。资讯默认依赖本机资讯 API，未启动该服务时会显示不可用状态，不代表静态前端缺失。

如只做主站视觉设计，可让本地主站读取线上已公开资讯（只读代理，不需要账号或密钥）：

```bash
TQL_NEWS_PUBLIC_ORIGIN=https://news.fftql.team node server.js
```

修改代码保存在本地副本，不会更新线上网站。管理后台需另配本地开发凭据；不要索取或复制生产凭据。资讯完整开发环境和端口安排见 [交接文档](FRONTEND_HANDOFF.md)。

## 校验与第三方素材

[BACKUP_MANIFEST.json](BACKUP_MANIFEST.json) 记录本次文件的 SHA-256，可用于比对下载内容。原有测试、LICENSE/NOTICE、字体许可与来源说明一并保留。公开读取不等于获得仓库内所有第三方品牌、图片及字体的再分发授权；请遵守各素材原有许可。
