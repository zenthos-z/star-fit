/**
 * #98 组后感受聚合表单 · 共享类型 + 纯函数（App / FeelModal / 测试共用的单一定义源）。
 *
 * STRENGTH_SET_TYPES：组完成后存在组间休息（App handleUpdateSet 塞默认 60s 倒计时），
 * 同时是聚合表单的触发集合与结算闸门的扫描集合——有氧/户外是持续运动，
 * 完成后无休息语境。★App 侧休息赋值分支与本清单语义必须同步（清单唯一定义源在此）。
 */
import type { Exercise, ExerciseType, Session } from '../../types/legacy';
import type { ExerciseSetEntry } from '../../../shared/contracts';

export const STRENGTH_SET_TYPES: ExerciseType[] = [
  'resistance', 'bodyweight', 'assisted', 'unilateral', 'weight_only', 'reps_only', 'isometric',
];

/** 聚合表单里的一行 = 一个待记组 */
export interface FeelModalRow {
  setId: string;
  /** 1-based 组号（行首等宽数字徽章 01/02） */
  setNo: number;
  weight?: number;
  reps?: number;
  /** 已填值回显；未填打开时取默认 50 */
  feel?: number;
  /** 已填语义补充回显（#119 缺陷3：动作级 feel_note 落在收尾组，重开时经行数据带回） */
  feel_note?: string;
}

/** 一个动作的行组（结算闸门按动作分组展示） */
export interface FeelModalGroup {
  exId: string;
  exName: string;
  sets: FeelModalRow[];
}

/** 聚合表单目标（多行滑条本体；结算闸门走 FeelGateAlert 窄卡，不经此类型） */
export interface FeelModalTarget {
  groups: FeelModalGroup[];
}

/** 确认时写回组级字段的补丁（契约子集，类型从 shared/contracts 导入） */
export type FeelPatch = Pick<ExerciseSetEntry, 'feel' | 'feel_note'>;

/** 批量确认载荷：每行一条，携 exId + setId 定位 */
export type FeelConfirmPatch = { exId: string; setId: string } & FeelPatch;

/** 动作级目标构造（组后触发/卡片入口/闸门[去补记]共用）：聚合动作全部组 */
export const buildActionFeelTarget = (ex: Exercise): FeelModalTarget => ({
  groups: [{
    exId: ex.id,
    exName: ex.name,
    sets: ex.sets.map((s, i) => ({
      setId: s.id,
      setNo: i + 1,
      weight: s.weight,
      reps: s.reps,
      feel: s.feel,
      feel_note: s.feel_note,
    })),
  }],
});

/**
 * 组后触发判定（#98 v2）：仅力量类「最后一组完成跃迁」时弹聚合表单，中间组静默。
 * @param ex        更新前的动作快照（App session 闭包）
 * @param setId     刚完成的组 id
 * @param prevCompleted 该组更新前的完成态（防取消后再次完成时重复弹）
 */
export const buildFeelTrigger = (ex: Exercise, setId: string, prevCompleted: boolean): FeelModalTarget | null => {
  const isStrength = STRENGTH_SET_TYPES.includes(ex.type as ExerciseType) || ex.type == null;
  if (!isStrength || prevCompleted) return null;
  const idx = ex.sets.findIndex(s => s.id === setId);
  if (idx === -1 || idx !== ex.sets.length - 1) return null;
  return buildActionFeelTarget(ex);
};

/**
 * 结算闸门扫描（§3）：全部力量动作里「已完成但未记感受」的组，按动作聚合。
 * 只收未填组——补记窗里的行必然是默认 50 起步的待填行。
 */
export const collectUnfilledFeelGroups = (exercises: Exercise[]): FeelModalGroup[] => {
  const groups: FeelModalGroup[] = [];
  for (const ex of exercises) {
    const isStrength = STRENGTH_SET_TYPES.includes(ex.type as ExerciseType) || ex.type == null;
    if (!isStrength) continue;
    const sets: FeelModalRow[] = [];
    ex.sets.forEach((s, i) => {
      if (s.completed === true && (s.feel === null || s.feel === undefined)) {
        sets.push({ setId: s.id, setNo: i + 1, weight: s.weight, reps: s.reps });
      }
    });
    if (sets.length > 0) groups.push({ exId: ex.id, exName: ex.name, sets });
  }
  return groups;
};

/**
 * 批量写感受进 session（纯函数）：App 确认回调一次 setSession，
 * 闸门「补完并结束」直接拿返回值做结算快照——避免读到 setSession 异步前的旧闭包。
 * feel/feel_note 不触发完成跃迁/休息分支（与逐组 handleUpdateSet 写法等价，
 * 持久化路径一致：session 状态机仍是唯一真源）。
 */
export const applyFeelPatchesToSession = (sess: Session, patches: FeelConfirmPatch[]): Session => ({
  ...sess,
  exercises: sess.exercises.map(ex => {
    const exPatches = patches.filter(p => p.exId === ex.id);
    if (exPatches.length === 0) return ex;
    return {
      ...ex,
      sets: ex.sets.map(s => {
        const p = exPatches.find(pp => pp.setId === s.id);
        return p ? { ...s, feel: p.feel, ...(p.feel_note !== undefined ? { feel_note: p.feel_note } : {}) } : s;
      }),
    };
  }),
});
