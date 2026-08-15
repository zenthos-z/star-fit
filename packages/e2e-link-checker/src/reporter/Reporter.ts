import * as fs from 'fs';
import * as path from 'path';
import { Issue, AnalysisResult, DependencyCheckResult } from '../types';

export class Reporter {
  generateMarkdownReport(issues: Issue[], summary: any, duration: number, filesAnalyzed: number): string {
    let report = '# E2E链路一致性检测报告\n\n';
    report += `生成时间: ${new Date().toISOString()}\n\n`;
    report += `## 检测摘要\n\n`;
    report += `- 文件分析数: ${filesAnalyzed}\n`;
    report += `- 问题总数: ${summary.total}\n`;
    report += `- 错误: ${summary.errors}\n`;
    report += `- 警告: ${summary.warnings}\n`;
    report += `- 信息: ${summary.info}\n`;
    report += `- 检测耗时: ${duration}ms\n\n`;

    if (issues.length === 0) {
      report += '✅ 未发现问题！\n\n';
      return report;
    }

    const groupedIssues = this.groupIssuesByType(issues);

    for (const [type, typeIssues] of Object.entries(groupedIssues)) {
      report += `## ${this.getTypeLabel(type)}\n\n`;
      
      for (const issue of typeIssues) {
        report += `### ${this.getSeverityEmoji(issue.severity)} ${issue.message}\n\n`;
        report += `- **位置**: ${issue.location}\n`;
        report += `- **建议**: ${issue.suggestion}\n`;
        if (issue.code) {
          report += `- **代码**: \`${issue.code}\`\n`;
        }
        report += '\n';
      }
    }

    return report;
  }

  generateJsonReport(issues: Issue[], summary: any, duration: number, filesAnalyzed: number): string {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        filesAnalyzed,
        issues: {
          total: summary.total,
          errors: summary.errors,
          warnings: summary.warnings,
          info: summary.info
        },
        duration
      },
      issues: issues.map(issue => ({
        type: issue.type,
        severity: issue.severity,
        message: issue.message,
        location: issue.location,
        suggestion: issue.suggestion,
        code: issue.code
      }))
    };

    return JSON.stringify(report, null, 2);
  }

  generateConsoleReport(issues: Issue[], summary: any, duration: number, filesAnalyzed: number): string[] {
    const lines: string[] = [];
    
    lines.push('');
    lines.push('╔═══════════════════════════════════════════════════════════════╗');
    lines.push('║           E2E链路一致性检测报告                              ║');
    lines.push('╚═══════════════════════════════════════════════════════════════╝');
    lines.push('');
    lines.push(`📊 检测摘要:`);
    lines.push(`   文件分析数: ${filesAnalyzed}`);
    lines.push(`   问题总数: ${summary.total}`);
    lines.push(`   ${this.getSeverityEmoji('error')} 错误: ${summary.errors}`);
    lines.push(`   ${this.getSeverityEmoji('warning')} 警告: ${summary.warnings}`);
    lines.push(`   ${this.getSeverityEmoji('info')} 信息: ${summary.info}`);
    lines.push(`   检测耗时: ${duration}ms`);
    lines.push('');

    if (issues.length === 0) {
      lines.push('✅ 未发现问题！');
      return lines;
    }

    const groupedIssues = this.groupIssuesByType(issues);

    for (const [type, typeIssues] of Object.entries(groupedIssues)) {
      lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      lines.push(`  ${this.getTypeLabel(type)} (${typeIssues.length})`);
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      for (const issue of typeIssues) {
        lines.push('');
        lines.push(`  ${this.getSeverityEmoji(issue.severity)} ${issue.message}`);
        lines.push(`  📍 ${issue.location}`);
        lines.push(`  💡 ${issue.suggestion}`);
        if (issue.code) {
          lines.push(`  📝 ${issue.code}`);
        }
      }
      lines.push('');
    }

    return lines;
  }

  generateDependencyReport(results: DependencyCheckResult[]): string[] {
    const lines: string[] = [];
    
    lines.push('');
    lines.push('╔═══════════════════════════════════════════════════════════════╗');
    lines.push('║           依赖检测报告                                        ║');
    lines.push('╚═══════════════════════════════════════════════════════════════╝');
    lines.push('');

    const missingDeps = results.filter(r => !r.installed);
    const installedDeps = results.filter(r => r.installed);

    if (missingDeps.length > 0) {
      lines.push('❌ 缺失的依赖:');
      for (const dep of missingDeps) {
        lines.push(`   ${dep.name} (${dep.type}) - ${dep.required}`);
      }
      lines.push('');
    }

    lines.push('✅ 已安装的依赖:');
    for (const dep of installedDeps) {
      lines.push(`   ${dep.name} (${dep.type}) - ${dep.version || 'unknown'}`);
    }
    lines.push('');

    return lines;
  }

  saveReport(content: string, filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  private groupIssuesByType(issues: Issue[]): Record<string, Issue[]> {
    const grouped: Record<string, Issue[]> = {};
    
    for (const issue of issues) {
      if (!grouped[issue.type]) {
        grouped[issue.type] = [];
      }
      grouped[issue.type].push(issue);
    }

    return grouped;
  }

  private getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      'relative-url': '相对URL检测',
      'websocket': 'WebSocket事件处理检测',
      'data-query': '数据查询检测',
      'dependency': '依赖检测',
      'aspect-ratio': '纵横比检测'
    };

    return labels[type] || type;
  }

  private getSeverityEmoji(severity: string): string {
    const emojis: Record<string, string> = {
      'error': '❌',
      'warning': '⚠️',
      'info': 'ℹ️'
    };

    return emojis[severity] || severity;
  }
}
