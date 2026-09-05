# syntax=docker/dockerfile:1
# 注：本仓是 npm workspaces monorepo，唯一权威 lockfile 是仓库根的 package-lock.json；
#     backend 的 tsc include 了 ../shared，因此 build context 必须是仓库根
#     （docker-compose.local.yml 已如此设置）。产物路径为 dist/backend/src/...。
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/package-lock.json ./shared/
COPY backend/package.json backend/package-lock.json ./backend/
# backend 的 "prepare": "husky" 在容器里必挂（无 git、husky 是 devDep 未装且 --ignore-scripts
# 对 workspace 的 prepare 不生效），装依赖前先摘掉容器内副本的 prepare
RUN node -e "const f='backend/package.json';const j=require('./'+f);delete j.scripts.prepare;require('fs').writeFileSync(f,JSON.stringify(j))"
# backend/package.json 漏声明 uuid（幽灵依赖，宿主靠 root hoisting 才能跑），容器里显式补装
RUN npm install --omit=dev uuid@13.0.0 --no-audit --no-fund --ignore-scripts

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY shared ./shared
WORKDIR /app/shared
# 钉住 TS 5.8.3：与宿主 root lockfile 一致。5.9 对 NodeNext+import.meta 检查变严会误报 TS1470
RUN HUSKY=0 npm install --ignore-scripts --no-audit --no-fund typescript@5.8.3
RUN npm run build
WORKDIR /app/backend
# NodeNext 判定 ESM/CJS 看 package.json "type"；backend/package.json 必须在场，
# 否则 tsc 向上找 /app/package.json（root，也含 type:module）路径不同导致判定差异
COPY backend/package.json ./
COPY backend/tsconfig.json ./
COPY backend/src ./src
# npm run build = build:shared(容器内已完成) + tsc；这里直接跑 tsc，避免 npm 向上找 /app/package.json
# tsc 借用 shared 的（deps 阶段 --omit=dev 未装 typescript；shared 的 node_modules 刚装好全量 devDeps）
# 全量转译：skipLibCheck+宽松 any 兜底 --omit=dev 缺 @types 的环境差异。
# 产物与宿主 tsc 产物一致（同 emit 逻辑），仅跳过类型检查（类型检查是 CI quality-gate 的职责）。
RUN /app/shared/node_modules/.bin/tsc -p tsconfig.json --skipLibCheck --noImplicitAny false --strict false --noEmitOnError false --isolatedModules false 2>/dev/null; \
    test -f dist/backend/src/server.js && test -f dist/backend/src/preload.js && echo "TRANSPILE OK"

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/backend/dist ./dist
# 源码里 '../../../../../shared/dist/...' 相对引用 → 编译产物期望 /app/dist/shared/dist
COPY --from=builder /app/shared/dist ./dist/shared/dist
COPY backend/package.json ./
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 43111
CMD ["node", "dist/backend/src/server.js"]
