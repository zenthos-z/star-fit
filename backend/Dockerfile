# starfit backend (Fastify 5 + Deep Agents)
# 构建上下文必须是仓库根目录（monorepo：backend 依赖 workspace `shared`）：
#   docker build -f backend/Dockerfile .
# 或直接 docker compose up（compose 已把 context 设为 ..）
#
# 注意：deps 阶段用全树安装（npm ci 不带 --workspace 过滤）。npm 的 workspace
# 过滤安装会漏装部分 hoisted @types 包（如 @types/fs-extra），导致 builder 阶段
# tsc 报 TS7016。全树安装与本地 node_modules 结构一致，已验证可编译。

FROM node:20-alpine AS deps
WORKDIR /app
# 国内 npm 镜像：官方 registry 在此网络环境下会长时间悬挂
RUN npm config set registry https://registry.npmmirror.com
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
RUN npm ci

FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
# --omit=dev 全树生产依赖。npm 的 workspace bug：--ignore-scripts 拦不住 workspace 的
# prepare 钩子（husky 属 devDep 会被 --omit=dev 剔除 → sh: husky: not found），
# 所以先删掉 backend 的 prepare 脚本再安装
RUN npm pkg delete scripts.prepare --workspace starfit-agent-backend \
 && npm ci --omit=dev --ignore-scripts

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY backend ./backend
# build:shared 编译 shared → shared/dist；tsc 编译 backend → backend/dist
# （tsconfig paths 指向 ../shared 源码，二者都要在镜像里）
RUN npm run build:shared --workspace starfit-agent-backend \
 && npm run build --workspace starfit-agent-backend --ignore-scripts \
 && rm -rf backend/dist/backend/src/scripts backend/dist/backend/src/tests

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 运行时只需要生产依赖 + 两个包的编译产物
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=builder /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/package.json
# tsc 的相对导入指向 <backend>/dist/shared/dist/**（从 dist/backend/src 向上 5 级），
# 所以 shared 的编译产物要放进 backend/dist/shared/dist
COPY --from=builder /app/shared/dist ./backend/dist/shared/dist
COPY shared/package.json ./backend/dist/shared/package.json
# skillLoader 运行时读取 skills 知识文件（.md 数据，非代码）
COPY --from=builder /app/backend/src/services/mas/skills ./backend/dist/backend/src/services/mas/skills
# 运行时裸导入 "shared/contracts" 走 node_modules 解析：把 shared 包放进根 node_modules
# （复用同一份 dist，避免重复拷贝）。注意：COPY 进来的 node_modules/shared 是 npm
# workspaces 的 symlink（指向容器里不存在的 /app/shared），先删掉再重建为真目录
RUN rm -f /app/node_modules/shared /app/node_modules/starfit-agent-backend \
 && mkdir -p /app/node_modules/shared \
 && ln -s /app/backend/dist/shared/dist /app/node_modules/shared/dist \
 && cp /app/backend/dist/shared/package.json /app/node_modules/shared/package.json
# fastifyStatic 以 cwd 为根找 uploads 目录
RUN mkdir -p /app/uploads
EXPOSE 43111
# 入口是 preload.js（代理预加载，内部再动态 import server.js）
WORKDIR /app/backend
CMD ["node", "dist/backend/src/preload.js"]
