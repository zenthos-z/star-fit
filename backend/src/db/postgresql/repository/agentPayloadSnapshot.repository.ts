/**
 * Agent Payload Snapshot Repository（issue #96 Agent 输入可视化页）
 *
 * agent_payload_snapshots 表的唯一读写入口：训练后审计快照
 * （交付时点的 normalize 后 payload + 硬校验结果 + 预处理标注）。
 *
 * 红线：
 *   - 快照是只读审计数据——本仓库不提供任何「修复/改写 payload」方法，
 *     唯一的写入口是 upsertSnapshot（ ingestion 链落快照，重同步覆盖）；
 *   - 所有查询按 user_id 限定（他用户的快照不可见）。
 *
 * 契约真源：shared/contracts/agent-payload-snapshot.ts（读回经 Zod 校验）。
 */

import { PostgresClient } from "../client/postgres-client.js";
import { BaseRepository } from "./base.repository.js";
import {
  AgentPayloadSnapshotListRowSchema,
  AgentPayloadSnapshotDetailSchema,
  AgentPayloadValidationSchema,
  type AgentPayloadSnapshotListRow,
  type AgentPayloadSnapshotDetail,
  type AgentPayloadValidation,
  type AgentSetPreprocessNote,
} from "shared/contracts";

/** upsert 写入行（snake_case 与表列一致；payload 为交付候选载荷本体） */
export interface AgentPayloadSnapshotWriteRow {
  user_id: string;
  session_id: string;
  start_time: Date | null;
  end_time: Date | null;
  title: string | null;
  exercise_count: number;
  validation_passed: boolean;
  payload: unknown;
  validation: AgentPayloadValidation;
  preprocess: AgentSetPreprocessNote[];
}

/** DB 原始行（jsonb 由 PG 预解析；时间列为 Date 对象） */
interface SnapshotRawRow {
  session_id: string;
  user_id: string;
  start_time: Date | null;
  end_time: Date | null;
  title: string | null;
  exercise_count: number;
  validation_passed: boolean;
  payload_json: unknown;
  validation_json: unknown;
  preprocess_json: unknown;
  snapshotted_at: Date;
  updated_at: Date;
}

export class AgentPayloadSnapshotRepository extends BaseRepository {
  constructor(client: PostgresClient) {
    super(client);
  }

  /**
   * 落一条交付快照（幂等：重同步同 session 覆盖为最新交付时点；
   * snapshotted_at 保留首次时刻）。返回读回的详情行（写读一致）。
   */
  async upsertSnapshot(
    row: AgentPayloadSnapshotWriteRow,
  ): Promise<AgentPayloadSnapshotDetail> {
    await this.execute(
      `INSERT INTO agent_payload_snapshots
         (user_id, session_id, start_time, end_time, title, exercise_count,
          validation_passed, payload_json, validation_json, preprocess_json,
          snapshotted_at, updated_at)
       VALUES ($userId, $sessionId, $startTime, $endTime, $title, $exerciseCount,
               $validationPassed, $payloadJson, $validationJson, $preprocessJson,
               NOW(), NOW())
       ON CONFLICT (user_id, session_id) DO UPDATE SET
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         title = EXCLUDED.title,
         exercise_count = EXCLUDED.exercise_count,
         validation_passed = EXCLUDED.validation_passed,
         payload_json = EXCLUDED.payload_json,
         validation_json = EXCLUDED.validation_json,
         preprocess_json = EXCLUDED.preprocess_json,
         updated_at = NOW()`,
      {
        userId: row.user_id,
        sessionId: row.session_id,
        startTime: row.start_time,
        endTime: row.end_time,
        title: row.title,
        exerciseCount: row.exercise_count,
        validationPassed: row.validation_passed,
        payloadJson: this.stringifyJSONB(row.payload),
        validationJson: this.stringifyJSONB(row.validation),
        preprocessJson: this.stringifyJSONB(row.preprocess),
      },
    );
    const detail = await this.getSnapshotBySessionId(
      row.user_id,
      row.session_id,
    );
    if (!detail) {
      // 刚写完即读不到 = 写入本身异常（冲突约束/触发器旁路），必须抛错上浮
      throw new Error(
        `agent_payload_snapshots upsert read-back failed for session ${row.session_id}`,
      );
    }
    return detail;
  }

  /**
   * 列表（摘要行，不含 payload 本体）：user 隔离，start_time 倒序分页。
   * 返回 rows + total（total 供前端分页条数计算）。
   */
  async listSnapshots(
    userId: string,
    options: { limit: number; offset: number },
  ): Promise<{ rows: AgentPayloadSnapshotListRow[]; total: number }> {
    const rows = await this.queryMany<SnapshotRawRow>(
      `SELECT session_id, user_id, start_time, end_time, title, exercise_count,
              validation_passed, payload_json, validation_json, preprocess_json,
              snapshotted_at, updated_at
         FROM agent_payload_snapshots
        WHERE user_id = $userId
        ORDER BY start_time DESC NULLS LAST, snapshotted_at DESC
        LIMIT $limit OFFSET $offset`,
      { userId, limit: options.limit, offset: options.offset },
    );
    const countRow = await this.queryOne<{ total: string | number }>(
      `SELECT count(*) AS total FROM agent_payload_snapshots WHERE user_id = $userId`,
      { userId },
    );
    const total = Number(countRow?.total ?? 0);
    return {
      // 每行独立 parse：单行脏数据抛错只影响该行定位，不影响整页
      rows: rows.map((r) =>
        AgentPayloadSnapshotListRowSchema.parse(this.toListRow(r)),
      ),
      total,
    };
  }

  /**
   * 详情（完整快照）：user 隔离；未命中（不存在/他人会话）返回 null。
   */
  async getSnapshotBySessionId(
    userId: string,
    sessionId: string,
  ): Promise<AgentPayloadSnapshotDetail | null> {
    const row = await this.queryOne<SnapshotRawRow>(
      `SELECT session_id, user_id, start_time, end_time, title, exercise_count,
              validation_passed, payload_json, validation_json, preprocess_json,
              snapshotted_at, updated_at
         FROM agent_payload_snapshots
        WHERE user_id = $userId AND session_id = $sessionId`,
      { userId, sessionId },
    );
    if (!row) return null;
    // 读回校验（红线：Zod 失败必须抛错）——快照行由本仓库唯一写入，形状
    // 契约化；脏行（如手工 SQL 注入的非法 validation）在读边界即暴露。
    return AgentPayloadSnapshotDetailSchema.parse(this.toDetail(row));
  }

  /** DB 原始行 → 列表行（时间列 ISO 化 + 校验码提取） */
  private toListRow(row: SnapshotRawRow): Record<string, unknown> {
    const validation = this.parseValidation(row.validation_json);
    return {
      session_id: row.session_id,
      start_time: row.start_time ? row.start_time.toISOString() : null,
      end_time: row.end_time ? row.end_time.toISOString() : null,
      title: row.title,
      exercise_count: Number(row.exercise_count),
      validation_passed: row.validation_passed,
      validation_code: validation.code,
      snapshotted_at: row.snapshotted_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  /** DB 原始行 → 详情行 */
  private toDetail(row: SnapshotRawRow): Record<string, unknown> {
    return {
      session_id: row.session_id,
      user_id: row.user_id,
      start_time: row.start_time ? row.start_time.toISOString() : null,
      end_time: row.end_time ? row.end_time.toISOString() : null,
      title: row.title,
      exercise_count: Number(row.exercise_count),
      validation_passed: row.validation_passed,
      validation: this.parseValidation(row.validation_json),
      payload: row.payload_json,
      preprocess: row.preprocess_json,
      snapshotted_at: row.snapshotted_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  /** validation_json 读回校验（AgentPayloadValidationSchema 单一真源） */
  private parseValidation(raw: unknown): AgentPayloadValidation {
    return this.parseJSONB<AgentPayloadValidation>(
      raw,
      AgentPayloadValidationSchema,
    );
  }
}

export function createAgentPayloadSnapshotRepository(
  client: PostgresClient,
): AgentPayloadSnapshotRepository {
  return new AgentPayloadSnapshotRepository(client);
}
