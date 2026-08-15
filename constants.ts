import { AiConfig, AiScenario } from './types';

export const APP_NAME = "Starfit";
export const DEFAULT_REST_TIME = 60; // seconds
export const DEFAULT_BODYWEIGHT = 75; // kg

export const RPE_COLORS = [
  '#22c55e', // 1-2 Green
  '#4ade80', // 3-4 Light Green
  '#facc15', // 5-6 Yellow
  '#fb923c', // 7-8 Orange
  '#f87171', // 9 Red
  '#ef4444'  // 10 Dark Red
];

// New RPE Logic: Zones (Chinese)
export const RPE_ZONES = [
  { value: 6, label: "热身激活", desc: "轻松，专注于动作模式", color: "bg-green-100 text-green-800 border-green-200" },
  { value: 7, label: "爆发力/技巧", desc: "动作极快，无疲劳感", color: "bg-green-100 text-green-800 border-green-200" },
  { value: 8, label: "容量积累", desc: "略感吃力，保留2-3次", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  { value: 9, label: "肌肥大", desc: "艰难，仅保留1次", color: "bg-orange-100 text-orange-800 border-orange-200" },
  { value: 10, label: "力竭/极限", desc: "完全力竭，无法再做", color: "bg-red-100 text-red-800 border-red-200" }
];

// Configuration for what fields to show for each exercise type
export const EXERCISE_TYPES_CONFIG = {
  'resistance': { 
    label: '常规负重', 
    fields: ['weight', 'reps', 'rpe'],
    primaryMetric: 'weight',
    units: { weight: 'kg', reps: '次' },
    defaultValues: { weight: 20, reps: 10 }
  },
  'unilateral': { 
    label: '单侧训练', 
    fields: ['weight', 'reps', 'rpe'],
    primaryMetric: 'weight',
    units: { weight: 'kg', reps: '次' },
    defaultValues: { weight: 10, reps: 10 }
  }, 
  'bodyweight': { 
    label: '自重训练', 
    fields: ['reps', 'weight', 'rpe'], 
    primaryMetric: 'reps',
    // Weight here means ADDED weight (e.g. dip belt)
    units: { weight: 'kg (+)', reps: '次' },
    defaultValues: { weight: 0, reps: 15 }
  },
  'assisted': { 
    label: '辅助器械', 
    fields: ['weight', 'reps', 'rpe'], 
    primaryMetric: 'weight',
    // Weight here means ASSISTED weight (subtracted from body)
    units: { weight: 'kg (-)', reps: '次' },
    defaultValues: { weight: 30, reps: 10 }
  },
  'isometric':  { 
    label: '静力/等长', 
    fields: ['duration', 'weight', 'rpe'],
    primaryMetric: 'duration',
    units: { weight: 'kg', duration: '秒' },
    defaultValues: { weight: 0, duration: 30 }
  },
  'cardio':     { 
    label: '有氧运动', 
    fields: ['duration', 'distance', 'rpe'],
    primaryMetric: 'duration',
    units: { duration: '分', distance: 'km' },
    defaultValues: { duration: 30, distance: 5 }
  },
  'heavy_weight': {
    label: '大重量/单次',
    fields: ['weight', 'rpe'],
    primaryMetric: 'weight',
    units: { weight: 'kg' },
    defaultValues: { weight: 20 }
  },
  'rep_training': {
    label: '次数训练',
    fields: ['reps', 'rpe'],
    primaryMetric: 'reps',
    units: { reps: '次' },
    defaultValues: { reps: 15 }
  },
  'flexibility': {
    label: '柔韧拉伸',
    fields: ['duration'],
    primaryMetric: 'duration',
    units: { duration: '秒' },
    defaultValues: { duration: 30 }
  },
  'outdoor': {
    label: '户外运动',
    fields: ['duration', 'distance', 'rpe'],
    primaryMetric: 'distance',
    units: { duration: '分', distance: 'km' },
    defaultValues: { duration: 30, distance: 5 }
  }
};

// Simple Library Data (Chinese)
export const EXERCISE_LIBRARY = {
  "胸部": ["杠铃卧推", "哑铃卧推", "俯卧撑", "绳索夹胸", "双杠臂屈伸"],
  "背部": ["引体向上", "高位下拉", "杠铃划船", "坐姿绳索划船", "面拉", "器械辅助引体"],
  "腿部": ["深蹲", "倒蹬机", "罗马尼亚硬拉", "箭步蹲", "腿屈伸", "提踵"],
  "肩部": ["站姿推举", "侧平举", "前平举", "反向飞鸟"],
  "手臂": ["二头弯举", "三头下压", "锤式弯举", "仰卧臂屈伸"],
  "核心": ["平板支撑", "卷腹", "悬垂举腿", "俄罗斯转体"],
  "有氧": ["跑步", "单车", "划船机", "跳绳"],
  "户外": ["户外跑步", "户外骑行", "徒步", "户外健走"]
};

// Mock initial plan for demo purposes if AI fails or no key
export const MOCK_PLAN = [
  {
    name: "动态热身",
    type: "bodyweight",
    sets: 2,
    reps: 12
  },
  {
    name: "杠铃深蹲",
    type: "resistance",
    sets: 3,
    reps: 5
  },
  {
    name: "辅助引体向上",
    type: "assisted",
    sets: 3,
    reps: 8,
    weight: 15 // Assisted weight
  }
];

// --- Agent System Constants ---

const BASE_SYSTEM_PROMPT = `You are Starfit AI, an advanced fitness agent.
Your core mission is to promote "Joy, Flexibility, and Data Sovereignty".
- Joy: Encourage the user, celebrate small wins.
- Flexibility: Adapt plans to how the user feels (RPE).
- Data Sovereignty: User data is theirs. Be transparent.

Language Rule: ALWAYS Detect the language of the User's last input and respond in that EXACT SAME language. If unsure, default to Chinese (Simplified).`;

export const DEFAULT_AI_CONFIG: AiConfig = {
  models: {
    [AiScenario.CHAT]: 'gemini-3-flash-preview',
    [AiScenario.PLAN]: 'gemini-3-pro-preview',
    [AiScenario.CARD]: 'gemini-3-flash-preview',
    [AiScenario.CALC]: 'gemini-3-flash-preview',
    [AiScenario.IMAGE]: 'gemini-3-pro-image-preview' 
  },
  context: {
    systemPrompts: {
      [AiScenario.CHAT]: `${BASE_SYSTEM_PROMPT}\n\nROLE: Coach & Companion. Focus on conversation, empathy, and immediate advice.`,
      [AiScenario.PLAN]: `${BASE_SYSTEM_PROMPT}\n\nROLE: Master Programmer. Focus on generating structured, scientifically sound JSON workout plans.`,
      [AiScenario.CARD]: `${BASE_SYSTEM_PROMPT}\n\nROLE: Educator. Focus on clear, visual, and concise Markdown summaries.`,
      [AiScenario.CALC]: `${BASE_SYSTEM_PROMPT}\n\nROLE: Analyst. Focus on data processing and RPE estimation.`,
      [AiScenario.IMAGE]: `(Not used directly, prompt is dynamically constructed in code)`
    },
    strategy: "Focus on progressive overload with a mix of hypertrophy and strength ranges. Review progress monthly.",
    historySummary: "No previous sessions recorded yet.",
    userMemory: "No specific injuries or constraints noted."
  }
};