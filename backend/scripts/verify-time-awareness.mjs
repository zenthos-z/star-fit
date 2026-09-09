/**
 * 验证时间感知修复（两个真实场景，走真实 LLM）：
 *   A. 受伤上报 → 卡片里的 auto-heal 日期应基于"今天"（2026-09-08），不是历史日期
 *   B. 当天已训练 → Agent 应识别出今天（09-08）已有训练记录，给训练后建议而不是问要不要练
 */
const API = 'http://localhost:43111/api';
const USER = 'dbf4d2a7-94ff-493b-b6ab-80bccf762a9a';
const HEADERS = { 'Content-Type': 'application/json', 'X-User-Id': encodeURIComponent(USER) };

async function chat(message, tag) {
  const res = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ message, scenario: 'chat', userId: USER, threadId: `time-fix-${tag}-${Date.now()}` }),
  });
  const raw = await res.text();
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try { events.push(JSON.parse(line.slice(5))); } catch {}
  }
  const text = events.filter(e => e.type === 'token').map(e => e.text || '').join('');
  const card = events.find(e => e.type === 'uiHint');
  return { text, card };
}

await new Promise(r => setTimeout(r, 8000));
console.log('health:', JSON.stringify(await fetch('http://localhost:43111/health').then(r => r.json()).catch(() => null)));

// ---- A. 受伤 + 过期日期 ----
console.log('\n=== A. 受伤上报（今天 2026-09-08 擦伤）===');
const a = await chat('我今天骑车摔了一跤，手臂和手掌擦伤了，皮破了有点渗血。帮我记录一下这个伤情。', 'injury');
console.log('卡片:', a.card ? JSON.stringify(a.card.card?.data || a.card.data || a.card).slice(0, 500) : '（无卡片）');
const blob = JSON.stringify(a.card || '') + a.text;
const hasToday = blob.includes('09-08') || blob.includes('9月8') || blob.includes('9-08');
const hasJuly = blob.includes('07-21') || blob.includes('7月21');
console.log(`过期日期基于今天: ${hasToday ? '✅' : '❌'} | 出现 7月21 幻觉: ${hasJuly ? '❌ 有' : '✅ 无'}`);
console.log('回复:', a.text.slice(0, 300));

// ---- B. 当天已训练识别 ----
console.log('\n=== B. 当天训练状态（09-08 01:35 已有 箭步蹲/平板支撑 记录）===');
const b = await chat('我今天还需要训练吗？', 'trained');
console.log('回复:', b.text.slice(0, 400));
const knowsToday = b.text.includes('箭步蹲') || b.text.includes('平板支撑') || b.text.includes('今天') && (b.text.includes('已经') || b.text.includes('练过'));
console.log(`识别出当天已训练: ${knowsToday ? '✅' : '❌'}`);

console.log('\n=== 总结:', hasToday && !hasJuly && knowsToday ? '✅ 两项全过' : '部分未过，见上', '===');
