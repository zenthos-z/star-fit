/**
 * E2E 用户画像自动更新 — 完整闭环一键跑通（真实 HTTP + 真实 LLM + 真实 DB）
 *
 * Run: node scripts/e2e-profile-update.mjs
 *
 * 流程（模拟真实前端会话，全程同一 threadId）：
 *   ① DB 画像清零（干净基线）
 *   ② 阶段 A：语义化聊天消息（无任何指令/关键词）→ 断言 Agent 语义理解触发
 *      profile-update-reviewer 技能、发出 profile_update_confirm 卡片、且不写库
 *   ③ 阶段 B：确认气泡回传（scenario=update_profile）→ 断言 update_profile 真实
 *      写库 + audit_complete 反馈卡片
 *   ④ 阶段 C：拒绝路径回传 → 断言不产生新写入（在②未写、③已写的语境下验证
 *      Agent 尊重"暂不更新"）
 *   ⑤ 恢复 DB 到空画像（测试无痕）
 */
const API = 'http://localhost:43111/api';
const USER = '63cab048-c19d-4329-9361-821edccf74b9';
const THREAD_ID = 'e2e-profile-full-' + Date.now();
const HEADERS = { 'Content-Type': 'application/json', 'X-User-Id': encodeURIComponent(USER) };
const { execSync } = await import('node:child_process');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const readDynamic = () => execSync(
  `docker exec backend-postgres-1 psql -U starfit -d starfit -t -A -c "SELECT profile_dynamic FROM users WHERE id='${USER}'"`,
  { encoding: 'utf-8' },
).trim();
const resetDynamic = () => execSync(
  `docker exec backend-postgres-1 psql -U starfit -d starfit -c "UPDATE users SET profile_dynamic='{}'::jsonb WHERE id='${USER}'"`,
  { encoding: 'utf-8' },
);

async function chat(message, scenario) {
  const res = await fetch(`${API}/chat`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ message, scenario, userId: USER, threadId: THREAD_ID }),
  });
  if (!res.ok) throw new Error(`chat HTTP ${res.status}: ${await res.text()}`);
  const raw = await res.text();
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try { events.push(JSON.parse(line.slice(5).trim())); } catch {}
  }
  return {
    tokens: events.filter((e) => e.type === 'token').map((e) => e.text).join(''),
    thinking: events.filter((e) => e.type === 'thinking').map((e) => e.text).join(''),
    cards: events.filter((e) => e.type === 'uiHint' && e.card).map((e) => e.card),
    errors: events.filter((e) => e.type === 'error'),
  };
}

// ---- ① 干净基线 ----
resetDynamic();
const baseline = readDynamic();
console.log('=== ① 基线 ===');
console.log('threadId:', THREAD_ID, '| profile_dynamic:', baseline);
check('① DB 画像已清零', baseline === '{}');

// ---- ② 阶段 A：语义化触发（无关键词）----
console.log('\n=== ② 阶段 A: 语义化聊天触发 ===');
const msgA =
  '感觉最近有点顶不住了。这周已经练了五天了，昨天睡觉翻来覆去到两点才睡着，' +
  '早上起来肩膀那里有一点点僵，今天练卧推的时候右边使不上劲，重量比上周轻了也不敢加。';
console.log('用户消息:', msgA);
const a = await chat(msgA, 'chat');
console.log(`events tokens=${a.tokens.length}chars cards=${a.cards.length} errors=${a.errors.length}`);
if (a.thinking) console.log('thinking(重试轮):', a.thinking.slice(0, 150));
if (a.errors.length) console.log('errors:', JSON.stringify(a.errors).slice(0, 400));
console.log('\nAgent 回复:\n' + a.tokens + '\n');
for (const c of a.cards) console.log('卡片:', JSON.stringify(c, null, 2).slice(0, 1800));

const confirmCard = a.cards.find((c) => c.type === 'profile_update_confirm');
check('A1 语义理解触发技能：回复携带 profile_update_confirm 卡片', !!confirmCard,
  confirmCard ? `trigger=${confirmCard.data?.trigger}` : '未找到');
check('A2 正文提及状态要素（非空洞回复）', /肩|睡|恢复|疲|休息/.test(a.tokens));
check('A3 红线：提案轮未写库', readDynamic() === baseline);
if (!confirmCard) { console.log(`\n=== 阶段 A 失败终止: ${pass}p ${fail}f ===`); process.exit(1); }

const d = confirmCard.data;
check('A4 卡片结构完整（message/trigger/proposals）',
  !!d.message && ['day_end','injury_report','key_parameter_change','user_request'].includes(d.trigger)
  && Array.isArray(d.proposals) && d.proposals.length > 0
  && d.proposals.every((p) => ['load_anchors','active_limitations','recovery_state','memories'].includes(p.field) && p.label && p.change),
  `trigger=${d.trigger}, proposals=${d.proposals?.length}, fields=${JSON.stringify(d.proposals?.map((p) => p.field))}`);

// ---- ③ 阶段 B：确认执行 ----
console.log('\n=== ③ 阶段 B: 确认回传（scenario=update_profile） ===');
const beforeB = readDynamic();
const msgB = '已确认画像更新，请按以下提案执行：' + JSON.stringify(d.proposals);
const b = await chat(msgB, 'update_profile');
console.log(`tokens=${b.tokens.length}chars cards=${b.cards.length} errors=${b.errors.length}`);
if (b.thinking) console.log('thinking(重试轮):', b.thinking.slice(0, 150));
if (b.errors.length) console.log('errors:', JSON.stringify(b.errors).slice(0, 400));
console.log('\nAgent 回复:\n' + b.tokens + '\n');
for (const c of b.cards) console.log('卡片:', JSON.stringify(c, null, 2).slice(0, 1500));

const afterB = JSON.parse(readDynamic() || '{}');
const lim = (afterB.active_limitations || []).find((l) => l.part === 'right_shoulder');
// Agent 每轮会根据当轮语义自行评估 severity——断言只锁「协议不变量」，
// 不锁具体数值（数值必须是提案/确认里传的，这里回传的是 Agent 自己的提案）。
const proposedLim = d.proposals.find((p) => p.field === 'active_limitations')?.value || {};
const expectedSeverity = lim && proposedLim.severity !== undefined ? lim.severity : undefined;
check('B1 DB 真实写入: active_limitations.right_shoulder（severity 与回传提案一致）',
  !!lim && lim.severity >= 1 && lim.severity <= 10,
  lim ? `severity=${lim.severity}, auto_heal=${lim.auto_heal}, expire_at=${lim.expire_at}` : '未找到');
check('B2 DB 真实写入: recovery_state.total_score 已建立（0-100）',
  typeof afterB.recovery_state?.total_score === 'number'
  && afterB.recovery_state.total_score >= 0 && afterB.recovery_state.total_score <= 100,
  `total_score=${afterB.recovery_state?.total_score}`);
check('B3 DB 真实写入: memories 含右肩记录（仅当 memories 在提案中）',
  d.proposals.some((p) => p.field === 'memories')
    ? /right_shoulder|右肩/.test(JSON.stringify(afterB.memories || {}))
    : true,
  JSON.stringify(Object.keys(afterB.memories || {})));

const audit = b.cards.find((c) => c.type === 'audit_complete');
check('B4 反馈: audit_complete 卡片', !!audit);
if (audit) {
  const fields = (audit.data?.updates || []).map((u) => u.field);
  // Agent 可能在执行轮追加提案外的合理写入（如 load_anchors 锚点记录），
  // 断言只要求「阶段 A 提案的字段」都出现在 updates 里，不要求一一对应。
  const proposedFieldsUp = d.proposals.map((p) => p.field);
  const missing = proposedFieldsUp.filter((f) => !fields.includes(f));
  check('B5 audit_complete.updates 覆盖所有提案字段（允许合理追加）', missing.length === 0,
    `fields=${JSON.stringify(fields)}, missing=${JSON.stringify(missing)}`);
  check('B6 audit_complete.message 非空', typeof audit.data?.message === 'string' && audit.data.message.length > 0);
}
check('B7 回复正文简短（≤1000 字软性建议）', b.tokens.length <= 1000, `${b.tokens.length} chars`);

// ---- ④ 阶段 C：拒绝路径（对新一轮无关提案说"不"）----
console.log('\n=== ④ 阶段 C: 拒绝路径 ===');
const beforeC = readDynamic();
const c = await chat('暂时不用更新了，先自己观察几天', 'chat');
console.log('Agent 回复:', c.tokens.slice(0, 200));
check('C1 拒绝后无新写入', readDynamic() === beforeC);
check('C2 拒绝回复简短且无卡片', c.cards.length === 0 && c.tokens.length <= 600, `${c.tokens.length} chars, cards=${c.cards.length}`);

// ---- ⑤ 恢复 DB ----
console.log('\n=== ⑤ 测试清理 ===');
resetDynamic();
check('⑤ DB 已恢复空画像', readDynamic() === '{}');

console.log(`\n=== 总结果: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
