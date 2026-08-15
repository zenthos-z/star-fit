import { EXERCISE_LIBRARY } from '../constants'
import { storageGet, storageSet } from '../storage'
import { getExerciseTutorial } from '../services/geminiService'

export interface LibraryItem {
  id?: string
  category: string
  name: string
  defaultType: string
  tutorialRef?: string
  createdBy?: string
  createdAt: number
  tags?: string[]
  level?: number
  contentHtml?: string
  assets?: {
    cover?: string
    video?: string
  }
}

const EXT_KEY = 'starfit_exercise_library_ext'

function guessType(name: string, cat: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('辅助') || lower.includes('assisted') || lower.includes('band')) return 'assisted'
  if (lower.includes('自重') || lower.includes('bodyweight') || lower.includes('俯卧撑') || lower.includes('push-up') || lower.includes('pull-up') || lower.includes('引体') || lower.includes('dip') || lower.includes('徒手')) return 'bodyweight'
  if (cat === '有氧' || lower.includes('跑') || lower.includes('run') || lower.includes('row') || lower.includes('划船机') || lower.includes('jump') || lower.includes('跳')) return 'cardio'
  if (lower.includes('静力') || lower.includes('支撑') || lower.includes('plank') || lower.includes('hold')) return 'isometric'
  if (lower.includes('单侧') || lower.includes('unilateral') || lower.includes('single')) return 'unilateral'
  return 'resistance'
}

export async function list(): Promise<LibraryItem[]> {
  const ext = await storageGet<Record<string, LibraryItem[]>>(EXT_KEY)
  const base: LibraryItem[] = Object.entries(EXERCISE_LIBRARY).flatMap(([category, items]) => {
    return (items as string[]).map(name => ({
      category,
      name,
      defaultType: guessType(name, category),
      createdAt: Date.now()
    }))
  })
  const merged: LibraryItem[] = [...base]
  if (ext && typeof ext === 'object') {
    Object.values(ext).forEach(arr => arr.forEach(i => merged.push(i)))
  }
  return merged
}

export async function add(name: string, category: string, createdBy = 'user'): Promise<LibraryItem> {
  const item: LibraryItem = {
    category,
    name,
    defaultType: guessType(name, category),
    createdBy,
    createdAt: Date.now()
  }
  const ext = await storageGet<Record<string, LibraryItem[]>>(EXT_KEY) || {}
  const listForCat = ext[category] || []
  listForCat.unshift(item)
  ext[category] = listForCat
  await storageSet(EXT_KEY, ext)
  return item
}

export async function ensureTutorial(name: string, lang = 'zh'): Promise<string> {
  const md = await getExerciseTutorial(name)
  return md
}

export function guessDefaultType(name: string, category: string): string {
  return guessType(name, category)
}
