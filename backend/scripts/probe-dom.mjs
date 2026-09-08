import { chromium } from 'playwright';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 420, height: 860 } });
// 先手动登录一次（写入凭据）
const pageA = await context.newPage();
await pageA.goto('http://localhost:43112', { waitUntil: 'networkidle' });
await pageA.waitForTimeout(1500);
await pageA.locator('input').first().fill('127.0.0.1');
await pageA.locator('input').nth(1).fill('autologin');
await pageA.locator('button:has-text("开始同步与训练")').click();
await pageA.waitForSelector('[aria-label="打开设置"]', { timeout: 10000 });
// 从设置里改不了服务器？直接改 IDB 模拟"上次的服务器已关机"
await pageA.evaluate(async () => {
  // 写入一个坏地址覆盖 serverUrl
  const dbs = await indexedDB.databases();
  const name = dbs.find(d => d.name && d.name.includes('starfit'))?.name;
  return name;
}).then(async (dbName) => {
  if (!dbName) return;
  await pageA.evaluate(async (dbName) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    // 找到 key/value store 并更新 serverUrl
    const storeNames = Array.from(db.objectStoreNames);
    for (const sn of storeNames) {
      await new Promise((res) => {
        const tx = db.transaction(sn, 'readwrite');
        const store = tx.objectStore(sn);
        const getAllKeys = store.getAllKeys();
        const getAll = store.getAll();
        getAllKeys.onsuccess = () => {
          const keys = getAllKeys.result;
          getAll.onsuccess = () => {
            const vals = getAll.result;
            keys.forEach((k, i) => {
              // serverUrl key 通常含 'server'
              if (String(k).toLowerCase().includes('server') && typeof vals[i] === 'string') {
                store.put('http://10.255.255.1:43111/api', k); // 不可达地址
              }
            });
            res();
          };
        };
        tx.oncomplete = () => {};
        tx.onerror = () => res();
      });
    }
    db.close();
  }, dbName);
});
await pageA.close();

// 重开 → 自动连接应失败 → 停在登录页 + amber 提示
const pageB = await context.newPage();
await pageB.goto('http://localhost:43112', { waitUntil: 'networkidle' });
await pageB.locator('text=正在连接上次的服务器').waitFor({ timeout: 8000 }).catch(() => {});
const connecting = await pageB.locator('text=正在连接上次的服务器').count();
console.log('connecting 提示:', connecting > 0 ? 'YES' : 'NO');
await pageB.locator('text=自动连接上次服务器失败').waitFor({ timeout: 15000 }).catch(() => {});
const failed = await pageB.locator('text=自动连接上次服务器失败').count();
console.log('失败提示:', failed > 0 ? 'YES' : 'NO');
const ip = await pageB.locator('input').first().inputValue();
console.log('表单已填入上次IP:', ip || '(空)');
await pageB.screenshot({ path: '/tmp/starfit-auto-login-fail.png' });
await browser.close();
