// Seed exercises into database
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/starfit'
});

async function seedExercises() {
  try {
    console.log('Seeding exercises table...');

    const exercises = [
      {
        id: 'bench_press',
        name: '杠铃卧推',
        exercise_type: 'resistance',
        difficulty: 'intermediate',
        attributes: {
          targets: { primary: ['胸大肌'], secondary: ['三角肌前束', '肱三头肌'] },
          equipment_required: ['barbell', 'bench'],
          impact_level: { shoulder: 6, chest: 9, triceps: 7 },
          pattern: 'push',
          movement_plane: 'sagittal',
        },
      },
      {
        id: 'squat',
        name: '深蹲',
        exercise_type: 'resistance',
        difficulty: 'intermediate',
        attributes: {
          targets: { primary: ['股四头肌'], secondary: ['臀大肌', '竖脊肌'] },
          equipment_required: ['barbell'],
          impact_level: { knee: 10, back: 8, hips: 9 },
          pattern: 'squat',
          movement_plane: 'sagittal',
        },
      },
      {
        id: 'deadlift',
        name: '硬拉',
        exercise_type: 'resistance',
        difficulty: 'advanced',
        attributes: {
          targets: { primary: ['背阔肌', '臀部', '腘绳肌'], secondary: ['竖脊肌', '斜方肌'] },
          equipment_required: ['barbell'],
          impact_level: { back: 10, hips: 9, legs: 8 },
          pattern: 'hinge',
          movement_plane: 'sagittal',
        },
      },
      {
        id: 'overhead_press',
        name: '站姿杠铃推举',
        exercise_type: 'resistance',
        difficulty: 'intermediate',
        attributes: {
          targets: { primary: ['三角肌'], secondary: ['肱三头肌', '核心'] },
          equipment_required: ['barbell'],
          impact_level: { shoulder: 10, triceps: 7 },
          pattern: 'push',
          movement_plane: 'sagittal',
        },
      },
      {
        id: 'pull_up',
        name: '引体向上',
        exercise_type: 'bodyweight',
        difficulty: 'intermediate',
        attributes: {
          targets: { primary: ['背阔肌'], secondary: ['二头肌', '后肩'] },
          equipment_required: ['bar'],
          impact_level: { back: 9, biceps: 7 },
          pattern: 'pull',
          movement_plane: 'sagittal',
        },
      },
      {
        id: 'barbell_row',
        name: '杠铃划船',
        exercise_type: 'resistance',
        difficulty: 'intermediate',
        attributes: {
          targets: { primary: ['背阔肌', '菱形肌'], secondary: ['二头肌', '后肩'] },
          equipment_required: ['barbell'],
          impact_level: { back: 9, biceps: 6 },
          pattern: 'pull',
          movement_plane: 'sagittal',
        },
      },
      {
        id: 'leg_press',
        name: '腿举',
        exercise_type: 'resistance',
        difficulty: 'beginner',
        attributes: {
          targets: { primary: ['股四头肌'], secondary: ['臀部'] },
          equipment_required: ['leg_press_machine'],
          impact_level: { legs: 8 },
          pattern: 'squat',
          movement_plane: 'sagittal',
        },
      },
      {
        id: 'lateral_raise',
        name: '哑铃侧平举',
        exercise_type: 'resistance',
        difficulty: 'beginner',
        attributes: {
          targets: { primary: ['三角肌中束'] },
          equipment_required: ['dumbbell'],
          impact_level: { shoulder: 5 },
          pattern: 'isolation',
          movement_plane: 'frontal',
        },
      },
      {
        id: 'bicep_curl',
        name: '哑铃弯举',
        exercise_type: 'resistance',
        difficulty: 'beginner',
        attributes: {
          targets: { primary: ['二头肌'] },
          equipment_required: ['dumbbell'],
          impact_level: { arms: 4 },
          pattern: 'isolation',
          movement_plane: 'sagittal',
        },
      },
      {
        id: 'plank',
        name: '平板支撑',
        exercise_type: 'isometric',
        difficulty: 'beginner',
        attributes: {
          targets: { primary: ['核心'], secondary: ['肩部', '背部'] },
          equipment_required: [],
          impact_level: { core: 7 },
          pattern: 'stability',
          movement_plane: null,
        },
      },
      {
        id: 'lunges',
        name: '箭步蹲',
        exercise_type: 'resistance',
        difficulty: 'beginner',
        attributes: {
          targets: { primary: ['股四头肌'], secondary: ['臀部', '腘绳肌'] },
          equipment_required: ['dumbbell'],
          impact_level: { legs: 7 },
          pattern: 'lunge',
          movement_plane: 'sagittal',
        },
      },
      {
        id: 'dip',
        name: '双杠臂屈伸',
        exercise_type: 'bodyweight',
        difficulty: 'intermediate',
        attributes: {
          targets: { primary: ['三头肌'], secondary: ['胸大肌', '前肩'] },
          equipment_required: ['parallel_bars'],
          impact_level: { triceps: 8, chest: 6 },
          pattern: 'push',
          movement_plane: 'sagittal',
        },
      },
    ];

    // Create enum types if they don't exist
    console.log('Ensuring enum types exist...');
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exercise_type_enum') THEN
        CREATE TYPE exercise_type_enum AS ENUM (
          'resistance', 'unilateral', 'bodyweight', 'assisted', 'isometric',
          'cardio', 'flexibility', 'heavy_weight', 'rep_training', 'outdoor'
        );
      END IF;
    END $$;`);

    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'difficulty_level') THEN
        CREATE TYPE difficulty_level AS ENUM ('beginner', 'intermediate', 'advanced');
      END IF;
    END $$;`);

    let inserted = 0;
    for (const exercise of exercises) {
      try {
        await pool.query(
          `INSERT INTO exercises (id, name, exercise_type, difficulty, attributes)
           VALUES ($1, $2, $3::exercise_type_enum, $4::difficulty_level, $5::jsonb)
           ON CONFLICT (name) DO UPDATE SET
             exercise_type = EXCLUDED.exercise_type,
             difficulty = EXCLUDED.difficulty,
             attributes = EXCLUDED.attributes`,
          [exercise.id, exercise.name, exercise.exercise_type, exercise.difficulty, JSON.stringify(exercise.attributes)]
        );
        inserted++;
        console.log(`  ✓ ${exercise.name} (${exercise.id})`);
      } catch (err) {
        console.error(`  ✗ Failed to insert ${exercise.name}:`, err.message);
      }
    }

    console.log(`\nSeeded ${inserted} exercises into database`);

    // Verify
    const result = await pool.query('SELECT COUNT(*) as count FROM exercises');
    console.log(`Total exercises in database: ${result.rows[0].count}`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

seedExercises();
