import fs from 'fs/promises';
import path from 'path';

const apiBase = (process.env.SNAPSHOT_API_BASE || 'http://127.0.0.1:43111/api').replace(/\/+$/, '');
const userId = (process.env.SNAPSHOT_USER_ID || 'global').trim() || 'global';

const outDir = path.resolve(process.cwd(), 'fixtures', 'admin-contracts');

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!isObject(value)) return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = String(k);
    const lower = key.toLowerCase();
    if (
      lower.includes('api_key') ||
      lower.includes('apikey') ||
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('password')
    ) {
      out[key] = v ? '***' : v;
      continue;
    }
    if (lower === 'device_id') {
      out[key] = '***';
      continue;
    }
    out[key] = sanitize(v);
  }
  return out;
}

async function httpJson(method, endpoint, body) {
  const url = `${apiBase}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-User-Id': encodeURIComponent(userId),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function writeSnapshot(fileName, payload) {
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

async function main() {
  const generatedAt = new Date().toISOString();

  const health = await httpJson('GET', '/admin/health');
  await writeSnapshot('admin_health.json', sanitize({ generated_at: generatedAt, apiBase, ...health }));

  const logs = await httpJson('GET', '/admin/logs?limit=10&level=all');
  await writeSnapshot('admin_logs.json', sanitize({ generated_at: generatedAt, apiBase, ...logs }));

  const proxy = await httpJson('GET', '/admin/proxy');
  await writeSnapshot('admin_proxy.json', sanitize({ generated_at: generatedAt, apiBase, ...proxy }));

  const aiConfig = await httpJson('GET', '/admin/ai-config');
  await writeSnapshot('admin_ai_config.json', sanitize({ generated_at: generatedAt, apiBase, ...aiConfig }));

  const users = await httpJson('GET', '/admin/users');
  const usersList = Array.isArray(users.json) ? users.json : [];
  await writeSnapshot(
    'admin_users.json',
    sanitize({ generated_at: generatedAt, apiBase, status: users.status, json: usersList.slice(0, 5) })
  );

  const sampleUserId = usersList[0]?.id ? String(usersList[0].id) : null;
  if (sampleUserId) {
    const profile = await httpJson('GET', `/profiles/${encodeURIComponent(sampleUserId)}`);
    await writeSnapshot('profile_sample.json', sanitize({ generated_at: generatedAt, apiBase, userId: sampleUserId, ...profile }));

    const stats = await httpJson('GET', `/admin/stats/${encodeURIComponent(sampleUserId)}`);
    const trimmedStats = Array.isArray(stats.json) ? stats.json.slice(0, 5) : stats.json;
    await writeSnapshot('stats_sample.json', sanitize({ generated_at: generatedAt, apiBase, userId: sampleUserId, status: stats.status, json: trimmedStats }));
  }

  const exercises = await httpJson('GET', '/exercises');
  const exList = Array.isArray(exercises.json) ? exercises.json : [];
  await writeSnapshot(
    'exercises_sample.json',
    sanitize({ generated_at: generatedAt, apiBase, status: exercises.status, json: exList.slice(0, 5) })
  );
}

await main();

