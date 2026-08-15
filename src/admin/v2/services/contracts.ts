import { z } from 'zod';

const zNumber = z.union([z.number(), z.string().transform((v) => Number(v))]).pipe(z.number());

export const zAdminHealth = z.object({
  api: z.object({
    status: z.string().catch('error'),
    latency: zNumber.catch(0),
  }),
  ai: z
    .object({
      status: z.string().catch('disconnected'),
      provider: z.string().catch(''),
      model: z.string().optional().catch(undefined),
      latency: zNumber.optional().catch(undefined),
    })
    .catch({ status: 'disconnected', provider: '' }),
  storage: z
    .object({
      used: zNumber.catch(0),
      total: zNumber.catch(0),
      percent: zNumber.catch(0),
      available: zNumber.optional().catch(undefined),
    })
    .catch({ used: 0, total: 0, percent: 0 }),
  uptime: zNumber.optional().catch(undefined),
});

export type AdminHealth = z.infer<typeof zAdminHealth>;

export const zAdminLogItem = z.object({
  timestamp: z.string().catch(new Date(0).toISOString()),
  level: z.string().catch('info'),
  message: z.string().catch(''),
});

export const zAdminLogs = z.array(zAdminLogItem).catch([]);
export type AdminLogItem = z.infer<typeof zAdminLogItem>;

export const zAdminProxyConfig = z
  .object({
    GLOBAL_PROXY: z.string().catch(''),
    GEMINI_PROXY: z.string().catch(''),
    OPENAI_PROXY: z.string().catch(''),
    AI_PROVIDER: z.string().catch('gemini'),
    GOOGLE_API_KEY_SET: z.boolean().catch(false),
    OPENAI_API_KEY_SET: z.boolean().catch(false),
  })
  .catch({
    GLOBAL_PROXY: '',
    GEMINI_PROXY: '',
    OPENAI_PROXY: '',
    AI_PROVIDER: 'gemini',
    GOOGLE_API_KEY_SET: false,
    OPENAI_API_KEY_SET: false,
  });

export type AdminProxyConfig = z.infer<typeof zAdminProxyConfig>;

export const zAdminAIConfig = z
  .object({
    aiProvider: z.string().catch('gemini'),
    coachPersona: z.string().catch('professional'),
    promptStyle: z.string().catch('default'),
    styleParams: z.record(z.string(), z.any()).catch({}),
  })
  .catch({ aiProvider: 'gemini', coachPersona: 'professional', promptStyle: 'default', styleParams: {} });

export type AdminAIConfig = z.infer<typeof zAdminAIConfig>;

// Model Configuration Schema (Single default config only)
const zModelConfigItem = z.object({
  provider: z.union([z.literal('gemini'), z.literal('openai'), z.literal('deepseek')]).catch('gemini'),
  model: z.string().catch(''),
  baseURL: z.string().optional().catch(undefined),
  source: z.union([z.literal('db'), z.literal('env'), z.literal('default')]).catch('default'),
});

export type ModelConfigItem = z.infer<typeof zModelConfigItem>;

const zModelConfigs = z.object({
  default: zModelConfigItem,
});

export const zModelConfigResponse = z.object({
  tasks: zModelConfigs,
  availableModels: z.object({
    gemini: z.array(z.string()).catch([]),
    openai: z.array(z.string()).catch([]),
    deepseek: z.array(z.string()).catch([]),
  }).catch({ gemini: [], openai: [], deepseek: [] }),
}).catch({
  tasks: {
    default: { provider: 'gemini', model: '', source: 'default' },
  },
  availableModels: { gemini: [], openai: [], deepseek: [] },
});

export type ModelConfigResponse = z.infer<typeof zModelConfigResponse>;

// Image Generation Model Configuration Schema
export const zImageGenProvider = z.union([z.literal('dmx'), z.literal('openai')]).catch('dmx');
export type ImageGenProvider = z.infer<typeof zImageGenProvider>;

const zImageGenConfigItem = z.object({
  provider: zImageGenProvider,
  model: z.string().catch(''),
  baseURL: z.string().optional().catch(undefined),
  source: z.union([z.literal('db'), z.literal('env'), z.literal('default')]).catch('default'),
});

export const zImageGenConfigResponse = z.object({
  config: zImageGenConfigItem,
  availableProviders: z.array(z.string()).catch([]),
  availableModels: z.object({
    dmx: z.array(z.string()).catch([]),
    openai: z.array(z.string()).catch([]),
  }).catch({ dmx: [], openai: [] }),
}).catch({
  config: { provider: 'dmx', model: '', source: 'default' },
  availableProviders: ['dmx', 'openai'],
  availableModels: { dmx: [], openai: [] },
});

export type ImageGenConfigResponse = z.infer<typeof zImageGenConfigResponse>;

export const zAdminCapabilities = z
  .object({
    protocol_version: z.string().catch('2.0.0'),
    features: z
      .object({
        dashboard: z
          .object({
            health: z.boolean().catch(false),
            logs: z.boolean().catch(false),
            quick_actions: z.boolean().catch(false),
          })
          .catch({ health: false, logs: false, quick_actions: false }),
        settings: z
          .object({
            proxy: z.boolean().catch(false),
            ai_config: z.boolean().catch(false),
          })
          .catch({ proxy: false, ai_config: false }),
        users: z
          .object({
            list: z.boolean().catch(false),
            profile: z.boolean().catch(false),
            stats: z.boolean().catch(false),
            delete_user: z.boolean().catch(false),
            delete_session: z.boolean().catch(false),
            health_integrations: z.boolean().catch(false),
          })
          .catch({
            list: false,
            profile: false,
            stats: false,
            delete_user: false,
            delete_session: false,
            health_integrations: false,
          }),
        content: z
          .object({
            exercises: z.boolean().catch(false),
            videos_upload: z.boolean().catch(false),
            media_upload: z.boolean().catch(false),
          })
          .catch({ exercises: false, videos_upload: false, media_upload: false }),
      })
      .catch({
        dashboard: { health: false, logs: false, quick_actions: false },
        settings: { proxy: false, ai_config: false },
        users: {
          list: false,
          profile: false,
          stats: false,
          delete_user: false,
          delete_session: false,
          health_integrations: false,
        },
        content: { exercises: false, videos_upload: false, media_upload: false },
      }),
  })
  .catch({
    protocol_version: '2.0.0',
    features: {
      dashboard: { health: false, logs: false, quick_actions: false },
      settings: { proxy: false, ai_config: false },
      users: {
        list: false,
        profile: false,
        stats: false,
        delete_user: false,
        delete_session: false,
        health_integrations: false,
      },
      content: { exercises: false, videos_upload: false, media_upload: false },
    },
  });

export type AdminCapabilities = z.infer<typeof zAdminCapabilities>;

export const zAdminUser = z.object({
  id: z.string().catch(''),
  username: z.string().nullable().optional().catch(null),
  short_id: z.string().nullable().optional().catch(null),
  display_name: z.string().nullable().optional().catch(null),
  session_count: zNumber.catch(0),
  device_id: z.string().catch(''),
  created_at: zNumber.catch(0),
});

export const zAdminUsers = z.array(zAdminUser).catch([]);
export type AdminUser = z.infer<typeof zAdminUser>;

export const zExercise = z.object({
  id: z.string().catch(''),
  name: z.string().catch(''),
  exercise_type: z.string().catch(''),
  targets: z.union([z.string(), z.any()]).transform((v) => (typeof v === 'string' ? v : JSON.stringify(v ?? { primary: [] }))).catch('{"primary":[]}'),
  content_html: z.string().catch(''),
  // Handle both string (old format) and object (new format from backend)
  assets_json: z.union([z.string(), z.object({}).passthrough()])
    .transform((v) => {
      if (typeof v === 'string') return v;
      try {
        return JSON.stringify(v);
      } catch {
        return '{}';
      }
    })
    .catch('{}'),
  tags_json: z.string().optional().catch(undefined),
  equipment_required: z.union([z.string(), z.any()]).transform((v) => (typeof v === 'string' ? v : JSON.stringify(v ?? []))).catch('[]'),
  difficulty: z.string().catch('beginner'),
  // attributes from PostgreSQL - may contain nested assets_json
  attributes: z.union([z.string(), z.object({}).passthrough()])
    .transform((v) => {
      if (typeof v === 'string') return v;
      try {
        return JSON.stringify(v);
      } catch {
        return '{}';
      }
    })
    .optional()
    .catch(undefined),
  // Legacy fields - deprecated but kept for parsing old data
  body_category: z.string().optional().catch(undefined),
  muscle_groups: z.union([z.string(), z.any()]).optional().catch(undefined),
});

export const zExercises = z.array(zExercise).catch([]);
export type AdminExercise = z.infer<typeof zExercise>;

export function parseOrFallback<T>(schema: z.ZodType<T>, input: unknown, fallback: T): T {
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : fallback;
}

// Dashboard Schemas
export const zDashboardLatestTraining = z.object({
  hasTraining: z.boolean().catch(false),
  session: z.object({
    id: z.string().catch(''),
    userId: z.string().catch(''),
    userName: z.string().catch(''),
    title: z.string().catch('训练记录'),
    startTime: z.string().catch(new Date().toISOString()),
    duration: z.number().catch(0),
    exercises: z.array(z.object({
      name: z.string().catch('未知动作'),
      type: z.string().catch('unknown'),
      sets: z.array(z.object({
        index: z.number().catch(0),
        weight: z.number().optional().catch(undefined),
        reps: z.number().optional().catch(undefined),
        rpe: z.number().optional().catch(undefined),
        duration: z.number().optional().catch(undefined),
        distance: z.number().optional().catch(undefined),
      })).catch([]),
    })).catch([]),
    totalVolume: z.number().catch(0),
    hasAudit: z.boolean().catch(false),
    auditText: z.string().optional().catch(undefined),
  }).optional().catch(undefined),
  todayStats: z.object({
    inProgress: z.number().catch(0),
    completed: z.number().catch(0),
    totalVolume: z.number().catch(0),
  }).catch({ inProgress: 0, completed: 0, totalVolume: 0 }),
});

export const zDashboardServerInfo = z.object({
  serverUrl: z.string().catch('http://localhost:5173'),
  apiUrl: z.string().catch('http://localhost:43111'),
});

export const zDashboardExerciseStats = z.object({
  total: z.number().catch(0),
  withVideo: z.number().catch(0),
  withImage: z.number().catch(0),
  pendingTranscode: z.number().catch(0),
});

// ============================================================================
// Embedding Schemas (New for Vector Search Management)
// ============================================================================

export const zEmbeddingStats = z.object({
  total: z.number().catch(0),
  notVectorized: z.number().catch(0),
  partial: z.number().catch(0),
  outdated: z.number().catch(0),
  current: z.number().catch(0),
  lastVectorizedAt: z.string().datetime().nullable().catch(null),
});

export type EmbeddingStats = z.infer<typeof zEmbeddingStats>;

export const zExerciseEmbeddingInfo = z.object({
  exerciseId: z.string().catch(''),
  name: z.string().catch(''),
  status: z.enum(['not_vectorized', 'partial', 'outdated', 'current']).catch('not_vectorized'),
  embeddingUpdatedAt: z.string().datetime().nullable().catch(null),
  contentUpdatedAt: z.string().datetime().catch(''),
});

export type ExerciseEmbeddingInfo = z.infer<typeof zExerciseEmbeddingInfo>;

export const zBatchVectorizeResponse = z.object({
  success: z.boolean().catch(false),
  total: z.number().catch(0),
  succeeded: z.number().catch(0),
  failed: z.number().catch(0),
  skipped: z.number().catch(0),  // 已有embedding，被跳过的
  results: z.array(z.object({
    exerciseId: z.string().catch(''),
    success: z.boolean().catch(false),
    skipped: z.boolean().catch(false),  // 是否被跳过
    embeddingGenerated: z.boolean().catch(false),  // 是否真正生成了embedding
    error: z.string().optional().catch(undefined),
  })).catch([]),
  durationMs: z.number().catch(0),
});

export type BatchVectorizeResponse = z.infer<typeof zBatchVectorizeResponse>;

export const zEmbeddingConfig = z.object({
  provider: z.enum(['openai', 'gemini']).catch('openai'),
  model: z.string().catch('text-embedding-3-small'),
  baseURL: z.string().optional().catch(undefined),
  hasApiKey: z.boolean().catch(false),
  defaultThreshold: z.number().min(0).max(1).catch(0.4),
});

export type EmbeddingConfig = z.infer<typeof zEmbeddingConfig>;
