import type { FastifyInstance } from "fastify";
import {
  postImage,
  postClassifyExercise,
} from "../controllers/agentController.js";
import { postChat } from "../controllers/chatController.js";
import { postUpload, getMedia } from "../controllers/mediaController.js";
import { getHistorySummary } from "../controllers/historyController.js";
import { resolveContext } from "../controllers/adminController.js";
import {
  postSession,
  getRecentSessions,
  postHRSamples,
} from "../controllers/sessionController.js";
import { postSuggestions } from "../controllers/suggestionController.js";
import { getSuggestionsCache } from "../controllers/suggestionCacheController.js";
import { postApplyProfileProposals } from "../controllers/profileProposalController.js";
import {
  getTodaySchedule,
  getScheduleSummary,
  postApplyWeeklyPlan,
} from "../controllers/scheduleController.js";
import {
  listAgentPayloadSnapshots,
  getAgentPayloadSnapshot,
} from "../controllers/agentPayloadController.js";

export default async function agentRoutes(app: FastifyInstance) {
  app.post("/agent/classify", postClassifyExercise);
  app.post("/agent/image", postImage);
  // E2: 今日课表确定性 API（训练前零容忍等待：纯 DB 读，无 LLM；
  // 无计划时返回结构化 no_plan，前端据此引导，不在本路径生成）
  app.get("/schedule/today", getTodaySchedule);
  // B2: 开始运动路由判定 summary（issue #22）——has_plan / today /
  // today_entries / user_stage / onboarding 一发返回；今日三态复用 E2 口径，
  // 纯 DB 读 + 纯函数判定，AI 零参与
  app.get("/schedule/summary", getScheduleSummary);
  // [B5b issue#38] weekly_plan 卡确认落库：确定性写入端点（无 LLM），
  // 前端在用户点「确认启用」后直调——提案-确认架构，确认前不落库
  app.post("/schedule/weekly-plan/apply", postApplyWeeklyPlan);
  // P010: canonical SSE chat endpoint over the frozen AgentService.chat seam.
  // Registered under the /api prefix in server.ts -> full path /api/chat.
  app.post("/chat", postChat);
  app.post("/agent/chat", postChat);
  // R9: /mas/chat (legacy WS-style MAS chat) removed — MAS runtime deleted.
  // /agent/plan + /tutorial HTTP endpoints removed (dead routes): plan now goes
  // through /api/chat (scenario=plan), tutorial goes through the WS
  // `tutor.generate_tutorial` handler in server.ts (fixed workflow, kept).
  app.post("/media/uploadData", postUpload);
  app.get("/media/:id", getMedia);
  app.get("/history/summary", getHistorySummary);

  // Phase 1: Session persistence (workout_complete refactor)
  // Frontend persists session data to DB first, then calls Agent for analysis.
  app.post("/sessions", postSession);
  app.get("/sessions/recent", getRecentSessions);
  // 心率样本批量入库（ADR-0001，手表训后批量同步通路）
  app.post("/sessions/:sessionId/hr-samples", postHRSamples);

  // 动作建议值（混合模式：公式基准 + 可选 Agent 有界调整；Agent 故障降级 formula）
  app.post("/suggestions", postSuggestions);

  // [B6 issue#39] 建议参数缓存对账：fingerprint 匹配回缓存，不匹配同步重算
  // （公式层毫秒级）返回新指纹 + 全量。前端打开 App 静默拉取，无 LLM。
  app.get("/suggestions/cache", getSuggestionsCache);

  // [B5 issue#37] 画像确认纯程序化写入：profile_update_confirm 卡片确认后
  // 前端直调（确定性端点，无 LLM）。毫秒级落库后前端才触发续跑主线。
  app.post("/profile/apply-proposals", postApplyProfileProposals);

  // Debug / Admin
  app.post("/admin/resolve-context", resolveContext);

  // #96 Agent 输入可视化页：交付载荷快照回看（训练后审计，只读）。
  // 鉴权同全部 /api 路由（STARFIT_ACCESS_TOKEN 门 + X-User-Id 用户隔离）。
  app.get("/debug/agent-payloads", listAgentPayloadSnapshots);
  app.get("/debug/agent-payloads/:sessionId", getAgentPayloadSnapshot);
}
