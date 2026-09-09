# Starfit 自部署指南

把 Starfit 后端部署到你自己的服务器（源码构建，无需镜像仓库）。

## 前置要求

- Docker ≥ 20.10 + Docker Compose v2+
- 1 核 CPU / ≥ 2GB 内存（最低 1G 可跑）
- 端口 43111 空闲（可在 `.env` 改 `STARFIT_PORT`）
- 一个 LLM API 密钥（deepseek / glm / openai / google 任一）

## 3 步部署

```bash
# 1. 复制并填写配置（数据库口令、访问令牌、AI 密钥必填；敏感项建议用
#    `openssl rand -base64 18` 生成随机值）
cp deploy/.env.example deploy/.env

# 2. 构建并启动（首次约 3-5 分钟）
docker compose -f deploy/docker-compose.prod.yml up -d --build

# 3. 初始化数据库（首次部署执行一次）
docker compose -f deploy/docker-compose.prod.yml --profile tools run --rm migrate
```

验证：`curl http://127.0.0.1:43111/api/ping` 返回 JSON 即成功。

打开 App → 登录页手填 `服务器IP:43111` → 填访问令牌（`deploy/.env` 里的
`STARFIT_ACCESS_TOKEN`）→ 登录。

> 交给 AI Agent 全自动部署：把 `deploy/AGENT_DEPLOY.md` 喂给它即可。

## 常用运维

```bash
# 日志
docker compose -f deploy/docker-compose.prod.yml logs -f backend

# 升级到最新代码
git pull && docker compose -f deploy/docker-compose.prod.yml up -d --build

# 备份数据库
docker compose -f deploy/docker-compose.prod.yml exec postgres \
  pg_dump -U starfit starfit > backup_$(date +%F).sql

# 恢复备份
cat backup_2026-01-01.sql | docker compose -f deploy/docker-compose.prod.yml exec -T postgres \
  psql -U starfit starfit

# 停止 / 启动
docker compose -f deploy/docker-compose.prod.yml down
docker compose -f deploy/docker-compose.prod.yml up -d

# 彻底删除（含数据卷，慎用）
docker compose -f deploy/docker-compose.prod.yml down -v
```

## 可选项

- **反向代理（nginx，80 端口）**：`docker compose -f deploy/docker-compose.prod.yml --profile web up -d`
- 排障详情、Agent 逐步任务书见 `deploy/AGENT_DEPLOY.md`。
