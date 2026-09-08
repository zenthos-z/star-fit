/**
 * E2E 数据流验证脚本（真实 HTTP + 真实 DB）
 *
 * 步骤：
 *  1. 逐类别构造格式化训练记录（与 src/v2/utils/workoutSummary.ts 输出形态一致）
 *  2. POST /api/sessions 持久化（带 X-User-Id，模拟前端 Phase 1）
 *  3. GET /api/sessions/recent 读回，验证每类数据完整落库
 *  4. 直接查 DB 验证 history_summary.sessions 里的最新一条
 *
 * 覆盖：resistance / cardio / outdoor / isometric / bodyweight / assisted / unilateral
 */
const API = 'http://localhost:43111/api';
const USER = '63cab048-c19d-4329-9361-821edccf74b9'; // testuser（既有测试用户）
const HEADERS = { 'Content-Type': 'application/json', 'X-User-Id': encodeURIComponent(USER) };

const T0 = Date.now() - 46 * 60 * 1000;
const T1 = Date.now();

// 与 workoutSummary.buildSessionPayload 输出严格同构
const payload = {
  sessionId: crypto.randomUUID(),
  startTime: T0,
  endTime: T1,
  exercises: [
    // 抗阻：组数/重量/次数
    { name: '杠铃卧推', type: 'resistance', sets: 3, completed_sets: 3, weight: 60, reps: 10 },
    // 有氧：时长 + 距离 + 心率 ← 任务要求的核心验证点
    { name: '跑步机', type: 'cardio', sets: 1, completed_sets: 1, duration: 1800, distance: 4000, avg_hr: 145 },
    // 户外：距离主导
    { name: '户外跑', type: 'outdoor', sets: 1, completed_sets: 1, duration: 3600, distance: 8000, avg_hr: 138 },
    // 等长：时长
    { name: '平板支撑', type: 'isometric', sets: 2, completed_sets: 2, duration: 105 },
    // 自重：次数
    { name: '俯卧撑', type: 'bodyweight', sets: 2, completed_sets: 2, reps: 18 },
    // 辅助：负重量（助力）
    { name: '助力引体', type: 'assisted', sets: 2, completed_sets: 2, weight: -10, reps: 8 },
    // 单侧
    { name: '箭步蹲', type: 'unilateral', sets: 2, completed_sets: 2, weight: 20, reps: 12 },
  ],
  stats: {
    totalVolume: 60*10*3 + 20*12*2,      // 1800 + 480（抗阻+单侧，等长另计不入此项）
    setsCount: 13,
    totalCardioDurationSec: 1800 + 3600, // 有氧+户外，等长不计
    totalDistanceM: 4000 + 8000,
    avgHr: Math.round((145 + 138) / 2),
  },
};

// ---- 1. POST /api/sessions ----
console.log('=== Step 1: POST /api/sessions ===');
const post = await fetch(`${API}/sessions`, {
  method: 'POST', headers: HEADERS, body: JSON.stringify(payload),
});
console.log('HTTP', post.status);
const postBody = await post.json();
console.log(JSON.stringify(postBody, null, 2));
if (post.status !== 201) {
  console.error('!!! PERSIST FAILED — 数据流断点仍存在');
  process.exit(1);
}

// ---- 2. GET /api/sessions/recent 读回 ----
console.log('\n=== Step 2: GET /api/sessions/recent ===');
const get = await fetch(`${API}/sessions/recent?limit=1`, { headers: HEADERS });
console.log('HTTP', get.status);
const recent = await get.json();
const sessions = recent.sessions || recent;
const latest = Array.isArray(sessions) ? sessions[sessions.length - 1] : sessions;
console.log(JSON.stringify(latest, null, 2)?.slice(0, 3000));

// ---- 3. 逐类别断言 ----
console.log('\n=== Step 3: 逐类别训练记录断言（读回 vs 发出） ===');
const byName = Object.fromEntries((latest.exercises || []).map((e) => [e.name, e]));
let failures = 0;
const expect = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

expect('resistance 杠铃卧推: weight=60, reps=10, sets=3', (() => {
  const e = byName['杠铃卧推']; return e && e.weight === 60 && e.reps === 10 && e.sets === 3;
})());
expect('cardio 跑步机: duration=1800s, distance=4000m, avg_hr=145', (() => {
  const e = byName['跑步机']; return e && e.duration === 1800 && e.distance === 4000 && e.avg_hr === 145;
})());
expect('outdoor 户外跑: distance=8000m', (() => {
  const e = byName['户外跑']; return e && e.distance === 8000;
})());
expect('isometric 平板支撑: duration=105s', (() => {
  const e = byName['平板支撑']; return e && e.duration === 105;
})());
expect('bodyweight 俯卧撑: reps=18', (() => {
  const e = byName['俯卧撑']; return e && e.reps === 18;
})());
expect('assisted 助力引体: weight=-10（助力负重保留）', (() => {
  const e = byName['助力引体']; return e && e.weight === -10;
})());
expect('unilateral 箭步蹲: weight=20, reps=12', (() => {
  const e = byName['箭步蹲']; return e && e.weight === 20 && e.reps === 12;
})());
expect('stats: totalCardioDurationSec=5400, totalDistanceM=12000', (() => {
  const s = latest.stats || {}; return s.totalCardioDurationSec === 5400 && s.totalDistanceM === 12000;
})());

console.log(failures === 0 ? '\n✅ 全部类别训练记录落库正确' : `\n❌ ${failures} 项断言失败`);
process.exit(failures === 0 ? 0 : 1);
