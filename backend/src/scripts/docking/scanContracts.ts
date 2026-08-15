import fs from "node:fs/promises";
import path from "node:path";

type FindingSeverity = "P0" | "P1" | "P2";

type Finding = {
  id: string;
  severity: FindingSeverity;
  title: string;
  evidence: string;
  file?: string;
};

type ScanReport = {
  ok: boolean;
  generatedAt: string;
  findings: Finding[];
};

async function readText(filePath: string) {
  return fs.readFile(filePath, "utf-8");
}

function has(text: string, needle: string) {
  return text.includes(needle);
}

function repoRootFromHere() {
  return path.resolve(process.cwd(), "..");
}

async function main() {
  const repoRoot = repoRootFromHere();

  const targets = {
    wsClient: path.join(repoRoot, "src", "v2", "services", "transport", "WebSocketClient.ts"),
    server: path.join(process.cwd(), "src", "server.ts"),
  };

  // R9: masController target removed (MAS runtime deleted); the HITL resume
  // contract check that read it is gone too.
  const [wsClient, server] = await Promise.all([
    readText(targets.wsClient),
    readText(targets.server),
  ]);

  const findings: Finding[] = [];

  if (has(wsClient, "ws://localhost:8000/ws")) {
    findings.push({
      id: "ws.default_url_mismatch",
      severity: "P0",
      title: "v2 WS 默认地址与后端 /api/ws/sync 不一致",
      evidence: "检测到默认 ws://localhost:8000/ws",
      file: targets.wsClient,
    });
  }

  if (!has(server, "/ws/sync")) {
    findings.push({
      id: "ws.server_route_missing",
      severity: "P0",
      title: "后端未注册 /api/ws/sync（预期存在）",
      evidence: "未找到 /ws/sync",
      file: targets.server,
    });
  }

  if (has(server, "data.payload")) {
    findings.push({
      id: "ws.envelope_payload_only",
      severity: "P0",
      title: "后端 WS 消费仅读取 payload，无法兼容 CloudEvents data 字段",
      evidence: "检测到 data.payload 读取路径",
      file: targets.server,
    });
  }

  if (!has(server, "tutor.generate_tutorial")) {
    findings.push({
      id: "tutor.ws_unhandled",
      severity: "P0",
      title: "后端 WS 未处理 tutor.generate_tutorial（教学 fallback）",
      evidence: "未检测到 tutor.generate_tutorial 分支",
      file: targets.server,
    });
  }

  const report: ScanReport = {
    ok: findings.length === 0,
    generatedAt: new Date().toISOString(),
    findings,
  };

  const outDir = path.join(process.cwd(), "tmp");
  const outPath = path.join(outDir, "docking-contract-scan.json");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(JSON.stringify(report, null, 2));
  console.log(`Report saved: ${outPath}`);

  if (!report.ok) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
