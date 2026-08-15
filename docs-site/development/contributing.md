# 贡献指南

我们欢迎对 Starfit 的贡献！请遵循以下指南以确保流程顺畅。

## 开发工作流

1.  **Fork 和 Clone**：Fork 仓库并在本地克隆。
2.  **创建分支**：为你的功能或修复创建一个新分支。
    ```bash
    git checkout -b feature/my-new-feature
    ```
3.  **编码**：
    - 遵循现有的代码风格（已配置 Prettier/ESLint）。
    - 使用 TypeScript 以确保类型安全。
4.  **测试**：
    - 运行单元测试：`npm run test`（在 backend 目录下）。
    - 运行 E2E 测试：`npm run e2e`（在根目录下）。
    - **重要**：确保在推送之前 `npm run test:all` 通过。
5.  **文档**：如果更改了功能，请更新 `docs-site/` 中的相关文档。
6.  **Pull Request**：提交 PR，并清晰描述所做的更改。

## 提交约定

我们使用 Conventional Commits：

- `feat`：新功能
- `fix`：错误修复
- `docs`：文档更改
- `chore`：构建过程、依赖项
- `refactor`：代码重构，不涉及 API 更改

示例：`feat(mas): 添加新的分析代理能力`

## 代码标准

- **React**：函数式组件、Hooks。
- **后端**：服务-控制器模式。
- **状态**：最小化全局状态，优先使用本地状态或服务器状态。
