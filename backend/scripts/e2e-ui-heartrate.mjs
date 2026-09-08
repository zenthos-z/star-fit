/**
 * E2E UI 测试 — 真实浏览器验证心率 UI 全链路
 *
 * 场景：打开 Starfit → 登录态注入 → 添加有氧动作 → 计时并录心率 →
 *       结束训练 → 截图 → 验证 POST /api/sessions 携带 heartRate
 *
 * 前置：vite dev(43112) + docker backend(43111) 均运行中
 */
import { chromium } from 'playwright';

const VITE = 'http://localhost:43112';
const API = 'http://localhost:43111/api';
const USER = '63cab048-c19d-4329-9361-821edccf74b9';

// 拦截持久化请求，捕获前端实际发出的 payload
let capturedPersistPayload = null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 860 } }); // 移动端视口

page.on('request', (req) => {
  if (req.url().includes('/api/sessions') && req.method() === 'POST') {
    try { capturedPersistPayload = JSON.parse(req.postData()); } catch {}
  }
});
const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

let failures = 0;
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`);
  if (!cond) failures++;
};

// ---- 1. 打开应用并真实登录 ----
console.log('=== 1. 打开应用并登录 ===');
await page.goto(VITE, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);

// 登录页：填服务器 IP + 用户名 → 开始同步与训练
const ipInput = page.locator('input[placeholder*="192.168"], input').first();
const nameInput = page.locator('input[placeholder*="test"], input').nth(1);
if (await ipInput.count() && await page.locator('text=开始同步与训练').count()) {
  await ipInput.fill('127.0.0.1');
  await nameInput.fill('testuser');
  await page.screenshot({ path: '/tmp/starfit-e2e-01-login.png' });
  await page.locator('button:has-text("开始同步与训练")').click();
  await page.waitForTimeout(2500); // 等登录 + 数据同步
}
expect('1.1 登录后进入主页（不在登录页）', (await page.locator('text=开始同步与训练').count()) === 0);
await page.screenshot({ path: '/tmp/starfit-e2e-01-home.png', fullPage: false });
console.log('截图: /tmp/starfit-e2e-01-home.png');
console.log('截图: /tmp/starfit-e2e-01-home.png');

// ---- 2. 真实 UI 流程：添加动作 → 动作库 → 选有氧 ----
console.log('\n=== 2. 添加有氧动作到训练列表 ===');
const addBtn = page.locator('div:has-text("添加动作")').last(); // last = 最内层匹配节点
expect('2.0 主页存在「添加动作」入口', await page.locator('text=添加动作').count() > 0);
await addBtn.click();
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/starfit-e2e-02-library.png' });

// 动作库弹层里搜索跑步机
const search = page.locator('input[type="search"], input[placeholder*="搜索"], input[placeholder*="search" i]').first();
if (await search.count()) {
  await search.fill('跑步');
  await page.waitForTimeout(800);
}
const cardioItem = page.locator('text=跑步机').first();
if (await cardioItem.count()) {
  await cardioItem.click();
  await page.waitForTimeout(600);
  // 弹层里可能有「添加/确定」确认按钮
  const confirm = page.locator('button:has-text("添加"), button:has-text("确定"), button:has-text("选择")').first();
  if (await confirm.count()) { await confirm.click(); await page.waitForTimeout(800); }
  console.log('已选择跑步机');
} else {
  console.log('未找到「跑步机」，截图动作库供排查');
}
await page.screenshot({ path: '/tmp/starfit-e2e-02-after-add.png' });

// ---- 3. 找到有氧卡片上的心率输入框 ----
console.log('\n=== 3. 验证心率 UI ===');
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/starfit-e2e-02-card.png', fullPage: false });

const hrInput = page.locator('input[type="number"][placeholder="实际心率"], input[placeholder*="心率"]').first();
const hrVisible = await hrInput.count();
expect('3.1 有氧卡片存在心率输入框', hrVisible > 0, '未找到 placeholder=实际心率 的输入框');

if (hrVisible > 0) {
  // 录入心率 142
  await hrInput.fill('142');
  await page.waitForTimeout(600);
  const val = await hrInput.inputValue();
  expect('3.2 心率录入成功（142）', val === '142', `实际 ${val}`);
  await page.screenshot({ path: '/tmp/starfit-e2e-03-hr-entered.png', fullPage: false });
}

// ---- 4. 开始训练 → 点卡片「完成」→ 滑杆「结束」触发持久化 ----
console.log('\n=== 4. 完成训练并触发持久化 ===');
// 4a-0. 先点 TimerCapsule 胶囊（START 区）把 session 置为 active
const capsule = page.locator('div:has-text("START"), button:has-text("START")').last();
if (await capsule.count()) {
  await capsule.click();
  await page.waitForTimeout(1200);
  console.log('已点 START 胶囊 → session active');
}
// 4a. 点主按钮「开始」（handleToggle 启动计时；启动后左小按钮文字变「结束」）
const startBtn = page.locator('button:has-text("开始")').first();
if (await startBtn.count()) {
  await startBtn.click();
  await page.waitForTimeout(2500); // 计时 2 秒，让 duration > 0
  console.log('已点「开始」→ 计时中');
}
// 4b-1. 点左侧「结束」（handleToggle 停止计时，syncToParent 保存 duration/heartRate）
const stopBtn = page.locator('button:has-text("结束")').first();
if (await stopBtn.count()) {
  await stopBtn.click();
  await page.waitForTimeout(800);
  console.log('已点「结束」（停止计时）');
}
// 4b-2. 点「完成」（handleComplete → status=COMPLETED）
const finishBtn = page.locator('button:has-text("完成")').first();
if (await finishBtn.count()) {
  await finishBtn.click();
  await page.waitForTimeout(800);
  console.log('已点「完成」→ set COMPLETED');
} else {
  console.log('（「完成」按钮未出现——计时可能未停止）');
}
await page.screenshot({ path: '/tmp/starfit-e2e-04-completed.png' });

// 4c. ActionSlider：先点胶囊展开选项，再点「结束」→ handleEndSession
const capsuleHandle = page.locator('.fixed.bottom-10 > div').first(); // 胶囊本体
if (await capsuleHandle.count()) {
  await capsuleHandle.click(); // 展开（第一次点击只展开）
  await page.waitForTimeout(1500); // 等 spring 动画完全结束
  // 页面有两个「结束」按钮：第一个在隐藏 overlay 模板里（y≈480），真正的滑杆按钮在底部（y>700）
  const endBtn = page.locator('button:has-text("结束")').last();
  await endBtn.waitFor({ state: 'visible', timeout: 5000 });
  const box = await endBtn.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    console.log(`已展开滑杆并 mouse.click「结束」(${Math.round(box.x+box.width/2)},${Math.round(box.y+box.height/2)}) → handleEndSession`);
    await page.waitForTimeout(4000); // 等持久化 POST + Agent 分析请求发出
  } else {
    console.log('（「结束」按钮无 boundingBox）');
  }
} else {
  console.log('（未找到底部滑杆胶囊）');
}

await page.screenshot({ path: '/tmp/starfit-e2e-04-end.png', fullPage: false });

// ---- 5. 校验前端发出的持久化 payload ----
console.log('\n=== 5. 前端持久化 payload 校验 ===');
if (capturedPersistPayload) {
  console.log('捕获到 POST /api/sessions payload:');
  console.log(JSON.stringify(capturedPersistPayload, null, 2).slice(0, 1200));
  const cardio = (capturedPersistPayload.exercises || []).find((e) => e.type === 'cardio');
  expect('5.1 exercises 为格式化条目（含 sets 计数）', cardio && typeof cardio.sets === 'number', JSON.stringify(cardio));
  expect('5.2 cardio 条目带 avg_hr（心率聚合字段）', cardio && cardio.avg_hr > 0, JSON.stringify(cardio));
  expect('5.3 stats 含有氧维度', capturedPersistPayload.stats && 'totalCardioDurationSec' in (capturedPersistPayload.stats || {}), JSON.stringify(capturedPersistPayload.stats));
  expect('5.4 startTime/endTime 有效', capturedPersistPayload.startTime > 0 && capturedPersistPayload.endTime > capturedPersistPayload.startTime);
} else {
  expect('5.0 前端发出 POST /api/sessions', false, '未捕获到持久化请求——UI 流程未走完');
}

// ---- 6. 控制台错误 ----
console.log('\n=== 6. 控制台健康 ===');
const realErrors = consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('404'));
expect('6.1 无控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? '\n✅ UI 端到端通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
