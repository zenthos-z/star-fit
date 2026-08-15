-- ============================================================================
-- Starfit Exercises Seed Data
-- ============================================================================
-- Version: 1.0.0
-- Created: 2026-02-19
-- Description: Basic exercise data for training plan generation
--
-- This file contains 20 basic exercises covering:
-- - Chest, Back, Legs, Shoulders, Arms, Core
-- - Difficulty levels: beginner, intermediate, advanced
-- - Various exercise types: resistance, bodyweight, unilateral, etc.
-- ============================================================================

-- Clear existing data (optional - comment out if you want to preserve existing data)
-- TRUNCATE TABLE exercises RESTART IDENTITY CASCADE;

-- ============================================================================
-- CHEST EXERCISES (胸部)
-- ============================================================================

INSERT INTO exercises (id, name, exercise_type, difficulty, attributes) VALUES
('fit:exercise:bench_press', '杠铃卧推', 'resistance', 'beginner', '{
  "targets": {"primary": ["中下胸"], "secondary": ["三头", "前肩"]},
  "equipment_required": ["杠铃", "卧推凳"],
  "pattern": "push",
  "impact_level": {"shoulder": 7, "elbow": 8, "wrist": 3}
}'::jsonb),

('fit:exercise:dumbbell_fly', '哑铃飞鸟', 'resistance', 'intermediate', '{
  "targets": {"primary": ["中下胸"], "secondary": ["前肩"]},
  "equipment_required": ["哑铃", "卧推凳"],
  "pattern": "push",
  "impact_level": {"shoulder": 6, "elbow": 5, "wrist": 2}
}'::jsonb),

('fit:exercise:pushup', '俯卧撑', 'bodyweight', 'beginner', '{
  "targets": {"primary": ["中下胸"], "secondary": ["三头", "前肩"]},
  "equipment_required": [],
  "pattern": "push",
  "impact_level": {"shoulder": 5, "elbow": 6, "wrist": 4}
}'::jsonb),

('fit:exercise:incline_bench_press', '上斜卧推', 'resistance', 'intermediate', '{
  "targets": {"primary": ["上胸"], "secondary": ["三头", "前肩"]},
  "equipment_required": ["杠铃", "上斜凳"],
  "pattern": "push",
  "impact_level": {"shoulder": 8, "elbow": 7, "wrist": 3}
}'::jsonb),

('fit:exercise:dip', '双杠臂屈伸', "bodyweight", 'intermediate', '{
  "targets": {"primary": ["下胸"], "secondary": ["三头"]},
  "equipment_required": ["双杠"],
  "pattern": "push",
  "impact_level": {"shoulder": 7, "elbow": 9, "wrist": 4}
}'::jsonb);

-- ============================================================================
-- BACK EXERCISES (背部)
-- ============================================================================

INSERT INTO exercises (id, name, exercise_type, difficulty, attributes) VALUES
('fit:exercise:pullup', '引体向上', 'bodyweight', 'intermediate', '{
  "targets": {"primary": ["背阔"], "secondary": ["二头", "后肩"]},
  "equipment_required": ["单杠"],
  "pattern": "pull",
  "impact_level": {"shoulder": 8, "elbow": 7, "wrist": 4}
}'::jsonb),

('fit:exercise:barbell_row', '杠铃划船', 'resistance', 'intermediate', '{
  "targets": {"primary": ["背部厚度"], "secondary": ["后肩", "二头"]},
  "equipment_required": ["杠铃"],
  "pattern": "pull",
  "impact_level": {"shoulder": 7, "elbow": 6, "lower_back": 7}
}'::jsonb),

('fit:exercise:lat_pulldown', '高位下拉', 'resistance', 'beginner', '{
  "targets": {"primary": ["背阔"], "secondary": ["二头", "后肩"]},
  "equipment_required": ["拉力器"],
  "pattern": "pull",
  "impact_level": {"shoulder": 6, "elbow": 5, "wrist": 3}
}'::jsonb),

('fit:exercise:seated_cable_row', '坐姿绳索划船', 'resistance', 'beginner', '{
  "targets": {"primary": ["背部厚度"], "secondary": ["后肩", "二头"]},
  "equipment_required": ["拉力器"],
  "pattern": "pull",
  "impact_level": {"shoulder": 5, "elbow": 5, "lower_back": 3}
}'::jsonb),

('fit:exercise:deadlift', '硬拉', 'resistance', 'advanced', '{
  "targets": {"primary": ["后链"], "secondary": ["臀大", "股四", "背阔"]},
  "equipment_required": ["杠铃"],
  "pattern": "hinge",
  "impact_level": {"lower_back": 10, "hip": 9, "knee": 7}
}'::jsonb);

-- ============================================================================
-- LEG EXERCISES (腿部)
-- ============================================================================

INSERT INTO exercises (id, name, exercise_type, difficulty, attributes) VALUES
('fit:exercise:squat', '杠铃深蹲', 'resistance', 'beginner', '{
  "targets": {"primary": ["股四"], "secondary": ["臀大", "核心"]},
  "equipment_required": ["杠铃", "深蹲架"],
  "pattern": "squat",
  "impact_level": {"knee": 9, "hip": 7, "lower_back": 6}
}'::jsonb),

('fit:exercise:leg_press', '腿举', 'resistance', 'beginner', '{
  "targets": {"primary": ["股四"], "secondary": ["臀大"]},
  "equipment_required": ["腿举机"],
  "pattern": "squat",
  "impact_level": {"knee": 7, "hip": 5}
}'::jsonb),

('fit:exercise:romanian_deadlift', '罗马尼亚硬拉', 'resistance', 'intermediate', '{
  "targets": {"primary": ["腘绳"], "secondary": ["臀大"]},
  "equipment_required": ["杠铃"],
  "pattern": "hinge",
  "impact_level": {"lower_back": 7, "hip": 8, "knee": 4}
}'::jsonb),

('fit:exercise:lunge', '箭步蹲', 'unilateral', 'beginner', '{
  "targets": {"primary": ["股四"], "secondary": ["臀大"]},
  "equipment_required": [],
  "pattern": "lunge",
  "impact_level": {"knee": 7, "hip": 6}
}'::jsonb),

('fit:exercise:leg_curl', '腿弯举', 'resistance', 'beginner', '{
  "targets": {"primary": ["腘绳"], "secondary": []},
  "equipment_required": ["腿弯举机"],
  "pattern": "pull",
  "impact_level": {"knee": 5}
}'::jsonb);

-- ============================================================================
-- SHOULDER EXERCISES (肩部)
-- ============================================================================

INSERT INTO exercises (id, name, exercise_type, difficulty, attributes) VALUES
('fit:exercise:overhead_press', '站姿杠铃推举', 'resistance', 'intermediate', '{
  "targets": {"primary": ["三角肌"], "secondary": ["三头"]},
  "equipment_required": ["杠铃"],
  "pattern": "push",
  "impact_level": {"shoulder": 10, "elbow": 6, "wrist": 3}
}'::jsonb),

('fit:exercise:lateral_raise', '哑铃侧平举', 'resistance', 'beginner', '{
  "targets": {"primary": ["中束"], "secondary": ["前束", "后束"]},
  "equipment_required": ["哑铃"],
  "pattern": "pull",
  "impact_level": {"shoulder": 4, "elbow": 3}
}'::jsonb),

('fit:exercise:face_pull', '面拉', 'resistance', 'beginner', '{
  "targets": {"primary": ["后束"], "secondary": ["中束", "ROTATOR_CUFF"]},
  "equipment_required": ["拉力器"],
  "pattern": "pull",
  "impact_level": {"shoulder": 3, "elbow": 4}
}'::jsonb);

-- ============================================================================
-- ARM EXERCISES (手臂)
-- ============================================================================

INSERT INTO exercises (id, name, exercise_type, difficulty, attributes) VALUES
('fit:exercise:bicep_curl', '杠铃弯举', 'resistance', 'beginner', '{
  "targets": {"primary": ["二头"], "secondary": ["前臂"]},
  "equipment_required": ["杠铃"],
  "pattern": "pull",
  "impact_level": {"elbow": 6, "wrist": 3}
}'::jsonb),

('fit:exercise:tricep_extension', '三头肌下压', 'resistance', 'beginner', '{
  "targets": {"primary": ["三头"], "secondary": []},
  "equipment_required": ["拉力器"],
  "pattern": "push",
  "impact_level": {"elbow": 7, "wrist": 4}
}'::jsonb);

-- ============================================================================
-- CORE EXERCISES (核心)
-- ============================================================================

INSERT INTO exercises (id, name, exercise_type, difficulty, attributes) VALUES
('fit:exercise:plank', '平板支撑', 'isometric', 'beginner', '{
  "targets": {"primary": ["核心"], "secondary": ["肩膀"]},
  "equipment_required": [],
  "pattern": "stabilize",
  "impact_level": {"lower_back": 3, "shoulder": 4}
}'::jsonb);

INSERT INTO exercises (id, name, exercise_type, difficulty, attributes) VALUES
('fit:exercise:crunch', '卷腹', 'bodyweight', 'beginner', '{
  "targets": {"primary": ["腹肌"], "secondary": []},
  "equipment_required": [],
  "pattern": "flexion",
  "impact_level": {"spine": 3}
}'::jsonb);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify data was inserted
-- SELECT id, name, exercise_type, difficulty, attributes
-- FROM exercises
-- ORDER BY exercise_type, name;

-- Count by exercise type
-- SELECT exercise_type, COUNT(*) as count
-- FROM exercises
-- GROUP BY exercise_type
-- ORDER BY count DESC;

-- Count by difficulty
-- SELECT difficulty, COUNT(*) as count
-- FROM exercises
-- GROUP BY difficulty
-- ORDER BY count DESC;
