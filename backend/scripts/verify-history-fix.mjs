/**
 * 验证：Agent 视角的 load_history 现在能读到 sync/push 落库的训练记录。
 * 不走 LLM，直接查 Agent 读的同一路径：users.history_summary（预期仍空）
 * + sessions 表实时行（预期含 8871b521）→ 合并结果非空即修复生效。
 */
const { execSync } = await import('node:child_process');
const USER = 'dbf4d2a7-94ff-493b-b6ab-80bccf762a9a';

const q = (sql) => execSync(
  `docker exec backend-postgres-1 psql -U starfit -d starfit -t -A -c "${sql}"`,
  { encoding: 'utf-8' },
);

const hs = q(`SELECT coalesce(history_summary::text,'null') FROM users WHERE id='${USER}'`).trim();
console.log('1) users.history_summary（Agent 原本唯一数据源）:', hs, hs === '{}' ? '← 空的，这就是之前 Agent 读到空历史的原因' : '');

const live = q(`SELECT count(*) FROM sessions WHERE user_id='${USER}'`).trim();
const target = q(`SELECT title FROM sessions WHERE id='8871b521-c246-4f00-823d-48618a9b68b8'`).trim();
console.log(`2) sessions 表实时行（合并后的新数据源）: ${live} 条，含目标记录「${target}」`);

// 等容器就绪后，用真实 LLM 走一轮对话验证 Agent 能引用到这次训练
await new Promise(r => setTimeout(r, 8000));
const health = await fetch('http://localhost:43111/health').then(r => r.json()).catch(() => null);
console.log('3) 后端健康:', JSON.stringify(health));

const chatRes = await fetch('http://localhost:43111/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-User-Id': encodeURIComponent(USER) },
  body: JSON.stringify({
    message: '我最近一次训练是什么时候？练了哪些动作？直接根据历史数据回答。',
    scenario: 'chat',
    userId: USER,
    threadId: 'verify-history-fix-' + Date.now(),
  }),
});
const raw = await chatRes.text();
let text = '';
for (const line of raw.split('\n')) {
  if (!line.startsWith('data:')) continue;
  try {
    const e = JSON.parse(line.slice(5));
    if (e.type === 'token') text += typeof e.data === 'string' ? e.data : (e.data?.text || '');
  } catch {}
}
console.log('\n4) Agent 回复（真实 LLM，经 load_history）:\n', text.slice(0, 600));
const hit = text.includes('箭步蹲') || text.includes('平板支撑');
console.log('\n=== 结论:', hit ? '✅ Agent 能读到 8871b521 的训练内容，闭环修复生效' : '❌ 仍未读到，需继续排查', '===');
process.exit(hit ? 0 : 1);
