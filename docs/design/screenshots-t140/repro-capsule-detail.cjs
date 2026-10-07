/**
 * issue #140 复现/截图脚本：锁屏胶囊长按暂停 + 预览图长按进详情
 *
 * 双向断言：
 *   A. 胶囊长按 ≥700ms → 暂停（计时冻结 + 控制条展开：左「结束」红 / 右「继续」蓝）
 *      → 轻点控制条收起 → 「继续」环钮长按 → 恢复计时（三链路全通）
 *   B. 预览大图长按 ≥500ms → 动作教学 sheet 打开且盖在锁屏之上（锁屏不卸载，
 *      计时不停）→ 点关闭回锁屏继续
 *
 * 用法：node repro-capsule-detail.js <appUrl> <outDir>
 * 依赖：仓库根 node_modules 的 playwright（chromium）；后端 43111 在跑。
 * 手势走 CDP touch 仿真（真实 pointer 流，非 mouse 合成）——与 WKWebView 同构。
 */
const path = require('path');
const { chromium } = require(path.join(process.cwd(), 'node_modules', 'playwright'));
const fs = require('fs');

const APP_URL = process.argv[2] || 'http://localhost:43112';
const OUT_DIR = process.argv[3] || path.join(__dirname, 'shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const USER_ID = '6f1c2a3b-9d4e-4f5a-8b6c-7d8e9f0a1b2c'; // 合法 v4 UUID（#137 同款种子）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpTouchHold(page, box, ms) {
  // CDP 原生 touch 流：touchStart → 保持 → touchEnd（真实 pointer 序列）
  const cdp = await page.context().newCDPSession(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cx, y: cy, id: 1 }],
  });
  await sleep(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function cdpTap(page, box) {
  const cdp = await page.context().newCDPSession(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cx, y: cy, id: 1 }],
  });
  await sleep(90);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
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
  await page.getByText('开始运动').first().waitFor({ state: 'visible', timeout: 20000 });
}

async function addExercise(page) {
  const handles = await page.getByText('开始运动', { exact: true }).elementHandles();
  for (const h of handles) {
    const box = await h.boundingBox();
    if (box && box.y < 500) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      break;
    }
  }
  await page.getByText('挑选动作').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.getByText('挑选动作').first().click();
  const row = page.getByText('悬垂举腿抬髋').first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.click();
  await page.getByText('去配置').first().click();
  const confirm = page.getByText('添加1个').first();
  await confirm.waitFor({ state: 'visible', timeout: 5000 });
  await confirm.click();
  await page.getByText('悬垂举腿抬髋').first().waitFor({ state: 'visible', timeout: 10000 });
}

async function startSession(page) {
  let hit = false;
  for (const sel of ['开始运动', '开始训练', '开始']) {
    const handles = await page.getByText(sel, { exact: false }).elementHandles();
    for (const h of handles) {
      const box = await h.boundingBox();
      if (box && box.y < 400) {
        console.log('[t140] clicking start via', sel, JSON.stringify(box));
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        hit = true;
        break;
      }
    }
    if (hit) break;
  }
  if (!hit) {
    await page.screenshot({ path: 'docs/design/screenshots-t140/shots/debug-before-start.png' });
    throw new Error('no start button found in upper half');
  }
  try {
    await page.getByText('00:00').first().waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    await page.screenshot({ path: 'docs/design/screenshots-t140/shots/debug-after-start.png' });
    throw new Error('session timer not visible after start');
  }
}

async function enterLockScreen(page) {
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
      await page.locator('[data-testid="lock-info-window"]').waitFor({ state: 'visible', timeout: 4000 });
      return;
    } catch {
      await sleep(800);
    }
  }
  throw new Error('lock screen did not open after 3 drag attempts');
}

(async () => {
  const log = (m) => console.log(`[t140] ${m}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
  });

  await seedLogin(page);
  log('seeded + home ready');
  await addExercise(page);
  await startSession(page);
  await enterLockScreen(page);
  log('lock screen open');
  await sleep(1200); // 等入场动画稳定

  // ---- A. 胶囊长按暂停 ----
  const capsule = page.locator('button[aria-label="上滑解锁"]');
  const capBox = await capsule.boundingBox();
  if (!capBox) throw new Error('capsule not found');
  const timeBefore = (await capsule.textContent()).trim();
  await cdpTouchHold(page, capBox, 1100); // > HOLD_MS 700 + 余量
  await page.locator('[aria-label="暂停控制"]').waitFor({ state: 'visible', timeout: 3000 });
  log('pause controls expanded');

  // 断言：计时冻结 + 控制条置顶
  const bar = page.locator('[aria-label="暂停控制"]');
  const barBox = await bar.boundingBox();
  const barTimeA = (await bar.textContent()).trim();
  await sleep(1300);
  const barTimeB = (await bar.textContent()).trim();
  const topAtBar = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const bar = document.querySelector('[aria-label="暂停控制"]');
    return { hit: el ? el.tagName + '.' + String(el.className).slice(0, 40) : null, isBar: !!bar && bar.contains(el) };
  }, { x: barBox.x + barBox.width / 2, y: barBox.y + barBox.height / 2 });
  const probeA = {
    capsuleTimeBefore: timeBefore,
    barTimeFrozen: barTimeA === barTimeB,
    barTime: barTimeB,
    controlsExpanded: true,
    barIsTopLayer: topAtBar.isBar,
    topElementAtBar: topAtBar.hit,
  };
  log('A probe ' + JSON.stringify(probeA));
  await page.screenshot({ path: path.join(OUT_DIR, '1-pause-controls-expanded.png') });

  // 「继续」环钮长按 → 恢复（计时再走；控制条展开态内操作）
  const resume = page.locator('[aria-label="继续训练"]');
  const resumeBox = await resume.boundingBox();
  await cdpTouchHold(page, resumeBox, 1100);
  await page.locator('[aria-label="暂停控制"]').waitFor({ state: 'detached', timeout: 3000 });
  const capsule2 = page.locator('button[aria-label="上滑解锁"]');
  const t1 = (await capsule2.textContent()).trim();
  await sleep(1300);
  const t2 = (await capsule2.textContent()).trim();
  log(`B resume: ${t1} -> ${t2} (ticking=${t1 !== t2})`);

  // ---- B. 预览大图长按进详情 ----
  const thumb = page.locator('img[data-testid="action-thumb"]');
  const thumbBox = await thumb.boundingBox();
  if (!thumbBox) throw new Error('thumb img not found');
  await cdpTouchHold(page, thumbBox, 900); // > THUMB_HOLD_MS 500 + 余量
  await page.locator('[aria-label="关闭"]').first().waitFor({ state: 'visible', timeout: 6000 });
  log('tutorial sheet open over lockscreen');
  await sleep(1500); // 等内容/封面稳定

  const probeB = await page.evaluate(() => {
    const lock = document.querySelector('button[aria-label="上滑解锁"]');
    const sheet = document.querySelector('.fixed.inset-x-0.bottom-0.z-\\[80\\]');
    const lockRoot = document.querySelector('.fixed.inset-0.z-\\[140\\]');
    const mid = document.elementFromPoint(195, 500);
    return {
      lockScreenStillMounted: !!lock && !!lockRoot,
      sheetMounted: !!sheet,
      sheetCoversLock: !!mid && !!sheet && sheet.contains(mid),
      topAtSheet: mid ? mid.tagName + '.' + String(mid.className).slice(0, 40) : null,
    };
  });
  log('B probe ' + JSON.stringify(probeB));
  await page.screenshot({ path: path.join(OUT_DIR, '2-detail-over-lockscreen.png') });

  // 点关闭 → 回锁屏（sheet 卸载、锁屏还在、计时未停）
  await page.locator('[aria-label="关闭"]').first().click();
  await page.locator('[aria-label="关闭"]').first().waitFor({ state: 'detached', timeout: 3000 });
  const back = await page.evaluate(() => ({
    lockScreenBack: !!document.querySelector('button[aria-label="上滑解锁"]'),
  }));
  const t3 = (await page.locator('button[aria-label="上滑解锁"]').textContent()).trim();
  await sleep(1200);
  const t4 = (await page.locator('button[aria-label="上滑解锁"]').textContent()).trim();
  const probeC = { ...back, timerStillTicking: t3 !== t4, t3, t4 };
  log('C probe ' + JSON.stringify(probeC));

  fs.writeFileSync(
    path.join(OUT_DIR, 'probe.json'),
    JSON.stringify({ A: probeA, B: probeB, C: probeC }, null, 2)
  );
  const ok =
    probeA.barTimeFrozen && probeA.barIsTopLayer &&
    probeB.lockScreenStillMounted && probeB.sheetMounted && probeB.sheetCoversLock &&
    probeC.lockScreenBack && t1 !== t2 && t3 !== t4;
  log(ok ? 'ALL PROBES PASS' : 'PROBE FAILURE');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('[t140] FATAL', e.message);
  process.exit(2);
});
