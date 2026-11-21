# 基模-落地牵引项目管理

自由画板、项目列表、会议记录、成果与历史。这里是 GitHub Pages 版本的前端维护源码，以发布提交 `25f673c` 为基准；无需构建或安装运行依赖。

## 本地启动

```sh
git clone --branch topic-workbench-source --single-branch https://github.com/ShirlyJia/ShirlyJia.github.io.git topic-workbench-source
cd topic-workbench-source
python3 -m http.server 8767 --bind 127.0.0.1
```

打开 <http://127.0.0.1:8767/>。`initial-data.json` 和 `initial-meetings.json` 是虚构示例；编辑保存在当前浏览器的独立存储空间。开发配置默认不接入线上数据或本机同步服务。

## 源码导航

- `index.html`、`app.js`：自由画板、项目列表和项目详情。
- `meetings.html`、`meetings.js`：会议记录和资料。
- `snapshots.html`、`snapshot-history.js`：画板快照和历史查看。
- `project-lifecycle.js`、`delivery-model.js`：项目状态与交付记录。
- `persistence.js`、`deployment-config.js`：数据校验和运行配置。

使用 Node.js 22 或更新版本运行 `npm test`，无需 `npm install`。

当前线上站点仍由 `main` 的 `topic-workbench/` 发布。推送本源码分支不会部署到线上。此分支不包含实际画板数据、飞书原始资料或本机发布服务的配置与凭证。
