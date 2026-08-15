# 快速开始

## 环境要求

- **Node.js**: v18 或更高版本
- **PostgreSQL**（含 pgvector 扩展，可选，仅 AI 分析与同步功能需要）
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
    ```

3. **配置后端环境变量:**

    进入 `backend/` 目录，复制 `.env.local.example` 为 `.env.local`，填入你的 API 密钥与数据库连接：

    ```env
    AI_PROVIDER=gemini
    GOOGLE_API_KEY=your_api_key_here
    DATABASE_URL=postgresql://user:pass@localhost:5432/starfit
    ```

    > `.env.local` 不进 git；`AI_PROVIDER` 支持 gemini / openai / deepseek 等 provider（多 provider adapter）。

## 运行

**后端**（端口 43111）：

```bash
cd backend
npm install
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
| `backend/` | `npm test` | 后端测试 |
| `backend/` | `npm run db:migrate` | PostgreSQL 迁移 |

## Android 构建

前端通过 Capacitor 打包为 Android 应用：

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleRelease   # 产物在 android/app/build/outputs/apk/
```

签名配置见 `android/app/build.gradle`（读取 `android/keystore.properties`，该文件不进 git）。
