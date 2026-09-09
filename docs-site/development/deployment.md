# 部署指南

**状态**: 与源码对齐（2026-09 重写）

---

Starfit 后端是无状态 Fastify 5 服务（**无 Redis**），数据库为 **PostgreSQL 16**
（docker 镜像 `postgres:16-alpine`，未使用 pgvector）。实时通道是 **SSE**（`/api/chat`），
不需要 WebSocket 支持，反代只需透传 HTTP 即可（建议关闭缓冲以获得流式效果）。

## 端口约定

| 服务 | 端口 |
| --- | --- |
| 后端（Fastify） | 43111 |
| 前端 Vite dev server（仅开发） | 43112 |
| 文档站点 dev（仅开发） | 5173（VitePress 默认） |

## 方式一：Docker Compose（推荐）

仓库自带 `backend/docker-compose.yml`，一次拉起 PostgreSQL + 后端：

```bash
cd backend
cp .env.local.example .env.local   # 按文件内注释填好最小 4 项
docker compose up -d --build
docker compose --profile tools run --rm migrate   # 首次部署执行迁移
curl http://127.0.0.1:43111/api/ping              # 期望返回 pong/ok
```

要点：

- 后端经 `env_file: .env.local` 注入配置；compose 内 `environment` 段仅强制
  `NODE_ENV/PORT/HOST` 与容器内 `DATABASE_URL`，不要在此添加 `${VAR}` 形式的
  空插值（会覆盖 env_file 真值，历史已踩坑）
- 数据落在命名卷 `pgdata`，上传文件落在 `uploads`
- 自带 healthcheck：`wget http://127.0.0.1:43111/api/ping`

> 面向服务器的完整自部署引导包（生产 compose + 可交给 AI Agent 执行的部署任务书）
> 见 `deploy/`（即将发布）。

## 方式二：本地进程

后端直连任意 PostgreSQL 16 实例：

```bash
cd backend
cp .env.local.example .env.local   # 填 DATABASE_URL / STARFIT_ACCESS_TOKEN / LLM 密钥
npm install
npm run db:migrate                 # 建表 + 增量迁移
npm run dev                        # 监听 0.0.0.0:43111
```

前端构建产物为纯静态文件（`dist/` + `admin.html`），可放任意静态托管或直接由
Capacitor 打进 App 壳；App 内通过登录页配置后端地址即可连上自托管服务。

## 前端 / App

```bash
npm run build        # 产物 dist/（含 admin.html 管理台入口）
npx cap sync ios     # iOS 壳（产品主形态，含 Swift 原生层）
npx cap sync android # Android 壳
```

App 出包默认加载打包内 Web 资源；开发热更可用
`CAP_DEV_URL=http://localhost:43112 npx cap sync ios` 直连本地 dev server。

## 文档站点

```bash
npm run docs:build   # 产物 docs-site/.vitepress/dist
npm run docs:preview # 本地预览
```

发布目标为 GitHub Pages（base = `/star-fit/`）。
