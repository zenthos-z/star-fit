export interface Issue {
  type: 'relative-url' | 'websocket' | 'data-query' | 'dependency' | 'aspect-ratio';
  severity: 'error' | 'warning' | 'info';
  message: string;
  location: string;
  suggestion: string;
  code?: string;
}

export interface RuleConfig {
  enabled: boolean;
  severity: 'error' | 'warning' | 'info';
  options?: Record<string, any>;
}

export interface Config {
  rules: {
    relativeUrl: RuleConfig;
    webSocket: RuleConfig;
    dataQuery: RuleConfig;
    dependency: RuleConfig;
    aspectRatio: RuleConfig;
  };
  include: string[];
  exclude: string[];
  dependencies: {
    system: string[];
    node: string[];
  };
  output: {
    format: 'markdown' | 'json' | 'console';
    filePath?: string;
  };
}

export interface AnalysisResult {
  issues: Issue[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
  };
  filesAnalyzed: number;
  duration: number;
}

export interface DependencyCheckResult {
  name: string;
  type: 'system' | 'node';
  installed: boolean;
  version?: string;
  required?: string;
}

export interface E2ETestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}
