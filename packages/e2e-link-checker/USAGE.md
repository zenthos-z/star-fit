# 使用示例

## 快速开始

### 1. 在项目中安装工具

```bash
npm install --save-dev @mas/e2e-link-checker
```

### 2. 初始化配置文件

```bash
npx e2e-link-checker init
```

这将在项目根目录创建`e2e-link-checker.config.ts`配置文件。

### 3. 执行检测

```bash
npx e2e-link-checker check
```

## 常见使用场景

### 场景1：检测封面图片URL问题

在Starfit项目中，封面图片使用相对URL导致无法显示。

```bash
npx e2e-link-checker check
```

工具会自动检测所有`img src`属性，发现相对URL使用时报告错误。

**修复前**：
```tsx
<img src={assets.cover} alt="cover" />
```

**修复后**：
```tsx
<img src={getFullUrl(String(assets.cover))} alt="cover" />
```

### 场景2：检测WebSocket事件处理问题

在视频上传功能中，WebSocket完成事件处理不完善导致视频404错误。

```bash
npx e2e-link-checker check
```

工具会检测WebSocket完成事件监听器中是否缺少数据库更新逻辑。

**修复前**：
```typescript
const uploadVideo = async (file: File) => {
  const taskId = await createTask(file);
  updateDatabaseUrl(taskId);
};
```

**修复后**：
```typescript
const uploadVideo = async (file: File) => {
  const taskId = await createTask(file);
  ws.on('complete', () => {
    updateDatabaseUrl(taskId);
  });
};
```

### 场景3：检测数据查询降级问题

在前端App教程内容获取功能中，查询逻辑过于单一导致内容无法获取。

```bash
npx e2e-link-checker check
```

工具会检测数据查询是否有多源查询和降级处理。

**修复前**：
```typescript
const exercise = await db.exercises.findFirst({
  where: { name: exerciseName },
});
```

**修复后**：
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

### 场景4：生成Markdown报告

```bash
npx e2e-link-checker check -f markdown -o report.md
```

生成的报告可以用于文档归档和团队评审。

### 场景5：生成JSON报告

```bash
npx e2e-link-checker check -f json -o report.json
```

生成的JSON报告可以用于CI/CD集成和自动化处理。

### 场景6：跳过依赖检测

```bash
npx e2e-link-checker check --no-dependencies
```

在依赖检测耗时较长时，可以跳过依赖检测。

## CI/CD集成示例

### GitHub Actions

在`.github/workflows/ci.yml`中添加：

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

### GitLab CI

在`.gitlab-ci.yml`中添加：

```yaml
stages:
  - test

e2e-link-checker:
  stage: test
  image: node:18
  script:
    - npm install
    - npm run build
    - npx e2e-link-checker check -f markdown -o report.md
  artifacts:
    paths:
      - report.md
    expire_in: 1 week
```

## 自定义配置

### 只检测特定规则

```typescript
const config: Config = {
  rules: {
    relativeUrl: {
      enabled: true,
      severity: 'error'
    },
    webSocket: {
      enabled: false,
      severity: 'warning'
    },
    dataQuery: {
      enabled: false,
      severity: 'warning'
    },
    dependency: {
      enabled: false,
      severity: 'error'
    },
    aspectRatio: {
      enabled: false,
      severity: 'warning'
    }
  },
  include: ['src/**/*.tsx'],
  exclude: ['**/node_modules/**'],
  dependencies: {
    system: [],
    node: []
  },
  output: {
    format: 'console'
  }
};
```

### 自定义文件路径

```typescript
const config: Config = {
  rules: {
    relativeUrl: { enabled: true, severity: 'error' },
    webSocket: { enabled: true, severity: 'warning' },
    dataQuery: { enabled: true, severity: 'warning' },
    dependency: { enabled: true, severity: 'error' },
    aspectRatio: { enabled: true, severity: 'warning' }
  },
  include: ['src/admin/**/*.tsx', 'src/app/**/*.tsx'],
  exclude: ['**/node_modules/**', '**/dist/**'],
  dependencies: {
    system: ['ffmpeg'],
    node: ['langchain', '@langchain/core']
  },
  output: {
    format: 'markdown'
  }
};
```

### 自定义依赖检查

```typescript
const config: Config = {
  rules: {
    relativeUrl: { enabled: true, severity: 'error' },
    webSocket: { enabled: true, severity: 'warning' },
    dataQuery: { enabled: true, severity: 'warning' },
    dependency: { enabled: true, severity: 'error' },
    aspectRatio: { enabled: true, severity: 'warning' }
  },
  include: ['src/**/*.tsx', 'src/**/*.ts'],
  exclude: ['**/node_modules/**'],
  dependencies: {
    system: ['ffmpeg', 'python3', 'java'],
    node: ['langchain', '@langchain/core', '@playwright/test', 'typescript']
  },
  output: {
    format: 'console'
  }
};
```

## 故障排除

### 问题：TypeScript编译错误

**错误信息**：
```
Cannot find module '@mas/e2e-link-checker'
```

**解决方案**：
```bash
npm install --save-dev @mas/e2e-link-checker
npm run build
```

### 问题：配置文件加载失败

**错误信息**：
```
配置文件加载失败，使用默认配置
```

**解决方案**：
1. 检查配置文件路径是否正确
2. 检查配置文件语法是否正确
3. 运行`npx e2e-link-checker init`重新生成配置文件

### 问题：依赖检测失败

**错误信息**：
```
package.json not found
```

**解决方案**：
1. 确保在项目根目录运行工具
2. 确保package.json文件存在
3. 如果不需要依赖检测，使用`--no-dependencies`选项

### 问题：文件未找到

**错误信息**：
```
No files found matching pattern
```

**解决方案**：
1. 检查include和exclude配置是否正确
2. 使用绝对路径
3. 检查文件扩展名是否匹配

## 高级用法

### 编程式调用

```typescript
import { StaticAnalyzer, DependencyChecker, Reporter } from '@mas/e2e-link-checker';

const analyzer = new StaticAnalyzer();
const issues = analyzer.analyze('src/components/ActionCard.tsx', config);

const reporter = new Reporter();
const report = reporter.generateMarkdownReport(issues, summary, duration, filesAnalyzed);
console.log(report);
```

### 自定义规则

```typescript
import { StaticAnalyzer } from '@mas/e2e-link-checker';

class CustomAnalyzer extends StaticAnalyzer {
  private visit(node: ts.Node, filePath: string, config: any) {
    super.visit(node, filePath, config);
    this.checkCustomRule(node, filePath);
  }

  private checkCustomRule(node: ts.Node, filePath: string) {
    if (ts.isCallExpression(node)) {
      const callText = node.expression.getText();
      if (callText.includes('console.log')) {
        this.addIssue({
          type: 'custom',
          severity: 'warning',
          message: '发现console.log调用',
          location: this.getLocation(filePath, node.getStart()),
          suggestion: '使用日志库代替console.log',
          code: callText
        });
      }
    }
  }
}
```

## 最佳实践

1. **定期运行检测**：在每次提交前运行检测，确保代码质量
2. **集成到CI/CD**：将检测工具集成到CI/CD流程，自动检测代码提交
3. **及时修复问题**：发现问题时及时修复，避免问题累积
4. **自定义配置**：根据项目需求自定义配置，提高检测效率
5. **团队协作**：分享检测报告，团队成员共同修复问题

## 贡献指南

欢迎提交Issue和Pull Request！请参考CONTRIBUTING.md了解详细信息。
