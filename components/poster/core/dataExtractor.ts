// Session and Exercise types were removed from this path during refactoring.
// Define minimal local types to satisfy dataExtractor without external dependency.
type Session = any;
type Exercise = any;

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

export function extractWorkoutData(session: Session): ExtractedWorkoutData {
  const dateObj = new Date(session.startTime);
  const dateStr = dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '.');
  
  const endTime = session.endTime || Date.now();
  const durationMinutes = Math.floor((endTime - session.startTime - session.pausedDuration) / 1000 / 60);
  
  const exercises: ExerciseItem[] = session.exercises
    .map(ex => {
      const completedSets = ex.sets.filter(s => s.completed);
      if (completedSets.length === 0) return null;

      const maxWeight = Math.max(...completedSets.map(s => s.weight || 0));
      const totalReps = completedSets.reduce((acc, s) => acc + (s.reps || 0), 0);
      
      let meta: string;
      
      if (ex.type === 'cardio') {
        const avgDuration = completedSets.reduce((acc, s) => acc + (s.duration || 0), 0) / completedSets.length;
        meta = `[${avgDuration.toFixed(0)} · ${completedSets.length}组]`;
      } else if (ex.type === 'isometric') {
        const avgDuration = completedSets.reduce((acc, s) => acc + (s.duration || 0), 0) / completedSets.length;
        meta = `[${avgDuration.toFixed(0)}SEC · ${completedSets.length}组]`;
      } else if (ex.type === 'bodyweight') {
        meta = `[${totalReps} · ${completedSets.length}组 · 自重]`;
      } else if (ex.type === 'assisted') {
        meta = `[${maxWeight}KG · ${totalReps} · ${completedSets.length}组]`;
      } else if (ex.type === 'unilateral') {
        meta = `[单手${maxWeight}KG · ${totalReps} · ${completedSets.length}组]`;
      } else {
        meta = `[${maxWeight}KG · ${totalReps} · ${completedSets.length}组]`;
      }

      return {
        name: ex.name,
        sets: `${completedSets.length}组`,
        reps: totalReps.toString(),
        weight: maxWeight > 0 ? `${maxWeight}KG` : undefined,
        duration: ex.type === 'cardio' || ex.type === 'isometric' ? `${durationMinutes}MIN` : undefined,
        equipment: ex.equipment
      };
    })
    .filter((ex): ex is ExerciseItem => ex !== null);

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
