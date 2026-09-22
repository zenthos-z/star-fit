/**
 * SessionRepo 单元测试（批次3补充）
 *
 * 通过 jest.mock 掉 postgres-client 模块，用内存假 client 验证关键路径：
 *  - ensureUser：空参短路、非法 manualUserId（SQLite 遗留非 UUID）回退设备查找
 *  - getRpeStats：RPE 日志 → 中位数统计
 *
 * 不依赖真实 PG，纯逻辑 + mock 断言。
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("../../../src/db/postgresql/client/postgres-client.js", () => {
  const client = {
    query: jest.fn(),
    queryOne: jest.fn(),
    queryMany: jest.fn(),
    transaction: jest.fn(),
  };
  return { getPostgresClient: jest.fn(() => client) };
});

import { SessionRepo } from "../../../src/services/sessionRepo.js";
import { CacheService } from "../../../src/services/cacheService.js";

const UUID = "15ba86ca-574c-42c1-b14a-eb4217d702c9";

function getFakeClient(): any {
  return (SessionRepo as any).getClient();
}

describe("SessionRepo", () => {
  beforeEach(() => {
    const client = getFakeClient();
    client.query.mockReset();
    client.queryOne.mockReset();
    client.queryMany.mockReset();
    client.transaction.mockReset();
  });

  describe("ensureUser", () => {
    it("returns null without touching the DB when both ids are empty", async () => {
      const client = getFakeClient();
      const result = await SessionRepo.ensureUser("", undefined);
      expect(result).toBeNull();
      expect(client.query).not.toHaveBeenCalled();
      expect(client.queryOne).not.toHaveBeenCalled();
    });

    it("falls back to device lookup when manualUserId is not a valid UUID (SQLite legacy)", async () => {
      const client = getFakeClient();
      client.queryOne.mockResolvedValue({ id: UUID, device_id: null, created_at: new Date().toISOString() });

      const result = await SessionRepo.ensureUser("device-abc", "global", true);

      expect(result?.id).toBe(UUID);
      expect(client.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("WHERE device_id = $deviceId"),
        { deviceId: "device-abc" },
      );
      // 'global' 不应作为 manualUserId 流入 SQL（会触发 uuid 类型错误）
      const calls = client.queryOne.mock.calls as Array<[string, unknown]>;
      expect(JSON.stringify(calls)).not.toContain("global");
    });

    it("uses a valid manualUserId directly (no device query)", async () => {
      const client = getFakeClient();
      client.queryOne.mockResolvedValue({ id: UUID, device_id: null, created_at: new Date().toISOString() });

      const result = await SessionRepo.ensureUser("", UUID, true);

      expect(result?.id).toBe(UUID);
      expect(client.queryOne).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = $manualUserId"),
        { manualUserId: UUID },
      );
    });
  });

  describe("getRpeStats", () => {
    it("computes median/count/last from the last 20 rpe_logs", async () => {
      const client = getFakeClient();
      // getUserId: device → user
      client.queryOne.mockResolvedValue({ id: UUID });
      // rpe_logs: newest-first
      client.queryMany.mockResolvedValue([
        { rpe: 8, timestamp: new Date("2026-09-20T10:00:00Z") },
        { rpe: 6, timestamp: new Date("2026-09-19T10:00:00Z") },
        { rpe: 7, timestamp: new Date("2026-09-18T10:00:00Z") },
      ]);

      const result = await SessionRepo.getRpeStats("device-rpe", "深蹲");

      // 排序 [6,7,8]，中位数下标 floor(3/2)=1 → 7；last = 最新一条 8
      expect(result).toEqual({ median: 7, count: 3, last: 8 });
      expect(client.queryMany).toHaveBeenCalledWith(
        expect.stringContaining("FROM rpe_logs"),
        expect.objectContaining({ exerciseName: "深蹲" }),
      );
    });

    it("returns null when the device has no user (unknown device)", async () => {
      const client = getFakeClient();
      client.queryOne.mockResolvedValue(undefined); // 无对应用户

      const result = await SessionRepo.getRpeStats("device-unknown", "卧推");
      expect(result).toBeNull();
      expect(client.queryMany).not.toHaveBeenCalled();
    });
  });
});
