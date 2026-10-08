/**
 * #142 FeelModal 三缺陷浏览器验证脚本（Playwright + CDP touch，390×844 @2x）。
 *
 * 前置：临时 harness（feel-harness.html，验证后删除）经 vite dev 提供组件挂载台，
 * 底层垫片 150vw 让 body 横向可滚——「拖滑块页面横滚」的复现前提。
 *
 * 探针：
 *  ① 确认钮 tap 位移（#142 缺陷1）：CDP touchStart 按住确认钮 250ms 后量 bbox——
 *     修复前 whileTap scale 写 inline transform 覆盖类位移 → 按钮下坠半高（~18px）；
 *     修复后位移由 framer 组合（translateY(-50%) scale(...)）→ 中心恒在（±2px）。
 *     touchCancel 收尾，不产生 click（modal 不关）。
 *  ② 滑块横滚（#142 缺陷2a）：CDP touch 拖 set-1 滑块至左端/右端，逐 move 采样
 *     window.scrollX——修复后恒 0（body 同时确认横向可滚 scrollWidth > 390）。
 *  ③ 滑柄两端可见（#142 缺陷2b）：value 0/100 时 thumb bbox 必须整体落在
 *     feel-rows 容器 bbox 内（±1px 浮点容差），并出 3 张视口截图。
 *  ④ 确认钮 click → onConfirm 真实触达（harness-result 出现）。
 *
 * 用法：node feel-verify-142.cjs <url> <shotsDir> [--legacy]
 *   --legacy：验证修复前的 HEAD 版本（thumb 无 testid，按 24px 圆形特征定位；
 *             各探针只记录实测值、几何断言输出 FAIL 但不中断，供 PR 前后对照）
 */
const { chromium } = require('playwright');

const url = process.argv[2] || 'http://127.0.0.1:43132/feel-harness.html';
const shotsDir = process.argv[3] || 'shots';
const legacy = process.argv.includes('--legacy');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CDP 触摸拖动：从 (x0,y) 逐步拖到 x1，每步后跑 sampler（返回值收集） */
async function touchDragX(cdp, page, x0, y, x1, { steps = 8, settle = 90 } = {}, sampler) {
  const samples = [];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  if (sampler) samples.push(await sampler());
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await sleep(settle);
    if (sampler) samples.push(await sampler());
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(200);
  return samples;
}

const getScrollX = (page) =>
  page.evaluate(() => ({
    scrollX: window.scrollX,
    docLeft: document.documentElement.scrollLeft,
    scrollable: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const results = {};
  let failures = 0;
  const check = (name, ok, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : legacy ? 'FAIL(legacy-expected)' : 'FAIL'}  ${name}  ${detail}`);
  };

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="feel-modal"]', { timeout: 10000 });
  await sleep(800); // sheet 进场动画 420ms + 渲染稳定

  // 前提条件：body 横向可滚（150vw 垫片生效），否则 ② 的 scrollX===0 无意义
  const pre = await getScrollX(page);
  check('precondition: body horizontally scrollable', pre.scrollable, JSON.stringify(pre));

  // ① 确认钮 tap 位移：按住 250ms 量中心漂移，touchCancel 收尾不触发 click
  const confirm = page.locator('[data-testid="feel-confirm"]');
  const box0 = await confirm.boundingBox();
  const cy = box0.y + box0.height / 2;
  const cx = box0.x + box0.width / 2;
  const transformAtRest = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="feel-confirm"]');
    return el ? el.style.transform : '(missing)';
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  await sleep(250); // whileTap scale 动画帧跑起来
  const box1 = await confirm.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await sleep(300);
  const drift = Math.abs(box0.y + box0.height / 2 - (box1.y + box1.height / 2));
  results.confirmTapDriftPx = +drift.toFixed(2);
  results.confirmTransformAtRest = transformAtRest;
  check('① confirm tap center drift < 2px', drift < 2, `drift=${drift.toFixed(2)}px rest="${transformAtRest}"`);

  // ②③ 拖 set-1 滑块至左端：逐 move 采样 scrollX（须恒 0）→ 几何断言 → 截图
  const slider = page.locator('[data-testid="feel-slider-set-1"]');
  const sb = await slider.boundingBox();
  const sy = sb.y + sb.height / 2;
  const rows = await page.locator('[data-testid="feel-rows"]').boundingBox();

  /** thumb bbox：优先 testid；legacy 无 testid → 行区内 24×24 圆形特征定位 */
  const thumbBox = async () =>
    page.evaluate(() => {
      const rows = document.querySelector('[data-testid="feel-rows"]');
      if (!rows) return null;
      const byId = document.querySelector('[data-testid="feel-thumb-set-1"]');
      if (byId) {
        const r = byId.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      for (const el of rows.querySelectorAll('div[aria-hidden="true"]')) {
        const r = el.getBoundingClientRect();
        if (Math.abs(r.width - 24) < 1 && Math.abs(r.height - 24) < 1) {
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }
      }
      return null;
    });

  const rr = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="feel-rows"]').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

  const thumbWithinRows = (t) =>
    t && t.x >= rr.x - 1 && t.x + t.width <= rr.x + rr.width + 1;

  // 左端拖动（scrollX 逐 move 采样）
  const leftSamples = await touchDragX(cdp, page, sb.x + sb.width / 2, sy, sb.x + 2, {}, () =>
    getScrollX(page),
  );
  const leftMaxScroll = Math.max(...leftSamples.flatMap((s) => [Math.abs(s.scrollX), Math.abs(s.docLeft)]));
  results.leftDragMaxScrollX = leftMaxScroll;
  check('② drag-to-left scrollX stays 0', leftMaxScroll === 0, `max|scrollX|=${leftMaxScroll}`);

  const tL = await thumbBox();
  results.thumbLeft = tL;
  check('③ thumb fully visible at 0%', thumbWithinRows(tL), `thumb=${JSON.stringify(tL)} rows.x=${rr.x}`);
  await page.screenshot({ path: `${shotsDir}/2-far-left.png` });

  // 右端拖动（从中位出发重新采样）
  const rightSamples = await touchDragX(cdp, page, sb.x + sb.width / 2, sy, sb.x + sb.width - 2, {}, () =>
    getScrollX(page),
  );
  const rightMaxScroll = Math.max(...rightSamples.flatMap((s) => [Math.abs(s.scrollX), Math.abs(s.docLeft)]));
  results.rightDragMaxScrollX = rightMaxScroll;
  check('② drag-to-right scrollX stays 0', rightMaxScroll === 0, `max|scrollX|=${rightMaxScroll}`);

  const tR = await thumbBox();
  results.thumbRight = tR;
  check('③ thumb fully visible at 100%', thumbWithinRows(tR), `thumb=${JSON.stringify(tR)} rowsRight=${rr.x + rr.width}`);
  await page.screenshot({ path: `${shotsDir}/3-far-right.png` });

  // 中位态截图（重开 harness 前先拍当前右端后回中？——中位即初始 50，须在最前拍；
  // 这里补拍法：重载页面回到初始 50 态）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="feel-modal"]', { timeout: 10000 });
  await sleep(800);
  await page.screenshot({ path: `${shotsDir}/1-middle.png` });

  // ④ 确认钮 click → onConfirm 真实触达（浏览器层首点即勾选）。
  // legacy 修法前的按钮 tap 期下坠会吞 click——此步超时即缺陷 1 的浏览器级复现
  let clickReached = false;
  let clickDetail = 'not attempted';
  try {
    await page.locator('[data-testid="feel-confirm"]').click();
    await page.waitForSelector('[data-testid="harness-result"]', { timeout: 5000 });
    clickReached = /CONFIRMED 3 rows/.test(
      await page.locator('[data-testid="harness-result"]').textContent(),
    );
    clickDetail = 'onConfirm reached on first click';
  } catch {
    clickDetail = 'first click swallowed (button shifted away mid-tap)';
  }
  check('④ confirm click reaches onConfirm', clickReached, clickDetail);

  await browser.close();
  console.log('\nRESULTS ' + JSON.stringify(results, null, 2));
  console.log(failures === 0 ? 'ALL PROBES GREEN' : `${failures} probe(s) failed`);
  process.exit(legacy ? 0 : failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SCRIPT ERROR', e);
  process.exit(2);
});
