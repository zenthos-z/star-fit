import { test } from "node:test";
import assert from "node:assert/strict";
import { BridgeClient, ApiError, NetworkError } from "../src/client.js";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function mockFetch(
  handler: (url: string) => { status: number; body: string },
): { calls: RecordedCall[]; fetch: typeof fetch } {
  const calls: RecordedCall[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const { status, body } = handler(String(url));
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetch: impl };
}

test("client: api 路径自动补 /api 前缀（含已带 /api 的基址不重复）", () => {
  const c1 = new BridgeClient("http://h:43111", "");
  assert.equal(c1.apiUrl("/admin/users"), "http://h:43111/api/admin/users");
  const c2 = new BridgeClient("http://h:43111/api/", "");
  assert.equal(c2.apiUrl("/admin/users"), "http://h:43111/api/admin/users");
  const c3 = new BridgeClient("http://h:43111///", "");
  assert.equal(c3.apiUrl("/x"), "http://h:43111/api/x");
  assert.equal(c3.rootUrl("/health"), "http://h:43111/health");
});

test("client: token 注入 X-Access-Token；body 注入 Content-Type", async () => {
  const { calls, fetch } = mockFetch(() => ({ status: 200, body: '{"ok":true}' }));
  const c = new BridgeClient("http://h:1", "tok123", fetch);
  await c.api("/admin/configs", { method: "POST", body: { key: "k", value: 1 } });
  const call = calls[0]!;
  assert.equal(
    (call.init.headers as Record<string, string>)["X-Access-Token"],
    "tok123",
  );
  assert.equal(
    (call.init.headers as Record<string, string>)["Content-Type"],
    "application/json",
  );
  assert.equal(call.init.body, '{"key":"k","value":1}');
});

test("client: 无 token 时不发鉴权头", async () => {
  const { calls, fetch } = mockFetch(() => ({ status: 200, body: "[]" }));
  const c = new BridgeClient("http://h:1", "", fetch);
  await c.api("/exercises");
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>)["X-Access-Token"],
    undefined,
  );
});

test("client: JSON 响应解析为对象；空体返回 null", async () => {
  const { fetch } = mockFetch(() => ({ status: 200, body: '{"a":1}' }));
  const c = new BridgeClient("http://h:1", "", fetch);
  assert.deepEqual(await c.api("/x"), { a: 1 });
  const { fetch: f2 } = mockFetch(() => ({ status: 200, body: "" }));
  const c2 = new BridgeClient("http://h:1", "", f2);
  assert.equal(await c2.api("/x"), null);
});

test("client: 非 2xx 抛 ApiError（携带状态/端点/错误消息）", async () => {
  const { fetch } = mockFetch(() => ({
    status: 401,
    body: '{"error":"invalid or missing access token"}',
  }));
  const c = new BridgeClient("http://h:1", "bad", fetch);
  await assert.rejects(
    () => c.api("/admin/users"),
    (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 401);
      assert.match(e.endpoint, /GET \/api\/admin\/users/);
      assert.match(e.message, /invalid or missing access token/);
      return true;
    },
  );
});

test("client: 网络故障抛 NetworkError（含排查提示）", async () => {
  const failing = (async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:43111");
  }) as unknown as typeof fetch;
  const c = new BridgeClient("http://h:1", "", failing);
  await assert.rejects(
    () => c.api("/x"),
    (e: unknown) => {
      assert.ok(e instanceof NetworkError);
      assert.match(e.message, /bridge config set server/);
      return true;
    },
  );
});

// ── 端点映射（动词 → 现有 REST API，mock fetch 断言）──────────────────

test("mapping: sessions → GET /api/admin/users/:id/sessions?limit=", async () => {
  const { calls, fetch } = mockFetch(() => ({ status: 200, body: "[]" }));
  const ctx = {
    client: new BridgeClient("http://h:1", "t", fetch),
    stdout: () => {},
    stderr: () => {},
  };
  const { cmdDataSessions } = await import("../src/commands.js");
  await cmdDataSessions(ctx, "11111111-1111-1111-1111-111111111111", 5, 10);
  const url = calls[0]!.url;
  assert.match(url, /\/api\/admin\/users\/11111111-1111-1111-1111-111111111111\/sessions\?limit=5&offset=10$/);
  assert.equal(calls[0]!.init.method, "GET");
});

test("mapping: exercises --id → GET /api/exercises/:id；缺省 → 列表", async () => {
  const { calls, fetch } = mockFetch(() => ({ status: 200, body: "{}" }));
  const ctx = {
    client: new BridgeClient("http://h:1", "", fetch),
    stdout: () => {},
    stderr: () => {},
  };
  const { cmdDataExercises } = await import("../src/commands.js");
  await cmdDataExercises(ctx, "ex-123");
  assert.equal(calls[0]!.url, "http://h:1/api/exercises/ex-123");
  await cmdDataExercises(ctx, undefined);
  assert.equal(calls[1]!.url, "http://h:1/api/exercises");
});

test("mapping: plans → 逐日 GET /api/schedule/today?date= 带 X-User-Id", async () => {
  const { calls, fetch } = mockFetch(() => ({
    status: 200,
    body: '{"date":"2026-10-05","status":"no_plan","entries":[]}',
  }));
  const ctx = {
    client: new BridgeClient("http://h:1", "", fetch),
    stdout: () => {},
    stderr: () => {},
  };
  const { cmdDataPlans } = await import("../src/commands.js");
  const result = await cmdDataPlans(
    ctx,
    "11111111-1111-1111-1111-111111111111",
    undefined,
    "2026-10-05",
    "2026-10-06",
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, "http://h:1/api/schedule/today?date=2026-10-05");
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>)["X-User-Id"],
    "11111111-1111-1111-1111-111111111111",
  );
  assert.ok(Array.isArray(result.data));
  assert.equal((result.data as unknown[]).length, 2);
});

test("mapping: app-config set → POST /api/admin/configs {key,value}", async () => {
  const { calls, fetch } = mockFetch(() => ({
    status: 200,
    body: '{"success":true}',
  }));
  const ctx = {
    client: new BridgeClient("http://h:1", "", fetch),
    stdout: () => {},
    stderr: () => {},
  };
  const { cmdAppConfigSet } = await import("../src/commands.js");
  await cmdAppConfigSet(ctx, "pinned_users", '["a","b"]');
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(calls[0]!.url, "http://h:1/api/admin/configs");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    key: "pinned_users",
    value: ["a", "b"],
  });
});

test("mapping: app-config get key → GET /api/admin/configs/:key", async () => {
  const { calls, fetch } = mockFetch(() => ({
    status: 200,
    body: '{"key":"k","value":1}',
  }));
  const ctx = {
    client: new BridgeClient("http://h:1", "", fetch),
    stdout: () => {},
    stderr: () => {},
  };
  const { cmdAppConfigGet } = await import("../src/commands.js");
  await cmdAppConfigGet(ctx, "k");
  assert.equal(calls[0]!.url, "http://h:1/api/admin/configs/k");
});
