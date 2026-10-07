/**
 * #140 三轮复现脚本：主按钮跨状态位置固定 + 「+10 秒」副按钮独立
 *
 * 三态实测（真实浏览器 + CDP touch，锁屏全流程）：
 *   A. 单钮态（confirm：完成第 1 组）——量主钮 bbox + 按钮带 bbox
 *   B. 双钮态（rest：结束休息 + +10 秒）——同量（主钮 = 栈首）
 *   C. 单钮态回归（完成第 2 组）——同量
 * 断言：
 *   - 主钮 top 三态恒定（|Δ| ≤ 1px）→ 跨态屏幕坐标零变化
 *   - 按钮带 top/bottom 三态恒定（带高/底锚不动，172 + safe-bottom+100）
 *   - 双钮态「+10 秒」可见且其 top > 主钮 bottom（副钮在主钮下方，不推挤）
 *
 * 用法：node repro-button-band.cjs <appUrl> <outDir>
 * 依赖：仓库根 node_modules 的 playwright（chromium）；后端 :43111 在跑（动作库）。
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(process.cwd(), 'node_modules', 'playwright'));

const APP_URL = process.argv[2] || 'http://127.0.0.1:43132';
const OUT_DIR = process.argv[3] || path.join(process.cwd(), 'docs/design/screenshots-t140/shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const HOLD_MS = 1100; // > HOLD_TO_CONFIRM 700ms + 余量
const USER_ID = '6f1c2a3b-9d4e-4f5a-8b6c-7d8e9f0a1b2c'; // 合法 v4 UUID
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 点击「位置在上半屏」文本元素中心（坐标点击，规避同格叠放文本互指 intercept） */
async function clickUpper(page, text) {
  const handles = await page.getByText(text, { exact: false }).elementHandles();
  for (const h of handles) {
    const box = await h.boundingBox();
    if (box && box.y < 500) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
  }
  throw new Error(`no upper-half element for text: ${text}`);
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
  await page.getByText('开始运动').first().waitFor({ state: 'visible', timeout: 15000 });
}

async function addExercise(page) {
  await clickUpper(page, '开始运动');
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
  await clickUpper(page, '开始运动');
  await page.getByText('00:00').first().waitFor({ state: 'visible', timeout: 8000 });
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
      await page
        .locator('[data-testid="lock-info-window"]')
        .waitFor({ state: 'visible', timeout: 4000 });
      return;
    } catch {
      await sleep(800);
    }
  }
  throw new Error('lock screen did not open after 3 drag attempts');
}

/** CDP 长按：HoldToConfirm 700ms 阈值（胶囊/主钮/环钮同源 pointer 流） */
async function cdpTouchHold(page, el, ms = HOLD_MS) {
  const box = await el.boundingBox();
  if (!box) throw new Error('no bbox for hold target');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cx, y: cy, id: 1 }],
  });
  await sleep(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** 量五件：主钮（栈首）bbox / 副钮（栈次）bbox / 标签文本 / 按钮带 bbox */
async function measureBand(page) {
  const stack = page.locator('[data-testid="lock-button-stack"]');
  await stack.waitFor({ state: 'visible', timeout: 8000 });
  const kids = stack.locator('> *');
  const count = await kids.count();
  const pBox = await kids.first().boundingBox();
  const sBox = count > 1 ? await kids.nth(1).boundingBox() : null;
  const labels = await kids.allTextContents();
  const bandBox = await page.locator('[data-testid="lock-button-band"]').boundingBox();
  return {
    primaryTop: Math.round(pBox.y * 10) / 10,
    primaryBottom: Math.round((pBox.y + pBox.height) * 10) / 10,
    primaryLabel: (labels[0] || '').trim(),
    childCount: count,
    secondaryTop: sBox ? Math.round(sBox.y * 10) / 10 : null,
    secondaryLabel: (labels[1] || '').trim() || null,
    bandTop: Math.round(bandBox.y * 10) / 10,
    bandBottom: Math.round((bandBox.y + bandBox.height) * 10) / 10,
    bandHeight: Math.round(bandBox.height * 10) / 10,
  };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  try {
    await seedLogin(page);
    await addExercise(page);
    await startSession(page);
    await enterLockScreen(page);
    console.log('[t140-r3] lock screen open');

    // ---- 态 A：单钮（完成第 1 组） ----
    const stack = page.locator('[data-testid="lock-button-stack"]');
    await stack.getByText(/完成第 1 组/).waitFor({ state: 'visible', timeout: 8000 });
    await sleep(600); // 等入场动画稳定再量
    const A = await measureBand(page);
    await page.screenshot({ path: path.join(OUT_DIR, '3-button-band-single.png') });
    console.log('[A single]', JSON.stringify(A));

    // ---- 态 B：双钮（结束休息 + +10 秒） ----
    await cdpTouchHold(page, stack.getByText(/完成第 1 组/));
    await stack.getByText('结束休息').waitFor({ state: 'visible', timeout: 8000 });
    await sleep(900); // swap 动画退出 + 入场稳定
    const B = await measureBand(page);
    await page.screenshot({ path: path.join(OUT_DIR, '4-button-band-dual.png') });
    console.log('[B dual]', JSON.stringify(B));

    // ---- 态 C：单钮回归（完成第 2 组） ----
    await cdpTouchHold(page, stack.getByText('结束休息'));
    await stack.getByText(/完成第 2 组/).waitFor({ state: 'visible', timeout: 8000 });
    await sleep(900);
    const C = await measureBand(page);
    await page.screenshot({ path: path.join(OUT_DIR, '5-button-band-single-again.png') });
    console.log('[C single-again]', JSON.stringify(C));

    // ---- 断言 ----
    const dAB = Math.abs(A.primaryTop - B.primaryTop);
    const dAC = Math.abs(A.primaryTop - C.primaryTop);
    const bandStable =
      A.bandTop === B.bandTop && B.bandTop === C.bandTop && A.bandBottom === B.bandBottom;
    const secondaryBelow =
      B.childCount === 2 &&
      (B.secondaryLabel || '').includes('+10 秒') &&
      B.secondaryTop >= B.primaryBottom; // 副钮整个位于主钮下方（不重叠、不推挤）
    const probe = {
      states: { single: A, dual: B, singleAgain: C },
      mainButtonTopDeltaAB: dAB,
      mainButtonTopDeltaAC: dAC,
      mainButtonZeroDrift: dAB <= 1 && dAC <= 1,
      bandGeometryStable: bandStable,
      secondaryBelowMain: secondaryBelow,
    };
    fs.writeFileSync(
      path.join(process.cwd(), 'docs/design/screenshots-t140/probe-button-band.json'),
      JSON.stringify(probe, null, 2),
    );
    console.log('PROBE ' + JSON.stringify(probe));
    const ok =
      probe.mainButtonZeroDrift && probe.bandGeometryStable && probe.secondaryBelowMain;
    if (!ok) throw new Error('probe assertion failed');
    console.log('ALL PROBES PASS');
  } catch (e) {
    console.error('SCRIPT FAIL:', e.message);
    await page
      .screenshot({ path: path.join(OUT_DIR, 'fail-button-band.png') })
      .catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
