/**
 * coachPrefill — AI 教练入口输入框预填文案（B1 / issue #5）。
 *
 * 纯前端确定性组装：数据源 = E2 今日课表 API（TodayScheduleResponse，纯 DB 读）
 * + 本地训练历史有无（loadHistory），AI 零参与（不算术、不拼数据、不生成）。
 * 三场景：
 *   A 有周计划且今日有条目 → 今日计划摘要（「今天是我的推拉腿：…，带我练」）
 *   B 无周计划 + 本地无训练记录（新手）→ 引导预填
 *   C 老用户无今日计划（休息日 / 本周无计划）→ 轻预填
 *
 * 红线对齐：本文件只做展示文案推导，与 weeklyPlanView 同风格
 * （类型一律从 shared/contracts 导入；负荷文案复用 formatTargetLoad，
 * 不做任何训练算术；预填文本可编辑、不自动发送——发送权在用户）。
 */
import type { TodayScheduleResponse } from 'shared/contracts';
import { formatTargetLoad, splitLabelZh } from './weeklyPlanView';

/** 场景 B：无计划新手（本地无训练记录 + 无周计划）的引导预填 */
export const NEWBIE_PREFILL = '我是新手，帮我安排一次入门全身训练';

/** 场景 C：老用户无今日计划（休息日 / 本周无计划）的轻预填 */
export const LIGHT_PREFILL = '今天练什么？';

/** 摘要最多展开的动作条数（超出折叠为计数，防输入框溢出） */
const MAX_ENTRY_SUMMARY = 6;

/**
 * 场景 A：计划日预填文案。
 * 「今天是我的推拉腿：杠铃卧推 4组·RPE 7–8 / 绳索下压 3组·RPE 8，带我练」
 * 条目超过上限时折叠：「…等 9 个动作，带我练」。
 * 形态异常（status=planned 但 entries 意外为空）返回空串，由 resolveCoachPrefill 兜底。
 */
export function buildPlannedPrefill(schedule: TodayScheduleResponse): string {
  const entries = schedule.entries ?? [];
  if (entries.length === 0) return '';

  const head = schedule.split ? `今天是我的${splitLabelZh(schedule.split)}：` : '今天训练：';
  const shown = entries.slice(0, MAX_ENTRY_SUMMARY);
  const items = shown.map((e) => `${e.exercise_name} ${e.target_sets}组·${formatTargetLoad(e.target_load)}`);
  const tail = entries.length > MAX_ENTRY_SUMMARY ? ` 等 ${entries.length} 个动作` : '';
  return `${head}${items.join(' / ')}${tail}，带我练`;
}

/**
 * 三场景路由（唯一判定入口，useAICoach.openAiCoach 调用）。
 *
 * @param schedule   E2 今日课表响应；null 表示课表不可得（网络/后端失败/形态非法）
 * @param hasHistory 本地是否有任何训练记录（loadHistory 非空）
 */
export function resolveCoachPrefill(
  schedule: TodayScheduleResponse | null,
  hasHistory: boolean,
): string {
  // 场景 A：今日有条目 → 计划摘要（契约保证 planned ⟺ entries 非空；
  // 形态异常摘要为空串时按轻预填兜底，不静默失败）
  if (schedule?.status === 'planned') {
    return buildPlannedPrefill(schedule) || LIGHT_PREFILL;
  }

  // 数据不可得：老用户不猜（宁缺勿错，输入框留白）；
  // 无记录者仍按新手引导（本地判定，不依赖网络）
  if (!schedule) return hasHistory ? '' : NEWBIE_PREFILL;

  // 场景 B：新手（issue 判定：本地无训练记录 + 本周无计划）
  if (!hasHistory && schedule.status === 'no_plan') return NEWBIE_PREFILL;

  // 场景 C：老用户无今日计划（休息日 / 本周无计划）→ 轻预填
  return LIGHT_PREFILL;
}
