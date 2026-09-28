/**
 * B6 建议参数缓存 API 剧本验证（issue #39 后端批）—— 纯 Node，零依赖。
 *
 * 前置（见 b6-verify-run.sh）：后端 43111（公式路径 + 空闲窗口 3s）+ mock
 * GLM 43199 已起，本脚本对着真实 PG 断言四个验证门：
 *
 *  a) 画像更新（apply-proposals）→ 空闲窗口后缓存整批重算（psql 指纹变了）
 *  b) GET /api/suggestions/cache fingerprint 对账（匹配 / 不匹配两分支）
 *  c) chat SSE 进行中触发心跳 → 重算不抢占（指纹不变）；对话结束后补偿执行
 *  d) 计划上下文因子：当日已排 3 个胸动作 → 第 4 个胸动作建议容量低于第 1 个
 *     （同一动作 A/B：排计划前后自身重量对比 + 因子元数据断言）
 *
 * 退出码 0 = 全部门通过；任一断言失败即打印 FAIL 并退出 1。
 */

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";

const API = process.env.B6_API ?? "http://127.0.0.1:43111";
const PSQL = process.env.B6_PSQL ?? "docker exec starfit-postgres psql -U starfit -d starfit";
const IDLE_WINDOW_MS = Number(process.env.B6_IDLE_WINDOW_MS ?? 3000);
const DEFER_CHECK_MS = 10_000; // scheduler chat 延后复查间隔（与实现常量一致）

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sql(query) {
  return execSync(`${PSQL} -t -A -c ${JSON.stringify(query)}`, {
    encoding: "utf8",
  }).trim();
}

function isoWeekId(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

async function apiGet(path, userId) {
  const res = await fetch(`${API}${path}`, {
    headers: { "X-User-Id": userId, "content-type": "application/json" },
  });
  return { status: res.status, body: await res.json() };
}

async function apiPost(path, userId, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "X-User-Id": userId, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** 该用户缓存批次快照：指纹 + 最新 updated_at（HHMMSS） */
function cacheState(userId) {
  const row = sql(
    `SELECT context_fingerprint || ' @ ' || to_char(max(updated_at), 'HH24:MI:SS')` +
      ` FROM suggestion_cache WHERE user_id = '${userId}'` +
      ` GROUP BY context_fingerprint ORDER BY max(updated_at) DESC LIMIT 1`,
  );
  return row || "(empty)";
}

// ---------------------------------------------------------------------------
// 剧本
// ---------------------------------------------------------------------------

async function main() {
  // ── 测试用户（login-or-create；唯一名避免撞老账号）────────────────────────
  const loginName = `b6-verify-${Date.now()}`;
  const login = await apiPost("/api/admin/login-or-create", "global", {
    userId: loginName,
  });
  const userId =
    login.body?.userId ??
    login.body?.data?.userId ??
    login.body?.user?.id;
  check(
    "setup: login-or-create 返回 UUID",
    Boolean(userId) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        String(userId),
      ),
    JSON.stringify(login.body).slice(0, 120),
  );
  if (!userId) process.exit(1);

  try {
    // ── 验证门 b：fingerprint 对账语义 ────────────────────────────────────
    const cold = await apiGet("/api/suggestions/cache", userId);
    const F1 = cold.body?.fingerprint;
    const libCount = Number(
      sql("SELECT count(*) FROM exercises WHERE owner_user_id IS NULL"),
    );
    check(
      "b1: 冷缓存 GET → matched=false + 全量 + 新指纹",
      cold.status === 200 &&
        cold.body?.matched === false &&
        Array.isArray(cold.body?.suggestions) &&
        cold.body.suggestions.length === libCount &&
        typeof F1 === "string" &&
        F1.length > 0,
      `status=${cold.status} matched=${cold.body?.matched} n=${cold.body?.suggestions?.length}/${libCount} fp=${F1}`,
    );
    if (cold.status !== 200 || !Array.isArray(cold.body?.suggestions)) {
      // 打到别人的后端 / 路由缺失等硬性环境问题：后续断言必然连环崩，直接终止
      console.error(
        "FATAL: cold GET failed — 检查 B6_API 是否指向本剧本拉起的后端",
      );
      process.exit(1);
    }
    check(
      "b1-meta: 条目自带 plan_context / context_fingerprint / source",
      cold.body.suggestions.every(
        (s) =>
          s.context_fingerprint === F1 &&
          s.plan_context &&
          typeof s.plan_context.factor === "number" &&
          (s.source === "formula" || s.source === "hybrid"),
      ),
      `sample=${JSON.stringify(cold.body.suggestions[0]?.plan_context)}`,
    );

    const hit = await apiGet(`/api/suggestions/cache?fingerprint=${F1}`, userId);
    check(
      "b2: 指纹匹配 → matched=true（沿用缓存，不重算）",
      hit.status === 200 &&
        hit.body?.matched === true &&
        hit.body?.fingerprint === F1 &&
        hit.body.suggestions.length === libCount,
      `matched=${hit.body?.matched} fp=${hit.body?.fingerprint}`,
    );

    const stale = await apiGet(
      "/api/suggestions/cache?fingerprint=deadbeef",
      userId,
    );
    check(
      "b3: 客户端指纹过期 → matched=false + 新指纹全量",
      stale.status === 200 &&
        stale.body?.matched === false &&
        stale.body?.fingerprint === F1 &&
        stale.body.suggestions.length === libCount,
      `matched=${stale.body?.matched} fp=${stale.body?.fingerprint}`,
    );

    // ── 验证门 d：计划上下文因子（当日 3 胸 → 第 4 胸降载）────────────────
    const chestIds = sql(
      `SELECT string_agg(id || '|' || name, E'\n' ORDER BY name)` +
        ` FROM (SELECT id, name FROM exercises` +
        `       WHERE owner_user_id IS NULL AND 'chest' = ANY(primary_muscles)` +
        `         AND exercise_type = 'resistance' LIMIT 4) t`,
    ).split("\n");
    check("d-setup: 库内 ≥4 个胸部 resistance 动作", chestIds.length >= 4, `n=${chestIds.length}`);
    const [e1, e2, e3, outsider] = chestIds.map((l) => {
      const [id, ...rest] = l.split("|");
      return { id, name: rest.join("|") };
    });

    const before = await apiGet("/api/suggestions/cache", userId);
    const beforeOutsider = before.body.suggestions.find(
      (s) => s.exercise_name === outsider.name,
    );
    check(
      "d1: 排计划前 outsider 无降载（factor=1 / prior=0）",
      beforeOutsider?.plan_context?.factor === 1 &&
        beforeOutsider?.plan_context?.prior_same_muscle_exercises === 0,
      JSON.stringify(beforeOutsider?.plan_context),
    );

    // 种当日计划：3 个胸动作（直插 plan_entries —— 验证剧本种子数据）
    const weekId = isoWeekId(todayUtc());
    sql(
      `INSERT INTO weekly_plans (user_id, week_id, split, status)` +
        ` VALUES ('${userId}', '${weekId}', 'custom', 'active')` +
        ` ON CONFLICT (user_id, week_id) DO NOTHING`,
    );
    const values = [e1, e2, e3]
      .map(
        (e, i) =>
          `('${userId}', '${todayUtc()}', '${e.id}', 3, 'rpe', 7, 8, 'planned', ${i})`,
      )
      .join(",");
    sql(
      `INSERT INTO plan_entries (user_id, entry_date, exercise_id, target_sets,` +
        ` target_load_type, target_load_min, target_load_max, status, sort_order, weekly_plan_id)` +
        ` SELECT v.user_id::uuid, v.entry_date::date, v.exercise_id, v.target_sets,` +
        ` v.load_type::public.plan_load_type, v.load_min, v.load_max,` +
        ` v.status::public.plan_entry_status, v.sort_order, wp.id` +
        ` FROM (VALUES ${values}) AS v(user_id, entry_date, exercise_id, target_sets, load_type, load_min, load_max, status, sort_order)` +
        ` JOIN weekly_plans wp ON wp.user_id = v.user_id::uuid AND wp.week_id = '${weekId}'`,
    );

    const after = await apiGet("/api/suggestions/cache", userId);
    const F2 = after.body.fingerprint;
    const afterOutsider = after.body.suggestions.find(
      (s) => s.exercise_name === outsider.name,
    );
    const firstPlanned = after.body.suggestions.find(
      (s) => s.exercise_name === e1.name,
    );
    check(
      "d2: 计划落库 → 指纹变化（整批重算）",
      F2 !== before.body.fingerprint,
      `${before.body.fingerprint} → ${F2}`,
    );
    check(
      "d3: 第 4 个胸动作（不在计划内）factor=0.85 / prior=3",
      Math.abs(afterOutsider?.plan_context?.factor - 0.85) < 1e-9 &&
        afterOutsider?.plan_context?.prior_same_muscle_exercises === 3 &&
        afterOutsider?.plan_context?.muscle === "chest",
      JSON.stringify(afterOutsider?.plan_context),
    );
    const w0 = beforeOutsider?.values?.weight;
    const w1 = afterOutsider?.values?.weight;
    check(
      "d4: 第 4 个胸动作建议容量低于第 1 个（同动作 A/B + 首位计划动作 factor=1）",
      typeof w1 === "number" &&
        typeof w0 === "number" &&
        w1 < w0 &&
        firstPlanned?.plan_context?.factor === 1 &&
        (firstPlanned?.values?.weight ?? 0) > w1,
      `outsider ${w0}→${w1}kg；首个计划动作 ${firstPlanned?.values?.weight}kg factor=${firstPlanned?.plan_context?.factor}`,
    );

    // ── 验证门 a：apply-proposals → 空闲窗口后整批重算（指纹变化）──────────
    const stateA0 = cacheState(userId);
    const apply1 = await apiPost("/api/profile/apply-proposals", userId, {
      proposals: [
        {
          field: "load_anchors",
          value: {
            [e1.name]: {
              best_weight: 100,
              best_reps: 5,
              est_1rm: 111,
              last_updated: Date.now(),
            },
          },
        },
      ],
    });
    check(
      "a1: apply-proposals 200",
      apply1.status === 200 && apply1.body?.ok === true,
      `status=${apply1.status} body=${JSON.stringify(apply1.body).slice(0, 80)}`,
    );

    await sleep(IDLE_WINDOW_MS + 2500); // 窗口 + 重算 + 余量
    const stateA1 = cacheState(userId);
    check(
      "a2: 空闲窗口后缓存整批重算（psql 指纹变了）",
      stateA1 !== "(empty)" && stateA1 !== stateA0 && !stateA1.startsWith(F2),
      `before=[${stateA0}] after=[${stateA1}]`,
    );
    const rowsAfterA = Number(
      sql(
        `SELECT count(*) FROM suggestion_cache WHERE user_id = '${userId}' AND context_fingerprint = split_part('${stateA1}', ' @ ', 1)`,
      ),
    );
    check(
      "a3: 重算后仍整批（行数 = 动作库数）",
      rowsAfterA === libCount,
      `rows=${rowsAfterA}/${libCount}`,
    );
    const hitAfterA = await apiGet(
      `/api/suggestions/cache?fingerprint=${splitPart(stateA1, 1)}`,
      userId,
    );
    check(
      "a4: 旧指纹 F2 现已过期（matched=false），新指纹匹配（matched=true）",
      (await apiGet(`/api/suggestions/cache?fingerprint=${F2}`, userId)).body
        .matched === false &&
        hitAfterA.body?.matched === true &&
        hitAfterA.body?.fingerprint === splitPart(stateA1, 1),
      `stale-matched=false, fresh-matched=${hitAfterA.body?.matched}`,
    );

    // ── 验证门 c：chat SSE 进行中重算不抢占 ────────────────────────────────
    const stateC0 = cacheState(userId);
    const chatEvents = {
      tokens: 0,
      done: false,
      error: null,
      firstTokenAt: 0,
      lastTokenAt: 0,
      connectedAt: 0,
    };
    const chatPromise = new Promise((resolve) => {
      // 用 node:http 而非 fetch：undici 会把小帧整个缓冲到响应结束才吐出
      // （实测首 token 25s 后才可见，c1/c2 断言全被打乱）；http.request 的
      // data 事件即时到达，与 curl -N 行为一致。
      const payload = JSON.stringify({
        message: "这轮对话用于 B6 验证：请随意回复一句话。",
        scenario: "chat",
        threadId: `b6-verify-${Date.now()}`,
      });
      const req = http.request(
        `${API}/api/chat`,
        {
          method: "POST",
          headers: {
            "X-User-Id": userId,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            chatEvents.error = `chat HTTP ${res.statusCode}`;
            res.resume();
            resolve();
            return;
          }
          // 200 响应头到手 = SSE 已建立（tracker 在 streamAgentSSE 首次迭代
          // 即标记活跃；token 因主线上 tool-leak 修复的终步快照缓冲设计，
          // 要到模型调用结束才批量可见 —— 心跳时机应锚连接而非首 token）
          chatEvents.connectedAt = Date.now();
          let buf = "";
          res.on("data", (chunk) => {
            buf += chunk.toString("utf8");
            const frames = buf.split("\n\n");
            buf = frames.pop() ?? "";
            for (const frame of frames) {
              const dataLine = frame
                .split("\n")
                .find((l) => l.startsWith("data:"));
              if (!dataLine) continue;
              try {
                const evt = JSON.parse(dataLine.slice(5).trim());
                if (evt.type === "token") {
                  chatEvents.tokens += 1;
                  if (!chatEvents.firstTokenAt) {
                    chatEvents.firstTokenAt = Date.now();
                  }
                  chatEvents.lastTokenAt = Date.now();
                } else if (evt.type === "done") {
                  chatEvents.done = true;
                } else if (evt.type === "error") {
                  chatEvents.error = JSON.stringify(evt).slice(0, 120);
                }
              } catch {
                /* 非 JSON 帧忽略 */
              }
            }
          });
          res.on("end", resolve);
          res.on("error", () => resolve());
        },
      );
      req.on("error", (err) => {
        chatEvents.error ??= err.message;
        resolve();
      });
      req.end(payload);
    });

    // 心跳时机：tracker 在 streamAgentSSE 首次 next() 即标记活跃（服务端
    // 同步行为，先于任何 SSE 事件——Fastify 的 SSE 响应头也延迟到首个事件
    // 才 flush，客户端无从提前观测）。POST 无即刻报错 + 固定 2.5s 落定后
    // 触发心跳即可确保落在流生命周期内（mock 流 ≥24s；流的活性由 c3 事后
    // 证明 tokens>1 && done）。
    await sleep(2500);
    check(
      "c1: chat POST 已派发且无即刻错误（SSE 流建立中）",
      !chatEvents.error,
      `error=${chatEvents.error}`,
    );

    // 对话进行中触发画像心跳（重算任务起表，窗口 3s）
    await apiPost("/api/profile/apply-proposals", userId, {
      proposals: [
        {
          field: "load_anchors",
          value: {
            [e2.name]: {
              best_weight: 90,
              best_reps: 5,
              est_1rm: 99,
              last_updated: Date.now(),
            },
          },
        },
      ],
    });
    // 窗口（3s）+ 余量 1.5s 到期：重算应被延后（chat 活跃），指纹不得变
    await sleep(IDLE_WINDOW_MS + 1500);
    const stateC1 = cacheState(userId);
    check(
      "c2: chat 进行中，窗口到期后重算未抢占（指纹未变）",
      stateC1 === stateC0,
      `during-chat=[${stateC1}] expected=[${stateC0}]`,
    );

    // 等对话自然结束（mock 30 token × 800ms ≈ 24s；含余量）
    const chatTimeout = Date.now() + 60_000;
    while (!chatEvents.done && !chatEvents.error && Date.now() < chatTimeout) {
      await sleep(500);
    }
    await chatPromise;
    check(
      "c3: chat 流全程不受影响（多 token + 正常 done，无 error）",
      chatEvents.tokens > 1 &&
        chatEvents.done &&
        !chatEvents.error,
      `tokens=${chatEvents.tokens} done=${chatEvents.done} error=${chatEvents.error}`,
    );
    if (!chatEvents.done) {
      console.error("FATAL: chat 流未正常结束，c4 的补偿语义不可判");
      process.exit(1);
    }

    // 对话结束后：延后复查（10s）+ 执行 + 余量 → 缓存应已补偿重算
    await sleep(DEFER_CHECK_MS + 6000);
    const stateC2 = cacheState(userId);
    check(
      "c4: chat 结束后重算补偿执行（psql 指纹变了）",
      stateC2 !== stateC0,
      `after-chat=[${stateC2}] before=[${stateC0}]`,
    );
  } finally {
    // ── 清理种子数据（保留用户行无 FK 危害，但顺手清干净）──────────────────
    try {
      sql(`DELETE FROM plan_entries WHERE user_id = '${userId}'`);
      sql(`DELETE FROM weekly_plans WHERE user_id = '${userId}'`);
      sql(`DELETE FROM suggestion_cache WHERE user_id = '${userId}'`);
      sql(`DELETE FROM users WHERE id = '${userId}' AND display_name = '${loginName}'`);
      sql(
        `DELETE FROM agent_runtime.checkpoints WHERE thread_id LIKE '${userId}:%'`,
      );
    } catch (err) {
      console.warn("cleanup failed (non-fatal):", err?.message ?? err);
    }
  }

  console.log(`\n==== B6 验证剧本：${results.length - failed}/${results.length} 通过 ====`);
  process.exit(failed === 0 ? 0 : 1);
}

function splitPart(s, idx) {
  return String(s).split(" @ ")[idx - 1];
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
