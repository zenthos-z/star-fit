import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DependencyCheckResult } from '../types';

export class DependencyChecker {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  checkSystemDependencies(dependencies: string[]): DependencyCheckResult[] {
    const results: DependencyCheckResult[] = [];

    for (const dep of dependencies) {
      try {
        const version = this.getSystemDependencyVersion(dep);
        results.push({
          name: dep,
          type: 'system',
          installed: true,
          version
        });
      } catch (error) {
        results.push({
          name: dep,
          type: 'system',
          installed: false,
          required: '需要安装'
        });
      }
    }

    return results;
  }

  checkNodeDependencies(dependencies: string[]): DependencyCheckResult[] {
    const results: DependencyCheckResult[] = [];
    const packageJsonPath = path.join(this.projectRoot, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found');
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const installedDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };

    for (const dep of dependencies) {
      const installedVersion = installedDeps[dep];
      results.push({
        name: dep,
        type: 'node',
        installed: !!installedVersion,
        version: installedVersion || undefined,
        required: installedVersion ? undefined : '需要安装'
      });
    }

    return results;
  }

  private getSystemDependencyVersion(name: string): string {
    const command = this.getDependencyCommand(name);
    const output = execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return this.parseVersion(output, name);
  }

  private getDependencyCommand(name: string): string {
    const commands: Record<string, string> = {
      ffmpeg: 'ffmpeg -version',
      node: 'node --version',
      npm: 'npm --version',
      python: 'python --version',
      python3: 'python3 --version',
      java: 'java -version',
      git: 'git --version'
    };

    return commands[name] || `${name} --version`;
  }

  private parseVersion(output: string, name: string): string {
    const versionRegex = /(\d+\.\d+\.\d+)/;
    const match = output.match(versionRegex);
    
    if (match) {
      return match[1];
    }

    const lines = output.split('\n');
    return lines[0].trim();
  }

  getAllDependencies(config: any): DependencyCheckResult[] {
    const systemResults = this.checkSystemDependencies(config.dependencies.system);
    const nodeResults = this.checkNodeDependencies(config.dependencies.node);
    
    return [...systemResults, ...nodeResults];
  }
}
