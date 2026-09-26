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
import {
  getTodaySchedule,
  getScheduleSummary,
} from "../controllers/scheduleController.js";

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

  // Debug / Admin
  app.post("/admin/resolve-context", resolveContext);
}
