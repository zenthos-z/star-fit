# MAS E2E链路一致性检测工具

自动检测代码中的URL解析、WebSocket事件处理、数据查询等问题，减少手动debug工作量。

## 功能特性

- **相对URL检测**：检测直接使用相对URL而未调用`getFullUrl`函数的情况
- **WebSocket事件处理检测**：检测WebSocket完成事件处理逻辑是否正确
- **数据查询降级检测**：检测数据查询是否有多源查询和降级处理
- **依赖检测**：检测系统依赖和Node.js依赖是否安装
- **纵横比检测**：检测UI组件中的纵横比设置是否合适
- **多种报告格式**：支持Markdown、JSON和Console格式报告

## 安装

```bash
npm install --save-dev @mas/e2e-link-checker
```

## 使用方法

### 初始化配置文件

```bash
npx e2e-link-checker init
```

这将在项目根目录创建`e2e-link-checker.config.ts`配置文件。

### 执行检测

```bash
npx e2e-link-checker check
```

### 指定配置文件

```bash
npx e2e-link-checker check -c custom-config.ts
```

### 指定报告格式

```bash
# 控制台输出（默认）
npx e2e-link-checker check -f console

# Markdown格式
npx e2e-link-checker check -f markdown -o report.md

# JSON格式
npx e2e-link-checker check -f json -o report.json
```

### 跳过依赖检测

```bash
npx e2e-link-checker check --no-dependencies
```

## 配置文件

配置文件示例：

```typescript
import { Config } from '@mas/e2e-link-checker';

const config: Config = {
  rules: {
    relativeUrl: {
      enabled: true,
      severity: 'error'
    },
    webSocket: {
      enabled: true,
      severity: 'warning'
    },
    dataQuery: {
      enabled: true,
      severity: 'warning'
    },
    dependency: {
      enabled: true,
      severity: 'error'
    },
    aspectRatio: {
      enabled: true,
      severity: 'warning'
    }
  },
  include: ['src/**/*.tsx', 'src/**/*.ts'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts'],
  dependencies: {
    system: ['ffmpeg'],
    node: ['langchain', '@langchain/core']
  },
  output: {
    format: 'console'
  }
};

export default config;
```

## 检测规则

### 1. 相对URL检测

检测直接使用相对URL而未调用`getFullUrl`函数的情况。

**错误示例**：
```tsx
<img src={assets.cover} alt="cover" />
```

**正确示例**：
```tsx
<img src={getFullUrl(String(assets.cover))} alt="cover" />
```

### 2. WebSocket事件处理检测

检测WebSocket完成事件处理逻辑是否正确，确保在完成事件触发后再更新数据库。

**错误示例**：
```typescript
const uploadVideo = async (file: File) => {
  const taskId = await createTask(file);
  updateDatabaseUrl(taskId);
};
```

**正确示例**：
```typescript
const uploadVideo = async (file: File) => {
  const taskId = await createTask(file);
  ws.on('complete', () => {
    updateDatabaseUrl(taskId);
  });
};
```

### 3. 数据查询降级检测

检测数据查询是否有多源查询和降级处理。

**错误示例**：
```typescript
const exercise = await db.exercises.findFirst({
  where: { name: exerciseName },
});
```

**正确示例**：
```typescript
let exercise = await db.exercises.findFirst({
  where: { id: exerciseId },
});
if (!exercise) {
  exercise = await db.exercises.findFirst({
    where: { name: exerciseName },
  });
}
if (!exercise) {
  return fallbackContent;
}
```

### 4. 依赖检测

检测系统依赖和Node.js依赖是否安装。

**系统依赖检测**：
- 检查FFmpeg等系统工具是否安装
- 检查Node.js版本是否符合要求

**Node.js依赖检测**：
- 检查package.json中是否声明了必要的依赖
- 检查依赖版本是否符合要求

### 5. 纵横比检测

检测UI组件中的纵横比设置是否合适。

**警告示例**：
```tsx
<div className="aspect-video">
  <img src={cover} alt="cover" />
</div>
```

**建议示例**：
```tsx
<div className="aspect-[4/3]">
  <img src={cover} alt="cover" />
</div>
```

## CI/CD集成

### GitHub Actions示例

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run typecheck
      - run: npm run build
      - run: npx e2e-link-checker check -f markdown -o report.md
      - name: Upload report
        uses: actions/upload-artifact@v2
        with:
          name: e2e-link-checker-report
          path: report.md
```

## 报告格式

### 控制台格式

```
╔═══════════════════════════════════════════════════════════════╗
║           E2E链路一致性检测报告                              ║
╚═══════════════════════════════════════════════════════════════╝

📊 检测摘要:
   文件分析数: 10
   问题总数: 3
   ❌ 错误: 1
   ⚠️  警告: 2
   ℹ️  信息: 0
   检测耗时: 1250ms
```

### Markdown格式

```markdown
# E2E链路一致性检测报告

生成时间: 2025-01-16T10:00:00.000Z

## 检测摘要

- 文件分析数: 10
- 问题总数: 3
- 错误: 1
- 警告: 2
- 信息: 0
- 检测耗时: 1250ms
```

### JSON格式

```json
{
  "timestamp": "2025-01-16T10:00:00.000Z",
  "summary": {
    "filesAnalyzed": 10,
    "issues": {
      "total": 3,
      "errors": 1,
      "warnings": 2,
      "info": 0
    },
    "duration": 1250
  },
  "issues": [...]
}
```

## 开发

### 构建项目

```bash
npm run build
```

### 运行测试

```bash
npm test
```

### 开发模式

```bash
npm run dev
```

## 许可证

MIT

## 贡献

欢迎提交Issue和Pull Request！
