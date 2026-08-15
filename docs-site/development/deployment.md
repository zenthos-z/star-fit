# 部署指南

## 前端部署

### 构建

```bash
npm run build
```

构建产物将输出到 `dist/` 目录。

### 环境变量

在部署前配置以下环境变量：

- `VITE_API_URL`: 后端 API 地址
- `VITE_WS_URL`: WebSocket 地址

### 静态托管

前端是一个静态应用，可以部署到任何静态托管服务：

- **Vercel**：连接 GitHub 仓库自动部署
- **Netlify**：拖拽上传或 Git 集成
- **GitHub Pages**：使用 `gh-pages` 分支

## 后端部署

### 准备

```bash
cd backend
npm install
```

### 环境变量

配置 `.env` 文件：

```env
PORT=3000
DATABASE_URL=./gemini_gym.db
OPENAI_API_KEY=your_api_key
```

### 启动

```bash
npm start
```

或使用 PM2 进行进程管理：

```bash
npm install -g pm2
pm2 start npm --name "starfit-backend" -- start
```

### Docker 部署

```bash
docker build -t starfit-backend .
docker run -p 3000:3000 --env-file .env starfit-backend
```

## 文档站点部署

### 构建

```bash
cd docs-site
npm run build
```

### 部署到 GitHub Pages

```bash
npm run deploy
```

这将自动构建并部署到 `gh-pages` 分支。
