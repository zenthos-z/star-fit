# 快速开始

## 环境要求

- **Node.js**: v18 或更高版本
- **Docker + Docker Compose**（推荐，用于拉起 PostgreSQL 16；也可自备数据库）
- **macOS + Xcode**（仅构建 iOS App 时需要）
- **Git**

## 安装步骤

1. **克隆仓库:**

    ```bash
    git clone https://github.com/zenthos-z/star-fit.git
    cd star-fit
    ```

2. **安装依赖:**

    ```bash
    npm install
    cd backend && npm install
    ```

3. **配置后端环境变量:**

    进入 `backend/` 目录，复制 `.env.local.example` 为 `.env.local`，
    改好最小可启动的 4 项即可（每个变量的用途见示例文件内注释）：

    ```env
    DATABASE_URL=postgresql://starfit:CHANGE_ME@localhost:5432/starfit
    STARFIT_ACCESS_TOKEN=CHANGE_ME          # 任意随机长字符串
    DEEPSEEK_API_KEY=CHANGE_ME              # 默认 LLM provider 的密钥
    DEEPSEEK_BASE_URL=CHANGE_ME             # DeepSeek 兼容网关
    ```

    > `.env.local` 不进 git。LLM provider 通过 `AI_PROVIDER` 切换，
    > 支持 `glm | deepseek | openai | google`，切换后按示例文件内对应段落补该 provider 的配置。

4. **起数据库（可选，推荐用 compose）:**

    ```bash
    cd backend
    docker compose up -d postgres
    ```

## 运行

**后端**（端口 43111）：

```bash
cd backend
npm run dev
```

**前端**（端口 43112，另开一个终端）：

```bash
npm run dev
```

访问 `http://127.0.0.1:43112` 即可看到应用；管理台在 `http://127.0.0.1:43112/admin.html`。

**文档站点**（可选）：

```bash
npm run docs:dev
```

## 常用命令

| 位置 | 命令 | 作用 |
| --- | --- | --- |
| 根目录 | `npm run dev` | Vite 前端开发服务器（43112） |
| 根目录 | `npm run build` | 生产构建 |
| 根目录 | `npm run typecheck` | TypeScript 类型检查 |
| 根目录 | `npm run test:run` | Vitest 单元测试 |
| 根目录 | `npm run docs:dev` | VitePress 文档站 |
| `backend/` | `npm run dev` | Fastify 后端（43111） |
| `backend/` | `npm test` | 后端测试（jest） |
| `backend/` | `npm run db:migrate` | PostgreSQL 迁移 |

## iOS 构建（产品主形态）

iOS 壳 = Capacitor 8 Web 层 + 手写 Swift 原生层（Liquid Glass 玻璃 UI、
原生 TabBar、灵动岛 Live Activity）：

```bash
npm run build
npx cap sync ios
open ios/App/App.xcworkspace   # Xcode 中运行
```

开发热更：`CAP_DEV_URL=http://localhost:43112 npx cap sync ios`。

## Android 构建

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleRelease   # 产物在 android/app/build/outputs/apk/
```

签名配置见 `android/app/build.gradle`（读取 `android/keystore.properties`，该文件不进 git）。

## 下一步

- [部署指南](/development/deployment) — 服务器自托管
- [数据协议](/concepts/data-protocol) — 数据契约与存储分层
