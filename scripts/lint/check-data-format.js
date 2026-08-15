#!/usr/bin/env node

/**
 * Data Format Consistency Check Script
 * 
 * Checks for:
 * 1. fitness_level using uppercase (BEGINNER/INTERMEDIATE/ADVANCED) instead of lowercase
 * 2. Field name inconsistencies (lastSummary vs summary, tags_json vs red_flags)
 * 3. JSON field type inconsistencies
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const COLORS = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  reset: '\x1b[0m'
};

const issues = [];

function log(message, color = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(process.cwd(), filePath);

  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (/(BEGINNER|INTERMEDIATE|ADVANCED)/.test(line) && !/['"]?(beginner|intermediate|advanced)['"]?/.test(line)) {
      issues.push({
        type: 'fitness_level_case',
        file: relativePath,
        line: lineNumber,
        message: `Uppercase fitness_level detected: ${line.trim()}`,
        suggestion: 'Use lowercase: beginner, intermediate, advanced'
      });
    }

    if (/\blastSummary\b/.test(line)) {
      issues.push({
        type: 'field_name',
        file: relativePath,
        line: lineNumber,
        message: `Old field name 'lastSummary' detected: ${line.trim()}`,
        suggestion: 'Use: summary'
      });
    }

    if (/tags_json/.test(line) && /red_flags/.test(line) === false) {
      if (line.includes('tags_json') && !line.includes('//')) {
        issues.push({
          type: 'field_name',
          file: relativePath,
          line: lineNumber,
          message: `Using 'tags_json' instead of 'red_flags': ${line.trim()}`,
          suggestion: 'Use: red_flags for consistency'
        });
      }
    }

    if (/avoided\s*:/g.test(line) && /avoid_exercises\s*:/g.test(line) === false) {
      issues.push({
        type: 'field_name',
        file: relativePath,
        line: lineNumber,
        message: `Using 'avoided' instead of 'avoid_exercises': ${line.trim()}`,
        suggestion: 'Use: avoid_exercises for consistency'
      });
    }
  });
}

function scanDirectory(dir, extensions = ['.ts', '.tsx', '.js', '.jsx']) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      const skipDirs = ['node_modules', '.next', 'dist', 'build', '.git'];
      if (!skipDirs.includes(file.name)) {
        scanDirectory(fullPath, extensions);
      }
    } else if (extensions.some(ext => file.name.endsWith(ext))) {
      checkFile(fullPath);
    }
  }
}

function main() {
  const dirs = [
    path.join(process.cwd(), 'backend', 'src'),
    path.join(process.cwd(), 'src', 'admin', 'v2')
  ];

  log('🔍 Scanning for data format consistency issues...\n', 'yellow');

  dirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      log(`Scanning: ${dir}`);
      scanDirectory(dir);
    }
  });

  log(`\n📊 Scan complete. Found ${issues.length} issues.\n`, issues.length > 0 ? 'red' : 'green');

  if (issues.length > 0) {
    const grouped = issues.reduce((acc, issue) => {
      if (!acc[issue.type]) acc[issue.type] = [];
      acc[issue.type].push(issue);
      return acc;
    }, {});

    Object.entries(grouped).forEach(([type, typeIssues]) => {
      log(`\n${type.toUpperCase()} Issues (${typeIssues.length}):`, 'red');
      typeIssues.forEach(issue => {
        log(`  ${issue.file}:${issue.line}`, 'yellow');
        log(`    ${issue.message}`);
        log(`    💡 ${issue.suggestion}`, 'green');
      });
    });

    process.exit(1);
  } else {
    log('✅ No data format issues found!\n', 'green');
    process.exit(0);
  }
}

main();
