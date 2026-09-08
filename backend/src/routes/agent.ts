import type { FastifyInstance } from "fastify";
import { postImage, postClassifyExercise } from "../controllers/agentController.js";
import { postChat } from "../controllers/chatController.js";
import { postUpload, getMedia } from "../controllers/mediaController.js";
import { getHistorySummary } from "../controllers/historyController.js";
import { resolveContext } from "../controllers/adminController.js";
import { postSession, getRecentSessions } from "../controllers/sessionController.js";
import { postSuggestions } from "../controllers/suggestionController.js";

export default async function agentRoutes(app: FastifyInstance) {
  app.post("/agent/classify", postClassifyExercise);
  app.post("/agent/image", postImage);
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

  // 动作建议值（混合模式：公式基准 + 可选 Agent 有界调整；Agent 故障降级 formula）
  app.post("/suggestions", postSuggestions);

  // Debug / Admin
  app.post("/admin/resolve-context", resolveContext);
}
