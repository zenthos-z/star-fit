import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { Issue } from '../types';

export class StaticAnalyzer {
  private issues: Issue[] = [];

  analyze(filePath: string, config: any): Issue[] {
    this.issues = [];
    const sourceFile = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, 'utf-8'),
      ts.ScriptTarget.Latest,
      true
    );

    this.visit(sourceFile, filePath, config);
    return this.issues;
  }

  private visit(node: ts.Node, filePath: string, config: any) {
    if (config.rules.relativeUrl?.enabled) {
      this.checkRelativeUrl(node, filePath);
    }
    if (config.rules.webSocket?.enabled) {
      this.checkWebSocket(node, filePath);
    }
    if (config.rules.dataQuery?.enabled) {
      this.checkDataQuery(node, filePath);
    }
    if (config.rules.aspectRatio?.enabled) {
      this.checkAspectRatio(node, filePath);
    }

    ts.forEachChild(node, (child) => this.visit(child, filePath, config));
  }

  private checkRelativeUrl(node: ts.Node, filePath: string) {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
      if (name === 'src' || name === 'href') {
        const initializer = node.initializer;
        if (initializer && ts.isJsxExpression(initializer)) {
          const expression = initializer.expression;
          if (expression) {
            const exprText = expression.getText();
            
            if (this.isDirectVariableUsage(exprText) && !this.hasGetFullUrlCall(node)) {
              this.addIssue({
                type: 'relative-url',
                severity: 'error',
                message: `检测到相对URL使用: ${exprText}`,
                location: this.getLocation(filePath, node.getStart()),
                suggestion: '使用getFullUrl函数解析URL',
                code: exprText
              });
            }
          }
        }
      }
    }
  }

  private isDirectVariableUsage(exprText: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(exprText) ||
           /^[a-zA-Z_$][a-zA-Z0-9_$]*\.[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(exprText);
  }

  private hasGetFullUrlCall(node: ts.Node): boolean {
    let hasCall = false;
    
    const checkParent = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callText = n.expression.getText();
        if (callText.includes('getFullUrl') || callText.includes('resolveUrl')) {
          hasCall = true;
          return;
        }
      }
      if (n.parent) {
        checkParent(n.parent);
      }
    };

    checkParent(node);
    return hasCall;
  }

  private checkWebSocket(node: ts.Node, filePath: string) {
    if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
      const functionText = node.getText();
      
      if (functionText.includes('ws.') || functionText.includes('WebSocket')) {
        if (functionText.includes('onComplete') || functionText.includes('on(\'complete\')')) {
          if (!functionText.includes('updateDatabase') && !functionText.includes('updateDatabaseUrl')) {
            this.addIssue({
              type: 'websocket',
              severity: 'warning',
              message: 'WebSocket完成事件监听器中缺少数据库更新逻辑',
              location: this.getLocation(filePath, node.getStart()),
              suggestion: '在WebSocket完成事件监听器中添加数据库更新逻辑',
              code: functionText.substring(0, 100)
            });
          }
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callText = node.expression.getText();
      if (callText.includes('updateDatabase') || callText.includes('updateDatabaseUrl')) {
        const parent = node.parent;
        if (parent && !this.isInWebSocketCallback(parent)) {
          this.addIssue({
            type: 'websocket',
            severity: 'error',
            message: '数据库更新操作不在WebSocket完成事件回调中',
            location: this.getLocation(filePath, node.getStart()),
            suggestion: '将数据库更新操作移到WebSocket完成事件回调中',
            code: callText
          });
        }
      }
    }
  }

  private isInWebSocketCallback(node: ts.Node): boolean {
    let inCallback = false;
    
    const checkParent = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callText = n.expression.getText();
        if (callText.includes('ws.on') || callText.includes('addEventListener')) {
          inCallback = true;
          return;
        }
      }
      if (n.parent && !inCallback) {
        checkParent(n.parent);
      }
    };

    checkParent(node);
    return inCallback;
  }

  private checkDataQuery(node: ts.Node, filePath: string) {
    if (ts.isCallExpression(node)) {
      const callText = node.expression.getText();
      
      if (callText.includes('find') || callText.includes('findOne') || callText.includes('findFirst')) {
        const hasMultiSourceQuery = this.checkMultiSourceQuery(node);
        const hasFallback = this.checkFallbackHandling(node);

        if (!hasMultiSourceQuery && !hasFallback) {
          this.addIssue({
            type: 'data-query',
            severity: 'warning',
            message: '数据查询缺少多源查询或降级处理',
            location: this.getLocation(filePath, node.getStart()),
            suggestion: '添加多源查询（按ID和名称查询）和降级处理逻辑',
            code: callText
          });
        }
      }
    }
  }

  private checkMultiSourceQuery(node: ts.Node): boolean {
    let hasMultiSource = false;
    const nodeText = node.getText();
    
    if (nodeText.includes('id:') && nodeText.includes('name:')) {
      hasMultiSource = true;
    }

    return hasMultiSource;
  }

  private checkFallbackHandling(node: ts.Node): boolean {
    let hasFallback = false;
    const nodeText = node.getText();
    
    if (nodeText.includes('if (!') || nodeText.includes('else if (!')) {
      hasFallback = true;
    }

    return hasFallback;
  }

  private checkAspectRatio(node: ts.Node, filePath: string) {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
      if (name === 'className') {
        const initializer = node.initializer;
        if (initializer && ts.isStringLiteral(initializer)) {
          const className = initializer.text;
          
          if (className.includes('aspect-video')) {
            this.addIssue({
              type: 'aspect-ratio',
              severity: 'warning',
              message: '使用aspect-video类可能导致卡片拉伸',
              location: this.getLocation(filePath, node.getStart()),
              suggestion: '使用aspect-[4/3]等固定比例类，避免卡片拉伸',
              code: className
            });
          }
        }
      }
    }
  }

  private getLocation(filePath: string, pos: number): string {
    return `${filePath}:${pos}`;
  }

  private addIssue(issue: Issue) {
    this.issues.push(issue);
  }
}
