/**
 * #123 全局计时自动激活/恢复 · 纯函数（App / 测试共用的单一定义源）。
 *
 * 背景：用户真机实测——全局计时未激活（session.status='idle'）时在动作卡片完成一组，
 * 全局计时不自动开始，训练时长丢失前段；返工补充——paused（暂停）态完成组同样是
 * 明确训练信号，应恢复计时（复用手动「继续」的暂停结算，勿写第二套）。
 * 手动「开始训练」/「继续」与自动激活/恢复共用同一跃迁，不存在第二套计时启停代码。
 */
import { v4 as uuidv4 } from 'uuid';
import type { Session } from '../../types/legacy';

/** 完成跃迁（updates.completed === true）触发计时动作的判定结果 */
export type TimerAction = 'activate' | 'resume' | 'none';

/**
 * 完成动作时的计时动作判定：
 * - idle → activate（全局计时自动开始）
 * - paused → resume（恢复计时：paused=计时没在走，完成组是明确训练信号）
 * - active → none（计时已在走，不得干扰）
 * - finished → none（历史态，不自动重启）
 * 非完成跃迁（改重量/清休息/取消完成）一律 none。
 */
export const resolveTimerAction = (
  status: Session['status'],
  completed: boolean | undefined
): TimerAction => {
  if (completed !== true) return 'none';
  if (status === 'idle') return 'activate';
  if (status === 'paused') return 'resume';
  return 'none';
};

/**
 * 全局计时开始跃迁（idle 态）：startTime=now、清零暂停、重生 session id
 * （idle 会话从未持久化，重生 id 与手动「开始训练」语义一致），
 * exercises 原样保留——自动激活发生在已有训练内容之上。
 */
export const activateSessionTimer = (prev: Session, now: number): Session => ({
  ...prev,
  id: uuidv4(),
  startTime: now,
  pausedDuration: 0,
  pauseStartTime: undefined,
  status: 'active',
  exercises: prev.exercises
});

/**
 * 全局计时恢复跃迁（paused 态，与手动「继续」handleResumeSession 同一收口）：
 * 结算本次暂停段（now − pauseStartTime）累计进 pausedDuration、清 pauseStartTime，
 * 暂停前已在休息的组顺延 restEndTime 使休息在恢复后继续计时。
 */
export const resumeSessionTimer = (prev: Session, now: number): Session => {
  const pauseDuration = prev.pauseStartTime ? now - prev.pauseStartTime : 0;
  return {
    ...prev,
    status: 'active',
    pausedDuration: prev.pausedDuration + pauseDuration,
    pauseStartTime: undefined, // 清除暂停开始时间
    exercises: prev.exercises.map(ex => ({
      ...ex,
      sets: ex.sets.map(s => {
        if (s.restEndTime && s.restEndTime > (prev.pauseStartTime || now)) {
          return { ...s, restEndTime: s.restEndTime + pauseDuration };
        }
        return s;
      })
    }))
  };
};
