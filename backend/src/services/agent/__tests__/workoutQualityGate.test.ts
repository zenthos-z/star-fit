/**
 * workoutQualityGate unit tests (Q1) — Agent 生成数据一致性检测
 *
 * 覆盖：
 *   B1: 真实数字的卡片通过（prose 与 data 数值均校验）
 *   B2: 编造数字被拒绝（总容量/组数/有氧时长/距离/心率 逐项）
 *   B3: 缺真值时静默放行（无 session / 无 stats / 非数值）
 *   B4: 容差——四舍五入、单位换算（km/m）、千分位不误伤
 *   B5: 不相关数字（百分比、RPE、组序号、时间戳）不误伤
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkWorkoutCardQuality,
  cardToCheckableText,
  extractSessionFacts,
} from '../workoutQualityGate.js';

const FACTS = {
  exercises: [
    { name: '杠铃卧推', type: 'resistance', sets: 3, completed_sets: 3, weight: 60, reps: 10 },
    { name: '跑步机', type: 'cardio', duration: 1800, distance: 4000, avg_hr: 145 },
  ],
  stats: {
    totalVolume: 1800,
    setsCount: 4,
    totalCardioDurationSec: 1800,
    totalDistanceM: 4000,
    durationMinutes: 45,
    avgHr: 145,
  },
};

describe('workoutQualityGate — B1 真实数据通过', () => {
  it('引用正确的总容量与组数 → 通过', () => {
    const r = checkWorkoutCardQuality('本次训练总容量 1800kg，完成 4 组，表现不错！', FACTS);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });

  it('data JSON 里的数值也会被校验（正确的）→ 通过', () => {
    const card = {
      type: 'summary_card',
      data: { summary: '完成良好', metrics: { volume: 1800, hr: 145 } },
    };
    const r = checkWorkoutCardQuality(cardToCheckableText(card), FACTS);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });

  it('千分位数字 1,800 正确解析 → 通过', () => {
    const r = checkWorkoutCardQuality('总容量 1,800 kg', FACTS);
    assert.equal(r.ok, true);
  });
});

describe('workoutQualityGate — B2 编造数字被拒绝', () => {
  it('编造总容量（2500 ≠ 1800）→ 拒绝', () => {
    const r = checkWorkoutCardQuality('你本次训练总容量达到 2500kg！', FACTS);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === 'data_mismatch'), JSON.stringify(r.issues));
  });

  it('编造组数（12 ≠ 4）→ 拒绝', () => {
    const r = checkWorkoutCardQuality('完成了 12 组训练', FACTS);
    assert.equal(r.ok, false);
  });

  it('编造有氧时长（卡片说有氧时长 3600 秒，实际 1800）→ 拒绝', () => {
    const r = checkWorkoutCardQuality('有氧时长 3600 秒，配速稳定', FACTS);
    assert.equal(r.ok, false);
  });

  it('编造距离（9.5km ≠ 4km，单位换算后仍不匹配）→ 拒绝', () => {
    const r = checkWorkoutCardQuality('总距离 9.5km', FACTS);
    assert.equal(r.ok, false);
  });

  it('编造心率（168 ≠ 145）→ 拒绝', () => {
    const r = checkWorkoutCardQuality('平均心率 168 bpm，强度达标', FACTS);
    assert.equal(r.ok, false);
  });

  it('多个编造数字 → 每个都有独立 issue', () => {
    const r = checkWorkoutCardQuality('总容量 2500kg，平均心率 168 bpm', FACTS);
    assert.equal(r.ok, false);
    assert.ok(r.issues.length >= 2);
  });
});

describe('workoutQualityGate — B3 缺真值时静默放行', () => {
  it('facts=null（库内无 session）→ 通过', () => {
    const r = checkWorkoutCardQuality('总容量 99999kg', null);
    assert.equal(r.ok, true);
  });

  it('stats 缺失 → 通过', () => {
    const r = checkWorkoutCardQuality('总容量 99999kg', { exercises: [] });
    assert.equal(r.ok, true);
  });

  it('stats 里没有该指标（avgHr 未记录）→ 不校验该指标', () => {
    const facts = { stats: { totalVolume: 1800, setsCount: 4 } };
    const r = checkWorkoutCardQuality('平均心率 200 bpm', facts);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });

  it('stats 为 0 的指标（本次无有氧）→ 不校验', () => {
    const facts = { stats: { totalVolume: 1800, setsCount: 4, totalDistanceM: 0 } };
    const r = checkWorkoutCardQuality('距离 42km', facts);
    assert.equal(r.ok, true);
  });
});

describe('workoutQualityGate — B4 容差不误伤', () => {
  it('四舍五入偏差（1799.5 → 写 1800 / 写 1799）→ 通过', () => {
    assert.equal(checkWorkoutCardQuality('总容量 1799 kg', FACTS).ok, true);
  });

  it('2% 内相对偏差 → 通过', () => {
    // 1800 * 1.019 ≈ 1834
    const r = checkWorkoutCardQuality('总容量 1834kg', FACTS);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });

  it('km/m 单位双向换算（4 km = 4000 m）→ 通过', () => {
    const r = checkWorkoutCardQuality('总距离 4km', FACTS);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });
});

describe('workoutQualityGate — B5 不相关数字不误伤', () => {
  it('百分比 / RPE / 组序号 / 时间 → 通过', () => {
    const text =
      '第3组表现最佳。训练强度达到 RPE 8，目标完成度 100%。建议休息 90 秒。' +
      '下次可以尝试 65kg（对比上次 60kg 是 +8.3%）。';
    const r = checkWorkoutCardQuality(text, FACTS);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });
});

describe('workoutQualityGate — 误伤修复回归（2026-09-06）', () => {
  it('配速语境「6 分/公里」不被当作距离主张 → 通过', () => {
    // FACTS.totalDistanceM=4000；「6 分/公里」的 6 若被当 km 距离会误报
    const r = checkWorkoutCardQuality(
      '跑步机 4000 米，配速约 6 分/公里，强度合理',
      FACTS,
    );
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });

  it('「30 分钟」描述动作有氧时长（=1800秒/60）→ 通过', () => {
    // FACTS.durationMinutes=45（session 墙钟），但 30 分钟=1800 秒有氧时长同样合法
    const r = checkWorkoutCardQuality(
      '跑步机时长 1800 秒（30 分钟），配速合理',
      FACTS,
    );
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });

  it('「30 分钟」若与两个时长真值都不符 → 仍拒绝', () => {
    // 墙钟 45 分钟、有氧 30 分钟——写「运动 60 分钟」必须报
    const r = checkWorkoutCardQuality('你本次运动 60 分钟，表现出色', FACTS);
    assert.equal(r.ok, false, JSON.stringify(r.issues));
    assert.ok(r.issues.some((i) => i.code === 'data_mismatch'));
  });

  it('引用单项动作心率（138/145 = 各动作 avg_hr）→ 通过', () => {
    // 全局 avgHr=142，但单项动作心率也是合法引用值
    const facts = {
      exercises: [
        { name: '户外跑', type: 'outdoor', avg_hr: 138 },
        { name: '跑步机', type: 'cardio', avg_hr: 145 },
      ],
      stats: { ...FACTS.stats, avgHr: 142 },
    };
    const r = checkWorkoutCardQuality(
      '户外跑平均心率 138，跑步机 145，整体 142，状态不错',
      facts,
    );
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });

  it('编造单项心率（160 不在任何真值中）→ 拒绝', () => {
    const facts = {
      exercises: [{ name: '户外跑', type: 'outdoor', avg_hr: 138 }],
      stats: { ...FACTS.stats, avgHr: 142 },
    };
    const r = checkWorkoutCardQuality('你的心率达到了 160 bpm', facts);
    assert.equal(r.ok, false, JSON.stringify(r.issues));
  });
});

describe('workoutQualityGate — extractSessionFacts', () => {
  it('取 sessions 最后一条', () => {
    const facts = extractSessionFacts({
      sessions: [{ stats: { totalVolume: 1 } }, { stats: { totalVolume: 2 } }],
    });
    assert.equal(facts?.stats?.totalVolume, 2);
  });

  it('无 sessions → null', () => {
    assert.equal(extractSessionFacts({}), null);
    assert.equal(extractSessionFacts({ sessions: [] }), null);
    assert.equal(extractSessionFacts(null), null);
  });
});
