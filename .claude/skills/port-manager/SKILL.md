---
name: port-manager
description: |
  项目端口管理工具，用于快速关闭、重启服务端口。
  触发词：关闭端口、kill port、重启后端、restart backend、端口被占用、端口冲突、kill-backend、kill-frontend、kill-studio、端口管理
---

# Port Manager

管理项目服务端口的工具，支持一键关闭/重启服务，无需手动搜索进程。

## 方法一：双击启动（最方便）

双击项目根目录的 **`启动端口管理器.bat`** 文件即可启动。

或在 `docs/小工具/` 目录中双击 **`启动端口管理器.bat`** 文件。

## 方法二：npm 命令（推荐）

```bash
# 完整命令
npm run port-manager

# 简写别名
npm run pm
```

## 方法三：直接运行 Node.js 脚本

```bash
node .claude/skills/port-manager/port-manager-server.mjs
```

---

## GUI 功能特点

独立服务器模式（端口 43113）提供：

- **可视化监控**: 实时显示所有端口状态和进程信息
- **一键关闭**: 点击按钮关闭占用端口的进程
- **命令执行**: 在 GUI 中直接执行系统命令
- **启动命令**: 查看各服务的启动命令
- **自动刷新**: 每 3 秒自动刷新端口状态

---

直接使用命令行工具（无需任何服务）：

```bash
# 查看所有端口状态
node .claude/skills/port-manager/scripts/port-manager.mjs status

# 关闭后端 (43111)
node .claude/skills/port-manager/scripts/port-manager.mjs kill-backend

# 关闭前端 (43112)
node .claude/skills/port-manager/scripts/port-manager.mjs kill-frontend

# 关闭 LangGraph Studio (43110)
node .claude/skills/port-manager/scripts/port-manager.mjs kill-studio

# 关闭任意端口
node .claude/skills/port-manager/scripts/port-manager.mjs kill <端口号>

# 关闭所有项目端口
node .claude/skills/port-manager/scripts/port-manager.mjs kill-all

# 重启后端服务
node .claude/skills/port-manager/scripts/port-manager.mjs restart-backend
```

## 方法三：后端 API 模式

如果后端服务正常运行，可以访问：

```
http://localhost:43111
```

然后打开 `docs/小工具/port-manager-gui.html`

## 端口清单

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 Vite | 43112 | 用户端 + 管理后台 |
| 后端 API | 43111 | Express 服务 |
| LangGraph Studio | 43110 | MAS 调试工具 |
| 端口管理器 | 43113 | 独立管理服务器 |
| PostgreSQL | 5432 | 数据库（仅查看） |
| Docs 文档站 | 5173 | VitePress |

## 使用场景

1. **端口被占用无法启动** → 运行 `port-manager-server.mjs` 使用 GUI
2. **后端热更新失败** → `restart-backend` 重启
3. **开发环境混乱** → `kill-all` 清理所有端口
4. **排查端口问题** → GUI 或 `status` 命令查看状态
