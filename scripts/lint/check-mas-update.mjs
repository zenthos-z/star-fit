#!/usr/bin/env node

/**
 * MAS System Update Completeness Check Script
 *
 * Checks for:
 * 1. InsightAnalyzer supports all necessary profile fields
 * 2. profileSummarizerNode calls complete profile update
 * 3. Prompt explicitly instructs updating all required fields
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

const REQUIRED_PROFILE_FIELDS = [
  'basic_info',
  'preferences',
  'load_anchors',
  'physiological',
  'psychological',
  'red_flags',
  'fitness_level'
];

function log(message, color = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function checkInsightAnalyzer(content, filePath) {
  const supportedFields = [];
  
  REQUIRED_PROFILE_FIELDS.forEach(field => {
    const pattern = new RegExp(`updates\\.push\\(['"]${field}\\s*=`, 'g');
    if (pattern.test(content)) {
      supportedFields.push(field);
    } else if (new RegExp(`if\\s*\\(validated\\.${field}\\s*!==\\s*undefined\\)`, 'g').test(content)) {
      supportedFields.push(field);
    } else if (new RegExp(field.replace('_', '\\s*'), 'g').test(content)) {
      supportedFields.push(field);
    }
  });

  const missingFields = REQUIRED_PROFILE_FIELDS.filter(f => !supportedFields.includes(f));
  
  if (missingFields.length > 0) {
    issues.push({
      type: 'insight_analyzer_missing_fields',
      file: path.relative(process.cwd(), filePath),
      line: 1,
      message: `InsightAnalyzer missing support for fields: ${missingFields.join(', ')}`,
      suggestion: 'Add update logic for all required profile fields'
    });
  }

  return { supportedFields, missingFields };
}

function checkProfileSummarizerNode(content, filePath) {
  const relativePath = path.relative(process.cwd(), filePath);

  if (!content.includes('updateProfile') && !content.includes('profileAdapter')) {
    issues.push({
      type: 'profile_summarizer_no_update',
      file: relativePath,
      line: 1,
      message: 'profileSummarizerNode does not call profile update',
      suggestion: 'Call profileAdapter.updateProfile() to update user profile'
    });
  }

  if (content.includes('insight.summary') && !content.includes('updateProfile')) {
    issues.push({
      type: 'profile_summarizer_no_update',
      file: relativePath,
      line: 1,
      message: 'profileSummarizerNode extracts summary but does not update profile',
      suggestion: 'Call profileAdapter.updateProfile() with extracted data'
    });
  }
}

function checkSystemPrompts(content, filePath) {
  const relativePath = path.relative(process.cwd(), filePath);

  REQUIRED_PROFILE_FIELDS.forEach(field => {
    const promptFields = field.split('_').join(' ');
    
    if (!new RegExp(promptFields, 'i').test(content)) {
      issues.push({
        type: 'prompt_missing_field',
        file: relativePath,
        line: 1,
        message: `Prompt does not mention field: ${field}`,
        suggestion: `Add instruction to update ${field} in the prompt`
      });
    }
  });

  if (!/update.*profile/i.test(content) && !/update.*user.*insight/i.test(content)) {
    issues.push({
      type: 'prompt_no_update_instruction',
      file: relativePath,
      line: 1,
      message: 'Prompt does not explicitly instruct AI to update profile',
      suggestion: 'Add clear instruction to update user profile'
    });
  }
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);

  if (fileName === 'insightAnalyzer.ts') {
    checkInsightAnalyzer(content, filePath);
  }

  if (fileName === 'graph.ts' && filePath.includes('mas')) {
    checkProfileSummarizerNode(content, filePath);
  }

  if (fileName === 'systemPrompts.ts' || fileName === 'prompts.ts') {
    checkSystemPrompts(content, filePath);
  }
}

function scanDirectory(dir, extensions = ['.ts', '.tsx']) {
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
    path.join(process.cwd(), 'backend', 'src', 'services', 'mas'),
    path.join(process.cwd(), 'backend', 'src', 'services', 'mas', 'memory'),
    path.join(process.cwd(), 'backend', 'src', 'services', 'mas', 'prompts')
  ];

  log('🔍 Scanning for MAS system update completeness...\n', 'cyan');

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
    log('✅ No MAS update issues found!\n', 'green');
    process.exit(0);
  }
}

main();
