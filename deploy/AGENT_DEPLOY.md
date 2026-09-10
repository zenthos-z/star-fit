# Starfit Agent 自部署任务书

> 本文件可交给任意 AI Agent（Hermes / Claude Code / Cursor 等）执行，目标是把 Starfit
> 后端以 Docker Compose 部署到当前这台服务器上。Agent 遇到与本文不符的报错时，
> **如实报告而非猜测修复**；需要用户决策的项（如端口、密钥选择）先问再动。

工作目录统一为仓库根（`docker-compose.prod.yml` 的 build context 是 `..`），
以下所有命令默认在仓库根执行。

---

## 第 1 步：环境前置检查

逐项执行并核对预期输出：

```bash
docker --version && docker compose version
# 预期：Docker ≥ 20.10，Compose v2+（输出含 "v2." 或 5.x 版本号）

lsof -nP -i :43111 -sTCP:LISTEN || echo "PORT_FREE"
# 预期：输出 PORT_FREE。若被占用：向用户报告占用进程，改用备用端口（如 53111），
# 并把 deploy/.env 的 STARFIT_PORT 改为该端口。

free -m 2>/dev/null || vm_stat || sysctl hw.memsize
# 预期：可用内存 ≥ 2GB（最低 1G 可跑但不推荐）；CPU ≥ 1 核

git --version
# 预期：已安装（源码构建需要）
```

任何一项不满足：停下，向用户报告具体缺项，不要继续。

## 第 2 步：生成配置

```bash
cp deploy/.env.example deploy/.env
```

生成两个随机密钥并就地替换 `CHANGE_ME`（每处必须不同）：

```bash
openssl rand -base64 18   # → STARFIT_ACCESS_TOKEN
openssl rand -base64 18   # → POSTGRES_PASSWORD
```

- `POSTGRES_PASSWORD` 替换后，**同步更新 `DATABASE_URL` 中的口令段**
  （`postgresql://starfit:<同一口令>@postgres:5432/starfit`）。
- 验证：`grep -c "CHANGE_ME" deploy/.env` —— 剩余的 `CHANGE_ME` 只允许出现在
  AI API 密钥行。

然后**引导用户填 AI 密钥**：询问用户使用哪个 provider（默认 deepseek 或 glm），
把对应 `*_API_KEY`（及 `*_BASE_URL`，如用自建网关）填入 `deploy/.env`，
并把 `AI_PROVIDER` 改为对应枚举值（`glm|deepseek|openai|google`）。
用户暂时不填：服务可以启动但 AI 功能不可用，须明确告知。

安全确认：`deploy/.env` 不进 git（已被 .gitignore 覆盖），不要把真实密钥
粘贴到任何会被提交的文件或对话记录外发。

## 第 3 步：构建并启动

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
# 预期：3-5 分钟构建完成；postgres 与 backend 容器 Up

docker compose -f deploy/docker-compose.prod.yml ps
# 预期：postgres 状态含 (healthy)，backend 状态含 (healthy)
```

backend 健康检查通过可能需要 30-60 秒（start_period 15s + 依赖 postgres 健康）。
若超时未 healthy：`docker compose -f deploy/docker-compose.prod.yml logs backend`
查看报错，如实报告。

## 第 4 步：数据库迁移

等 postgres healthy 后执行（一次性任务，跑完容器自动删除）：

```bash
docker compose -f deploy/docker-compose.prod.yml --profile tools run --rm migrate
# 预期：输出建表/迁移日志（000..009），进程退出码 0
```

## 第 5 步：健康验证

```bash
curl -s http://127.0.0.1:43111/api/ping -H "X-Access-Token: <STARFIT_ACCESS_TOKEN>"
# 预期：HTTP 200，返回 JSON（pong 响应）
```

若改过 `STARFIT_PORT`，curl 端口换成对应宿主端口。
注意：设了 `STARFIT_ACCESS_TOKEN` 后，未带令牌的请求返回 401 属正常鉴权行为。

## 第 6 步：向用户交付

汇报以下内容：

1. **服务器地址**：`http://<服务器IP>:<宿主端口>`（局域网部署给 出内网 IP）。
2. **访问令牌**：位置在 `deploy/.env` 的 `STARFIT_ACCESS_TOKEN`（App 登录要填，
   建议让用户自行查看而非明文转发）。
3. **App 配置方法**：打开 iOS App → 登录页手填 `IP:端口`（或用登录页扫描自动
   发现局域网服务器）→ 输入用户名 → 「访问令牌」框填入令牌 → 登录。
4. **排障入口**：
   - 日志：`docker compose -f deploy/docker-compose.prod.yml logs -f backend`
   - 状态：`docker compose -f deploy/docker-compose.prod.yml ps`
   - 重启：`docker compose -f deploy/docker-compose.prod.yml restart backend`
   - 升级：`git pull && docker compose -f deploy/docker-compose.prod.yml up -d --build`
   - 备份：`docker compose -f deploy/docker-compose.prod.yml exec postgres pg_dump -U starfit starfit > backup.sql`
   - 人类版文档：`deploy/README.md`
