#!/usr/bin/env node
/**
 * gen-picker-library.mjs — A8A9 数据源再生成工具（v7 起入库）
 *
 * 从生产库导出的 exercises.csv（docker exec backend-postgres-1 psql ... COPY ... CSV HEADER）
 * 生成 src/components/picker/pickerLibraryData.ts（与 pickerData 的 PickerLibraryEntry 同构）。
 * 确定性拷贝：本脚本不做任何 LLM 调用、不改写数据；仅做 CSV 反序列化 + 类型字面量化。
 *
 * 用法：node scripts/gen-picker-library.mjs /tmp/a8a9-v3/exercises.csv
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , csvPath] = process.argv;
if (!csvPath) {
  console.error('usage: node scripts/gen-picker-library.mjs <exercises.csv>');
  process.exit(1);
}

// --- 标准 CSV 解析（处理带引号的换行/逗号；PG 数组 {a,b} → string[]） ---
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function parsePgArray(s) {
  if (!s) return [];
  return s.replace(/^\{/, '').replace(/\}$/, '').split(',').map(x => x.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

const q = (s) => JSON.stringify(s ?? '');

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
console.log('parsed rows:', rows.length);

const outRows = rows.map(r => {
  const refs = parsePgArray(r.image_refs);
  return {
    id: r.id,
    name: r.name,
    nameZh: r.name_zh ?? '',
    exerciseType: r.exercise_type,
    bodyPart: r.body_part ?? '',
    primaryMuscles: parsePgArray(r.primary_muscles),
    secondaryMuscles: parsePgArray(r.secondary_muscles),
    equipment: r.equipment ?? '',
    difficulty: r.difficulty ?? '',
    // 库3 3D 解剖缩略图（R2 CDN），male 版优先；缺失为 ''（列表回退类型图标）
    thumbnail: refs[0] ?? '',
  };
});

const ts = `/**
 * pickerLibraryData — 动作库全量 mock 数据（A8A9 v3）
 *
 * 由生产库 exercises 表确定性导出（非 LLM 产物）：
 *   docker exec backend-postgres-1 psql -U starfit -d starfit -c
 *   "COPY (SELECT id,name,name_zh,exercise_type,category,body_part,primary_muscles,secondary_muscles,equipment,difficulty FROM exercises) TO STDOUT CSV HEADER"
 * 生成器：scripts/gen-picker-library.mjs（一次性工具，不入 commit）。
 * 条目数：${outRows.length}
 */

import type { PickerLibraryEntry } from './pickerData';

export const PICKER_LIBRARY_EXPORTED_AT = ${q(new Date().toISOString())};

export const PICKER_LIBRARY: PickerLibraryEntry[] = [
${outRows.map(r => `  {
    id: ${q(r.id)},
    name: ${q(r.name)},
    nameZh: ${q(r.nameZh)},
    exerciseType: ${q(r.exerciseType)},
    bodyPart: ${q(r.bodyPart)},
    primaryMuscles: [${r.primaryMuscles.map(q).join(', ')}],
    secondaryMuscles: [${r.secondaryMuscles.map(q).join(', ')}],
    equipment: ${q(r.equipment)},
    difficulty: ${q(r.difficulty)},
    thumbnail: ${q(r.thumbnail)},
  },`).join('\n')}
];
`;

const outPath = new URL('../src/components/picker/pickerLibraryData.ts', import.meta.url).pathname;
writeFileSync(outPath, ts);
console.log('written:', outPath, 'entries:', outRows.length);
