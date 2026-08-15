import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { z } from 'zod';

const VideoAssetSchema = z.object({
  id: z.string(),
  exerciseName: z.string(),
  type: z.enum(['local', 'cdn']),
  baseUrl: z.string(),
  sources: z.array(z.object({
    quality: z.enum(['360p', '720p', '1080p']),
    url: z.string(),
    size: z.number(),
    bandwidth: z.number(),
  })),
  posterUrl: z.string(),
  metadata: z.object({
    originalFilename: z.string(),
    duration: z.number(),
    width: z.number(),
    height: z.number(),
    codec: z.string(),
    bitrate: z.number(),
    size: z.number(),
  }),
  createdAt: z.number(),
  originalVideoUrl: z.string().optional(),
});

const ExerciseSchema = z.object({
  id: z.string().min(1).regex(/^\S+$/, 'ID cannot be empty or whitespace'),
  name: z.string().min(1),
  body_category: z.string(),
  exercise_type: z.string(),
  difficulty: z.string(),
  muscle_groups: z.union([
    z.object({
      primary: z.array(z.object({ name: z.string() })),
      secondary: z.array(z.object({ name: z.string() })),
      stabilizers: z.array(z.object({ name: z.string() })),
    }),
    z.string(),
  ]),
  equipment_required: z.union([
    z.array(z.string()),
    z.string(),
  ]),
  assets: z.object({
    cover: z.string().optional(),
    video: z.union([
      z.null(),
      VideoAssetSchema,
      z.array(VideoAssetSchema),
    ]).optional(),
  }),
});

describe('Contract Tests: Exercises API', () => {
  test('exercise response has valid structure', () => {
    const sampleExercise = {
      id: 'test-exercise-1',
      name: 'Test Exercise',
      body_category: 'push',
      exercise_type: 'resistance',
      difficulty: 'beginner',
      muscle_groups: JSON.stringify({
        primary: [{ name: 'chest' }],
        secondary: [{ name: 'triceps' }],
        stabilizers: [{ name: 'core' }],
      }),
      equipment_required: JSON.stringify(['barbell', 'bench']),
      assets: {
        cover: '/uploads/cover.jpg',
        video: null,
      },
    };

    const result = ExerciseSchema.safeParse(sampleExercise);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.data.muscle_groups);
      assert.ok(result.data.equipment_required);
    }
  });

  test('exercise response has valid JSON fields', () => {
    const sampleExercise = {
      id: 'test-exercise-2',
      name: 'JSON Field Test',
      body_category: 'pull',
      exercise_type: 'resistance',
      difficulty: 'intermediate',
      muscle_groups: '{"primary":[{"name":"back"}],"secondary":[],"stabilizers":[]}',
      equipment_required: '["dumbbell"]',
      assets: {},
    };

    const result = ExerciseSchema.safeParse(sampleExercise);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(typeof result.data.muscle_groups, 'string');
      assert.strictEqual(typeof result.data.equipment_required, 'string');

      const parsedMuscleGroups = JSON.parse(result.data.muscle_groups as string);
      const parsedEquipment = JSON.parse(result.data.equipment_required as string);

      assert.strictEqual(Array.isArray(parsedMuscleGroups.primary), true);
      assert.strictEqual(Array.isArray(parsedEquipment), true);
    }
  });

  test('exercise with video asset has valid structure', () => {
    const sampleExercise = {
      id: 'test-exercise-3',
      name: 'Video Exercise',
      body_category: 'legs',
      exercise_type: 'resistance',
      difficulty: 'advanced',
      muscle_groups: JSON.stringify({
        primary: [{ name: 'quads' }],
        secondary: [],
        stabilizers: [],
      }),
      equipment_required: JSON.stringify(['squat rack']),
      assets: {
        video: {
          id: 'video-1',
          exerciseName: 'squat',
          type: 'local',
          baseUrl: '/uploads/videos/video-1',
          sources: [
            { quality: '360p', url: '/360p.mp4', size: 500000, bandwidth: 500000 },
            { quality: '720p', url: '/720p.mp4', size: 1500000, bandwidth: 1500000 },
            { quality: '1080p', url: '/1080p.mp4', size: 3000000, bandwidth: 3000000 },
          ],
          posterUrl: '/uploads/videos/video-1/poster.jpg',
          metadata: {
            originalFilename: 'squat.mp4',
            duration: 60,
            width: 1920,
            height: 1080,
            codec: 'h264',
            bitrate: 4000000,
            size: 3000000,
          },
          createdAt: Date.now(),
          originalVideoUrl: '/uploads/videos/video-1/original.mp4',
        },
      },
    };

    const result = ExerciseSchema.safeParse(sampleExercise);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.data.assets.video);
      const video = result.data.assets.video as any;
      assert.ok(video.baseUrl);
      assert.notStrictEqual(video.baseUrl, '');
      assert.ok(video.posterUrl);
      assert.notStrictEqual(video.posterUrl, '');
      assert.strictEqual(video.originalVideoUrl, '/uploads/videos/video-1/original.mp4');
      assert.strictEqual(Array.isArray(video.sources), true);
      assert.strictEqual(video.sources.length, 3);
    }
  });
});

describe('Contract Tests: Video Protocol', () => {
  test('video asset matches VideoAssetSchema', () => {
    const sampleVideo = {
      id: 'video-test-1',
      exerciseName: 'bench press',
      type: 'local',
      baseUrl: '/uploads/videos/video-test-1',
      sources: [
        { quality: '360p', url: '/360p.mp4', size: 500000, bandwidth: 500000 },
        { quality: '720p', url: '/720p.mp4', size: 1500000, bandwidth: 1500000 },
      ],
      posterUrl: '/uploads/videos/video-test-1/poster.jpg',
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
    };

    const result = VideoAssetSchema.safeParse(sampleVideo);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.baseUrl, '/uploads/videos/video-test-1');
      assert.strictEqual(result.data.posterUrl, '/uploads/videos/video-test-1/poster.jpg');
      assert.strictEqual(result.data.metadata.originalFilename, 'bench-press.mp4');
      assert.strictEqual(result.data.metadata.duration, 45);
      assert.strictEqual(result.data.metadata.width, 1920);
      assert.strictEqual(result.data.metadata.height, 1080);
      assert.strictEqual(Array.isArray(result.data.sources), true);
      assert.strictEqual(result.data.sources.length, 2);
    }
  });

  test('video asset with originalVideoUrl field', () => {
    const sampleVideo = {
      id: 'video-test-2',
      exerciseName: 'deadlift',
      type: 'cdn',
      baseUrl: 'https://cdn.example.com/videos/video-test-2',
      sources: [
        { quality: '1080p', url: 'https://cdn.example.com/videos/video-test-2/1080p.mp4', size: 5000000, bandwidth: 5000000 },
      ],
      posterUrl: 'https://cdn.example.com/videos/video-test-2/poster.jpg',
      metadata: {
        originalFilename: 'deadlift.mp4',
        duration: 90,
        width: 1920,
        height: 1080,
        codec: 'h265',
        bitrate: 5000000,
        size: 5000000,
      },
      createdAt: Date.now(),
      originalVideoUrl: 'https://cdn.example.com/videos/video-test-2/original.mp4',
    };

    const result = VideoAssetSchema.safeParse(sampleVideo);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.data.originalVideoUrl);
      assert.strictEqual(result.data.originalVideoUrl, 'https://cdn.example.com/videos/video-test-2/original.mp4');
      assert.strictEqual(result.data.baseUrl, 'https://cdn.example.com/videos/video-test-2');
    }
  });

  test('video asset with multiple sources', () => {
    const sampleVideo = {
      id: 'video-test-3',
      exerciseName: 'squat',
      type: 'local',
      baseUrl: '/uploads/videos/video-test-3',
      sources: [
        { quality: '360p', url: '/360p.mp4', size: 500000, bandwidth: 500000 },
        { quality: '720p', url: '/720p.mp4', size: 1500000, bandwidth: 1500000 },
        { quality: '1080p', url: '/1080p.mp4', size: 3000000, bandwidth: 3000000 },
      ],
      posterUrl: '/uploads/videos/video-test-3/poster.jpg',
      metadata: {
        originalFilename: 'squat.mp4',
        duration: 60,
        width: 1920,
        height: 1080,
        codec: 'h264',
        bitrate: 4000000,
        size: 3000000,
      },
      createdAt: Date.now(),
    };

    const result = VideoAssetSchema.safeParse(sampleVideo);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.sources.length, 3);
      assert.strictEqual(result.data.sources[0].quality, '360p');
      assert.strictEqual(result.data.sources[1].quality, '720p');
      assert.strictEqual(result.data.sources[2].quality, '1080p');
    }
  });
});

describe('Contract Tests: Protocol Compliance', () => {
  test('exercise id is never null or empty', () => {
    const invalidIds = ['', '  ', '\t'];

    invalidIds.forEach(id => {
      const sampleExercise = {
        id,
        name: 'Invalid ID Test',
        body_category: 'push',
        exercise_type: 'resistance',
        difficulty: 'beginner',
        muscle_groups: JSON.stringify({
          primary: [{ name: 'chest' }],
          secondary: [],
          stabilizers: [],
        }),
        equipment_required: JSON.stringify([]),
        assets: {},
      };

      const result = ExerciseSchema.safeParse(sampleExercise);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.issues[0].path.includes('id'));
      }
    });
  });

  test('exercise name is never empty', () => {
    const sampleExercise = {
      id: 'test-exercise',
      name: '',
      body_category: 'push',
      exercise_type: 'resistance',
      difficulty: 'beginner',
      muscle_groups: JSON.stringify({
        primary: [{ name: 'chest' }],
        secondary: [],
        stabilizers: [],
      }),
      equipment_required: JSON.stringify([]),
      assets: {},
    };

    const result = ExerciseSchema.safeParse(sampleExercise);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues[0].path.includes('name'));
    }
  });

  test('muscle_groups can be parsed from JSON string', () => {
    const validJsonString = JSON.stringify({
      primary: [{ name: 'chest' }],
      secondary: [{ name: 'triceps' }],
      stabilizers: [],
    });

    const sampleExercise = {
      id: 'test-exercise',
      name: 'Valid JSON Test',
      body_category: 'push',
      exercise_type: 'resistance',
      difficulty: 'beginner',
      muscle_groups: validJsonString,
      equipment_required: '[]',
      assets: {},
    };

    const result = ExerciseSchema.safeParse(sampleExercise);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.muscle_groups, validJsonString);
    }
  });

  test('equipment_required can be parsed from JSON string', () => {
    const validJsonString = JSON.stringify(['barbell', 'bench']);

    const sampleExercise = {
      id: 'test-exercise',
      name: 'Valid Equipment Test',
      body_category: 'push',
      exercise_type: 'resistance',
      difficulty: 'beginner',
      muscle_groups: JSON.stringify({ primary: [], secondary: [], stabilizers: [] }),
      equipment_required: validJsonString,
      assets: {},
    };

    const result = ExerciseSchema.safeParse(sampleExercise);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.equipment_required, validJsonString);
    }
  });
});
