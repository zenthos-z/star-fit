/**
 * #123 全局计时自动激活 · 纯函数（App / 测试共用的单一定义源）。
 *
 * 背景：用户真机实测——全局计时未激活（session.status='idle'）时在动作卡片完成一组，
 * 全局计时不自动开始，训练时长丢失前段。产品语义：完成任一动作 = 训练已开始，
 * 全局计时应自动激活。手动「开始训练」与自动激活共用同一跃迁（activateSessionTimer），
 * 不存在第二套计时启动代码。
 */
import { v4 as uuidv4 } from 'uuid';
import type { Session } from '../../types/legacy';

/**
 * 完成动作时是否需要自动激活全局计时。
 * 仅 idle 态 + 完成跃迁（updates.completed === true）触发；
 * active/paused 计时已在走，不得干扰；finished 是历史态，不自动重启。
 */
export const shouldAutoActivateTimer = (
  status: Session['status'],
  completed: boolean | undefined
): boolean => completed === true && status === 'idle';

/**
 * 全局计时开始跃迁：startTime=now、清零暂停、重生 session id
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
