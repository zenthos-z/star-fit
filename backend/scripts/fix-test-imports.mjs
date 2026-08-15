#!/usr/bin/env node

/**
 * Fix Test Imports Script
 *
 * Converts 'shared/contracts' imports to relative paths
 * to unblock test execution with the current Jest configuration.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TESTS_DIR = join(__dirname, '../tests');

// Pattern to match shared/contracts imports
const IMPORT_PATTERN = /from ['"]shared\/contracts(?:\/(.*?))?['"]/g;

function processFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const originalContent = content;

  // Replace imports with relative paths
  const newContent = content.replace(IMPORT_PATTERN, (match, subPath) => {
    // Calculate relative path from test file to shared/contracts
    const testDir = dirname(filePath);
    const contractsDir = join(__dirname, '../../shared/contracts');
    const relativePath = relative(testDir, contractsDir);

    // Convert to POSIX path separators
    const posixPath = relativePath.replace(/\\/g, '/');

    // Add .js extension and subpath if present
    const suffix = subPath ? `/${subPath}` : '';
    return `from '${posixPath}${suffix}.js'`;
  });

  if (newContent !== originalContent) {
    writeFileSync(filePath, newContent, 'utf-8');
    return true;
  }
  return false;
}

function findTestFiles(dir, files = []) {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      findTestFiles(fullPath, files);
    } else if (entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function main() {
  console.log('🔧 Fixing test imports...\n');

  const testFiles = findTestFiles(TESTS_DIR);
  console.log(`📁 Found ${testFiles.length} test files\n`);

  let fixedCount = 0;

  for (const file of testFiles) {
    const wasFixed = processFile(file);
    if (wasFixed) {
      fixedCount++;
      const relativePath = relative(TESTS_DIR, file);
      console.log(`✅ Fixed: ${relativePath}`);
    }
  }

  console.log(`\n✨ Fixed ${fixedCount} test file(s)`);

  if (fixedCount === 0) {
    console.log('\nℹ️  No imports needed fixing.');
  } else {
    console.log('\n📝 Next steps:');
    console.log('   1. Run: npm run test:unit');
    console.log('   2. Check for any remaining issues');
    console.log('   3. Run: npm run test:coverage');
  }
}

main();
