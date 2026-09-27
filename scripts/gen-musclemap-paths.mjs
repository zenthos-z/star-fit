#!/usr/bin/env node
/**
 * gen-musclemap-paths.mjs — 从 MuscleMap Swift Package (MIT) 提取 SVG path 数据
 *
 * 数据真源：Sources/MuscleMap/Data/{MaleFront,MaleBack,FemaleFront,FemaleBack}Paths.swift
 * （BodyPartPathData: slug + common/left/right 三组 SVG path 字符串，36 肌群）。
 * 本脚本做确定性文本转换（非 LLM），产出 src/components/musclemap/paths/*.ts。
 *
 * 用法：node scripts/gen-musclemap-paths.mjs <MuscleMap包根目录>
 * 默认包根：Xcode SourcePackages checkouts 下的 MuscleMap。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const repoRoot = process.argv[2] ??
  '/Users/Admin/Library/Developer/Xcode/DerivedData/App-aexscdjegemnrhbwhppsiorqndrc/SourcePackages/checkouts/MuscleMap';

const FILES = [
  ['MaleFrontPaths.swift', 'male-front'],
  ['MaleBackPaths.swift', 'male-back'],
  ['FemaleFrontPaths.swift', 'female-front'],
  ['FemaleBackPaths.swift', 'female-back'],
];

/** 解析一个 Paths.swift 文件 → [{ slug, common[], left[], right[] }] */
function parseSwiftPaths(source) {
  const entries = [];
  // 逐个 BodyPartPathData 块：从 "slug: .xxx" 起，到与之平衡的 ")" 为止
  const slugRe = /slug:\s*\.([A-Za-z]+)/g;
  let m;
  while ((m = slugRe.exec(source)) !== null) {
    const slug = m[1]
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase();
    // 块体：从 slug 起找到平衡的 "(" ... ")"（BodyPartPathData( ... )）
    let i = source.indexOf('(', m.index);
    let depth = 0;
    let end = i;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const block = source.slice(m.index, end);
    // 数组段：left/right/common 各取 [ ... ] 内的字符串字面量
    const grab = (name) => {
      const am = block.match(new RegExp(`${name}:\\s*\\[([\\s\\S]*?)\\]`));
      if (!am) return [];
      return [...am[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(s => s[1]);
    };
    entries.push({
      slug,
      common: grab('common'),
      left: grab('left'),
      right: grab('right'),
    });
  }
  return entries;
}

const outDir = new URL('../src/components/musclemap/paths/', import.meta.url).pathname;
const seenSlugs = new Set();

for (const [file, name] of FILES) {
  const src = readFileSync(`${repoRoot}/Sources/MuscleMap/Data/${file}`, 'utf8');
  const entries = parseSwiftPaths(src);
  entries.forEach(e => seenSlugs.add(e.slug));

  const body = entries.map(e => `  {
    slug: ${JSON.stringify(e.slug)},
    common: ${JSON.stringify(e.common)},
    left: ${JSON.stringify(e.left)},
    right: ${JSON.stringify(e.right)},
  },`).join('\n');

  const ts = `/**
 * ${name} paths — 数据来源：MuscleMap Swift Package (MIT)
 * https://github.com/melihcolpan/MuscleMap
 * 提取自 Sources/MuscleMap/Data/${file}（确定性转换，生成器
 * scripts/gen-musclemap-paths.mjs）。坐标为原包画布绝对坐标，
 * viewBox 见 MuscleMapSvg.tsx（与原包 BodyViewBox 一致）。
 */

export interface MusclePathEntry {
  slug: string;
  common: string[];
  left: string[];
  right: string[];
}

export const ${name.replace(/-/g, '_').toUpperCase()}_PATHS: MusclePathEntry[] = [
${body}
];
`;
  writeFileSync(`${outDir}${name}-paths.ts`, ts);
  console.log(`${name}: ${entries.length} entries`);
}

console.log('slugs covered:', seenSlugs.size);
