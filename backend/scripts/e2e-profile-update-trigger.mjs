/**
 * E2E 用户画像自动更新闭环（真实 HTTP + 真实 LLM + 真实 DB）
 *
 * 阶段 A — 语义化触发验证（本文件）：
 *   用户消息【不含"更新画像"“受伤”“记录”等任何关键词】，只描述状态变化
 *   （睡眠变差 + 连续训练疲劳的口语化表述），验证 Agent 是否：
 *     1. 通过语义理解识别触发条件（key_parameter_change / day_end）
 *     2. 激活 profile-update-reviewer 技能
 *     3. 回复中携带 profile_update_confirm 确认卡片
 *     4. 【红线】本回合绝不写库（update_profile 不被调用）
 *
 * 阶段 B — 确认执行轮（e2e-profile-update-confirm.mjs）：
 *   以 scenario=update_profile 回传确认，验证 audit_complete + DB 真实写入。
 */
const API = 'http://localhost:43111/api';
const USER = '63cab048-c19d-4329-9361-821edccf74b9'; // testuser（既有测试用户）
const THREAD_ID = 'e2e-profile-trigger-' + Date.now(); // 独立线程，避免残留 checkpoint 污染
const HEADERS = { 'Content-Type': 'application/json', 'X-User-Id': encodeURIComponent(USER) };

// ---- 0. 记录执行前的画像基线（用于验证红线：提案轮不得写库） ----
const baseline = await fetch(`${API}/sessions/recent?userId=${USER}`, { headers: HEADERS });
console.log('baseline recent-sessions HTTP', baseline.status);

// 直接读 DB 里的 profile_dynamic 基线
const { execSync } = await import('node:child_process');
const dbOut = execSync(
  `docker exec backend-postgres-1 psql -U starfit -d starfit -t -A -c "SELECT profile_dynamic FROM users WHERE id='${USER}'"`,
  { encoding: 'utf-8' },
);
const baselineDynamic = dbOut.trim();
console.log('=== DB profile_dynamic BEFORE ===');
console.log(baselineDynamic.length > 800 ? baselineDynamic.slice(0, 800) + ' …(truncated)' : baselineDynamic);

// ---- 1. 语义化聊天消息（无任何指令关键词）----
// 特意避免：更新/画像/记录/受伤/疼痛/建议/save/update/profile 等词。
// 只陈述近况，让 Agent 自己从上下文推断「关键参数变化」并主动提议。
const message =
  '感觉最近有点顶不住了。这周已经练了五天了，昨天睡觉翻来覆去到两点才睡着，' +
  '早上起来肩膀那里有一点点僵，今天练卧推的时候右边使不上劲，重量比上周轻了也不敢加。';

console.log('\n=== 阶段 A: POST /api/chat (scenario=chat, 语义化消息, 无关键词) ===');
console.log('用户消息:', message);

const chatRes = await fetch(`${API}/chat`, {
  method: 'POST',
  headers: HEADERS,
  body: JSON.stringify({ message, scenario: 'chat', userId: USER, threadId: THREAD_ID }),
});
console.log('HTTP', chatRes.status, '| threadId:', THREAD_ID);
console.log('（阶段 B 脚本需用同一 THREAD_ID 回传确认 —— 若失败请把上面打印的 threadId 手动填入 confirm 脚本）');
if (!chatRes.ok) {
  console.error('chat failed:', await chatRes.text());
  process.exit(1);
}

// ---- 2. 解析 SSE 流 ----
const raw = await chatRes.text();
const events = [];
for (const line of raw.split('\n')) {
  if (!line.startsWith('data:')) continue;
  try { events.push(JSON.parse(line.slice(5).trim())); } catch {}
}
const tokens = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
const thinking = events.filter((e) => e.type === 'thinking').map((e) => e.text).join('');
const cards = events.filter((e) => e.type === 'uiHint' && e.card).map((e) => e.card);
const errors = events.filter((e) => e.type === 'error');
console.log('\n=== SSE 事件统计 ===');
console.log('total events:', events.length, '| tokens:', tokens.length, 'chars | cards:', cards.length, '| errors:', errors.length);
if (thinking) console.log('thinking(重试轮):', thinking.slice(0, 200));
if (errors.length) console.log('errors:', JSON.stringify(errors));

console.log('\n=== Agent 回复正文 ===');
console.log(tokens);

console.log('\n=== 卡片明细 ===');
for (const c of cards) {
  console.log(JSON.stringify(c, null, 2).slice(0, 2000));
}

// ---- 3. 断言 ----
console.log('\n=== 阶段 A 断言 ===');
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const confirmCard = cards.find((c) => c.type === 'profile_update_confirm');
check('回复携带 profile_update_confirm 卡片（技能激活）', !!confirmCard,
  confirmCard ? `trigger=${confirmCard.data?.trigger}, proposals=${confirmCard.data?.proposals?.length}` : '未找到确认卡片');

if (confirmCard) {
  const d = confirmCard.data;
  check('卡片含非空 message', typeof d.message === 'string' && d.message.length > 0);
  check('卡片含合法 trigger', ['day_end','injury_report','key_parameter_change','user_request'].includes(d.trigger), `trigger=${d.trigger}`);
  check('proposals ≥1 且字段合法', Array.isArray(d.proposals) && d.proposals.length > 0
    && d.proposals.every((p) => ['load_anchors','active_limitations','recovery_state','memories'].includes(p.field)
      && p.label && p.change),
    JSON.stringify(d.proposals?.map((p) => p.field)));
  check('语义理解正确：非 user_request 触发（应为 key_parameter_change/day_end/injury_report）',
    d.trigger !== 'user_request', `trigger=${d.trigger}`);
}

check('正文提及肩膀/睡眠/恢复等状态要素（非空洞回复）',
  /肩|睡|恢复|疲|休息/.test(tokens), '');

// ---- 红线：提案轮不得写库 ----
const dbAfter = execSync(
  `docker exec backend-postgres-1 psql -U starfit -d starfit -t -A -c "SELECT profile_dynamic FROM users WHERE id='${USER}'"`,
  { encoding: 'utf-8' },
).trim();
check('红线：提案轮未写库（profile_dynamic 与执行前一致）', dbAfter === baselineDynamic,
  dbAfter === baselineDynamic ? '' : '!!! profile_dynamic 发生了变化 —— 先问后写红线被违反');

console.log(`\n=== 阶段 A 结果: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
