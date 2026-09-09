/**
 * 复现用户场景：口语化摔伤表述 → 后端是否发 profile_update_confirm 卡片
 * （只验证后端 SSE 事件，不动 DB、不发确认轮）
 */
const API = 'http://localhost:43111/api';
const USER = '63cab048-c19d-4329-9361-821edccf74b9';
const THREAD_ID = 'repro-fall-injury-' + Date.now();
const HEADERS = { 'Content-Type': 'application/json', 'X-User-Id': encodeURIComponent(USER) };

const message = '我今天不小心摔了一跤，手撑了一下地，现在手腕有点疼，有点肿。';
console.log('用户消息:', message, '\n');

const chatRes = await fetch(`${API}/chat`, {
  method: 'POST',
  headers: HEADERS,
  body: JSON.stringify({ message, scenario: 'chat', userId: USER, threadId: THREAD_ID }),
});
console.log('HTTP', chatRes.status);
if (!chatRes.ok) { console.error(await chatRes.text()); process.exit(1); }

const raw = await chatRes.text();
const events = [];
for (const line of raw.split('\n')) {
  if (!line.startsWith('data:')) continue;
  try { events.push(JSON.parse(line.slice(5))); } catch {}
}
console.log('SSE 事件数:', events.length, '| 类型分布:');
const types = {};
for (const e of events) types[e.type || '?'] = (types[e.type || '?'] || 0) + 1;
console.log(types, '\n');

// 找卡片事件
const cardEvents = events.filter(e => {
  const t = e.type || '';
  return t.includes('ui') || t.includes('card') || (e.card && e.card.type) || (e.uiHint && e.uiHint.type);
});
console.log('卡片类事件:', JSON.stringify(cardEvents, null, 2).slice(0, 2000) || '（无）');

// 兜底：看文本流里是否泄漏了卡片 JSON
const textChunks = events.filter(e => e.type === 'text' || e.type === 'token').map(e => e.data?.text || e.data || '').join('');
const leaked = textChunks.includes('profile_update_confirm');
console.log('\n文本中泄漏卡片JSON:', leaked);
console.log('\n=== 回复全文 ===\n' + textChunks.slice(0, 1500));
