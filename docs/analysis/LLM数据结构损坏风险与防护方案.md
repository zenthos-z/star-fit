# MAS 系统 LLM 数据结构损坏风险分析与防护方案

## 文档信息

| 项目 | 内容 |
|------|------|
| 文档版本 | 1.0.0 |
| 创建日期 | 2026-01-25 |
| 核心问题 | LLM 输出的结构化数据被意外修改或损坏 |
| 关键场景 | workout_complete, plan, chat |

---

## 1. 问题概述

### 1.1 核心担忧

在 MAS 系统中，**Architect 智能体**负责输出结构化的 `uiHint`，这些数据经过 LLM 处理后可能存在以下风险：

1. **JSON 格式损坏**：LLM 返回的 JSON 格式不正确
2. **类型混淆**：对象数组变成字符串数组，或对象变成数组
3. **字段缺失**：必需字段丢失或为空
4. **嵌套结构损坏**：深层嵌套的数据结构被破坏

### 1.2 影响范围

```
┌─────────────────────────────────────────────────────────────────┐
│                     LLM 数据流与风险点                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LLM 输出 → extractTextContent → JSON.parse → Schema 验证 → 前端  │
│     │              │                   │            │           │
│     ▼              ▼                   ▼            ▼           │
│  [风险1]        [风险2]             [风险3]       [风险4]      │
│  格式异常        内容丢失             类型错误      渲染失败     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 数据损坏路径分析

### 2.1 完整数据流

```
┌──────────────────────────────────────────────────────────────────────┐
│                        workout_complete 数据流                        │
└──────────────────────────────────────────────────────────────────────┘

1. 前端请求
   └─> POST /mas/chat
       { scenario: 'workout_complete', workoutFacts: {...} }

2. Controller 处理
   └─> masController.postMasChat
       ├─> 加载用户画像
       ├─> 构建初始状态
       └─> masGraph.invoke(state)

3. LangGraph 路由
   └─> routerNode
       └─> 检测 scenario = 'workout_complete'
           └─> architectNode (直接处理，不经过其他 agents)

4. Architect 处理
   └─> loadEnhancedUserProfile()
   └─> buildHistoricalComparison()
   └─> enrichWithExerciseLibrary()
   └─> buildWorkoutCompleteContext()
   └─> LLM.invoke([workoutCompletePrompt])

5. LLM 响应处理 ⚠️ **关键风险点**
   └─> extractTextContent(response)
       ├─> 可能丢失内容
       └─> 返回字符串

6. JSON 解析 ⚠️ **关键风险点**
   └─> JSON.parse(responseText)
       ├─> 可能解析失败
       └─> 需要降级策略

7. 结构验证 ⚠️ **缺失验证**
   └─> parsedResult?.uiHint?.type === 'SURVEY_CARD'
       └─> 缺少 questions 结构验证

8. 返回前端
   └─> { uiHint: { type: 'SURVEY_CARD', data: {...} } }
       └─> 前端 SurveyCard 渲染
```

### 2.2 风险点详解

#### 风险点 A：LLM 输出提取 (`extractTextContent`)

**位置**：`backend/src/services/mas/graph.ts:26-66`

**问题**：
```typescript
const extractTextContent = (response: any): string => {
  const content = response.content;
  if (Array.isArray(content)) {
    // 过滤空文本块
    const textParts = content
      .filter((part: any) => (part.type === 'text' || typeof part === 'string') && ...)
      .map((part: any) => typeof part === 'string' ? part : part.text);

    let text = textParts.join('\n').trim();

    // 如果没有文本但有思维链
    if (!text) {
      const thoughtPart = content.find((part: any) => part.type === 'thought');
      if (thoughtPart) {
        return ""; // ⚠️ 返回空字符串，后续 JSON.parse 会失败
      }
    }
    return text;
  }
  return "";
};
```

**风险场景**：
1. LLM 只返回思维链（thought）没有文本 → 返回空字符串
2. LLM 返回复合结构（text + thought）→ 可能只提取部分内容
3. LLM 返回格式异常 → 过滤逻辑可能误判

#### 风险点 B：JSON 解析降级策略不完善

**位置**：`backend/src/services/mas/graph.ts:832-848`

**问题**：
```typescript
let parsedResult: any;
try {
  parsedResult = JSON.parse(responseText);
} catch (e) {
  // 尝试提取 JSON 代码块
  const jsonMatch = responseText?.match(/```json\s*([\s\S]*?)\s*```/) ||
                   responseText?.match(/```\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      parsedResult = JSON.parse(jsonMatch[1]);
    } catch (e2) {
      console.error('[MAS] workout_complete: Failed to parse extracted JSON:', e2);
      // ⚠️ 没有进一步降级，直接使用 fallback
    }
  }
}
```

**风险场景**：
1. LLM 在 JSON 前添加额外文字 → `好的，这是您的问题：{...}`
2. LLM 在 JSON 后添加解释 → `{...}\n\n希望这些对您有帮助`
3. LLM 使用单引号而非双引号 → `{'id': 'q1', ...}`
4. LLM 返回多个 JSON 对象 → 需要智能提取第一个完整对象

#### 风险点 C：Questions 数组类型混淆

**位置**：`backend/src/services/mas/graph.ts:1160-1185`

**问题**：
```typescript
if (finalUiHint?.type === 'SURVEY_CARD' && finalUiHint.data?.questions) {
  const questions = finalUiHint.data.questions;
  if (Array.isArray(questions) && questions.length > 0 && typeof questions[0] === 'string') {
    // ⚠️ 尝试解析字符串数组
    try {
      const parsedQuestions = questions.map((q, idx) => {
        if (typeof q === 'string') {
          const parsed = JSON.parse(q); // 可能抛出异常
          return parsed;
        }
        return q;
      });
      finalUiHint = {
        ...finalUiHint,
        data: {
          ...finalUiHint.data,
          questions: parsedQuestions
        }
      };
    } catch (e) {
      console.error('[MAS] Failed to parse questions:', e);
      // ⚠️ 解析失败后没有回退，仍使用原始字符串数组
    }
  }
}
```

**风险场景**：
1. LLM 返回字符串数组而非对象数组 → `["{\\"id\\":\\"q1\\"...}"]`
2. 字符串 JSON 本身格式错误 → 解析失败
3. 混合类型数组 → 部分是对象，部分是字符串

#### 风险点 D：缺少结构验证

**位置**：`backend/src/services/mas/graph.ts:841-846`

**问题**：
```typescript
if (parsedResult?.uiHint?.type === 'SURVEY_CARD') {
  console.log(`[MAS] workout_complete: Successfully parsed SURVEY_CARD`);
  // ⚠️ 没有验证 questions 结构完整性
  return {
    uiHint: parsedResult.uiHint
  };
}
```

**缺失的验证**：
- `questions` 是否为数组？
- 每个 question 是否有必需的 `id` 和 `question` 字段？
- 是否至少有 `placeholder` 或 `options` 之一？
- 数据类型是否正确？

---

## 3. 各场景风险评估

### 3.1 workout_complete 场景 🔴 **高风险**

**数据流**：
```
LLM Response → extractTextContent → JSON Parse → ⚠️ 直接使用
```

**风险点**：
| 风险 | 可能性 | 影响 | 现有保护 |
|------|--------|------|---------|
| JSON 格式异常 | 中 | 高 | 有限降级策略 |
| Questions 类型错误 | 高 | 高 | 后置转换逻辑 |
| 缺少必需字段 | 中 | 高 | ❌ 无 |
| 空响应 | 低 | 高 | Fallback 问题 |

**示例问题响应**：
```json
// 问题1：额外文字 + JSON
"这是根据您的情况生成的问题：
{
  \"ops\": [],
  \"uiHint\": {
    \"type\": \"SURVEY_CARD\",
    \"data\": {
      \"questions\": \"[{\\"id\\":\\"q1\\", \\"question\\":\\"...\\", \\"required\\": true}]\" // ⚠️ 字符串而非数组
    }
  }
}
希望这些对您有帮助！"

// 问题2：单引号
"{'ops': [], 'uiHint': {'type': 'SURVEY_CARD', 'data': {...}}}"

// 问题3：缺少必需字段
"{\"ops\": [], \"uiHint\": {\"type\": \"SURVEY_CARD\", \"data\": {\"questions\": []}}}"
```

### 3.2 plan 场景 🟡 **中风险**

**数据流**：
```
有用户画像 → 直接查数据库 → ⚠️ 绕过 LLM
无用户画像 → LLM 生成调研 → JSON Parse
```

**风险点**：
| 风险 | 可能性 | 影响 | 现有保护 |
|------|--------|------|---------|
| PLAN_CARD 对象/数组转换 | 低 | 中 | 后置转换逻辑 |
| 动作库数据异常 | 低 | 中 | ❌ 无 |
| LLM 返回调研数据异常 | 中 | 中 | 基础验证 |

**优势**：plan 场景大部分情况绕过 LLM，直接使用数据库查询，风险较低。

### 3.3 chat 场景 🟡 **中风险**

**数据流**：
```
LLM Response → extractTextContent → withStructuredOutput → Schema 验证
```

**风险点**：
| 风险 | 可能性 | 影响 | 现有保护 |
|------|--------|------|---------|
| Schema 不匹配 | 低 | 中 | Zod 验证 |
| 消息截断不当 | 低 | 低 | ⚠️ 不一致的 limit |
| Tool 调用异常 | 低 | 低 | ToolNode 处理 |

**优势**：使用 `withStructuredOutput` 有 Schema 保护。

---

## 4. 防护方案设计

### 4.1 多层防护架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      多层防护架构                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LLM Output                                                      │
│     │                                                            │
│     ▼                                                            │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ 第1层：内容提取增强                                     │     │
│  │  - 处理各种响应格式（Gemini 3 thought/text）          │     │
│  │  - 提取 JSON 边界                                       │     │
│  │  - 清理额外文字                                         │     │
│  └────────────────────────────────────────────────────────┘     │
│     │                                                            │
│     ▼                                                            │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ 第2层：智能 JSON 解析                                   │     │
│  │  - 多策略降级（直接解析/代码块/对象提取）              │     │
│  │  - 修复常见格式问题（单引号/逗号）                     │     │
│  │  - 提取第一个完整对象                                   │     │
│  └────────────────────────────────────────────────────────┘     │
│     │                                                            │
│     ▼                                                            │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ 第3层：Schema 验证                                      │     │
│  │  - Zod Schema 定义完整数据结构                         │     │
│  │  - 验证所有必需字段                                     │     │
│  │  - 类型检查（对象数组/字符串数组）                     │     │
│  └────────────────────────────────────────────────────────┘     │
│     │                                                            │
│     ▼                                                            │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ 第4层：降级处理                                         │     │
│  │  - 验证失败时使用预定义问题                             │     │
│  │  - 确保至少返回可用数据                                 │     │
│  │  - 记录异常用于监控                                     │     │
│  └────────────────────────────────────────────────────────┘     │
│     │                                                            │
│     ▼                                                            │
│  安全输出 → 前端                                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 实现代码

#### 第1层：增强内容提取

```typescript
// backend/src/services/mas/parsing/enhancedExtract.ts

/**
 * 增强的 LLM 响应提取器
 */
export class EnhancedLLMExtractor {
  /**
   * 提取 JSON 内容，处理各种边界情况
   */
  extractJSON(text: string): string | null {
    if (!text || typeof text !== 'string') return null;

    // 策略1: 直接是完整 JSON
    if (this.isValidJSON(text)) {
      return text;
    }

    // 策略2: 提取 json 代码块
    const jsonCodeBlock = this.extractCodeBlock(text, 'json');
    if (jsonCodeBlock && this.isValidJSON(jsonCodeBlock)) {
      return jsonCodeBlock;
    }

    // 策略3: 提取通用代码块
    const genericCodeBlock = this.extractCodeBlock(text);
    if (genericCodeBlock && this.isValidJSON(genericCodeBlock)) {
      return genericCodeBlock;
    }

    // 策略4: 查找第一个完整 JSON 对象
    const jsonObject = this.extractJSONObject(text);
    if (jsonObject) {
      return jsonObject;
    }

    // 策略5: 尝试修复常见格式问题
    const repaired = this.repairJSON(text);
    if (repaired) {
      return repaired;
    }

    return null;
  }

  /**
   * 检查是否为有效 JSON
   */
  private isValidJSON(text: string): boolean {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 提取代码块内容
   */
  private extractCodeBlock(text: string, lang?: string): string | null {
    const pattern = lang
      ? new RegExp(`\`\`\`${lang}\\s*([\\s\\S]*?)\\s*\`\`\``)
      : /```(?:\w+)?\s*([\s\S]*?)\s*```/;

    const match = text.match(pattern);
    return match ? match[1].trim() : null;
  }

  /**
   * 提取第一个完整 JSON 对象
   */
  private extractJSONObject(text: string): string | null {
    // 查找 { 和 } 的配对
    let start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') depth++;
        if (char === '}') {
          depth--;
          if (depth === 0) {
            const candidate = text.substring(start, i + 1);
            if (this.isValidJSON(candidate)) {
              return candidate;
            }
            break;
          }
        }
      }
    }

    return null;
  }

  /**
   * 尝试修复常见 JSON 格式问题
   */
  private repairJSON(text: string): string | null {
    let repaired = text;

    // 修复1: 单引号 → 双引号（小心字符串内的单引号）
    repaired = repaired.replace(/'([^']*?)'/g, '"$1"');

    // 修复2: 移除注释
    repaired = repaired.replace(/\/\/.*$/gm, '');
    repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');

    // 修复3: 移除尾随逗号
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    // 修复4: 清理控制字符
    repaired = repaired.replace(/[\x00-\x1F\x7F]/g, '');

    if (this.isValidJSON(repaired)) {
      return repaired;
    }

    return null;
  }
}
```

#### 第2层：Schema 验证

```typescript
// backend/src/services/mas/parsing/schemas.ts

import { z } from 'zod';

/**
 * Survey Question Schema
 */
export const SurveyQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  required: z.boolean().optional().default(false),
  placeholder: z.string().optional(),
  options: z.array(z.object({
    label: z.string().min(1),
    value: z.string().min(1)
  })).optional()
}).refine(
  (data) => data.placeholder !== undefined || (data.options && data.options.length > 0),
  { message: "Question must have either placeholder or options" }
);

/**
 * Survey Card Data Schema
 */
export const SurveyCardDataSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  message: z.string().optional(),
  sessionId: z.string().optional(),
  questions: z.array(SurveyQuestionSchema).min(1).max(10)
});

/**
 * UI Hint Schema
 */
export const UIHintSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SURVEY_CARD'),
    data: SurveyCardDataSchema
  }),
  z.object({
    type: z.literal('PLAN_CARD'),
    data: z.array(z.object({
      exerciseId: z.string(),
      name: z.string(),
      sets: z.number(),
      reps: z.number(),
      weight: z.number()
    }))
  }),
  z.object({
    type: z.literal('SUMMARY_CARD'),
    data: z.object({
      stats: z.record(z.any()),
      exercises: z.array(z.any())
    })
  }),
  z.object({
    type: z.literal('DEVIATION_CARD'),
    data: z.object({
      reason: z.string()
    })
  }),
  z.object({
    type: z.literal('INSTRUCTION_CARD'),
    data: z.object({
      message: z.string()
    })
  })
]);

/**
 * Architect Output Schema
 */
export const ArchitectOutputSchema = z.object({
  ops: z.array(z.object({
    op: z.enum(['replace', 'add', 'remove']),
    path: z.string(),
    value: z.any().optional(),
    idempotencyKey: z.string().optional()
  })).default([]),
  uiHint: UIHintSchema.optional()
});

/**
 * 验证函数
 */
export function validateUIHint(data: unknown): {
  success: boolean;
  data?: any;
  error?: string;
} {
  try {
    const result = ArchitectOutputSchema.parse({ ops: [], uiHint: data });
    return {
      success: true,
      data: result.uiHint
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
      };
    }
    return {
      success: false,
      error: 'Unknown validation error'
    };
  }
}

/**
 * 验证并修复 Survey Questions
 */
export function validateAndFixQuestions(questions: unknown): {
  success: boolean;
  questions?: any[];
  error?: string;
} {
  // 场景1: 字符串数组，尝试解析
  if (Array.isArray(questions) && questions.length > 0 && typeof questions[0] === 'string') {
    try {
      const parsed = questions.map((q, idx) => {
        if (typeof q === 'string') {
          return JSON.parse(q);
        }
        return q;
      });
      const result = z.array(SurveyQuestionSchema).safeParse(parsed);
      if (result.success) {
        return { success: true, questions: result.data };
      }
    } catch {
      // 继续尝试其他方案
    }
  }

  // 场景2: 直接验证对象数组
  const result = z.array(SurveyQuestionSchema).safeParse(questions);
  if (result.success) {
    return { success: true, questions: result.data };
  }

  return {
    success: false,
    error: result.error instanceof z.ZodError
      ? result.error.errors.map(e => e.message).join('; ')
      : 'Invalid questions structure'
  };
}
```

#### 第3层：降级处理

```typescript
// backend/src/services/mas/parsing/fallback.ts

/**
 * 降级问题生成器
 */
export class FallbackQuestionGenerator {
  /**
   * 根据训练数据生成通用问题
   */
  generateForWorkoutComplete(exercises: any[], userProfile?: any): any[] {
    const exerciseCount = exercises.length;
    const exerciseNames = exercises.map(e => e.name || e.exerciseId).filter(Boolean).slice(0, 3);

    const questions: any[] = [
      {
        id: 'overall_feeling',
        question: `本次 ${exerciseCount} 个动作的训练感觉如何？`,
        required: true,
        placeholder: '请描述你的训练感受...'
      }
    ];

    // 如果有具体的动作名称，添加针对性问题
    if (exerciseNames.length > 0) {
      questions.push({
        id: 'exercise_feeling',
        question: `${exerciseNames.join('、')} 这些动作的发力感受如何？`,
        required: false,
        placeholder: '比如：某个动作特别吃力或特别轻松...'
      });
    }

    // 根据健身水平调整问题
    if (userProfile?.fitnessLevel === 'beginner') {
      questions.push({
        id: 'difficulty_feedback',
        question: '有没有觉得特别困难或需要指导的地方？',
        required: false,
        placeholder: '可以描述具体动作或感受...'
      });
    } else {
      questions.push({
        id: 'progress_feedback',
        question: '相比以往训练，这次有什么不同的感受？',
        required: false,
        placeholder: '比如：重量、次数、体力状态等方面的变化...'
      });
    }

    return questions;
  }

  /**
   * 生成调研问题（首次使用）
   */
  generateForInitialSurvey(): any[] {
    return [
      {
        id: 'goal',
        question: '你的主要训练目标是？',
        required: true,
        options: [
          { label: '增肌', value: 'muscle_gain' },
          { label: '减脂', value: 'fat_loss' },
          { label: '增强力量', value: 'strength' },
          { label: '提高耐力', value: 'endurance' }
        ]
      },
      {
        id: 'level',
        question: '你目前的训练水平是？',
        required: true,
        options: [
          { label: '初学者', value: 'beginner' },
          { label: '中级', value: 'intermediate' },
          { label: '高级', value: 'advanced' }
        ]
      },
      {
        id: 'equipment',
        question: '你有哪些训练设备？',
        required: true,
        placeholder: '比如：哑铃、杠铃、健身房会员等...'
      }
    ];
  }
}
```

#### 集成使用

```typescript
// backend/src/services/mas/graph.ts (workout_complete 分支)

import { EnhancedLLMExtractor } from './parsing/enhancedExtract';
import { validateUIHint, validateAndFixQuestions } from './parsing/schemas';
import { FallbackQuestionGenerator } from './parsing/fallback';

// 在 workout_complete 处理中
if (state.scenario === 'workout_complete') {
  const extractor = new EnhancedLLMExtractor();
  const fallbackGenerator = new FallbackQuestionGenerator();

  try {
    // 1. 构建上下文...
    const context = buildWorkoutCompleteContext({...});

    // 2. 调用 LLM
    const response = await architectLLM.invoke([
      { role: 'system', content: workoutCompletePrompt }
    ]);

    // 3. 增强提取
    let responseText = extractTextContent(response);
    let jsonText = extractor.extractJSON(responseText);

    if (!jsonText) {
      throw new Error('无法从 LLM 响应中提取有效 JSON');
    }

    // 4. 解析并验证
    let parsedResult = JSON.parse(jsonText);
    const validation = validateUIHint(parsedResult.uiHint);

    if (!validation.success) {
      console.warn('[MAS] UIHint validation failed:', validation.error);

      // 尝试修复 questions
      if (parsedResult.uiHint?.data?.questions) {
        const questionsFix = validateAndFixQuestions(parsedResult.uiHint.data.questions);
        if (questionsFix.success) {
          parsedResult.uiHint.data.questions = questionsFix.questions;
        } else {
          throw new Error(`Questions validation failed: ${questionsFix.error}`);
        }
      } else {
        throw new Error(`Validation failed: ${validation.error}`);
      }
    }

    console.log(`[MAS] workout_complete: Generated ${parsedResult.uiHint.data.questions.length} questions`);
    return { uiHint: parsedResult.uiHint };

  } catch (error: any) {
    console.error('[MAS] workout_complete error:', error);

    // 降级：使用预定义问题
    const fallbackQuestions = fallbackGenerator.generateForWorkoutComplete(
      state.workoutFacts?.exercises || [],
      state.workoutFacts?.userProfile
    );

    return {
      uiHint: {
        type: 'SURVEY_CARD',
        data: {
          sessionId: state.sessionId,
          title: '补充训练信息',
          subtitle: '基于您的训练数据生成',
          questions: fallbackQuestions
        }
      }
    };
  }
}
```

---

## 5. 监控与测试

### 5.1 结构化日志

```typescript
// backend/src/services/mas/monitoring/parserMonitor.ts

export class ParserMonitor {
  private stats = {
    totalAttempts: 0,
    successfulParses: 0,
    fallbackUsed: 0,
    errors: new Map<string, number>()
  };

  recordAttempt(success: boolean, fallback: boolean, error?: string): void {
    this.stats.totalAttempts++;
    if (success) this.stats.successfulParses++;
    if (fallback) this.stats.fallbackUsed++;
    if (error) {
      const count = this.stats.errors.get(error) || 0;
      this.stats.errors.set(error, count + 1);
    }
  }

  getReport(): {
    successRate: number;
    fallbackRate: number;
    topErrors: Array<{ error: string; count: number }>;
  } {
    const successRate = this.stats.totalAttempts > 0
      ? this.stats.successfulParses / this.stats.totalAttempts
      : 0;

    const fallbackRate = this.stats.totalAttempts > 0
      ? this.stats.fallbackUsed / this.stats.totalAttempts
      : 0;

    const topErrors = Array.from(this.stats.errors.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { successRate, fallbackRate, topErrors };
  }
}
```

### 5.2 测试用例

```typescript
// tests/mas/parsing.test.ts

import { describe, it, expect } from 'vitest';
import { EnhancedLLMExtractor } from '@/services/mas/parsing/enhancedExtract';
import { validateUIHint } from '@/services/mas/parsing/schemas';

describe('MAS LLM Parsing', () => {
  const extractor = new EnhancedLLMExtractor();

  describe('JSON Extraction', () => {
    it('should extract pure JSON', () => {
      const text = '{"type": "SURVEY_CARD", "data": {...}}';
      expect(extractor.extractJSON(text)).toBeTruthy();
    });

    it('should extract from code block', () => {
      const text = '这是您的问题：\n```json\n{"type": "SURVEY_CARD"}\n```\n希望有帮助';
      expect(extractor.extractJSON(text)).toBeTruthy();
    });

    it('should repair single quotes', () => {
      const text = "{'type': 'SURVEY_CARD', 'data': {'questions': []}}";
      expect(extractor.extractJSON(text)).toBeTruthy();
    });

    it('should extract first object from mixed text', () => {
      const text = '好的 {\"type\": \"SURVEY_CARD\"} 还有一些其他内容...';
      const result = extractor.extractJSON(text);
      expect(result).toContain('SURVEY_CARD');
    });
  });

  describe('Schema Validation', () => {
    it('should validate correct SURVEY_CARD', () => {
      const data = {
        type: 'SURVEY_CARD',
        data: {
          questions: [
            { id: 'q1', question: 'Test?', required: true, placeholder: '...' }
          ]
        }
      };
      const result = validateUIHint(data);
      expect(result.success).toBe(true);
    });

    it('should reject questions without placeholder or options', () => {
      const data = {
        type: 'SURVEY_CARD',
        data: {
          questions: [
            { id: 'q1', question: 'Test?', required: true }
          ]
        }
      };
      const result = validateUIHint(data);
      expect(result.success).toBe(false);
    });

    it('should fix string array questions', () => {
      const questions = ['{"id": "q1", "question": "Test?", "placeholder": "..."}'];
      const result = validateAndFixQuestions(questions);
      expect(result.success).toBe(true);
    });
  });
});
```

---

## 6. 总结与建议

### 6.1 问题总结

| 风险类别 | 当前状态 | 建议 |
|---------|---------|------|
| JSON 解析 | 基础降级策略 | 实现多策略智能解析 |
| Schema 验证 | ❌ 缺失 | 立即添加 Zod 验证 |
| 降级处理 | 基础 fallback | 实现智能降级生成器 |
| 监控告警 | ❌ 缺失 | 添加解析成功率监控 |

### 6.2 实施优先级

**P0 - 立即实施**：
1. 添加 Schema 验证层
2. 实现增强 JSON 提取器
3. 添加智能降级处理

**P1 - 近期实施**：
1. 添加解析监控
2. 编写测试用例
3. 优化降级问题质量

**P2 - 长期优化**：
1. LLM Prompt 优化（减少格式问题）
2. 结构化输出工具切换（考虑其他方案）
3. 用户反馈收集

### 6.3 预期效果

实施上述方案后：
- **解析成功率**：从 ~90% 提升到 >99%
- **降级使用率**：从 ~10% 降到 <1%
- **用户体验**：稳定的问卷展示，无渲染失败

---

*本文档针对 MAS 系统 LLM 数据结构损坏问题，提供完整的分析与防护方案*
