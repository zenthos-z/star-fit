/**
 * issue #137 ③ 复现脚本：锁屏内完成力量动作全部组 → FeelModal 必须弹出
 *
 * 双向断言：
 *   A. 锁屏场景：下拉胶囊进锁屏 → 长按主钮完成 3 组 → feel-modal 应出现
 *   B. 非锁屏场景（对照）：主界面卡片短按完成 3 组 → feel-modal 应出现（不回归）
 *
 * 用法：node repro-feel-modal.js <appUrl> <outDir> [onlyA|onlyB]
 * 依赖：仓库根 node_modules 的 playwright（chromium）。
 */
const path = require('path');
const { chromium } = require(path.join(process.cwd(), 'node_modules', 'playwright'));

const APP_URL = process.argv[2] || 'http://localhost:43192';
const OUT_DIR = process.argv[3] || '/tmp/t137';
const ONLY = process.argv[4] || '';

const fs = require('fs');
fs.mkdirSync(OUT_DIR, { recursive: true });

const HOLD_MS = 1100; // > HOLD_TO_CONFIRM 700ms + 余量
const USER_ID = '6f1c2a3b-9d4e-4f5a-8b6c-7d8e9f0a1b2c'; // 合法 v4 UUID

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function holdButton(page, text, timeout = 8000) {
  const btn = page.getByText(text, { exact: false }).first();
  await btn.waitFor({ state: 'visible', timeout });
  const box = await btn.boundingBox();
  if (!box) throw new Error(`no bbox for ${text}`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await sleep(HOLD_MS);
  await page.mouse.up();
}

async function seedLogin(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((uid) => {
    localStorage.clear();
    localStorage.setItem('starfit_user_id', uid);
    localStorage.setItem('starfit_server_url', 'http://localhost:43111');
    localStorage.setItem('starfit_server_ip', 'localhost');
  }, USER_ID);
  await page.reload({ waitUntil: 'domcontentloaded' });
  // 主界面就绪：空态胶囊（垂直居中，轮播 开始运动/添加动作）
  await page.getByText('开始运动').first().waitFor({ state: 'visible', timeout: 15000 });
}

/** 点击「位置在上半屏」的文本元素中心点（坐标点击，规避同格叠放文本互指 intercept） */
async function clickUpper(page, text, exact = false) {
  const handles = await page.getByText(text, { exact }).elementHandles();
  for (const h of handles) {
    const box = await h.boundingBox();
    if (box && box.y < 500) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
  }
  throw new Error(`no upper-half element for text: ${text}`);
}

async function addExercise(page) {
  // 空态：点居中胶囊 → 分裂菜单 → 挑选动作
  await clickUpper(page, '开始运动');
  await page.getByText('挑选动作').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.getByText('挑选动作').first().click();
  const row = page.getByText('悬垂举腿抬髋').first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.click();
  await page.getByText('去配置').first().click(); // 浏览页 → 清单页（参数配置）
  const confirm = page.getByText('添加1个').first();
  await confirm.waitFor({ state: 'visible', timeout: 5000 });
  await confirm.click();
  // 会话卡片出现（顶部胶囊随即上移到 non-centered 位）
  await page.getByText('悬垂举腿抬髋').first().waitFor({ state: 'visible', timeout: 10000 });
}

async function startSession(page) {
  // 已有动作：点顶部胶囊（idle+hasExercises → 非 centered，点按直接 onStart）
  await clickUpper(page, '开始运动');
  // active 后胶囊显示计时 00:00
  await page.getByText('00:00').first().waitFor({ state: 'visible', timeout: 8000 });
}

async function enterLockScreen(page) {
  // 训练中：计时胶囊下拖 >90px 进锁屏（TimerCapsule 手势）；等胶囊入场动画稳定
  await sleep(1000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const timer = page.getByText('00:0').first();
    const box = await timer.boundingBox();
    if (!box) throw new Error('no timer bbox');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx, y: cy, id: 1 }],
    });
    for (let i = 1; i <= 7; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: cx, y: cy + i * 20, id: 1 }],
      });
      await sleep(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    try {
      await page
        .locator('[data-testid="lock-info-window"]')
        .waitFor({ state: 'visible', timeout: 4000 });
      return;
    } catch {
      await sleep(800); // 重试（可能撞上入场动画）
    }
  }
  throw new Error('lock screen did not open after 3 drag attempts');
}

async function feelProbe(page) {
  return page.evaluate(() => {
    const modal = document.querySelector('[data-testid="feel-modal"]');
    const lock = document.querySelector('[data-testid="lock-info-window"]');
    const probe = { feelModalInDom: !!modal, lockScreenInDom: !!lock };
    if (modal) {
      const r = modal.getBoundingClientRect();
      probe.feelModalRect = { x: r.x, y: r.y, w: r.width, h: r.height };
      // 探针：sheet 中部（视口下半）最顶元素是谁——被盖住时会是锁屏层
      const el = document.elementFromPoint(195, 700);
      probe.topElementAt195x700 = el
        ? `${el.tagName}.${String(el.className).slice(0, 60)}`
        : null;
      probe.feelModalIsTop = modal.contains(el);
    }
    return probe;
  });
}

/** 场景 A：锁屏内完成全部组 */
async function scenarioA(page, tag) {
  const log = (m) => console.log(`[${tag}] ${m}`);
  await seedLogin(page);
  await addExercise(page);
  await startSession(page);
  await enterLockScreen(page);
  log('lock screen open');

  // 3 组：完成 → 结束休息 → 完成 → 结束休息 → 完成(末组) → 应弹感受表单
  for (let i = 1; i <= 3; i++) {
    await holdButton(page, `完成第 ${i} 组`);
    log(`set ${i} completed`);
    await sleep(600);
    const feelEarly = await feelProbe(page);
    if (i < 3) {
      await holdButton(page, '结束休息');
      log(`rest ${i} ended`);
      await sleep(400);
    }
  }
  // 等感受表单
  let appeared = false;
  try {
    await page
      .locator('[data-testid="feel-modal"]')
      .waitFor({ state: 'visible', timeout: 6000 });
    appeared = true;
  } catch {
    appeared = false;
  }
  const probe = await feelProbe(page);
  await page.screenshot({ path: path.join(OUT_DIR, `A-lockscreen-${tag}.png`) });
  const result = { scenario: 'A-lock', feelModalAppeared: appeared, ...probe };
  log('RESULT ' + JSON.stringify(result));
  return result;
}

/** 场景 B：非锁屏（主界面卡片）完成全部组 —— 对照，不应回归 */
async function scenarioB(page, tag) {
  const log = (m) => console.log(`[${tag}] ${m}`);
  await seedLogin(page);
  await addExercise(page);
  await startSession(page);
  log('session started (no lock screen)');

  // 卡片组行短按：完成 → (REST 行)再按结束休息 → 下一组……共 3 组
  // 组行完成钮 = 卡片内圆形按钮（含对勾/播放 SVG）。按 DOM 序逐个处理。
  for (let i = 1; i <= 3; i++) {
    // 未完成组的对勾钮（灰色对勾 SVG path M5 13l4 4L19 7，strokeWidth 3.5 灰色）
    const checkBtn = page
      .locator('button:has(svg path[d="M5 13l4 4L19 7"])')
      .last();
    await checkBtn.waitFor({ state: 'visible', timeout: 8000 });
    await checkBtn.click();
    log(`set ${i} tapped`);
    await sleep(700);
    // 若进入 REST（该行变白色 REST 行），短按结束休息
    const restLabel = page.getByText('REST').first();
    if (await restLabel.isVisible().catch(() => false)) {
      await restLabel.click();
      log(`rest ${i} ended`);
      await sleep(500);
    }
  }
  let appeared = false;
  try {
    await page
      .locator('[data-testid="feel-modal"]')
      .waitFor({ state: 'visible', timeout: 6000 });
    appeared = true;
  } catch {
    appeared = false;
  }
  const probe = await feelProbe(page);
  await page.screenshot({ path: path.join(OUT_DIR, `B-card-${tag}.png`) });
  const result = { scenario: 'B-card', feelModalAppeared: appeared, ...probe };
  log('RESULT ' + JSON.stringify(result));
  return result;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const results = {};
  try {
    if (ONLY !== 'onlyB') results.A = await scenarioA(page, process.argv[5] || 'before');
    if (ONLY !== 'onlyA') results.B = await scenarioB(page, process.argv[5] || 'before');
    fs.writeFileSync(
      path.join(OUT_DIR, `result-${process.argv[5] || 'before'}.json`),
      JSON.stringify(results, null, 2),
    );
    console.log('FINAL ' + JSON.stringify(results));
  } catch (e) {
    console.error('SCRIPT FAIL:', e.message);
    await page
      .screenshot({ path: path.join(OUT_DIR, `fail-${process.argv[5] || 'before'}.png`) })
      .catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
