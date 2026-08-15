const API_BASE = 'http://localhost:43111/api';

async function test() {
  console.log('--- Data Isolation Verification ---');

  const userA = 'test_user_alice';
  const userB = 'test_user_bob';
  const deviceA = 'device_alice_1';
  const deviceB = 'device_bob_1';

  // 1. Push Session for Alice
  console.log('1. Pushing session for Alice...');
  const res1 = await fetch(`${API_BASE}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userA },
    body: JSON.stringify({
      deviceId: deviceA,
      sessions: [{ id: 'session_alice_1', startTime: Date.now(), exercises: [{ name: 'Bench Press' }] }]
    })
  });
  console.log('Alice push status:', res1.status);

  // 2. Push Session for Bob
  console.log('2. Pushing session for Bob...');
  const res2 = await fetch(`${API_BASE}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userB },
    body: JSON.stringify({
      deviceId: deviceB,
      sessions: [{ id: 'session_bob_1', startTime: Date.now(), exercises: [{ name: 'Squat' }] }]
    })
  });
  console.log('Bob push status:', res2.status);

  // 3. Pull for Alice
  console.log('3. Pulling for Alice...');
  const res3 = await fetch(`${API_BASE}/sync/pull?deviceId=${deviceA}`, {
    headers: { 'X-User-Id': userA }
  });
  const dataAlice = await res3.json();
  const aliceSessions = dataAlice.updates.sessions.map(s => s.id);
  console.log('Alice sessions:', aliceSessions);
  if (aliceSessions.includes('session_alice_1') && !aliceSessions.includes('session_bob_1')) {
    console.log('✅ Session Isolation: SUCCESS');
  } else {
    console.error('❌ Session Isolation: FAILED');
  }

  // 4. Set Config for Alice
  console.log('4. Setting config for Alice...');
  await fetch(`${API_BASE}/admin/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userA },
    body: JSON.stringify({ key: 'theme', value: 'dark' })
  });

  // 5. Pull Config for Bob
  console.log('5. Pulling config for Bob...');
  const res5 = await fetch(`${API_BASE}/sync/pull?deviceId=${deviceB}`, {
    headers: { 'X-User-Id': userB }
  });
  const dataBob = await res5.json();
  const bobConfigs = dataBob.updates.appConfigs;
  console.log('Bob configs:', bobConfigs);
  const hasAliceConfig = bobConfigs.some(c => c.key === 'theme' && c.value === 'dark');
  if (!hasAliceConfig) {
    console.log('✅ Config Isolation: SUCCESS');
  } else {
    console.error('❌ Config Isolation: FAILED');
  }

  console.log('--- Verification Complete ---');
}

test().catch(console.error);
