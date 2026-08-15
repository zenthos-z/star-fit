/**
 * Fix all shared/contracts import paths from 7 levels to 5 levels
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const masDir = path.join(__dirname, '../src/services/mas');

// Files to fix: 7-level-up imports (../../../../../shared/contracts)
const filesToFix = [
  'mas/memoryNode.ts',              // line 1: LoadAnchor types
  'mas/historyService.ts',            // line 3: parseJSONSafe
  'mas/memory/persistence.ts',        // line 3: parseJSONSafe
  'mas/memory/persistence.ts',         // line 6: LoadAnchors types
  'mas/services/CompressionService.ts',  // line 22
  'mas/services/ICompressionService.ts',  // line 10
  'mas/services/IProfileService.ts',    // line 20
  'mas/services/ProfileUpdateManager.ts',  // line 23
  'mas/services/ProfileService.ts',        // line 27
  'mas/services/ProgressionService.ts',    // line 22
  'mas/services/ProgressionService.ts',     // line 11
  'mas/services/ISelfHealingService.ts',   // line 10
  'mas/services/IProgressionService.ts',     // line 22
  'mas/services/SelfHealingService.ts',      // line 16
  'mas/services/ProfileService.ts',          // line 15
  'mas/services/ValidationService.ts',         // line 17
  'mas/services/SelfHealingService.ts',        // line 16
  'mas/tools/queryExerciseLibrary.ts',      // line 17
];

console.log('[Fix] Starting import path fixes...');
console.log('[Fix] Files to fix:', filesToFix.length);

let fixedCount = 0;
let errorCount = 0;

for (const file of filesToFix) {
  const filePath = path.join(masDir, file);

  try {
    let content = fs.readFileSync(filePath, 'utf8');

    // Pattern 1: Fix 'from '../../../../../shared/contracts/' to 'from ../../../../../shared/contracts/'
    const pattern1 = /from\s+['"]\.\.\\.\.\\.\.\\.\.\\.\.\\.\.\\shared\/contracts/g;
    content = content.replace(pattern1, 'from \'../../../../../shared/contracts/\'');

    // Pattern 2: Fix type imports with same path
    const pattern2 = /from\s+['"]\.\.\\.\.\\.\.\\.\.\\.\.\\.\.\\.\.\\shared\/contracts\/index\.js['"]/g;
    content = content.replace(pattern2, 'from \'../../../../../shared/contracts/index.js\'');

    // Count fixed occurrences
    const matches1 = (content.match(pattern1) || []).length;
    const matches2 = (content.match(pattern2) || []).length;

    if (matches1 > 0 || matches2 > 0) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[Fix] ✓ ${file}`);
      fixedCount++;
    } else {
      console.log(`[Fix] - ${file} (no changes needed)`);
    }

  } catch (error) {
    console.error(`[Fix] ✗ ${file}:`, error.message);
    errorCount++;
  }
}

console.log(`\n[Fix] Complete!`);
console.log(`[Fix] Fixed: ${fixedCount} files`);
console.log(`[Fix] Errors: ${errorCount}`);
console.log(`[Fix] Skipped: ${filesToFix.length - fixedCount - errorCount} files (no changes needed)`);

process.exit(errorCount > 0 ? 1 : 0);
