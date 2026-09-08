/**
 * E2E 阶段 B — 用户确认后的执行轮（真实 HTTP + 真实 LLM + 真实 DB）
 *
 * 前置：阶段 A（e2e-profile-update-trigger.mjs）已跑完，Agent 提出了三项提案。
 * 本脚本模拟前端确认气泡回传（scenario=update_profile + 携带提案原文），验证：
 *   1. Agent 真实调用 update_profile（而非只生成文字）
 *   2. 回复携带 audit_complete 反馈卡片，updates[] 与提案对应
 *   3. DB 的 profile_dynamic 真实写入（active_limitations / recovery_state / memories）
 *   4. 同一 thread 上下文（threadId 贯穿，模拟真实会话）
 */
const API = 'http://localhost:43111/api';
const USER = '63cab048-c19d-4329-9361-821edccf74b9';
const HEADERS = { 'Content-Type': 'application/json', 'X-User-Id': encodeURIComponent(USER) };
const THREAD_ID = 'e2e-profile-update-20260908';

const { execSync } = await import('node:child_process');
const readDynamic = () => execSync(
  `docker exec backend-postgres-1 psql -U starfit -d starfit -t -A -c "SELECT profile_dynamic FROM users WHERE id='${USER}'"`,
  { encoding: 'utf-8' },
).trim();

const before = readDynamic();
console.log('=== DB profile_dynamic BEFORE (阶段 B) ===');
console.log(before.length > 600 ? before.slice(0, 600) + ' …(truncated)' : before);

// 模拟前端确认气泡回传（与 docs/profile-update-frontend-spec.md §3.3 的 message 模板一致）
const message =
  '已确认画像更新，请按以下提案执行：' +
  '[{"field":"active_limitations","label":"活动限制","change":"新增右肩活动限制（晨僵+推举无力），严重度 4/10，7 天后自动过期","value":{"part":"right_shoulder","severity":4}},' +
  '{"field":"recovery_state","label":"恢复状态","change":"标记恢复不足：连续5天训练+睡眠<6小时，恢复评分下调至 40/100","value":{"total_score":40}},' +
  '{"field":"memories","label":"训练记忆","change":"记录：2026-09 连续训练5天后右肩晨僵、卧推无力，需优先恢复睡眠并暂停推类大重量"}]';

console.log('\n=== 阶段 B: POST /api/chat (scenario=update_profile, 确认回传) ===');
const chatRes = await fetch(`${API}/chat`, {
  method: 'POST',
  headers: HEADERS,
  body: JSON.stringify({ message, scenario: 'update_profile', userId: USER, threadId: THREAD_ID }),
});
console.log('HTTP', chatRes.status);
if (!chatRes.ok) {
  console.error('chat failed:', await chatRes.text());
  process.exit(1);
}

const raw = await chatRes.text();
const events = [];
for (const line of raw.split('\n')) {
  if (!line.startsWith('data:')) continue;
  try { events.push(JSON.parse(line.slice(5).trim())); } catch {}
}
const tokens = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
const cards = events.filter((e) => e.type === 'uiHint' && e.card).map((e) => e.card);
const errors = events.filter((e) => e.type === 'error');
console.log('events:', events.length, '| cards:', cards.length, '| errors:', errors.length);
if (errors.length) console.log('errors:', JSON.stringify(errors, null, 2).slice(0, 800));

console.log('\n=== Agent 回复正文 ===');
console.log(tokens);
console.log('\n=== 卡片 ===');
for (const c of cards) console.log(JSON.stringify(c, null, 2).slice(0, 1500));

// DB 验证
const after = readDynamic();
const afterObj = JSON.parse(after || '{}');
console.log('\n=== DB profile_dynamic AFTER ===');
console.log(after.length > 900 ? after.slice(0, 900) + ' …(truncated)' : after);

const lims = afterObj.active_limitations || [];
const newLim = lims.find((l) => l.part === 'right_shoulder');
const recovery = afterObj.recovery_state || {};
const memText = JSON.stringify(afterObj.memories || '');

console.log('\n=== 阶段 B 断言 ===');
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

check('DB 写入: active_limitations 含 right_shoulder', !!newLim,
  newLim ? `severity=${newLim.severity}, auto_heal=${newLim.auto_heal}, expire_at=${newLim.expire_at}` : '未找到');
check('DB 写入: severity=4（与提案一致）', newLim?.severity === 4);
check('DB 写入: 7 天自动过期（expire_at 存在）', typeof newLim?.expire_at === 'string' && newLim.expire_at.length > 0);
check('DB 写入: recovery_state.total_score=40', recovery.total_score === 40, `total_score=${recovery.total_score}`);
check('DB 写入: memories 含右肩记录', /right_shoulder|右肩/.test(memText), '');
check('profile_dynamic 确实变化（阶段 B 有写入）', after !== before);

const audit = cards.find((c) => c.type === 'audit_complete');
check('回复携带 audit_complete 反馈卡片', !!audit);
if (audit) {
  const fields = (audit.data.updates || []).map((u) => u.field).sort();
  const expect = ['active_limitations', 'memories', 'recovery_state'].sort();
  check('audit_complete.updates 覆盖三个写入字段', expect.every((f) => fields.includes(f)), `fields=${JSON.stringify(fields)}`);
  check('audit_complete.message 非空', typeof audit.data.message === 'string' && audit.data.message.length > 0);
}

check('正文简短（软性 1000 字建议内）', tokens.length <= 1000, `${tokens.length} chars`);

console.log(`\n=== 阶段 B 结果: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
