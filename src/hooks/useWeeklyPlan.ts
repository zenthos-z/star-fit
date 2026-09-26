/**
 * useWeeklyPlan — 信息页「本周计划」数据源（C2 / issue #6）。
 *
 * 读确定性课表 API（GET /api/schedule/today?date=，纯 DB 读无 LLM）：
 * 对本周 7 个日历日各取一次（Promise.all 并行），聚合成 date → 课表映射。
 * 计划是否存在 / 三态判定全由服务器给出（planned / rest_day / no_plan），
 * 本 hook 只做取数与聚合，不做任何计划语义推导。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TodayScheduleResponse, WeeklyPlanSplit } from 'shared/contracts';
import { parseJSONSafe } from 'shared/contracts';
import { API_BASE, getHeaders } from '../services/geminiService';
import { getWeekDates } from '../utils/weeklyPlanView';

export interface WeeklyPlanState {
  loading: boolean;
  error: string | null;
  /** 本周 7 个本地日历日（周一 → 周日，YYYY-MM-DD） */
  weekDates: string[];
  /** date → 当日课表响应（加载失败/未返回的日期缺省） */
  dayMap: Record<string, TodayScheduleResponse>;
  /** 本周 ISO 周标识（取自任一成功响应；无响应为 null） */
  weekId: string | null;
  /** 本周分化（no_plan 周为 null） */
  split: WeeklyPlanSplit | null;
  /** 是否整周都无计划（引导生成） */
  hasNoPlan: boolean;
  refresh: () => void;
}

export function useWeeklyPlan(): WeeklyPlanState {
  const weekDates = useMemo(() => getWeekDates(), []);
  const [dayMap, setDayMap] = useState<Record<string, TodayScheduleResponse>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const results = await Promise.all(
        weekDates.map(async (date) => {
          try {
            const res = await fetch(`${API_BASE}/schedule/today?date=${date}`, {
              headers: getHeaders(),
            });
            if (!res.ok) return null;
            const parsed = parseJSONSafe<TodayScheduleResponse>(await res.text(), 'useWeeklyPlan');
            return parsed ?? null;
          } catch {
            return null; // 单日失败不影响整周展示（缺省日按无数据处理）
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, TodayScheduleResponse> = {};
      for (const r of results) {
        if (r) map[r.date] = r;
      }
      setDayMap(map);
      setLoading(false);
      if (results.every((r) => r === null)) {
        setError('课表加载失败，请检查后端连接');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekDates, tick]);

  const responses = weekDates.map((d) => dayMap[d]).filter(Boolean);
  const weekId = responses[0]?.week_id ?? null;
  // split 以首个「本周有计划」的响应为准（no_plan 周为 null）
  const planned = responses.find((r) => r.status !== 'no_plan');
  const split = planned?.split ?? null;
  const hasNoPlan = responses.length > 0 && responses.every((r) => r.status === 'no_plan');

  return { loading, error, weekDates, dayMap, weekId, split, hasNoPlan, refresh };
}
