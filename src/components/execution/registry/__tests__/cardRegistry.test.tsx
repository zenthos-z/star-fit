/**
 * #88 分册3 插件注册 API 测试 —— register(cardType, component, spec)。
 *
 * 覆盖（任务书验证门 2）：
 *   1. validateCardSpec 纯函数：spec 契约对拍（必需字段 ⊆ ExerciseSetEntrySchema、
 *      uiHint 允许键与 uiHintValidator 一致、cardType 真源枚举、域交叉规则）
 *   2. register 注册面（fresh 模块实例）：正常注册 / 重复注册报错 / 非法
 *      cardType 报错 / spec 契约不符报错 / 坏组件报错 / lazy 组件可注册
 *   3. 装配等价性：迁移前 ExerciseRenderer PluginRegistry 16 键快照逐一
 *      对拍（组件身份恒等；户外卡三键共用同一 lazy 产物并验其真身模块）
 *   4. 键域/细类覆盖完整性：CARD_TYPE_VALUES 全注册、10 细类恰好一卡覆盖、
 *      裸值派生（细类/hiit/UNKNOWN/存量旧值）
 *   5. 未注册分发显式错误（渲染级）：可见错误卡 + console.error 指向「去注册」，
 *      禁静默 StandardCard JSON 兜底
 *   6. registerRemote 预留未实现
 *   7. 真源 guard：AI 卡键域 / uiHint.data 允许键真值表 / SSE 可达键闭环
 *      与 backend uiHintSchemas 逐字对拍（后端契约漂移即红）
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// 装配（副作用：现有卡片全量注册）+ 注册表 + spec 校验
import '../assembleCards';
import {
  register,
  resolveCard,
  getRegisteredCardTypes,
  registerRemote,
} from '../cardRegistry';
import {
  validateCardSpec,
  UI_HINT_DATA_KEYS,
  AI_CARD_TYPES,
  actionTypeToCardType,
} from '../cardSpec';
import { ExerciseRenderer } from '../../ExerciseRenderer';

// 等价性对拍锚点：迁移前 PluginRegistry（ExerciseRenderer.tsx c79da55）的组件身份
import { ResistanceCard } from '../../plugins/ResistanceCard';
import { CardioCard } from '../../plugins/CardioCard';
import { RunningCard } from '../../plugins/RunningCard';
import { IsometricCard } from '../../plugins/IsometricCard';
import { PlanCard } from '../../cards/PlanCard';
import { WeeklyPlanCard } from '../../cards/WeeklyPlanCard';
import { SummaryCard } from '../../cards/SummaryCard';
import { SurveyCard } from '../../cards/SurveyCard';
import { SurveySuccessCard } from '../../cards/SurveySuccessCard';
import { AuditCompleteCard } from '../../cards/AuditCompleteCard';
import { HitlConfirmCard } from '../../cards/HitlConfirmCard';
import { ProfileUpdateConfirmCard } from '../../cards/ProfileUpdateConfirmCard';
import { StandardCard } from '../../cards/StandardCard';

// 真源：shared/contracts + backend 校验 schema（后端契约漂移即红）
import {
  CARD_TYPE_VALUES,
  EXERCISE_TYPE_VALUES,
  UiHintCardSchema,
  WeeklyPlanCardDataSchema,
  cardTypeForExerciseType,
  type UiHintCard,
} from 'shared/contracts';
import {
  UIHintTypeEnum,
  ExercisePlanSchema,
  SurveyCardDataSchema,
  SummaryCardDataSchema,
  DeviationCardDataSchema,
  AuditCompleteDataSchema,
  ProfileUpdateConfirmDataSchema,
} from '../../../../../backend/src/services/agent/schemas/uiHintSchemas';
import { synthesizeUiHint } from '../../../../services/agent/sseAgentClient';

// PlanCard 渲染冒烟所需挂桩（与 debugPanels.test 同款）
vi.mock('../../../../lib/nativeHaptics', () => ({ haptic: vi.fn() }));
vi.mock('../../../../hooks/useExerciseLibraryIndex', () => ({
  useExerciseLibraryIndex: () => ({ byId: new Map(), byName: new Map() }),
}));

const DummyCard: React.FC<any> = () => <div data-testid="dummy-card" />;

// ============================================================================
// 1. validateCardSpec 纯函数（spec 契约对拍）
// ============================================================================

describe('validateCardSpec · spec 契约对拍（纯函数）', () => {
  it('合法运动卡 spec：无问题', () => {
    expect(
      validateCardSpec('resistance_standard', {
        interactionMode: 'active',
        requiredSetFields: ['reps', 'weight', 'timestamp'],
        fineTypes: ['resistance'],
      }),
    ).toEqual([]);
  });

  it('合法 AI 卡 spec（uiHintDataKeys 与真值表逐字一致）：无问题', () => {
    expect(
      validateCardSpec('summary_card', {
        interactionMode: 'passive',
        uiHintDataKeys: ['title', 'summary', 'highlights', 'metrics'],
      }),
    ).toEqual([]);
  });

  it('cardType 域外 → 真源枚举问题', () => {
    const problems = validateCardSpec('not_a_real_type', {
      interactionMode: 'active',
      requiredSetFields: ['reps'],
    });
    expect(problems.join('\n')).toContain('不在真源枚举内');
  });

  it('运动卡 requiredSetFields 越界键 → ExerciseSetEntrySchema 契约对拍失败', () => {
    const problems = validateCardSpec('cardio_running', {
      interactionMode: 'active',
      requiredSetFields: ['duration', 'notAContractField'],
    });
    expect(problems.join('\n')).toContain('notAContractField');
    expect(problems.join('\n')).toContain('ExerciseSetEntrySchema');
  });

  it('AI 卡 uiHintDataKeys 缺键/多键 → 与 uiHintValidator 允许键不一致', () => {
    const missing = validateCardSpec('survey_card', {
      interactionMode: 'passive',
      uiHintDataKeys: ['title', 'message'], // 缺 sessionId/subtitle/questions
    });
    expect(missing.join('\n')).toContain('缺键');
    expect(missing.join('\n')).toContain('questions');

    const extra = validateCardSpec('summary_card', {
      interactionMode: 'passive',
      uiHintDataKeys: [...UI_HINT_DATA_KEYS.summary_card, 'privateExtension'],
    });
    expect(extra.join('\n')).toContain('多键');
    expect(extra.join('\n')).toContain('privateExtension');
  });

  it('AI 卡漏答 uiHintDataKeys → 必答项问题', () => {
    const problems = validateCardSpec('audit_complete', { interactionMode: 'passive' });
    expect(problems.join('\n')).toContain('必须声明 uiHintDataKeys');
  });

  it('域交叉：运动卡禁 uiHintDataKeys / AI 卡禁 requiredSetFields 与 fineTypes', () => {
    expect(
      validateCardSpec('resistance_standard', {
        interactionMode: 'active',
        requiredSetFields: ['reps'],
        uiHintDataKeys: ['any'],
      }).join('\n'),
    ).toContain('运动卡不声明 uiHintDataKeys');

    expect(
      validateCardSpec('plan_card', {
        interactionMode: 'passive',
        uiHintDataKeys: UI_HINT_DATA_KEYS.plan_card,
        requiredSetFields: ['reps'],
        fineTypes: ['resistance'],
      }).join('\n'),
    ).toContain('AI 卡不声明 requiredSetFields');
  });

  it('fineTypes 越界细类 → EXERCISE_TYPE_VALUES 真源问题', () => {
    const problems = validateCardSpec('isometric_static', {
      interactionMode: 'active',
      requiredSetFields: ['duration'],
      fineTypes: ['madeup_type'],
    });
    expect(problems.join('\n')).toContain('EXERCISE_TYPE_VALUES');
  });

  it('interactionMode 非法值（JS 调用方）→ 必答项问题', () => {
    const problems = validateCardSpec('unknown', {
      interactionMode: 'sometimes' as never,
    });
    expect(problems.join('\n')).toContain('interactionMode');
  });
});

// ============================================================================
// 2. register 注册面（fresh 注册表实例，不污染装配态）
// ============================================================================

describe('register 注册面（fresh 模块实例）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const freshRegistry = async () => {
    const mod = await import('../cardRegistry');
    return mod;
  };

  it('正常注册：合法 spec 进表、可解析、spec 可回读', async () => {
    const { register: reg, resolveCard: resolve, getCardSpec } = await freshRegistry();
    // 用当前无组件的 deviation_card 演示「补 DeviationCard 后照此注册即闭环」
    reg('deviation_card', DummyCard, {
      interactionMode: 'passive',
      uiHintDataKeys: UI_HINT_DATA_KEYS.deviation_card,
    });
    expect(resolve('deviation_card')?.component).toBe(DummyCard);
    expect(getCardSpec('deviation_card')?.interactionMode).toBe('passive');
  });

  it('重复注册 → 启动即抛错（禁覆盖双写）', async () => {
    const { register: reg } = await freshRegistry();
    reg('stretch_standard', DummyCard, { interactionMode: 'active', requiredSetFields: ['timestamp'] });
    // 注：fresh 实例的 Error 类与静态导入的类不同源，用错误名 + 文案断言
    let caught: Error | undefined;
    try {
      reg('stretch_standard', DummyCard, { interactionMode: 'active', requiredSetFields: ['timestamp'] });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.name).toBe('CardRegistrationError');
    expect(caught?.message).toMatch(/重复注册/);
  });

  it('非法 cardType → 真源枚举外即抛错', async () => {
    const { register: reg } = await freshRegistry();
    expect(() => reg('push_up_card', DummyCard, { interactionMode: 'active' })).toThrow(
      /不在真源枚举内/,
    );
  });

  it('spec 契约不符 → 注册时抛错（requiredSetFields 编造字段）', async () => {
    const { register: reg } = await freshRegistry();
    expect(() =>
      reg('cardio_running', DummyCard, {
        interactionMode: 'active',
        requiredSetFields: ['bogus_field'],
      }),
    ).toThrow(/ExerciseSetEntrySchema/);
  });

  it('spec 契约不符 → 注册时抛错（uiHintDataKeys 与 uiHintValidator 不一致）', async () => {
    const { register: reg } = await freshRegistry();
    expect(() =>
      reg('plan_card', DummyCard, {
        interactionMode: 'passive',
        uiHintDataKeys: ['exerciseId', 'name'], // 缺 6 个契约键
      }),
    ).toThrow(/缺键/);
  });

  it('component 非组件 → 注册时抛错', async () => {
    const { register: reg } = await freshRegistry();
    expect(() =>
      reg('hiit_timer', 'not-a-component' as never, { interactionMode: 'active' }),
    ).toThrow(/必须是 React 组件/);
  });

  it('lazy 组件可注册（户外卡同款形态）', async () => {
    const { register: reg, resolveCard: resolve } = await freshRegistry();
    const LazyDummy = React.lazy(async () => ({ default: DummyCard }));
    reg('deviation_card', LazyDummy, {
      interactionMode: 'passive',
      uiHintDataKeys: UI_HINT_DATA_KEYS.deviation_card,
    });
    expect(resolve('deviation_card')?.component).toBe(LazyDummy);
  });
});

// ============================================================================
// 3. 装配等价性（迁移前后分发对拍）
// ============================================================================

/**
 * 迁移前 PluginRegistry 快照（ExerciseRenderer.tsx @ c79da55，分册3 删除前）。
 * 逐键断言注册表解析结果与迁移前组件身份恒等——props 透传未动，
 * 组件恒等 ⟹ 渲染结果一致。
 */
const LEGACY_PLUGIN_REGISTRY: ReadonlyArray<{ key: string; component: unknown }> = [
  // 运动类型卡片
  { key: 'resistance_standard', component: ResistanceCard },
  { key: 'cardio_running', component: RunningCard },
  { key: 'isometric_static', component: IsometricCard },
  { key: 'hiit_timer', component: CardioCard },
  // AI Coach 卡片
  { key: 'plan_card', component: PlanCard },
  { key: 'weekly_plan', component: WeeklyPlanCard },
  { key: 'survey_card', component: SurveyCard },
  { key: 'summary_card', component: SummaryCard },
  { key: 'survey_success', component: SurveySuccessCard },
  { key: 'audit_complete', component: AuditCompleteCard },
  { key: 'hitl_confirm', component: HitlConfirmCard },
  { key: 'profile_update_confirm', component: ProfileUpdateConfirmCard },
  // 错误兜底（迁移后 = 显式注册的哨兵卡，非静默兜底）
  { key: 'skeleton', component: StandardCard },
  { key: 'unknown', component: StandardCard },
];

describe('装配等价性 · 迁移前后分发对拍（PluginRegistry 16 键全量）', () => {
  it.each(LEGACY_PLUGIN_REGISTRY)('$key → 组件身份与迁移前恒等', ({ key, component }) => {
    const entry = resolveCard(key);
    expect(entry, `cardType "${key}" 必须可解析（装配文件漏注册？）`).toBeDefined();
    expect(entry!.component).toBe(component);
  });

  it('户外卡三键（cardio_outdoor/running_gps/outdoor_gps）共用同一 lazy 组件', () => {
    const lazy = resolveCard('cardio_outdoor')?.component as any;
    expect(resolveCard('running_gps')?.component).toBe(lazy);
    expect(resolveCard('outdoor_gps')?.component).toBe(lazy);
    // lazy 真身：工厂加载的是真实 OutdoorExerciseCardV2 模块（与迁移前同款装配）
    expect(lazy.$$typeof).toBe(Symbol.for('react.lazy'));
  });

  it('户外卡 lazy 工厂解析出真实 OutdoorExerciseCardV2 模块', async () => {
    const lazy = resolveCard('running_gps')?.component as any;
    // lazy ctor 位置随 React 版本浮动（19 未初始化在 _payload._result、
    // ≤18 在 _payload._value）——本测试不先渲染户外卡，状态必为未初始化
    const payload = lazy._payload;
    const load =
      typeof payload === 'function'
        ? payload
        : typeof payload._result === 'function'
          ? payload._result
          : payload._value;
    const mod = await load();
    // 装配的 ctor 是 import(...).then(m => ({ default: m.OutdoorExerciseCardV2 }))
    // ——解析产物即真实户外卡组件本体
    expect(typeof mod.default).toBe('function');
    // 导出名带 memo/forwardRef 包装时 fn.name 取内层组件名，前缀断言即可
    expect(String(mod.default.name)).toContain('OutdoorExerciseCardV2');
  });

  it('新增标准键补齐：CARD_TYPE_VALUES 6 键全部可解析', () => {
    for (const key of CARD_TYPE_VALUES) {
      expect(resolveCard(key), `标准键 "${key}" 未注册`).toBeDefined();
    }
  });
});

// ============================================================================
// 4. 键域与细类覆盖完整性
// ============================================================================

describe('键域与细类覆盖完整性', () => {
  it('注册表卡片清单 = 18 键（运动卡 8 + AI 卡 8 + 哨兵 2），快照锁定', () => {
    expect([...getRegisteredCardTypes()].sort()).toEqual(
      [
        // 运动卡：6 标准键 + cardio_outdoor 的 2 个存量别名
        'resistance_standard',
        'cardio_running',
        'cardio_outdoor',
        'running_gps',
        'outdoor_gps',
        'isometric_static',
        'hiit_timer',
        'stretch_standard',
        // AI 卡（deviation_card 无组件，显式未注册——见「未注册分发」组）
        'plan_card',
        'weekly_plan',
        'summary_card',
        'survey_card',
        'survey_success',
        'audit_complete',
        'hitl_confirm',
        'profile_update_confirm',
        // 哨兵
        'skeleton',
        'unknown',
      ].sort(),
    );
  });

  it('10 细类恰好被一张运动卡覆盖（fineTypes 无缺口无重叠）', () => {
    const registered = getRegisteredCardTypes();
    for (const fine of EXERCISE_TYPE_VALUES) {
      const covering = registered.filter((key) => {
        const spec = resolveCard(key)?.spec;
        return spec?.fineTypes?.includes(fine) ?? false;
      });
      expect(
        covering,
        `细类 "${fine}" 应恰好被 1 张卡覆盖（实际 ${covering.length}: ${covering.join(',')}）`,
      ).toHaveLength(1);
      // 裸细类分发 = 真源派生标准卡（cardTypeForExerciseType 唯一映射）
      expect(resolveCard(fine)?.component).toBe(
        resolveCard(cardTypeForExerciseType(fine))?.component,
      );
    }
  });

  it('裸值派生：动作类型/存量旧值/哨兵经真源映射解析', () => {
    expect(actionTypeToCardType('resistance')).toBe('resistance_standard');
    expect(actionTypeToCardType('outdoor')).toBe('cardio_outdoor');
    expect(actionTypeToCardType('hiit')).toBe('hiit_timer');
    expect(actionTypeToCardType('strength')).toBe('resistance_standard'); // 存量旧值（LEGACY 别名）
    expect(actionTypeToCardType('UNKNOWN')).toBeUndefined(); // 无法归一 = 显式错误，禁编造
    expect(resolveCard('hiit')?.component).toBe(resolveCard('hiit_timer')?.component);
    expect(resolveCard('UNKNOWN')?.component).toBe(StandardCard); // 大写哨兵 → unknown 卡
    expect(resolveCard(undefined)).toBeUndefined();
    expect(resolveCard('garbage_type')).toBeUndefined();
  });
});

// ============================================================================
// 5. 未注册分发 · 显式错误（渲染级，红线2 不兜底）
// ============================================================================

describe('未注册分发 · 显式错误卡（禁静默 StandardCard 兜底）', () => {
  it('未注册 cardType → 可见错误卡 + console.error 指向「去注册」，无 JSON 兜底渲染', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <ExerciseRenderer uiHint={{ type: 'deviation_card', data: { reason: 'x', suggestion: 'y' } }} />,
    );
    const errorCard = screen.getByTestId('unregistered-card-error');
    expect(errorCard).toHaveTextContent('deviation_card');
    expect(errorCard).toHaveTextContent('register');
    // 红线2：不静默降级为 StandardCard 的 JSON 直渲染
    expect(container.querySelector('pre')).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('未注册的 cardType'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('assembleCards.ts'));
    errSpy.mockRestore();
  });

  it('已注册 AI 卡经渲染器正常出卡（分发链端到端冒烟：plan_card → PlanCard）', () => {
    render(
      <ExerciseRenderer
        uiHint={{
          type: 'plan_card',
          data: [
            {
              exerciseId: 'V1StGXR8_Z5jdHi6B-myT',
              name: '深蹲',
              exercise_type: 'resistance',
              sets: 4,
              reps: 8,
              weight: 60,
            },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('plan-card')).toBeInTheDocument();
    expect(screen.getByText('深蹲')).toBeInTheDocument();
  });

  it('SSE 合成键缺口清单锁定（新卡型未注册即红）', () => {
    // SSE UiHintCard 契约类型 → CARD_TYPE_TO_LEGACY 合成键；已注册或显式入缺口清单
    const KNOWN_UNCOVERED_SSE_KEYS = ['instruction_card', 'deviation_confirmation', 'unknown_card'];
    const uiHintCardTypes = (UiHintCardSchema.shape.type as { unwrap: () => { options: string[] } })
      .unwrap()
      .options;
    for (const t of uiHintCardTypes) {
      const key = synthesizeUiHint({ type: t, data: {}, priority: 0 } as UiHintCard)!.type;
      const covered = resolveCard(key) !== undefined;
      if (!covered) {
        expect(
          KNOWN_UNCOVERED_SSE_KEYS,
          `SSE 可达键 "${key}"（UiHintCard.type=${t}）既未注册也不在缺口清单——新卡型必须 register 或显式记缺口`,
        ).toContain(key);
      }
    }
    // 缺口清单三键当前确实未注册（补组件后从这里挪进装配文件）
    for (const key of KNOWN_UNCOVERED_SSE_KEYS) {
      expect(resolveCard(key)).toBeUndefined();
    }
  });
});

// ============================================================================
// 6. registerRemote · 运行时留口（预留未实现）
// ============================================================================

describe('registerRemote · 运行时插件留口', () => {
  it('本批不实现网络加载：调用即抛「未实现」并指向编译时注册', async () => {
    await expect(registerRemote('https://example.com/cards/stretch.js')).rejects.toThrow(
      /未实现/,
    );
  });
});

// ============================================================================
// 7. 真源 guard · uiHintValidator 键域对拍（后端契约漂移即红）
// ============================================================================

describe('真源 guard · AI 卡键域与 uiHint.data 允许键对拍 backend uiHintSchemas', () => {
  it('AI_CARD_TYPES 与后端 UIHintTypeEnum 一致（+前端专属卡 2 枚）', () => {
    const backend: readonly string[] = UIHintTypeEnum.options;
    for (const t of backend) {
      expect(AI_CARD_TYPES, `后端卡型 "${t}" 必须在 AI_CARD_TYPES 键域内`).toContain(t);
    }
    const frontendOnly = (AI_CARD_TYPES as readonly string[]).filter(
      (t) => !backend.includes(t),
    );
    expect(frontendOnly.sort()).toEqual(['hitl_confirm', 'survey_success']);
  });

  it.each([
    ['plan_card', ExercisePlanSchema], // data = 行数组，此处为行内允许键
    ['survey_card', SurveyCardDataSchema],
    ['summary_card', SummaryCardDataSchema],
    ['deviation_card', DeviationCardDataSchema],
    ['audit_complete', AuditCompleteDataSchema],
    ['profile_update_confirm', ProfileUpdateConfirmDataSchema],
  ])('UI_HINT_DATA_KEYS.%s === backend schema 允许键（逐字一致）', (type, schema) => {
    const truth = Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();
    expect([...UI_HINT_DATA_KEYS[type]].sort()).toEqual(truth);
  });

  it('weekly_plan 允许键 === shared/contracts WeeklyPlanCardDataSchema（契约真源）', () => {
    expect([...UI_HINT_DATA_KEYS.weekly_plan].sort()).toEqual(
      Object.keys(WeeklyPlanCardDataSchema.shape).sort(),
    );
  });
});
