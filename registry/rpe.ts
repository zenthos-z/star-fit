import type { Session, Exercise } from '../types'
import { getRecentByCount } from './trainLog'

export interface RpeStats {
  exerciseName: string
  medianRpe: number | null
  rpeDistribution: number[]
  completionRate: number
  last3Days: { date: number; median?: number }[]
  recommendedRestSec: number
}

function median(nums: number[]): number | null {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  if (s.length % 2 === 0) return (s[mid - 1] + s[mid]) / 2
  return s[mid]
}

export async function computeMedianRpe(exerciseName: string): Promise<RpeStats> {
  const recent = await getRecentByCount(3)
  const rpes: number[] = []
  let completed = 0
  let total = 0
  const last3Days: { date: number; median?: number }[] = []
  recent.forEach(s => {
    const oneDay: number[] = []
    s.exercises.forEach(e => {
      if (e.name !== exerciseName) return
      e.sets.forEach(set => {
        total += 1
        if (set.completed && typeof set.rpe === 'number') {
          completed += 1
          rpes.push(set.rpe)
          oneDay.push(set.rpe)
        }
      })
    })
    last3Days.push({ date: s.startTime, median: median(oneDay) || undefined })
  })
  const med = median(rpes)
  const rate = total === 0 ? 0 : completed / total
  const rest = med && med >= 8 ? 90 : 60
  return {
    exerciseName,
    medianRpe: med,
    rpeDistribution: rpes,
    completionRate: rate,
    last3Days,
    recommendedRestSec: rest
  }
}

export function calibrate(params: { weight?: number; duration?: number; reps?: number }, targetRpe: number, currentMedian: number | null) {
  const delta = (targetRpe - (currentMedian ?? 7))
  const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x))
  const factor = clamp(1 + delta * 0.05, 0.9, 1.2)
  const out: { weight?: number; duration?: number; reps?: number } = {}
  if (typeof params.weight === 'number') out.weight = Math.round(params.weight * factor / 2.5) * 2.5
  if (typeof params.duration === 'number') out.duration = Math.round(params.duration * factor)
  if (typeof params.reps === 'number') out.reps = Math.round(params.reps * factor)
  return out
}
