# 动画系统迁移日志

## 日期
2026-01-31

## 迁移范围
- 训练记录卡片（History.tsx / SwipeableRow.tsx）
- 战报页面按钮（SettlementV2.tsx）
- 海报生成器（PosterPromptGeneratorV2.tsx）

## 技术栈
- **从**：Tailwind CSS 动画类
- **到**：Framer Motion 预设库

## 动画参数
- **点击缩放**：5% (scale: 0.95)
- **悬停缩放**：5% (scale: 1.05)
- **悬停抬升**：4px (y: -4px)
- **过渡时长**：150-300ms
- **缓动函数**：easeOut / spring(200, 20)

## 新增文件
- `src/v2/lib/animations.ts` - 动画预设库
- `src/v2/lib/animations/types.ts` - TypeScript 类型定义

## 修改文件
- `components/SwipeableRow.tsx` - 更新卡片悬停/点击动效
- `src/v2/components/settlement/SettlementV2.tsx` - 更新按钮动效
- `src/v2/components/poster/PosterPromptGeneratorV2.tsx` - 重构模态框动效

## 文档更新
- `docs-site/ui-guides/animation-interaction-system.md` - 添加动画预设库说明

## 已知问题
无

## 后续计划
- 迁移 V2 组件中的所有动画
- 建立完整的动画组件库
- 探索更复杂的手势动画（如拖拽排序、手势导航）

## 性能指标
- 目标 FPS：≥ 55
- 动画使用 GPU 加速属性（transform, opacity）
- 避免动画布局属性（width, height）
