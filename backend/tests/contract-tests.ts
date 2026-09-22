/**
 * Contract Tests: Exercises API & Video Protocol
 *
 * 批次3改造（2026-09-22）：删除本地手抄的 ExerciseSchema / VideoAssetSchema 镜像
 * （旧 L7-60 本地 z.object，契约改动后测试照样绿——失去镜像意义），改为直接断言
 * 真源契约：
 *  - ExerciseSchema       → shared/contracts（数据契约唯一定义源，NA-003 红线）
 *  - VideoAssetSchema     → backend/src/schemas/videoSchema.ts
 *    （shared/contracts 无视频资产导出；后端视频资产真源即此文件，
 *     视频处理链路 videoProcessingService.ts 亦从这里导入）
 *
 * 断言按真 schema 形状编写：Exercise 为 NanoID + attributes 嵌套结构；
 * VideoAsset 为 uuid id + 正数元数据 + quality 枚举 + type/sources 默认值。
 */
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { ExerciseSchema } from '../../shared/contracts/index.js';
import { VideoAssetSchema } from '../src/schemas/videoSchema.js';

// ============================================================================
// 构造器：按真契约形状构造样本
// ============================================================================

/** 合法 NanoID（12-24 字符，如 nanoid 默认 21 位） */
const NANO_ID = 'test-exercise-0001';

function buildExercise(overrides: Record<string, unknown> = {}) {
  return {
    id: NANO_ID,
    name: 'Test Exercise',
    exercise_type: 'resistance',
    difficulty: 'beginner',
    attributes: {
      targets: {
        primary: ['中下胸'],
        secondary: ['三头'],
      },
      equipment_required: ['杠铃', '卧推凳'],
    },
    ...overrides,
  };
}

function buildVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: '9f8b7c6d-5e4a-4b3c-8d2e-1f0a9b8c7d6e',
    exerciseName: 'bench_press',
    type: 'local',
    baseUrl: '/uploads/videos/video-1',
    sources: [
      { quality: '360p', url: '/360p.mp4', size: 500000, bandwidth: 500000 },
      { quality: '720p', url: '/720p.mp4', size: 1500000, bandwidth: 1500000 },
    ],
    posterUrl: '/uploads/videos/video-1/poster.jpg',
    metadata: {
      originalFilename: 'bench-press.mp4',
      duration: 45,
      width: 1920,
      height: 1080,
      codec: 'h264',
      bitrate: 3000000,
      size: 1500000,
    },
    createdAt: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// Contract Tests: Exercises API（真源 shared/contracts ExerciseSchema）
// ============================================================================

describe('Contract Tests: Exercises API', () => {
  test('exercise response has valid structure', () => {
    const result = ExerciseSchema.safeParse(buildExercise());
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.data.attributes.targets.primary.length > 0);
      assert.ok(Array.isArray(result.data.attributes.equipment_required));
    }
  });

  test('exercise id is NanoID-shaped (12-24 chars, no whitespace)', () => {
    // 合法：21 位默认 NanoID
    const ok = ExerciseSchema.safeParse(buildExercise({ id: '123456789012345678901' }));
    assert.strictEqual(ok.success, true);

    // 非法：过短 / 含空白 —— 真契约必须拦截
    for (const bad of ['', '  ', '\t', 'short']) {
      const result = ExerciseSchema.safeParse(buildExercise({ id: bad }));
      assert.strictEqual(result.success, false, `id "${bad}" should be rejected`);
      if (!result.success) {
        assert.ok(
          result.error.issues.some((i) => i.path.includes('id')),
          `failure should point at id, got ${JSON.stringify(result.error.issues)}`,
        );
      }
    }
  });

  test('exercise name must be a string (real contract: no min-length)', () => {
    // 真契约 name: z.string()——不强制非空（旧镜像的 .min(1) 是手抄件，不是真约束）
    const emptyOk = ExerciseSchema.safeParse(buildExercise({ name: '' }));
    assert.strictEqual(emptyOk.success, true);

    const nonString = ExerciseSchema.safeParse(buildExercise({ name: 123 }));
    assert.strictEqual(nonString.success, false);
    if (!nonString.success) {
      assert.ok(nonString.error.issues.some((i) => i.path.includes('name')));
    }
  });

  test('exercise_type must be a known enum value', () => {
    const result = ExerciseSchema.safeParse(buildExercise({ exercise_type: 'yoga' }));
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes('exercise_type')));
    }
  });

  test('difficulty must be a known enum value', () => {
    const result = ExerciseSchema.safeParse(buildExercise({ difficulty: 'extreme' }));
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes('difficulty')));
    }
  });

  test('attributes is required and validates equipment_required as array', () => {
    const missing = ExerciseSchema.safeParse(buildExercise({ attributes: undefined }));
    assert.strictEqual(missing.success, false);

    const badEquip = ExerciseSchema.safeParse(
      buildExercise({ attributes: { targets: { primary: ['胸'] }, equipment_required: 'barbell' } }),
    );
    assert.strictEqual(badEquip.success, false);
    if (!badEquip.success) {
      assert.ok(
        badEquip.error.issues.some((i) => i.path.includes('equipment_required')),
      );
    }
  });
});

// ============================================================================
// Contract Tests: Video Protocol（真源 backend/src/schemas/videoSchema.ts）
// ============================================================================

describe('Contract Tests: Video Protocol', () => {
  test('video asset matches VideoAssetSchema', () => {
    const result = VideoAssetSchema.safeParse(buildVideo());
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.baseUrl, '/uploads/videos/video-1');
      assert.strictEqual(result.data.posterUrl, '/uploads/videos/video-1/poster.jpg');
      assert.strictEqual(result.data.metadata.originalFilename, 'bench-press.mp4');
      assert.strictEqual(result.data.metadata.duration, 45);
      assert.strictEqual(Array.isArray(result.data.sources), true);
      assert.strictEqual(result.data.sources.length, 2);
    }
  });

  test('video id must be a UUID', () => {
    const result = VideoAssetSchema.safeParse(buildVideo({ id: 'video-test-1' }));
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes('id')));
    }
  });

  test('exerciseName must be slug-shaped (no spaces / non-latin)', () => {
    const result = VideoAssetSchema.safeParse(buildVideo({ exerciseName: '卧推 bench press' }));
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes('exerciseName')));
    }
  });

  test('type defaults to local when omitted', () => {
    const result = VideoAssetSchema.safeParse(buildVideo({ type: undefined }));
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.type, 'local');
    }
  });

  test('sources defaults to empty array when omitted', () => {
    const result = VideoAssetSchema.safeParse(buildVideo({ sources: undefined }));
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.sources.length, 0);
    }
  });

  test('sources quality must be a known enum', () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({ sources: [{ quality: '4k', url: '/4k.mp4', size: 1, bandwidth: 1 }] }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes('quality')));
    }
  });

  test('metadata numeric fields reject non-positive values', () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({ metadata: { ...buildVideo().metadata, duration: -5 } }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes('duration')));
    }
  });
});
