#!/usr/bin/env tsx
/**
 * Console.log Cleanup Script
 *
 * This script identifies and categorizes console.log statements for cleanup.
 * It provides recommendations for each console.log usage.
 */

import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ConsoleLogMatch {
  file: string;
  line: number;
  type: 'log' | 'error' | 'warn';
  pattern: string;
  recommendation: 'keep' | 'replace-debug' | 'replace-info' | 'replace-error' | 'delete';
  suggestedCode?: string;
}

// Patterns to identify different types of console usage
const patterns = {
  // Keep: Critical infrastructure logs that should remain
  keep: [
    /^\[MAS\].*Creating (model|OpenAI|Gemini)/,
    /^\[MAS\].*Graph compiled/,
    /^\[MAS\].*Current AI Provider/,
    /^\[Router\].*scenario=/,
    /^\[PERF\]/,
  ],

  // Replace with logger.info(): Operational logs
  replaceInfo: [
    /^\[.*\].*(completed|successfully|saved|updated|generated|processed)/,
    /^\[.*\].*Loading/,
    /^\[.*\].*Processing/,
    /^\[.*\].*(Query|Database|DB)/,
  ],

  // Replace with logger.debug(): Detailed debugging
  replaceDebug: [
    /^\[.*\].*snippet/,
    /^\[.*\].*Length:/,
    /^\[.*\].*Parsed/,
    /^\[.*\].*Response type/,
    /^\[.*\].*System prompt/,
  ],

  // Replace with logger.error(): Error cases
  replaceError: [
    /console\.error\(/,
    /console\.warn\(/,
  ],
};

function categorizeConsoleLog(match: string): ConsoleLogMatch['recommendation'] {
  const trimmedMatch = match.trim();

  for (const pattern of patterns.keep) {
    if (pattern.test(trimmedMatch)) {
      return 'keep';
    }
  }

  for (const pattern of patterns.replaceInfo) {
    if (pattern.test(trimmedMatch)) {
      return 'replace-info';
    }
  }

  for (const pattern of patterns.replaceDebug) {
    if (pattern.test(trimmedMatch)) {
      return 'replace-debug';
    }
  }

  for (const pattern of patterns.replaceError) {
    if (pattern.test(trimmedMatch)) {
      return 'replace-error';
    }
  }

  // Default to replace-debug for unspecified console.log
  return 'replace-debug';
}

function generateSuggestedCode(line: string, recommendation: ConsoleLogMatch['recommendation']): string {
  if (recommendation === 'keep') {
    return line;
  }

  // Extract console call content
  const match = line.match(/console\.(log|error|warn)\((.*)\)/);
  if (!match) {
    return line;
  }

  const [, method, content] = match;

  switch (recommendation) {
    case 'replace-debug':
      return `logger.debug(${content})`;
    case 'replace-info':
      return `logger.info(${content})`;
    case 'replace-error':
      return `logger.error(${content})`;
    case 'delete':
      return `// ${line.trim()} // TODO: Consider if this log is still needed`;
    default:
      return line;
  }
}

async function analyzeFile(filePath: string): Promise<ConsoleLogMatch[]> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const matches: ConsoleLogMatch[] = [];

  lines.forEach((line, index) => {
    const consoleMatch = line.match(/console\.(log|error|warn)\(/);
    if (consoleMatch) {
      const type = consoleMatch[1] as 'log' | 'error' | 'warn';
      const recommendation = categorizeConsoleLog(line);

      matches.push({
        file: filePath,
        line: index + 1,
        type,
        pattern: line.trim(),
        recommendation,
        suggestedCode: generateSuggestedCode(line, recommendation),
      });
    }
  });

  return matches;
}

async function main() {
  const tsFiles = await glob('**/*.ts', {
    cwd: join(__dirname, '..'),
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
  });

  console.log(`\n🔍 Analyzing ${tsFiles.length} TypeScript files...\n`);

  const allMatches: ConsoleLogMatch[] = [];

  for (const file of tsFiles) {
    const matches = await analyzeFile(file);
    allMatches.push(...matches);
  }

  // Generate report
  const report = {
    summary: {
      totalFiles: tsFiles.length,
      filesWithConsole: new Set(allMatches.map((m) => m.file)).size,
      totalMatches: allMatches.length,
      byType: {
        log: allMatches.filter((m) => m.type === 'log').length,
        error: allMatches.filter((m) => m.type === 'error').length,
        warn: allMatches.filter((m) => m.type === 'warn').length,
      },
      byRecommendation: {
        keep: allMatches.filter((m) => m.recommendation === 'keep').length,
        'replace-debug': allMatches.filter((m) => m.recommendation === 'replace-debug').length,
        'replace-info': allMatches.filter((m) => m.recommendation === 'replace-info').length,
        'replace-error': allMatches.filter((m) => m.recommendation === 'replace-error').length,
        delete: allMatches.filter((m) => m.recommendation === 'delete').length,
      },
    },
    files: allMatches.reduce((acc, match) => {
      if (!acc[match.file]) {
        acc[match.file] = [];
      }
      acc[match.file].push(match);
      return acc;
    }, {} as Record<string, ConsoleLogMatch[]>),
  };

  // Print summary
  console.log('📊 Summary:');
  console.log(`   Total files scanned: ${report.summary.totalFiles}`);
  console.log(`   Files with console: ${report.summary.filesWithConsole}`);
  console.log(`   Total console statements: ${report.summary.totalMatches}\n`);

  console.log('📋 By Type:');
  console.log(`   console.log:  ${report.summary.byType.log}`);
  console.log(`   console.error: ${report.summary.byType.error}`);
  console.log(`   console.warn:  ${report.summary.byType.warn}\n`);

  console.log('💡 Recommendations:');
  console.log(`   Keep as-is:           ${report.summary.byRecommendation.keep}`);
  console.log(`   Replace with logger:  ${report.summary.byRecommendation['replace-debug'] + report.summary.byRecommendation['replace-info'] + report.summary.byRecommendation['replace-error']}`);
  console.log(`   - logger.debug():     ${report.summary.byRecommendation['replace-debug']}`);
  console.log(`   - logger.info():      ${report.summary.byRecommendation['replace-info']}`);
  console.log(`   - logger.error():     ${report.summary.byRecommendation['replace-error']}`);
  console.log(`   Delete/Review:        ${report.summary.byRecommendation.delete}\n`);

  // Save detailed report
  const reportPath = join(__dirname, '..', '..', '..', 'docs', 'console-log-cleanup-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Detailed report saved to: ${reportPath}\n`);

  // Show top files with most console statements
  const fileCounts = Object.entries(report.files)
    .map(([file, matches]) => [file.replace(/.*\backend\//, ''), matches.length])
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 10);

  console.log('🏆 Top 10 files with most console statements:');
  fileCounts.forEach(([file, count]) => {
    console.log(`   ${String(count).padStart(3)}: ${file}`);
  });

  console.log('\n✅ Analysis complete!\n');
}

main().catch(console.error);
