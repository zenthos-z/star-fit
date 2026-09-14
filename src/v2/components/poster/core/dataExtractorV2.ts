import { WorkoutSession } from '../../../types/protocol';

export interface ExtractedWorkoutData {
  nickname: string;
  date: string;
  duration: string;
  exercises: ExerciseItem[];
}

export interface ExerciseItem {
  name: string;
  sets: string;
  reps?: string;
  weight?: string;
  duration?: string;
  equipment?: string;
}

export function extractWorkoutData(session: WorkoutSession): ExtractedWorkoutData {
  const dateObj = new Date(session.startTime);
  const dateStr = dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '.');

  const endTime = session.endTime || new Date().toISOString();
  const startTime = new Date(session.startTime);
  const endTimeObj = new Date(endTime);
  const pausedDuration = session.metadata?.pausedDuration || 0;
  const durationMinutes = Math.floor((endTimeObj.getTime() - startTime.getTime() - pausedDuration) / 1000 / 60);

  const exercises: ExerciseItem[] = session.exercises
    .map(ex => {
      // 完成组判定要兼容历史数据：协议是 status:'COMPLETED'，但实际落库/旧版本
      // 常只有 completed:false + reps>0（甚至不写 completed）。以"有实际训练量"为准。
      const hasVolume = (s: any) =>
        s?.status === 'COMPLETED' ||
        s?.completed === true ||
        (Number(s?.reps) > 0 || Number(s?.duration) > 0 || Number(s?.distance) > 0);
      const completedSets = ex.sets.filter(hasVolume);
      if (completedSets.length === 0) return null;

      const maxWeight = Math.max(...completedSets.map(s => s.weight || 0));
      const totalReps = completedSets.reduce((acc, s) => acc + (s.reps || 0), 0);
      const totalDuration = completedSets.reduce((acc, s) => acc + (s.duration || 0), 0);

      let meta: string;

      if (ex.type === 'cardio' || ex.type === 'outdoor') {
        const avgDuration = totalDuration / completedSets.length;
        meta = `[${avgDuration.toFixed(0)} · ${completedSets.length}组]`;
      } else if (ex.type === 'isometric') {
        const avgDuration = totalDuration / completedSets.length;
        meta = `[${avgDuration.toFixed(0)}SEC · ${completedSets.length}组]`;
      } else {
        meta = `[${maxWeight}KG · ${totalReps} · ${completedSets.length}组]`;
      }

      // 动作名兼容：协议只有 exerciseId(fit://...)，实存数据带 name/metadata.name（中文）。
      const exerciseName =
        (ex as any).name?.trim?.() ||
        ex.metadata?.name?.trim?.() ||
        ex.exerciseId?.replace('fit://library/exercise/', '') ||
        (ex as any).libraryId ||
        '未知动作';

      return {
        name: exerciseName,
        sets: `${completedSets.length}组`,
        reps: totalReps.toString(),
        weight: maxWeight > 0 ? `${maxWeight}KG` : undefined,
        duration: ex.type === 'cardio' || ex.type === 'outdoor' || ex.type === 'isometric' ? `${durationMinutes}MIN` : undefined,
        equipment: ex.metadata?.equipment
      };
    })
    .filter((ex) => ex !== null) as ExerciseItem[];

  return {
    nickname: '你的昵称',
    date: dateStr,
    duration: `${durationMinutes} MINS`,
    exercises
  };
}

export function formatWorkoutForPrompt(data: ExtractedWorkoutData): string {
  return data.exercises.map(ex => `${ex.name}     ${ex.sets}`).join('\n');
}
