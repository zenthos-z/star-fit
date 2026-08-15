import { loadHistory, saveHistory } from '../storage'
import type { Session, Exercise } from '../types'

export interface RecentSummary {
  sessions: Session[]
  totalVolume: number
  totalSets: number
  durationMinutes: number
}

export async function getRecentByCount(count: number): Promise<Session[]> {
  const all = await loadHistory() as any as Session[] | null
  if (!all || all.length === 0) return []
  return all.slice(0, count)
}

export async function getRecentByDays(days: number): Promise<Session[]> {
  const all = await loadHistory() as any as Session[] | null
  if (!all || all.length === 0) return []
  const now = Date.now()
  const cutoff = now - days * 24 * 60 * 60 * 1000
  return all.filter(s => (s.startTime || 0) > cutoff)
}

export function calculateVolume(ex: Exercise, bodyweightDefault = 75): number {
  let vol = 0
  const bw = ex.referenceBodyweight || bodyweightDefault
  ex.sets.forEach(set => {
    if (!set.completed) return
    const reps = set.reps || 0
    const weight = set.weight || 0
    const duration = set.duration || 0
    switch (ex.type) {
      case 'resistance': vol += weight * reps; break
      case 'unilateral': vol += weight * reps * 2; break
      case 'bodyweight': vol += (bw + weight) * reps; break
      case 'assisted': vol += Math.max(0, (bw - weight)) * reps; break
      case 'isometric': vol += (weight > 0 ? weight : bw) * duration; break
      case 'cardio': break
    }
  })
  return vol
}

export function summarize(sessions: Session[], bodyweightDefault = 75): RecentSummary {
  const totalVolume = sessions.reduce((acc, s) => acc + s.exercises.reduce((x, ex) => x + calculateVolume(ex, bodyweightDefault), 0), 0)
  const totalSets = sessions.reduce((acc, s) => acc + s.exercises.reduce((x, ex) => x + ex.sets.filter(t => t.completed).length, 0), 0)
  const durationMinutes = sessions.reduce((acc, s) => {
    const end = s.endTime || Date.now()
    const mins = Math.floor((end - s.startTime - s.pausedDuration) / 1000 / 60)
    return acc + Math.max(0, mins)
  }, 0)
  return { sessions, totalVolume, totalSets, durationMinutes }
}

export async function importHistory(list: Session[]): Promise<void> {
  const all = await loadHistory() as any as Session[] | null
  const merged = [...(all || [])]
  list.forEach(s => {
    const exists = merged.findIndex(x => x.id === s.id)
    if (exists >= 0) merged[exists] = s
    else merged.unshift(s)
  })
  await saveHistory(merged as any)
}
