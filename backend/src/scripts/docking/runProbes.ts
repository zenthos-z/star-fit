import WebSocket from "ws";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type ProbeResult = {
  name: string;
  ok: boolean;
  details?: any;
};

type ProbeReport = {
  target: {
    backendBase: string;
    apiBase: string;
    wsUrl: string;
  };
  generatedAt: string;
  results: ProbeResult[];
};

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function createTimeout(ms: number, message: string) {
  let handle: any;
  const promise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(message)), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

async function probePing(apiBase: string): Promise<ProbeResult> {
  const url = `${apiBase}/ping`;
  const res = await fetch(url, { method: "GET" });
  const json = await res.json().catch(() => ({}));
  return {
    name: "http.ping",
    ok: Boolean(res.ok && json?.pong),
    details: { status: res.status, body: json },
  };
}

async function withWs<T>(
  url: string,
  fn: (ws: WebSocket) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const ws = new WebSocket(url);
  const timeout = createTimeout(timeoutMs, `WS timeout after ${timeoutMs}ms`);

  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (e) => reject(e));
  });

  await Promise.race([opened, timeout.promise]);
  timeout.cancel();
  try {
    return await fn(ws);
  } finally {
    try {
      ws.close();
    } catch {}
  }
}

async function probeWsTutor(wsUrl: string): Promise<ProbeResult> {
  const result = await withWs(
    wsUrl,
    async (ws) => {
      const envelope = {
        specversion: "1.0",
        type: "tutor.generate_tutorial",
        source: "/probe",
        id: crypto.randomUUID(),
        time: nowIso(),
        datacontenttype: "application/json",
        data: { exerciseName: "squat", lang: "zh" },
      };

      ws.send(JSON.stringify(envelope));

      const response = await new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("No tutor response message received")), 15000);
        ws.on("message", (buf) => {
          try {
            const msg = JSON.parse(buf.toString());
            if (msg?.type === "tutor.tutorial_result") {
              clearTimeout(t);
              resolve(msg);
            }
          } catch {}
        });
      });

      return response;
    },
    22000
  );

  return { name: "ws.tutor.generate_tutorial", ok: true, details: result };
}

async function main() {
  const backendBase = process.env.BACKEND_BASE || "http://localhost:43111";
  const apiBase = `${backendBase.replace(/\/$/, "")}/api`;
  const wsUrl =
    (process.env.WS_URL as string | undefined) || `ws://localhost:43111/api/ws/sync?userId=global&deviceId=probe`;

  const results: ProbeResult[] = [];
  try {
    results.push(await probePing(apiBase));
  } catch (e: any) {
    results.push({ name: "http.ping", ok: false, details: { error: e?.message || String(e) } });
  }

  await sleep(200);

  try {
    results.push(await probeWsTutor(wsUrl));
  } catch (e: any) {
    results.push({ name: "ws.tutor.generate_tutorial", ok: false, details: { error: e?.message || String(e) } });
  }

  const report: ProbeReport = {
    target: { backendBase, apiBase, wsUrl },
    generatedAt: nowIso(),
    results,
  };

  const outDir = path.join(process.cwd(), "tmp");
  const outPath = path.join(outDir, "docking-probes.json");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(JSON.stringify(report, null, 2));
  console.log(`Report saved: ${outPath}`);

  if (results.some((r) => !r.ok)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
