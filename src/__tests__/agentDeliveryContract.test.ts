/**
 * #97 感受采集契约批单测（契约真源 shared/contracts）
 *
 * 覆盖（任务书验证门 4）：
 * 1. feel 字段边界值：0 / 100 合法，101 / -1 / 50.5 拒绝（无级原值禁分档 ≠ 禁小数——
 *    契约为 int 滑块原值，小数与越界同拒）
 * 2. 旧数据无 timestamp 的 normalize 推算：startTime + (组序+1) × 60s，单调不减
 * 3. 硬校验拒绝：缺字段样本（timestamp / name / session_id）/ 坏引用样本
 *    （exercise_id 不在动作库全集）
 * 4. 存量兼容读取：weight_only 漂移类型、UPPERCASE status、completed 布尔、
 *    completedAt 缺失全部归一成功且语义不破坏
 * 5. 关系引用完整性：组序号连续、组时间戳非倒序
 * 6. 门卫助手：单条坏数据扣下不炸整批，拒付原因上浮
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_SET_TIMESTAMP_STEP_MS,
  AgentDeliveryError,
  ExerciseSetEntrySchema,
  gateSessionsForAgentDelivery,
  inferSetTimestampMs,
  normalizeAndValidateAgentSession,
  normalizeSessionForAgentDelivery,
  validateAgentSessionDelivery,
} from 'shared/contracts';

// ---------------------------------------------------------------------------
// 测试素材：贴近 sessions.raw_json 真实存量形态（legacy Session）
// ---------------------------------------------------------------------------

const START_MS = 1790775300000; // 2026-09-29T14:15:00Z 附近（固定值，推算可断言）

const legacySet = (over: Record<string, unknown> = {}) => ({
  id: 'set-id-1',
  reps: 8,
  weight: 60,
  rpe: 7,
  completed: true,
  ...over,
});

const legacySession = (over: Record<string, unknown> = {}) => ({
  id: '3f2b8c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  startTime: START_MS,
  endTime: START_MS + 55 * 60_000,
  status: 'finished',
  exercises: [
    {
      id: 'V1StGXR8_Z5jdHi6B-myT', // 动作库 NanoID 引用
      libraryId: 'V1StGXR8_Z5jdHi6B-myT',
      name: '深蹲',
      type: 'resistance',
      sets: [legacySet(), legacySet({ id: 'set-id-2' })],
    },
  ],
  ...over,
});

// ---------------------------------------------------------------------------
// 1. feel 字段边界值
// ---------------------------------------------------------------------------

describe('#97 契约：feel / feel_note 字段边界', () => {
  const baseSet = {
    index: 0,
    status: 'completed',
    timestamp: '2026-09-30T14:20:31Z',
  };

  it.each([0, 100])('feel=%s 合法（闭区间端点原值）', (feel) => {
    expect(() => ExerciseSetEntrySchema.parse({ ...baseSet, feel })).not.toThrow();
  });

  it.each([101, -1])('feel=%s 拒绝（越界）', (feel) => {
    expect(ExerciseSetEntrySchema.safeParse({ ...baseSet, feel }).success).toBe(false);
  });

  it('feel=50.5 拒绝（滑块原值为整数刻度，非整数即坏数据）', () => {
    expect(ExerciseSetEntrySchema.safeParse({ ...baseSet, feel: 50.5 }).success).toBe(false);
  });

  it('feel_note=500 字符合法、501 字符拒绝', () => {
    const ok = 'a'.repeat(500);
    const bad = 'a'.repeat(501);
    expect(() => ExerciseSetEntrySchema.parse({ ...baseSet, feel_note: ok })).not.toThrow();
    expect(ExerciseSetEntrySchema.safeParse({ ...baseSet, feel_note: bad }).success).toBe(false);
  });

  it('timestamp 必填化：缺 timestamp 的组直接被契约拒绝（绕过 normalize 即坏数据）', () => {
    const { timestamp: _drop, ...withoutTs } = baseSet;
    expect(ExerciseSetEntrySchema.safeParse(withoutTs).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. 旧数据无 timestamp 的 normalize 推算
// ---------------------------------------------------------------------------

describe('#97 契约：存量无 timestamp 推算填充', () => {
  it('推算规则：timestamp = startTime + (组序+1) × 60s，ISO 8601 输出', () => {
    const session = legacySession({
      exercises: [
        {
          id: 'ex-nanoid-1',
          name: '深蹲',
          type: 'resistance',
          // 存量形态：无 completedAt、无 timestamp（老版本 App 数据）
          sets: [{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }, { reps: 6, weight: 60 }],
        },
      ],
    });
    const normalized = normalizeSessionForAgentDelivery(session);
    const sets = normalized.exercises[0].sets;
    expect(sets).toHaveLength(3);
    sets.forEach((s, i) => {
      expect(s.timestamp).toBe(new Date(inferSetTimestampMs(i, START_MS)).toISOString());
      expect(s.index).toBe(i);
    });
    // 推算锚点间距恒等于 60s 默认休息节奏
    const gap0 = Date.parse(sets[1].timestamp) - Date.parse(sets[0].timestamp);
    expect(gap0).toBe(AGENT_SET_TIMESTAMP_STEP_MS);
  });

  it('有 completedAt 的组用实测值，不推算（禁虚构替换实测）', () => {
    const realMs = START_MS + 3 * 60_000;
    const session = legacySession({
      exercises: [
        {
          id: 'ex-nanoid-1',
          name: '深蹲',
          type: 'resistance',
          sets: [{ reps: 8, completedAt: realMs }, { reps: 8 }],
        },
      ],
    });
    const sets = normalizeSessionForAgentDelivery(session).exercises[0].sets;
    expect(sets[0].timestamp).toBe(new Date(realMs).toISOString());
    expect(sets[1].timestamp).toBe(new Date(inferSetTimestampMs(1, START_MS)).toISOString());
  });

  it('completedAt 存在但不可解析 → 拒付（坏数据 ≠ 缺失）', () => {
    const session = legacySession({
      exercises: [
        {
          id: 'ex-nanoid-1',
          name: '深蹲',
          type: 'resistance',
          sets: [{ reps: 8, completedAt: 'not-a-time' }],
        },
      ],
    });
    expect(() => normalizeSessionForAgentDelivery(session)).toThrow(AgentDeliveryError);
  });

  it('显式 ISO timestamp 优先级最高', () => {
    const iso = '2026-09-28T10:00:00Z';
    const session = legacySession({
      exercises: [
        {
          id: 'ex-nanoid-1',
          name: '深蹲',
          type: 'resistance',
          sets: [{ reps: 8, timestamp: iso, completedAt: START_MS + 9 * 60_000 }],
        },
      ],
    });
    const sets = normalizeSessionForAgentDelivery(session).exercises[0].sets;
    // 输出统一规范化为 toISOString 形态（.000 毫秒段），语义等价
    expect(sets[0].timestamp).toBe(new Date(iso).toISOString());
    expect(Date.parse(sets[0].timestamp)).toBe(Date.parse(iso));
  });
});

// ---------------------------------------------------------------------------
// 3 + 5. 硬校验拒绝样本（缺字段 / 坏引用 / 序号 / 倒序）
// ---------------------------------------------------------------------------

describe('#97 契约：交付硬校验拒绝', () => {
  const knownIds = new Set(['V1StGXR8_Z5jdHi6B-myT', 'ex-cardio-2']);

  const validNormalized = () =>
    normalizeSessionForAgentDelivery(
      legacySession({
        exercises: [
          {
            id: 'V1StGXR8_Z5jdHi6B-myT',
            name: '深蹲',
            type: 'resistance',
            sets: [
              { reps: 8, completedAt: START_MS + 60_000 },
              { reps: 8, completedAt: START_MS + 180_000, feel: 55 },
            ],
          },
        ],
      }),
    );

  it('合法样本过门（含 feel）', () => {
    const s = validNormalized();
    expect(() => validateAgentSessionDelivery(s, { knownExerciseIds: knownIds })).not.toThrow();
    expect(s.exercises[0].sets[1].feel).toBe(55);
  });

  it('缺字段样本：组缺 timestamp → schema 拒', () => {
    const bad = validNormalized();
    delete (bad.exercises[0].sets[0] as { timestamp?: string }).timestamp;
    expect(() => validateAgentSessionDelivery(bad)).toThrow(/timestamp/);
  });

  it('缺字段样本：会话缺 session_id → schema 拒', () => {
    const bad = validNormalized() as unknown as Record<string, unknown>;
    delete bad.session_id;
    expect(() => validateAgentSessionDelivery(bad)).toThrow(AgentDeliveryError);
  });

  it('缺字段样本：动作缺 name → normalize 即拒（unnormalizable）', () => {
    const session = legacySession({
      exercises: [{ id: 'V1StGXR8_Z5jdHi6B-myT', type: 'resistance', sets: [] }],
    });
    expect(() => normalizeAndValidateAgentSession(session)).toThrow(/name/);
  });

  it('坏引用样本：exercise_id 不在动作库全集 → reference 拒', () => {
    const session = legacySession({
      exercises: [
        { id: 'ghost-id-not-in-library', name: '幽灵动作', type: 'resistance', sets: [] },
      ],
    });
    try {
      normalizeAndValidateAgentSession(session, { knownExerciseIds: knownIds });
      expect.unreachable('坏引用必须拒付');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentDeliveryError);
      expect((err as AgentDeliveryError).code).toBe('reference');
      expect((err as AgentDeliveryError).message).toContain('ghost-id-not-in-library');
    }
  });

  it('坏引用样本：动作缺 id/libraryId/exerciseId → unnormalizable 拒', () => {
    const session = legacySession({
      exercises: [{ name: '无身份动作', type: 'resistance', sets: [] }],
    });
    try {
      normalizeAndValidateAgentSession(session);
      expect.unreachable('缺身份必须拒付');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentDeliveryError);
      expect((err as AgentDeliveryError).code).toBe('unnormalizable');
    }
  });

  it('组序号不连续 → set_indices 拒', () => {
    const bad = validNormalized();
    (bad.exercises[0].sets[1] as { index: number }).index = 5;
    try {
      validateAgentSessionDelivery(bad);
      expect.unreachable('序号断裂必须拒付');
    } catch (err) {
      expect((err as AgentDeliveryError).code).toBe('set_indices');
    }
  });

  it('组时间戳倒序 → timestamp_order 拒', () => {
    const bad = validNormalized();
    (bad.exercises[0].sets[1] as { timestamp: string }).timestamp =
      new Date(START_MS).toISOString(); // 早于 set[0]
    try {
      validateAgentSessionDelivery(bad);
      expect.unreachable('倒序必须拒付');
    } catch (err) {
      expect((err as AgentDeliveryError).code).toBe('timestamp_order');
    }
  });

  it('实测 + 推算混排可产生倒序 → 硬校验扣下（不放行也不篡改实测值）', () => {
    const session = legacySession({
      exercises: [
        {
          id: 'V1StGXR8_Z5jdHi6B-myT',
          name: '深蹲',
          type: 'resistance',
          sets: [{ reps: 8 }, { reps: 8 }, { reps: 8, completedAt: START_MS + 10 * 60_000 }, { reps: 8 }],
        },
      ],
    });
    // set[2] 实测 10min，set[3] 推算 = start+4min → 倒序。硬校验不重排、不夹逼，
    // 直接拒付（坏序 = 坏数据；重排在 normalize 层做会掩盖真实数据问题）。
    const normalized = normalizeSessionForAgentDelivery(session);
    try {
      validateAgentSessionDelivery(normalized);
      expect.unreachable('实测+推算混排倒序必须拒付');
    } catch (err) {
      expect((err as AgentDeliveryError).code).toBe('timestamp_order');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. 存量兼容读取
// ---------------------------------------------------------------------------

describe('#97 契约：存量兼容读取（禁破坏存量语义）', () => {
  it('weight_only 漂移类型 / UPPERCASE status / completed 布尔全部归一', () => {
    const session = legacySession({
      exercises: [
        {
          id: 'ex-legacy-1',
          name: '硬拉',
          type: 'weight_only', // legacy.ts 历史漂移值
          sets: [
            { reps: 3, weight: 100, status: 'COMPLETED' },
            { reps: 3, weight: 100, status: 'PLANNED' },
            { reps: 3, weight: 100, status: 'SKIPPED' },
            { reps: 3, weight: 100 }, // 无 status，无 completed → unknown
          ],
        },
      ],
    });
    const s = normalizeAndValidateAgentSession(session);
    expect(s.exercises[0].type).toBe('heavy_weight'); // weight_only → heavy_weight（分册1 对照表）
    const statuses = s.exercises[0].sets.map((x) => x.status);
    expect(statuses).toEqual(['completed', 'planned', 'skipped', 'unknown']);
  });

  it('非契约字段透传保留（heartRate / primaryMuscles 等不丢）', () => {
    const session = legacySession({
      exercises: [
        {
          id: 'ex-keep-1',
          name: '深蹲',
          type: 'resistance',
          primaryMuscles: ['quadriceps'],
          sets: [{ reps: 8, heartRate: 138, completedAt: START_MS + 60_000 }],
        },
      ],
    });
    const s = normalizeAndValidateAgentSession(session);
    expect((s.exercises[0] as Record<string, unknown>).primaryMuscles).toEqual(['quadriceps']);
    expect((s.exercises[0].sets[0] as Record<string, unknown>).heartRate).toBe(138);
  });

  it('feel / feel_note 原样随组流转（采集 UI 批写入后即端到端可见）', () => {
    const session = legacySession({
      exercises: [
        {
          id: 'ex-feel-1',
          name: '深蹲',
          type: 'resistance',
          sets: [
            { reps: 8, completedAt: START_MS + 60_000, feel: 72, feel_note: '状态很好' },
          ],
        },
      ],
    });
    const s = normalizeAndValidateAgentSession(session);
    expect(s.exercises[0].sets[0].feel).toBe(72);
    expect(s.exercises[0].sets[0].feel_note).toBe('状态很好');
  });

  it('raw_json 字符串形态可解析（legacy 字符串行兼容）', () => {
    const s = normalizeAndValidateAgentSession(JSON.stringify(legacySession()));
    expect(s.session_id).toBe('3f2b8c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d');
  });

  it('ISO startTime / start_time 键形态可解析（协议形态行兼容）', () => {
    const s = normalizeAndValidateAgentSession({
      session_id: '3f2b8c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      start_time: new Date(START_MS).toISOString(),
      exercises: [],
    });
    expect(s.start_time).toBe(new Date(START_MS).toISOString());
  });
});

// ---------------------------------------------------------------------------
// 6. 门卫助手（load_history 接线语义）
// ---------------------------------------------------------------------------

describe('#97 契约：批量门卫', () => {
  const knownIds = new Set(['V1StGXR8_Z5jdHi6B-myT']);

  it('单条坏数据扣下不炸整批，拒付原因上浮（不静默）', () => {
    const rows = [
      { raw_json: legacySession() },
      { raw_json: { broken: true } }, // 无 id / 无 startTime
      {
        raw_json: legacySession({
          id: 'another-session-uuid',
          exercises: [
            { id: 'ghost', name: '幽灵', type: 'resistance', sets: [] },
          ],
        }),
      },
    ];
    const gate = gateSessionsForAgentDelivery(rows, { knownExerciseIds: knownIds });
    expect(gate.delivered).toHaveLength(1);
    expect(gate.delivered[0].session_id).toBe('3f2b8c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d');
    expect(gate.rejected).toHaveLength(2);
    expect(gate.rejected.map((r) => r.code)).toEqual(['unnormalizable', 'reference']);
    expect(gate.rejected[1].session_id).toBe('another-session-uuid');
  });

  it('不传 knownExerciseIds = 只做结构校验（引用检查显式opt-in）', () => {
    const rows = [
      {
        raw_json: legacySession({
          exercises: [{ id: 'ghost', name: '幽灵', type: 'resistance', sets: [] }],
        }),
      },
    ];
    const gate = gateSessionsForAgentDelivery(rows);
    expect(gate.delivered).toHaveLength(1);
    expect(gate.rejected).toHaveLength(0);
  });
});
