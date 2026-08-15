#!/usr/bin/env node

/**
 * API Call Consistency Check Script
 *
 * Checks for:
 * 1. All updateProfile calls have proper replaceAnchors parameter
 * 2. API response format consistency
 * 3. Missing required parameters
 */

import fs from 'fs';
import path from 'path';

const COLORS = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
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

    if (/updateProfile\s*\(/.test(line) || /\.updateProfile/.test(line)) {
      if (!line.includes('replaceAnchors')) {
        const linesAround = lines.slice(Math.max(0, index - 5), index + 5);
        const context = linesAround.join('\n');

        if (context.includes('load_anchors') && !context.includes('replaceAnchors')) {
          issues.push({
            type: 'missing_replace_anchors',
            file: relativePath,
            line: lineNumber,
            message: `updateProfile call with load_anchors but missing replaceAnchors parameter`,
            suggestion: 'Add replaceAnchors: true or replaceAnchors: false as appropriate'
          });
        }
      }
    }

    if (/\/api\/profiles\//.test(line) && /load_anchors/.test(line)) {
      const linesAround = lines.slice(Math.max(0, index - 5), index + 5);
      if (!linesAround.some(l => l.includes('replaceAnchors'))) {
        issues.push({
          type: 'missing_replace_anchors',
          file: relativePath,
          line: lineNumber,
          message: `API call to /api/profiles/ with load_anchors data but missing replaceAnchors`,
          suggestion: 'Add replaceAnchors: true or replaceAnchors: false to request body'
        });
      }
    }

    if (/\.then\s*\(/.test(line) && /response\.data/.test(lines[lineNumber] || '')) {
      const linesAround = lines.slice(index, index + 10);
      const hasErrorCheck = linesAround.some(l => 
        l.includes('.catch') || l.includes('try') || l.includes('catch')
      );

      if (!hasErrorCheck && linesAround.some(l => l.includes('response'))) {
        issues.push({
          type: 'missing_error_handling',
          file: relativePath,
          line: lineNumber,
          message: `API response without proper error handling`,
          suggestion: 'Add try/catch or .catch() to handle API errors'
        });
      }
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
    path.join(process.cwd(), 'src', 'admin', 'v2'),
    path.join(process.cwd(), 'backend', 'src', 'controllers')
  ];

  log('🔍 Scanning for API call consistency issues...\n', 'cyan');

  dirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      log(`Scanning: ${dir}`);
      scanDirectory(dir);
    }
  });

  log(`\n📊 Scan complete. Found ${issues.length} potential issues.\n`, issues.length > 0 ? 'red' : 'green');

  if (issues.length > 0) {
    const grouped = issues.reduce((acc, issue) => {
      if (!acc[issue.type]) acc[issue.type] = [];
      acc[issue.type].push(issue);
      return acc;
    }, {});

    Object.entries(grouped).forEach(([type, typeIssues]) => {
      log(`\n${type.replace(/_/g, ' ').toUpperCase()} Issues (${typeIssues.length}):`, 'red');
      typeIssues.forEach(issue => {
        log(`  ${issue.file}:${issue.line}`, 'yellow');
        log(`    ${issue.message}`);
        log(`    💡 ${issue.suggestion}`, 'green');
      });
    });

    process.exit(1);
  } else {
    log('✅ No API consistency issues found!\n', 'green');
    process.exit(0);
  }
}

main();
