/**
 * Seed Exercises Script
 *
 * 直接通过 PostgresClient 导入 exercises 基础数据
 * 使用 NanoID 生成器创建唯一 ID
 *
 * @version 2.0.0
 * @created 2026-02-19
 * @updated 2026-02-28 - Migrate to NanoID format
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { createLogger } from '../utils/logger.js';
import { generateExerciseNanoId } from '../utils/nanoid.js';

const logger = createLogger({ component: 'seedExercises' });

// Exercise data templates (IDs will be generated during seeding)
const exerciseTemplates = [
  // CHEST EXERCISES
  {
    name: '杠铃卧推',
    exercise_type: 'resistance',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['中下胸'], secondary: ['三头', '前肩'] },
      equipment_required: ['杠铃', '卧推凳'],
      pattern: 'push',
      impact_level: { shoulder: 7, elbow: 8, wrist: 3 }
    }
  },
  {
    name: '哑铃飞鸟',
    exercise_type: 'resistance',
    difficulty: 'intermediate',
    attributes: {
      targets: { primary: ['中下胸'], secondary: ['前肩'] },
      equipment_required: ['哑铃', '卧推凳'],
      pattern: 'push',
      impact_level: { shoulder: 6, elbow: 5, wrist: 2 }
    }
  },
  {
    name: '俯卧撑',
    exercise_type: 'bodyweight',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['中下胸'], secondary: ['三头', '前肩'] },
      equipment_required: [],
      pattern: 'push',
      impact_level: { shoulder: 5, elbow: 6, wrist: 4 }
    }
  },
  {
    name: '上斜卧推',
    exercise_type: 'resistance',
    difficulty: 'intermediate',
    attributes: {
      targets: { primary: ['上胸'], secondary: ['三头', '前肩'] },
      equipment_required: ['杠铃', '上斜凳'],
      pattern: 'push',
      impact_level: { shoulder: 8, elbow: 7, wrist: 3 }
    }
  },
  {
    name: '双杠臂屈伸',
    exercise_type: 'bodyweight',
    difficulty: 'intermediate',
    attributes: {
      targets: { primary: ['下胸'], secondary: ['三头'] },
      equipment_required: ['双杠'],
      pattern: 'push',
      impact_level: { shoulder: 7, elbow: 9, wrist: 4 }
    }
  },
  // BACK EXERCISES
  {
    name: '引体向上',
    exercise_type: 'bodyweight',
    difficulty: 'intermediate',
    attributes: {
      targets: { primary: ['背阔'], secondary: ['二头', '后肩'] },
      equipment_required: ['单杠'],
      pattern: 'pull',
      impact_level: { shoulder: 8, elbow: 7, wrist: 4 }
    }
  },
  {
    name: '杠铃划船',
    exercise_type: 'resistance',
    difficulty: 'intermediate',
    attributes: {
      targets: { primary: ['背部厚度'], secondary: ['后肩', '二头'] },
      equipment_required: ['杠铃'],
      pattern: 'pull',
      impact_level: { shoulder: 7, elbow: 6, lower_back: 7 }
    }
  },
  {
    name: '高位下拉',
    exercise_type: 'resistance',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['背阔'], secondary: ['二头', '后肩'] },
      equipment_required: ['拉力器'],
      pattern: 'pull',
      impact_level: { shoulder: 6, elbow: 5, wrist: 3 }
    }
  },
  {
    name: '坐姿绳索划船',
    exercise_type: 'resistance',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['背部厚度'], secondary: ['后肩', '二头'] },
      equipment_required: ['拉力器'],
      pattern: 'pull',
      impact_level: { shoulder: 5, elbow: 5, lower_back: 3 }
    }
  },
  {
    name: '硬拉',
    exercise_type: 'resistance',
    difficulty: 'advanced',
    attributes: {
      targets: { primary: ['后链'], secondary: ['臀大', '股四', '背阔'] },
      equipment_required: ['杠铃'],
      pattern: 'hinge',
      impact_level: { lower_back: 10, hip: 9, knee: 7 }
    }
  },
  // LEG EXERCISES
  {
    name: '杠铃深蹲',
    exercise_type: 'resistance',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['股四'], secondary: ['臀大', '核心'] },
      equipment_required: ['杠铃', '深蹲架'],
      pattern: 'squat',
      impact_level: { knee: 9, hip: 7, lower_back: 6 }
    }
  },
  {
    name: '腿举',
    exercise_type: 'resistance',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['股四'], secondary: ['臀大'] },
      equipment_required: ['腿举机'],
      pattern: 'squat',
      impact_level: { knee: 7, hip: 5 }
    }
  },
  {
    name: '罗马尼亚硬拉',
    exercise_type: 'resistance',
    difficulty: 'intermediate',
    attributes: {
      targets: { primary: ['腘绳'], secondary: ['臀大'] },
      equipment_required: ['杠铃'],
      pattern: 'hinge',
      impact_level: { lower_back: 7, hip: 8, knee: 4 }
    }
  },
  {
    name: '箭步蹲',
    exercise_type: 'unilateral',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['股四'], secondary: ['臀大'] },
      equipment_required: [],
      pattern: 'lunge',
      impact_level: { knee: 7, hip: 6 }
    }
  },
  {
    name: '腿弯举',
    exercise_type: 'resistance',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['腘绳'], secondary: [] },
      equipment_required: ['腿弯举机'],
      pattern: 'pull',
      impact_level: { knee: 5 }
    }
  },
  // SHOULDER EXERCISES
  {
    name: '站姿杠铃推举',
    exercise_type: 'resistance',
    difficulty: 'intermediate',
    attributes: {
      targets: { primary: ['三角肌'], secondary: ['三头'] },
      equipment_required: ['杠铃'],
      pattern: 'push',
      impact_level: { shoulder: 10, elbow: 6, wrist: 3 }
    }
  },
  {
    name: '哑铃侧平举',
    exercise_type: 'resistance',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['中束'], secondary: ['前束', '后束'] },
      equipment_required: ['哑铃'],
      pattern: 'pull',
      impact_level: { shoulder: 4, elbow: 3 }
    }
  },
  {
    name: '面拉',
    exercise_type: 'resistance',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['后束'], secondary: ['中束', 'ROTATOR_CUFF'] },
      equipment_required: ['拉力器'],
      pattern: 'pull',
      impact_level: { shoulder: 3, elbow: 4 }
    }
  },
  // ARM EXERCISES
  {
    name: '杠铃弯举',
    exercise_type: 'resistance',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['二头'], secondary: ['前臂'] },
      equipment_required: ['杠铃'],
      pattern: 'pull',
      impact_level: { elbow: 6, wrist: 3 }
    }
  },
  {
    name: '三头肌下压',
    exercise_type: 'resistance',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['三头'], secondary: [] },
      equipment_required: ['拉力器'],
      pattern: 'push',
      impact_level: { elbow: 7, wrist: 4 }
    }
  },
  // CORE EXERCISES
  {
    name: '平板支撑',
    exercise_type: 'isometric',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['核心'], secondary: ['肩膀'] },
      equipment_required: [],
      pattern: 'stabilize',
      impact_level: { lower_back: 3, shoulder: 4 }
    }
  },
  {
    name: '卷腹',
    exercise_type: 'bodyweight',
    difficulty: 'beginner',
    attributes: {
      targets: { primary: ['腹肌'], secondary: [] },
      equipment_required: [],
      pattern: 'flexion',
      impact_level: { spine: 3 }
    }
  }
];

async function main() {
  logger.info('[seedExercises] Starting to seed exercises data with NanoID format');

  // Use DATABASE_URL directly
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error('[seedExercises] DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // 检查现有数据
    const existingResult = await pool.query('SELECT COUNT(*) as count FROM exercises');
    const existingCount = parseInt(existingResult.rows[0].count, 10);

    logger.info('[seedExercises] Existing exercises count', { count: existingCount });

    if (existingCount > 0) {
      logger.info('[seedExercises] Exercises already exist, skipping seed');
      await pool.end();
      return;
    }

    // 插入数据 - 生成 NanoID for each exercise
    let inserted = 0;
    let skipped = 0;

    for (const template of exerciseTemplates) {
      try {
        const exerciseId = generateExerciseNanoId();
        await pool.query(
          `INSERT INTO exercises (id, name, exercise_type, difficulty, attributes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [
            exerciseId,
            template.name,
            template.exercise_type,
            template.difficulty,
            JSON.stringify(template.attributes)
          ]
        );
        inserted++;
        logger.info('[seedExercises] Inserted exercise', {
          id: exerciseId,
          name: template.name
        });
      } catch (error) {
        logger.warn('[seedExercises] Failed to insert exercise', {
          name: template.name,
          error
        });
        skipped++;
      }
    }

    // 验证结果
    const verifyResult = await pool.query('SELECT COUNT(*) as count FROM exercises');
    const finalCount = parseInt(verifyResult.rows[0].count, 10);

    logger.info('[seedExercises] Seed completed', {
      inserted,
      skipped,
      finalCount
    });

    await pool.end();
    process.exit(0);
  } catch (error) {
    logger.error('[seedExercises] Fatal error', { error });
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('[seedExercises] Unhandled error', { error });
  process.exit(1);
});
