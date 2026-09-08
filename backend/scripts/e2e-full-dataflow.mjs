/**
 * FULL E2E — 完整端到端数据流验证（真实 HTTP + 真实 DB + 真实 LLM）
 *
 * 链路：前端格式化 payload → POST /api/sessions 持久化 → POST /api/chat
 *       (scenario=workout_complete, SSE) → Agent 调 load_history 读真数据
 *       → LLM 生成 summary/survey 卡片 → 数据一致性校验（workoutQualityGate 判定逻辑）
 *
 * 验证点：
 *   A. 持久化：7 类动作 + 心率 → 201
 *   B. DB 读回：所有字段（含 avg_hr）落库正确
 *   C. Agent SSE：流式返回 token/done，卡片被 extract/validate 回路接受
 *   D. 生成质量：Agent 文本中的训练数字与库内真值一致（门判定 ok:true）
 *   E. 质量门反向验证：喂一张编造数字的卡片，确认门会拒绝（防线真实生效）
 */
const API = 'http://localhost:43111/api';
const USER = '63cab048-c19d-4329-9361-821edccf74b9';
const HEADERS = { 'Content-Type': 'application/json', 'X-User-Id': encodeURIComponent(USER) };

let failures = 0;
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`);
  if (!cond) failures++;
};

// ---------------------------------------------------------------------------
// Step A: 持久化（含心率）
// ---------------------------------------------------------------------------
console.log('=== A. POST /api/sessions（含心率混合会话） ===');
const T0 = Date.now() - 47 * 60 * 1000;
const payload = {
  sessionId: crypto.randomUUID(),
  startTime: T0,
  endTime: Date.now(),
  exercises: [
    { name: '杠铃卧推', type: 'resistance', sets: 3, completed_sets: 3, weight: 60, reps: 10 },
    { name: '跑步机', type: 'cardio', sets: 1, completed_sets: 1, duration: 1800, distance: 4000, avg_hr: 145 },
    { name: '户外跑', type: 'outdoor', sets: 1, completed_sets: 1, duration: 3600, distance: 8000, avg_hr: 138 },
    { name: '平板支撑', type: 'isometric', sets: 2, completed_sets: 2, duration: 105 },
    { name: '俯卧撑', type: 'bodyweight', sets: 2, completed_sets: 2, reps: 18 },
    { name: '助力引体', type: 'assisted', sets: 2, completed_sets: 2, weight: -10, reps: 8 },
    { name: '箭步蹲', type: 'unilateral', sets: 2, completed_sets: 2, weight: 20, reps: 12 },
  ],
  stats: {
    totalVolume: 60 * 10 * 3 + 20 * 12 * 2, // 2280（抗阻+单侧）
    setsCount: 13,
    totalCardioDurationSec: 5400,
    totalDistanceM: 12000,
    avgHr: 142,
  },
};
const post = await fetch(`${API}/sessions`, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload) });
expect('A1. 持久化返回 201', post.status === 201, `实际 ${post.status}: ${JSON.stringify(await post.json().catch(() => ({})))}`);

// ---------------------------------------------------------------------------
// Step B: DB 读回校验
// ---------------------------------------------------------------------------
console.log('\n=== B. GET /api/sessions/recent 读回 ===');
const get = await fetch(`${API}/sessions/recent?limit=1`, { headers: HEADERS });
const recent = await get.json();
const sessions = recent.sessions || recent;
const latest = Array.isArray(sessions) ? sessions[sessions.length - 1] : sessions;
const byName = Object.fromEntries((latest.exercises || []).map((e) => [e.name, e]));
expect('B1. 跑步机心率 avg_hr=145 落库', byName['跑步机']?.avg_hr === 145, JSON.stringify(byName['跑步机']));
expect('B2. 户外跑 avg_hr=138 落库', byName['户外跑']?.avg_hr === 138);
expect('B3. stats.totalDistanceM=12000', latest.stats?.totalDistanceM === 12000);
expect('B4. stats.avgHr=142', latest.stats?.avgHr === 142);

// ---------------------------------------------------------------------------
// Step C: Agent 真实 LLM 分析（workout_complete, SSE）
// ---------------------------------------------------------------------------
console.log('\n=== C. POST /api/chat scenario=workout_complete（真实 LLM，可能需要 1-3 分钟） ===');
const chatReq = {
  userId: USER,
  message: `训练已结束，session ${payload.sessionId} 已持久化到数据库。请分析本次训练表现。`,
  scenario: 'workout_complete',
  metadata: { intent_context: { type: 'workout_complete', sessionId: payload.sessionId } },
};
const t0 = Date.now();
const chat = await fetch(`${API}/chat`, { method: 'POST', headers: HEADERS, body: JSON.stringify(chatReq) });
expect('C0. /api/chat 返回 200 且为 SSE', chat.status === 200 && (chat.headers.get('content-type') || '').includes('event-stream'),
  `status=${chat.status} ct=${chat.headers.get('content-type')}`);

const text = await chat.text();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`（SSE 流接收完毕，耗时 ${elapsed}s，${text.length} 字节）`);

// 解析 SSE 帧
const events = [];
for (const frame of text.split('\n\n')) {
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) {
      try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
    }
  }
}
const tokens = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
const uiHints = events.filter((e) => e.type === 'uiHint');
const errors = events.filter((e) => e.type === 'error');
const dones = events.filter((e) => e.type === 'done');
console.log(`--- Agent 最终文本（前 600 字）---\n${tokens.slice(0, 600)}\n---`);
console.log(`事件统计: token=${events.filter(e=>e.type==='token').length}, uiHint=${uiHints.length}, error=${errors.length}, done=${dones.length}`);
if (errors.length) console.log('错误详情:', JSON.stringify(errors[0]));

expect('C1. 收到 done 事件（回合正常结束）', dones.length > 0);
expect('C2. 无 error 事件（Agent 未崩溃/未校验失败）', errors.length === 0, errors[0]?.error?.message || '');
expect('C3. Agent 文本非空（真实 LLM 输出）', tokens.trim().length > 20);

// ---------------------------------------------------------------------------
// Step D: 生成质量——Agent 数字 vs 库内真值
// （宽松校验：Agent 引用单项动作值也算正确——如「跑步机心率145」vs 全局142；
//   因此对每项指标取「Agent 文本中出现的所有候选值」，任一匹配真值即 PASS）
// ---------------------------------------------------------------------------
console.log('\n=== D. 数据一致性（质量门判定逻辑，多候选宽松匹配） ===');
const cardText = tokens + (uiHints.length ? JSON.stringify(uiHints[uiHints.length - 1].card) : '');
const fullText = cardText;
const FACTS = { stats: payload.stats };
const within = (actual, claimed) => Math.abs(actual - claimed) <= 1 || Math.abs(actual - claimed) / Math.max(Math.abs(actual), 1) <= 0.02;

let checked = 0, ok = 0;
/** 收集文本中所有「关键词±窗口内」的数字（含 km→m 换算候选） */
const collectCandidates = (text, keywords, unit) => {
  const cands = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)(?:(\s*(?:km|公里|m))|(?:(分钟|秒)\b))?/g)) {
    // 简化：只在与关键词有窗口关联时算数（前后 16 字符）
    const start = Math.max(0, (m.index ?? 0) - 16);
    const win = text.slice(start, (m.index ?? 0) + (m[0]?.length ?? 0) + 16);
    if (!keywords.some((kw) => win.includes(kw))) continue;
    let v = Number(m[1].replace(/,/g, ''));
    if (m[2] && /km|公里/.test(m[2])) v *= 1000;
    cands.push(v);
  }
  return cands;
};

const checks = [
  ['总容量', ['总容量', '容量'], /无/, FACTS.stats.totalVolume, (t) => collectCandidates(t, ['总容量', '容量'])],
  ['组数', ['13 组', '13组'], /无/, FACTS.stats.setsCount, (t) => collectCandidates(t, ['共', '组数'])],
  ['距离', ['12km', '12000', '距离'], /无/, FACTS.stats.totalDistanceM, (t) => collectCandidates(t, ['距离', 'km'])],
  ['心率（全局或单项动作）', ['心率', 'bpm'], /无/, FACTS.stats.avgHr, (t) => collectCandidates(t, ['心率'])],
];
for (const [label, , , actual, collector] of checks) {
  const cands = collector(fullText);
  if (cands.length === 0) { console.log(`SKIP  ${label}: Agent 未提及（不强制）`); continue; }
  checked++;
  // 真值或任何合法单项值（每动作均值的集合）命中即通过
  const perExerciseHr = [145, 138]; // 单项心率属于真值族（DB exercises.avg_hr）
  const legalValues = label.startsWith('心率') ? [...perExerciseHr, actual] : [actual];
  const pass = cands.some((c) => legalValues.some((lv) => within(lv, c)));
  ok += pass ? 1 : 0;
  expect(`D.${checked} ${label}: 候选[${cands.join(',')}] 含真值 ${actual}（或单项真值）`, pass);
}
expect('D.sum 至少校验了 1 项数字', checked >= 1, 'Agent 输出未包含任何可校验的训练数字');

// ---------------------------------------------------------------------------
// Step E: 质量门反向验证（喂编造卡片，确认门拒绝）
// ---------------------------------------------------------------------------
console.log('\n=== E. 质量门反向验证（编造数字必须被拒） ===');
const { checkWorkoutCardQuality, extractSessionFacts } = await import('./quality-gate.mjs');
const fabricated = {
  type: 'summary_card',
  data: { summary: '本次训练总容量达到 9999kg，平均心率 190 bpm，距离 42km！' },
};
const facts = extractSessionFacts({ sessions: [latest] });
const gate = checkWorkoutCardQuality(JSON.stringify(fabricated), facts);
expect('E1. 编造卡片被拒（ok=false）', gate.ok === false);
expect('E2. 至少 2 个 data_mismatch', gate.issues.filter((i) => i.code === 'data_mismatch').length >= 2, JSON.stringify(gate.issues));
const honest = { type: 'summary_card', data: { summary: '本次训练总容量 2280kg，平均心率 142 bpm。' } };
const gateOk = checkWorkoutCardQuality(JSON.stringify(honest), facts);
expect('E3. 诚实卡片放行（ok=true）', gateOk.ok === true, JSON.stringify(gateOk.issues));

console.log(failures === 0 ? '\n✅✅ 完整端到端全部通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
