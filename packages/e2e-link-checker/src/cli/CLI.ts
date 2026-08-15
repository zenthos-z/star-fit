import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import { StaticAnalyzer } from '../analyzer/StaticAnalyzer';
import { DependencyChecker } from '../checker/DependencyChecker';
import { Reporter } from '../reporter/Reporter';
import { Config, Issue } from '../types';

export class CLI {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupCommands();
  }

  private setupCommands() {
    this.program
      .name('e2e-link-checker')
      .description('MAS E2E链路一致性检测工具')
      .version('1.0.0');

    this.program
      .command('check')
      .description('执行E2E链路一致性检测')
      .option('-c, --config <path>', '配置文件路径', 'e2e-link-checker.config.ts')
      .option('-o, --output <path>', '报告输出路径')
      .option('-f, --format <format>', '报告格式 (markdown|json|console)', 'console')
      .option('--no-dependencies', '跳过依赖检测')
      .action((options) => this.runCheck(options));

    this.program
      .command('init')
      .description('初始化配置文件')
      .action(() => this.initConfig());
  }

  private async runCheck(options: any) {
    console.log(chalk.blue('🔍 开始E2E链路一致性检测...\n'));

    const startTime = Date.now();
    const config = this.loadConfig(options.config);
    const reporter = new Reporter();

    let allIssues: Issue[] = [];
    let filesAnalyzed = 0;

    const filePaths = await this.getFilePaths(config);

    for (const filePath of filePaths) {
      const analyzer = new StaticAnalyzer();
      const issues = analyzer.analyze(filePath, config);
      allIssues.push(...issues);
      filesAnalyzed++;
    }

    const summary = this.calculateSummary(allIssues);
    const duration = Date.now() - startTime;

    if (options.dependencies !== false) {
      console.log(chalk.yellow('📦 检测依赖...\n'));
      const depChecker = new DependencyChecker();
      const depResults = depChecker.getAllDependencies(config);
      const depReport = reporter.generateDependencyReport(depResults);
      depReport.forEach(line => console.log(line));
    }

    console.log('');
    console.log(chalk.blue('📊 检测结果:\n'));

    if (options.format === 'console') {
      const consoleReport = reporter.generateConsoleReport(allIssues, summary, duration, filesAnalyzed);
      consoleReport.forEach(line => console.log(line));
    } else if (options.format === 'markdown') {
      const report = reporter.generateMarkdownReport(allIssues, summary, duration, filesAnalyzed);
      const outputPath = options.output || 'e2e-link-checker-report.md';
      reporter.saveReport(report, outputPath);
      console.log(chalk.green(`✅ 报告已保存到: ${outputPath}\n`));
      console.log(report);
    } else if (options.format === 'json') {
      const report = reporter.generateJsonReport(allIssues, summary, duration, filesAnalyzed);
      const outputPath = options.output || 'e2e-link-checker-report.json';
      reporter.saveReport(report, outputPath);
      console.log(chalk.green(`✅ 报告已保存到: ${outputPath}\n`));
      console.log(report);
    }

    if (summary.errors > 0) {
      console.log(chalk.red(`\n❌ 检测完成，发现 ${summary.errors} 个错误`));
      process.exit(1);
    } else if (summary.warnings > 0) {
      console.log(chalk.yellow(`\n⚠️  检测完成，发现 ${summary.warnings} 个警告`));
      process.exit(0);
    } else {
      console.log(chalk.green('\n✅ 检测完成，未发现问题'));
      process.exit(0);
    }
  }

  private initConfig() {
    const configPath = path.join(process.cwd(), 'e2e-link-checker.config.ts');
    
    if (fs.existsSync(configPath)) {
      console.log(chalk.yellow('⚠️  配置文件已存在'));
      return;
    }

    const configContent = `import { Config } from '@mas/e2e-link-checker';

const config: Config = {
  rules: {
    relativeUrl: {
      enabled: true,
      severity: 'error'
    },
    webSocket: {
      enabled: true,
      severity: 'warning'
    },
    dataQuery: {
      enabled: true,
      severity: 'warning'
    },
    dependency: {
      enabled: true,
      severity: 'error'
    },
    aspectRatio: {
      enabled: true,
      severity: 'warning'
    }
  },
  include: ['src/**/*.tsx', 'src/**/*.ts'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts'],
  dependencies: {
    system: ['ffmpeg'],
    node: ['langchain', '@langchain/core']
  },
  output: {
    format: 'console'
  }
};

export default config;
`;

    fs.writeFileSync(configPath, configContent, 'utf-8');
    console.log(chalk.green(`✅ 配置文件已创建: ${configPath}`));
  }

  private loadConfig(configPath: string): Config {
    const fullPath = path.resolve(configPath);
    
    if (!fs.existsSync(fullPath)) {
      console.log(chalk.yellow('⚠️  配置文件不存在，使用默认配置'));
      return this.getDefaultConfig();
    }

    try {
      delete require.cache[require.resolve(fullPath)];
      const config = require(fullPath);
      return config.default || config;
    } catch (error) {
      console.log(chalk.yellow('⚠️  配置文件加载失败，使用默认配置'));
      return this.getDefaultConfig();
    }
  }

  private getDefaultConfig(): Config {
    return {
      rules: {
        relativeUrl: { enabled: true, severity: 'error' },
        webSocket: { enabled: true, severity: 'warning' },
        dataQuery: { enabled: true, severity: 'warning' },
        dependency: { enabled: true, severity: 'error' },
        aspectRatio: { enabled: true, severity: 'warning' }
      },
      include: ['src/**/*.tsx', 'src/**/*.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts'],
      dependencies: {
        system: ['ffmpeg'],
        node: ['langchain', '@langchain/core']
      },
      output: {
        format: 'console'
      }
    };
  }

  private async getFilePaths(config: Config): Promise<string[]> {
    const filePaths: string[] = [];

    for (const pattern of config.include) {
      const files = await glob(pattern, {
        cwd: process.cwd(),
        ignore: config.exclude,
        absolute: true
      });
      filePaths.push(...files);
    }

    return [...new Set(filePaths)];
  }

  private calculateSummary(issues: Issue[]) {
    return {
      total: issues.length,
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
      info: issues.filter(i => i.severity === 'info').length
    };
  }

  run(argv: string[]) {
    this.program.parse(argv);
  }
}
