const API_BASE = process.env.API_BASE || 'http://localhost:3000/api';
const now = Date.now();
function uuid() { return (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now()); }
async function push(deviceId, sessions) {
  const res = await fetch(`${API_BASE}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, sessions })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
async function getUsers() {
  const res = await fetch(`${API_BASE}/admin/users`);
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}
async function getStats(userId) {
  const res = await fetch(`${API_BASE}/admin/stats/${userId}`);
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}
async function main() {
  const d1 = 'device-alpha';
  const d2 = 'device-beta';
  const s1 = [
    { id: uuid(), startTime: now - 86400000, endTime: now - 86300000, exercises: [{ name: 'Bench Press', sets: [{ completed: true, rpe: 8, weight: 60, reps: 8 }]}]},
    { id: uuid(), startTime: now - 43200000, endTime: now - 43100000, exercises: [{ name: 'Squat', sets: [{ completed: true, rpe: 9, weight: 100, reps: 5 }]}]},
  ];
  const s2 = [
    { id: uuid(), startTime: now - 172800000, endTime: now - 172700000, exercises: [{ name: 'Deadlift', sets: [{ completed: true, rpe: 8, weight: 120, reps: 5 }]}]},
  ];
  const r1 = await push(d1, s1);
  const r2 = await push(d2, s2);
  console.log('push d1:', r1.status, r1.data);
  console.log('push d2:', r2.status, r2.data);
  const users = await getUsers();
  console.log('users count:', users.length);
  for (const u of users) {
    const stats = await getStats(u.id);
    console.log('user:', u.device_id, 'sessions:', stats.length);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
