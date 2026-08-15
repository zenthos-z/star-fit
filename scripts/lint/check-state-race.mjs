#!/usr/bin/env node

/**
 * State Management Race Condition Check Script
 *
 * Checks for:
 * 1. useEffect with prop dependencies that might reset user input
 * 2. WebSocket callbacks that might interfere with editing state
 * 3. Parent component props changes that might override child local state
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

  let inUseEffect = false;
  let useEffectStartLine = 0;
  let useEffectDeps = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (/useEffect\s*\(/.test(line)) {
      inUseEffect = true;
      useEffectStartLine = lineNumber;

      const match = line.match(/useEffect\s*\(\s*\([^)]*\)\s*,\s*\[([^\]]*)\]\s*\)/);
      if (match) {
        useEffectDeps = match[1].split(',').map(d => d.trim()).filter(d => d);
      }
    }

    if (inUseEffect) {
      if (/^\s*\}\s*\)\s*;/.test(line)) {
        inUseEffect = false;
        useEffectDeps = [];
      }

      if (useEffectDeps.length > 0 && /set[A-Z]/.test(line)) {
        const setStateMatch = line.match(/set[A-Z]\w+/);
        if (setStateMatch && !line.includes('//') && !line.includes('/*')) {
          if (useEffectDeps.includes('open') || useEffectDeps.includes('isOpen')) {
            issues.push({
              type: 'useeffect_props_override',
              file: relativePath,
              line: lineNumber,
              message: `useEffect might override state on dependency change: ${setStateMatch[0]}`,
              suggestion: 'Consider using ref to track initialization or add initialization guard'
            });
          }
        }
      }
    }

    if (/wsService\.on|WebSocket.*onmessage|socket\.on/.test(line)) {
      const wsCallbackMatch = line.match(/(wsService\.on|WebSocket|socket\.on)/);
      if (wsCallbackMatch && /set[A-Z]/.test(lines[lineNumber] || '')) {
        issues.push({
          type: 'websocket_state_interference',
          file: relativePath,
          line: lineNumber,
          message: `WebSocket callback might update local state: ${line.trim()}`,
          suggestion: 'Ensure WebSocket updates do not override user input during editing'
        });
      }
    }

    if (/props\./.test(line) && !line.includes('props.')) {
      if (lines[lineNumber - 2]?.includes('useEffect') || lines[lineNumber - 3]?.includes('useEffect')) {
        issues.push({
          type: 'prop_override_risk',
          file: relativePath,
          line: lineNumber,
          message: `Using props inside useEffect: ${line.trim()}`,
          suggestion: 'Be aware that prop changes might reset local state'
        });
      }
    }
  });
}

function scanDirectory(dir, extensions = ['.tsx', '.jsx', '.ts', '.js']) {
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
    path.join(process.cwd(), 'src', 'admin', 'v2', 'components')
  ];

  log('🔍 Scanning for state management race conditions...\n', 'cyan');

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
    log('✅ No state management race conditions found!\n', 'green');
    process.exit(0);
  }
}

main();
