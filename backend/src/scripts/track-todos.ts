#!/usr/bin/env tsx
/**
 * TODO/FIXME/HACK Tracker Script
 *
 * This script scans the codebase for TODO/FIXME/HACK comments
 * and generates a list of GitHub Issues or action items.
 */

import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TodoItem {
  file: string;
  line: number;
  type: 'TODO' | 'FIXME' | 'HACK';
  comment: string;
  context: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
}

function extractTodoInfo(line: string): Partial<TodoItem> | null {
  const trimmedLine = line.trim();

  // Match patterns: TODO: text, FIXME: text, HACK: text
  const todoMatch = trimmedLine.match(/\/\/\s*(TODO|FIXME|HACK):\s*(.+)/);
  if (!todoMatch) {
    return null;
  }

  const [, type, comment] = todoMatch;

  // Determine priority based on keywords
  let priority: TodoItem['priority'] = 'medium';
  const lowerComment = comment.toLowerCase();
  if (lowerComment.includes('critical') || lowerComment.includes('urgent') || lowerComment.includes('security')) {
    priority = 'high';
  } else if (lowerComment.includes('later') || lowerComment.includes('maybe') || lowerComment.includes('consider')) {
    priority = 'low';
  }

  // Determine category
  let category = 'general';
  if (lowerComment.includes('implement') || lowerComment.includes('实现')) {
    category = 'implementation';
  } else if (lowerComment.includes('refactor') || lowerComment.includes('重构')) {
    category = 'refactoring';
  } else if (lowerComment.includes('fix') || lowerComment.includes('bug')) {
    category = 'bug-fix';
  } else if (lowerComment.includes('test') || lowerComment.includes('测试')) {
    category = 'testing';
  } else if (lowerComment.includes('optimize') || lowerComment.includes('优化')) {
    category = 'optimization';
  } else if (lowerComment.includes('integrate') || lowerComment.includes('集成')) {
    category = 'integration';
  }

  return {
    type: type as TodoItem['type'],
    comment,
    priority,
    category,
  };
}

async function analyzeFile(filePath: string): Promise<TodoItem[]> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const todos: TodoItem[] = [];

    lines.forEach((line, index) => {
      const todoInfo = extractTodoInfo(line);
      if (todoInfo) {
        // Get context (2 lines before and after)
        const contextStart = Math.max(0, index - 2);
        const contextEnd = Math.min(lines.length, index + 3);
        const contextLines = lines.slice(contextStart, contextEnd);

        todos.push({
          file: filePath.replace(/.*\backend\//, ''),
          line: index + 1,
          type: todoInfo.type!,
          comment: todoInfo.comment!,
          context: contextLines.join('\n'),
          priority: todoInfo.priority!,
          category: todoInfo.category!,
        });
      }
    });

    return todos;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return [];
  }
}

async function main() {
  const tsFiles = await glob('**/*.ts', {
    cwd: join(__dirname, '..'),
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
  });

  console.log(`\n🔍 Searching for TODO/FIXME/HACK in ${tsFiles.length} files...\n`);

  const allTodos: TodoItem[] = [];

  for (const file of tsFiles) {
    const todos = await analyzeFile(file);
    allTodos.push(...todos);
  }

  if (allTodos.length === 0) {
    console.log('✅ No TODO/FIXME/HACK comments found!\n');
    return;
  }

  // Group by type
  const byType = {
    TODO: allTodos.filter((t) => t.type === 'TODO'),
    FIXME: allTodos.filter((t) => t.type === 'FIXME'),
    HACK: allTodos.filter((t) => t.type === 'HACK'),
  };

  // Group by category
  const byCategory: Record<string, TodoItem[]> = {};
  allTodos.forEach((todo) => {
    if (!byCategory[todo.category]) {
      byCategory[todo.category] = [];
    }
    byCategory[todo.category].push(todo);
  });

  // Group by priority
  const byPriority = {
    high: allTodos.filter((t) => t.priority === 'high'),
    medium: allTodos.filter((t) => t.priority === 'medium'),
    low: allTodos.filter((t) => t.priority === 'low'),
  };

  console.log('📊 Summary:');
  console.log(`   Total TODO/FIXME/HACK: ${allTodos.length}`);
  console.log(`   - TODO:  ${byType.TODO.length}`);
  console.log(`   - FIXME: ${byType.FIXME.length}`);
  console.log(`   - HACK:  ${byType.HACK.length}\n`);

  console.log('🏷️  By Category:');
  Object.entries(byCategory)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([category, items]) => {
      console.log(`   ${String(items.length).padStart(3)} ${category}`);
    });

  console.log('\n⚠️  By Priority:');
  console.log(`   High:   ${byPriority.high.length}`);
  console.log(`   Medium: ${byPriority.medium.length}`);
  console.log(`   Low:    ${byPriority.low.length}\n`);

  // Show high priority items
  if (byPriority.high.length > 0) {
    console.log('🔴 High Priority Items:');
    byPriority.high.forEach((todo) => {
      console.log(`   ${todo.file}:${todo.line}`);
      console.log(`   ${todo.type}: ${todo.comment}\n`);
    });
  }

  // Generate GitHub Issues markdown
  const issuesMarkdown = generateIssuesMarkdown(allTodos);
  const reportPath = join(__dirname, '..', '..', '..', 'docs', 'todo-issues-report.md');
  writeFileSync(reportPath, issuesMarkdown);
  console.log(`📄 GitHub Issues report saved to: ${reportPath}\n`);

  // Save JSON report
  const jsonReportPath = join(__dirname, '..', '..', '..', 'docs', 'todo-issues-report.json');
  writeFileSync(jsonReportPath, JSON.stringify(allTodos, null, 2));
  console.log(`📄 JSON report saved to: ${jsonReportPath}\n`);

  console.log('✅ Analysis complete!\n');
}

function generateIssuesMarkdown(todos: TodoItem[]): string {
  let markdown = `# TODO/FIXME/HACK Issues Report

Generated: ${new Date().toISOString()}

## Summary

- **Total Issues**: ${todos.length}
- **TODO**: ${todos.filter((t) => t.type === 'TODO').length}
- **FIXME**: ${todos.filter((t) => t.type === 'FIXME').length}
- **HACK**: ${todos.filter((t) => t.type === 'HACK').length}

---

## Issues

`;

  // Group by category for issues
  const byCategory: Record<string, TodoItem[]> = {};
  todos.forEach((todo) => {
    if (!byCategory[todo.category]) {
      byCategory[todo.category] = [];
    }
    byCategory[todo.category].push(todo);
  });

  Object.entries(byCategory).forEach(([category, items]) => {
    markdown += `### ${category.charAt(0).toUpperCase() + category.slice(1)} (${items.length})\n\n`;

    items.forEach((todo, index) => {
      const title = `[${todo.type}] ${todo.comment.substring(0, 60)}${todo.comment.length > 60 ? '...' : ''}`;
      markdown += `#### ${index + 1}. ${title}\n\n`;
      markdown += `**File**: \`${todo.file}:${todo.line}\`\n\n`;
      markdown += `**Priority**: ${todo.priority}\n\n`;
      markdown += `**Context**:\n\`\`\`\n${todo.context.split('\n').map((l, i) => (i === 2 ? '> ' + l : '  ' + l)).join('\n')}\n\`\`\`\n\n`;
      markdown += '---\n\n';
    });
  });

  markdown += `## Recommended Actions

1. **High Priority**: Address immediately or create GitHub Issues
2. **Medium Priority**: Schedule for next sprint
3. **Low Priority**: Consider if still relevant, consider removing

## Automation

To convert these to GitHub Issues, use the GitHub CLI:

\`\`\`bash
gh issue create --title "[TODO] ..." --body "..."
\`\`\`

`;

  return markdown;
}

main().catch(console.error);
