/**
 * ExerciseSortService 单元测试（issue #31：picker 智能排序后端真源）
 *
 * 通过 jest.mock 掉 postgres-client 模块，按 SQL 文本分流内存假数据：
 *  - 同分区去重：多次训练同一分区只计最新一条（本批核心规则）
 *  - 排序合成：近期置顶（新→旧）+ 其余保持库序
 *  - 防御口径：userId 缺失/非法 → 纯库序基线不查 sessions；
 *    坏 raw_json / 解析不出库行的条目静默跳过
 *  - 兜底链：libraryId 优先，name / name_zh 兜底，legacy libraryId 字段兼容
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

import { ExerciseSortService } from "../../../src/services/exerciseSortService.js";
import { getPostgresClient } from "../../../src/db/postgresql/client/postgres-client.js";

const UUID = "15ba86ca-574c-42c1-b14a-eb4217d702c9";

/** 库投影（listSortProjection 输出形态：id/name/name_zh/body_part，库序 = created_at 序） */
const LIB = [
  { id: "lib-pushup", name: "Push Up", name_zh: "俯卧撑", body_part: "chest" }, // upper
  {
    id: "lib-squat",
    name: "Back Squat",
    name_zh: "深蹲",
    body_part: "upper_legs",
  }, // lower
  { id: "lib-plank", name: "Plank", name_zh: "平板支撑", body_part: "waist" }, // core
  {
    id: "lib-run",
    name: "Treadmill Run",
    name_zh: "跑步机",
    body_part: "cardio",
  }, // cardio
  {
    id: "lib-curl",
    name: "Bicep Curl",
    name_zh: "弯举",
    body_part: "upper_arms",
  }, // upper
];

/** 按 SQL 文本分流：exercises 投影走 base repo（client.query→{rows}）；sessions 走 SessionRepo（client.queryMany→行数组） */
function mockDb(sessions: any[]) {
  const client = (getPostgresClient as jest.Mock)();
  client.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM exercises")) return { rows: LIB };
    throw new Error("unexpected sql: " + sql);
  });
  client.queryMany.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM sessions")) return sessions;
    throw new Error("unexpected sql: " + sql);
  });
}

describe("ExerciseSortService.getSmartSort", () => {
  beforeEach(() => {
    const client = (getPostgresClient as jest.Mock)();
    client.query.mockReset();
    client.queryOne.mockReset();
    client.queryMany.mockReset();
    client.transaction.mockReset();
  });

  it("近期分区去重：同分区多次出现只计最新，置顶头按新→旧，其余保持库序", async () => {
    mockDb([
      // 最新一节：练上肢（弯举）
      {
        id: "s1",
        raw_json: {
          exercises: [
            { name: "Bicep Curl", metadata: { libraryId: "lib-curl" } },
          ],
        },
      },
      // 更早一节：练下肢 + 上肢（俯卧撑按 name_zh 兜底，属更早的 upper → 被去重丢弃）
      {
        id: "s2",
        raw_json: {
          exercises: [
            { name: "Back Squat", metadata: { libraryId: "lib-squat" } },
            { name: "俯卧撑" }, // 无 libraryId，name_zh 兜底
          ],
        },
      },
    ]);

    const res = await ExerciseSortService.getSmartSort(UUID);

    expect(res.recent_regions).toEqual(["upper", "lower"]); // 重复 upper 只计最新
    expect(res.recent_exercise_ids).toEqual(["lib-curl", "lib-squat"]);
    // 置顶头（新→旧）+ 其余保持库序（pushup 虽近期练过，但分区已被更新的 curl 代表）
    expect(res.ranked_ids).toEqual([
      "lib-curl",
      "lib-squat",
      "lib-pushup",
      "lib-plank",
      "lib-run",
    ]);
    // 窗口：sessions 查询带 LIMIT（SMART_SORT_RECENT_SESSION_LIMIT）
    const sessionsCall = (
      getPostgresClient as jest.Mock
    )().queryMany.mock.calls.find((c: any[]) =>
      String(c[0]).includes("FROM sessions"),
    );
    expect(sessionsCall?.[1]).toMatchObject({ userId: UUID, limit: 10 });
  });

  it("userId 缺失 / 非法：纯库序基线，不查 sessions 不抛错", async () => {
    mockDb([]); // 不应被消费
    for (const userId of [undefined, null, "not-a-uuid", ""]) {
      const res = await ExerciseSortService.getSmartSort(userId as any);
      expect(res.ranked_ids).toEqual(LIB.map((r) => r.id));
      expect(res.recent_regions).toEqual([]);
      expect(res.recent_exercise_ids).toEqual([]);
    }
    const sessionCalls = (
      getPostgresClient as jest.Mock
    )().queryMany.mock.calls.filter((c: any[]) =>
      String(c[0]).includes("FROM sessions"),
    );
    expect(sessionCalls).toHaveLength(0);
  });

  it("坏 raw_json / 解析不出库行的条目：静默跳过返回基线，不抛错", async () => {
    mockDb([
      { id: "s1", raw_json: "{not valid json" }, // 坏行跳过
      {
        id: "s2",
        raw_json: { exercises: [{ name: "库里没有的动作", metadata: null }] },
      }, // 解析不出库行
      { id: "s3", raw_json: { other: true } }, // 无 exercises 数组
    ]);
    const res = await ExerciseSortService.getSmartSort(UUID);
    expect(res.recent_regions).toEqual([]);
    expect(res.recent_exercise_ids).toEqual([]);
    expect(res.ranked_ids).toEqual(LIB.map((r) => r.id));
  });

  it("raw_json 为 JSON 字符串（旧形态）同样解析；legacy libraryId 字段兜底", async () => {
    mockDb([
      {
        id: "s1",
        raw_json: JSON.stringify({
          exercises: [
            { libraryId: "lib-run", name: "跑步机训练" }, // 无 metadata，legacy 字段兜底 → cardio
          ],
        }),
      },
    ]);
    const res = await ExerciseSortService.getSmartSort(UUID);
    expect(res.recent_regions).toEqual(["cardio"]);
    expect(res.recent_exercise_ids).toEqual(["lib-run"]);
    expect(res.ranked_ids[0]).toBe("lib-run");
  });

  it("置顶上限：近期动作超过 limit(3) 时只置顶最新 3 条", async () => {
    mockDb([
      {
        id: "s1",
        raw_json: {
          exercises: [
            { name: "Plank", metadata: { libraryId: "lib-plank" } },
            { name: "Back Squat", metadata: { libraryId: "lib-squat" } },
            { name: "Push Up", metadata: { libraryId: "lib-pushup" } },
            { name: "Bicep Curl", metadata: { libraryId: "lib-curl" } }, // 第 4 条被截断
          ],
        },
      },
    ]);
    const res = await ExerciseSortService.getSmartSort(UUID);
    expect(res.recent_exercise_ids).toEqual([
      "lib-plank",
      "lib-squat",
      "lib-pushup",
    ]);
    expect(res.ranked_ids.slice(0, 3)).toEqual([
      "lib-plank",
      "lib-squat",
      "lib-pushup",
    ]);
    expect(res.ranked_ids.slice(3)).toEqual(["lib-run", "lib-curl"]); // curl 落回库序
  });

  it("body_part 缺省：POST 建的动作按 primary_muscles 肌群兜底判区（批量添加→排序闭环）", async () => {
    // 模拟 POST /exercises 建的行：body_part 为 NULL，仅 primary_muscles 可判
    const client = (getPostgresClient as jest.Mock)();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM exercises")) {
        return {
          rows: [
            {
              id: "lib-api1",
              name: "API Press",
              name_zh: null,
              body_part: null,
              primary_muscles: ["chest", "triceps"],
            },
          ],
        };
      }
      throw new Error("unexpected sql: " + sql);
    });
    client.queryMany.mockResolvedValue([
      {
        id: "s1",
        raw_json: {
          exercises: [
            { name: "API Press", metadata: { libraryId: "lib-api1" } },
          ],
        },
      },
    ]);

    const res = await ExerciseSortService.getSmartSort(UUID);
    expect(res.recent_regions).toEqual(["upper"]); // chest → upper
    expect(res.recent_exercise_ids).toEqual(["lib-api1"]);
    expect(res.ranked_ids[0]).toBe("lib-api1");
  });
});
