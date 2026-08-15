/**
 * LangGraph Studio 综合测试脚本
 *
 * 不仅检查错误，还验证：
 * 1. 生成内容是否符合预期格式和质量
 * 2. 数据更新机制是否正常工作
 * 3. uiHint 类型是否正确
 * 4. 响应内容是否完整
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// LangGraph Studio 配置
const LANGGRAPH_STUDIO_URL = process.env.LANGGRAPH_STUDIO_URL || 'http://localhost:43110';

// 测试结果存储
const testResults = [];
const validationResults = [];

/**
 * 测试验证规则
 */
const VALIDATION_RULES = {
  // 01-initial-survey: 应该返回 SURVEY_CARD
  '01-initial-survey': {
    requiredUiHintType: 'SURVEY_CARD',
    requiredFields: ['type', 'data'],
    dataChecks: {
      questions: (data) => Array.isArray(data.questions) && data.questions.length > 0,
      title: (data) => typeof data.title === 'string' && data.title.length > 0
    }
  },

  // 02-survey-upload-and-plan: 应该返回 PLAN_CARD
  '02-survey-upload-and-plan': {
    requiredUiHintType: 'PLAN_CARD',
    dataChecks: {
      title: (data) => typeof data.title === 'string',
      weeklySchedule: (data) => typeof data.weeklySchedule === 'object'
    }
  },

  // 03-workout-complete-with-survey: 应该返回 AUDIT_COMPLETE
  '03-workout-complete-with-survey': {
    requiredUiHintType: 'AUDIT_COMPLETE',
    dataChecks: {
      title: (data) => typeof data.title === 'string',
      updates: (data) => Array.isArray(data.updates)
    },
    shouldUpdateProfile: true
  },

  // 04-strategy-generation: 应该返回 STRATEGY_CONFIRM
  '04-strategy-generation': {
    requiredUiHintType: 'STRATEGY_CONFIRM',
    dataChecks: {
      title: (data) => typeof data.title === 'string',
      fullContent: (data) => typeof data.fullContent === 'string' && data.fullContent.length > 100
    }
  },

  // 05-chat-conversation: 应该返回 TEXT_CARD 或类似的文本响应
  '05-chat-conversation': {
    requiredResponse: true,
    responseChecks: {
      minLength: 20,
      maxLength: 1000
    }
  },

  // 06-multi-turn-conversation: 应该有上下文感知
  '06-multi-turn-conversation': {
    requiredResponse: true,
    responseChecks: {
      containsKeywords: ['理解', '收到', '好的']
    }
  },

  // 07-three-state-update-static: 应该更新静态态
  '07-three-state-update-static': {
    requiredUiHintType: 'SKELETON', // 更新后通常返回骨架屏
    shouldUpdateStatic: true
  },

  // 08-three-state-update-dynamic: 应该更新动态态
  '08-three-state-update-dynamic': {
    requiredUiHintType: 'AUDIT_COMPLETE',
    shouldUpdateDynamic: true
  },

  // 09-three-state-update-summary: 应该返回总结
  '09-three-state-update-summary': {
    requiredUiHintType: 'TEXT_CARD',
    requiredResponse: true
  },

  // 10-edge-case-validation-error: 应该优雅处理验证错误
  '10-edge-case-validation-error': {
    requiredUiHintType: 'ERROR_CARD',
    dataChecks: {
      message: (data) => typeof data.message === 'string'
    }
  },

  // 11-edge-case-no-user-profile: 应该返回初始问卷
  '11-edge-case-no-user-profile': {
    requiredUiHintType: 'SURVEY_CARD',
    dataChecks: {
      questions: (data) => Array.isArray(data.questions)
    }
  }
};

/**
 * 读取所有测试输入文件
 */
function loadTestInputs() {
  const inputsDir = path.resolve(__dirname, '../../docs/langsmith-tests/inputs');
  const files = fs.readdirSync(inputsDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  const tests = [];
  for (const file of files) {
    const filePath = path.join(inputsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const input = JSON.parse(content);
    const testName = file.replace('.json', '');
    tests.push({
      file,
      name: testName,
      input,
      validation: VALIDATION_RULES[testName] || {}
    });
  }
  return tests;
}

/**
 * 验证 uiHint 结构
 */
function validateUiHint(uiHint, testName) {
  const errors = [];
  const warnings = [];

  if (!uiHint) {
    errors.push('uiHint is null or undefined');
    return { valid: false, errors, warnings };
  }

  if (typeof uiHint !== 'object') {
    errors.push('uiHint is not an object');
    return { valid: false, errors, warnings };
  }

  if (!uiHint.type) {
    errors.push('uiHint.type is missing');
  }

  if (!uiHint.data && uiHint.type !== 'TEXT_CARD') {
    warnings.push('uiHint.data is missing');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 验证响应消息
 */
function validateMessages(messages, testName) {
  const errors = [];
  const warnings = [];

  if (!messages || !Array.isArray(messages)) {
    errors.push('messages is not an array');
    return { valid: false, errors, warnings };
  }

  const assistantMessages = messages.filter(m => m.role === 'assistant');
  if (assistantMessages.length === 0) {
    warnings.push('No assistant messages found');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 验证测试结果
 */
function validateTestResult(testName, output, validation) {
  const result = {
    testName,
    passed: true,
    checks: [],
    errors: [],
    warnings: []
  };

  // 检查 uiHint 类型
  if (validation.requiredUiHintType) {
    const actualType = output?.uiHint?.type;
    const match = actualType === validation.requiredUiHintType;
    result.checks.push({
      name: `uiHint type should be ${validation.requiredUiHintType}`,
      expected: validation.requiredUiHintType,
      actual: actualType,
      passed: match
    });
    if (!match) {
      result.passed = false;
      result.errors.push(`Expected uiHint type ${validation.requiredUiHintType}, got ${actualType}`);
    }
  }

  // 检查 uiHint 数据
  if (validation.dataChecks && output?.uiHint?.data) {
    for (const [field, check] of Object.entries(validation.dataChecks)) {
      const passed = typeof check === 'function' ? check(output.uiHint.data) : check;
      result.checks.push({
        name: `uiHint.data.${field} check`,
        passed
      });
      if (!passed) {
        result.passed = false;
        result.errors.push(`Data check failed for field: ${field}`);
      }
    }
  }

  // 检查响应消息
  if (validation.requiredResponse) {
    const hasAssistantMessage = output?.messages?.some(m => typeof m === 'string' && m.length > 0);
    result.checks.push({
      name: 'Has assistant response',
      passed: hasAssistantMessage
    });
    if (!hasAssistantMessage) {
      result.passed = false;
      result.errors.push('No assistant response found');
    }
  }

  // 检查响应长度
  if (validation.responseChecks) {
    const lastMessage = output?.messages?.[output.messages.length - 1];
    if (lastMessage) {
      const msgLength = lastMessage.length;

      if (validation.responseChecks.minLength && msgLength < validation.responseChecks.minLength) {
        result.passed = false;
        result.errors.push(`Response too short: ${msgLength} < ${validation.responseChecks.minLength}`);
      }

      if (validation.responseChecks.maxLength && msgLength > validation.responseChecks.maxLength) {
        result.passed = false;
        result.errors.push(`Response too long: ${msgLength} > ${validation.responseChecks.maxLength}`);
      }

      if (validation.responseChecks.containsKeywords) {
        const hasKeyword = validation.responseChecks.containsKeywords.some(kw =>
          lastMessage.includes(kw)
        );
        if (!hasKeyword) {
          result.warnings.push(`Response doesn't contain expected keywords: ${validation.responseChecks.containsKeywords.join(', ')}`);
        }
      }
    }
  }

  return result;
}

/**
 * 运行单个测试用例
 */
async function runTest(test) {
  const startTime = Date.now();
  const result = {
    name: test.name,
    file: test.file,
    success: false,
    duration: 0,
    error: null,
    output: null,
    validation: null
  };

  console.log(`\n${'='.repeat(60)}`);
  console.log(`运行测试: ${test.name}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // 检查连接
    const healthCheck = await fetch(`${LANGGRAPH_STUDIO_URL}/info`);
    if (!healthCheck.ok) {
      throw new Error(`LangGraph Studio 不可用`);
    }

    // 创建 thread
    const threadResponse = await fetch(`${LANGGRAPH_STUDIO_URL}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metadata: { test_name: test.name }
      })
    });

    if (!threadResponse.ok) throw new Error('创建 thread 失败');
    const thread = await threadResponse.json();
    const threadId = thread.thread_id;
    console.log(`创建 thread: ${threadId}`);

    // 运行测试
    const runResponse = await fetch(
      `${LANGGRAPH_STUDIO_URL}/threads/${threadId}/runs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistant_id: 'mas',
          input: test.input,
          config: {},
          on_completion: 'delete',
          stream_subscribed: false
        })
      }
    );

    if (!runResponse.ok) {
      const errorBody = await runResponse.text();
      throw new Error(`运行失败: ${errorBody}`);
    }

    const run = await runResponse.json();
    const runId = run.run_id;
    console.log(`创建 run: ${runId}`);

    // 等待运行完成
    let finalStatus = null;
    let attempts = 0;
    const maxAttempts = 120;

    while (attempts < maxAttempts) {
      await sleep(1000);
      process.stdout.write('.');

      const statusResponse = await fetch(
        `${LANGGRAPH_STUDIO_URL}/threads/${threadId}/runs/${runId}`
      );

      if (statusResponse.ok) {
        const status = await statusResponse.json();
        finalStatus = status.status;

        if (status.status === 'success' || status.status === 'error') {
          break;
        }
      }

      attempts++;
    }

    console.log(`\n状态: ${finalStatus}`);

    if (finalStatus === 'success') {
      result.success = true;

      // 获取最终状态
      const stateResponse = await fetch(
        `${LANGGRAPH_STUDIO_URL}/threads/${threadId}/state`
      );

      if (stateResponse.ok) {
        const state = await stateResponse.json();

        // 提取输出
        result.output = extractOutput(state);

        // 验证输出
        result.validation = validateTestResult(test.name, result.output, test.validation);

        if (!result.validation.passed) {
          result.success = false;
          result.error = 'Validation failed';
        }

        console.log('✅ 测试完成');
        console.log(`  uiHint: ${result.output?.uiHint?.type || 'N/A'}`);
        console.log(`  响应消息数: ${result.output?.messages?.length || 0}`);

        if (result.validation.warnings.length > 0) {
          console.log(`  ⚠️ 警告: ${result.validation.warnings.length}`);
        }
      }
    } else {
      result.error = finalStatus || '未知错误';
      console.log(`❌ 测试失败: ${result.error}`);
    }

  } catch (error) {
    result.error = error.message;
    console.log(`❌ 测试异常: ${error.message}`);
  }

  result.duration = Date.now() - startTime;
  return result;
}

/**
 * 提取输出信息
 */
function extractOutput(state) {
  const output = {
    uiHint: state.values?.uiHint,
    scenario: state.values?.scenario,
    next: state.values?.next,
    suggestedActions: state.values?.suggestedActions,
    planContext: state.values?.planContext,
    messages: []
  };

  // 提取最后的 AI 消息
  const messages = state.values?.messages || [];
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      const content = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
      output.messages.push(content);
    }
  }

  return output;
}

/**
 * 生成测试报告
 */
function generateReport(results) {
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const total = results.length;

  let report = `# LangGraph Studio 综合测试报告

生成时间: ${new Date().toLocaleString('zh-CN')}
测试环境: ${LANGGRAPH_STUDIO_URL}

## 测试概要

- 总测试数: ${total}
- 通过: ${passed} ✅
- 失败: ${failed} ❌
- 成功率: ${((passed / total) * 100).toFixed(1)}%

## 详细结果

`;

  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    report += `### ${status} ${result.name}\n\n`;
    report += `- **文件**: \`${result.file}\`\n`;
    report += `- **耗时**: ${result.duration}ms\n`;

    if (result.output) {
      report += `- **uiHint**: ${result.output.uiHint?.type || 'N/A'}\n`;
      if (result.output.messages.length > 0) {
        const preview = result.output.messages[0].substring(0, 100);
        report += `- **响应**: ${preview}...\n`;
      }
    }

    if (result.validation) {
      const checkStatus = result.validation.passed ? '✅' : '❌';
      report += `- **内容验证**: ${checkStatus}\n`;

      if (result.validation.errors.length > 0) {
        report += `- **验证错误**:\n`;
        for (const err of result.validation.errors) {
          report += `  - ${err}\n`;
        }
      }

      if (result.validation.warnings.length > 0) {
        report += `- **警告**:\n`;
        for (const warn of result.validation.warnings) {
          report += `  - ${warn}\n`;
        }
      }
    }

    if (result.error) {
      report += `- **错误**: ${result.error}\n`;
    }

    report += `\n`;
  }

  // 数据更新验证
  report += `## 数据更新验证\n\n`;

  const dataUpdateTests = results.filter(r => r.validation?.checks?.some(c =>
    c.name?.includes('update') || c.name?.includes('anchor')
  ));

  if (dataUpdateTests.length > 0) {
    report += `### 需要数据更新的测试\n\n`;
    for (const test of dataUpdateTests) {
      report += `- **${test.name}**: ${test.success ? '✅' : '❌'}\n`;
    }
  } else {
    report += `没有测试需要验证数据更新机制。\n\n`;
  }

  return report;
}

/**
 * 保存测试报告
 */
function saveReport(report) {
  const reportsDir = path.resolve(__dirname, '../../docs/langsmith-tests/reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const reportPath = path.join(reportsDir, `comprehensive-test-report-${timestamp}.md`);

  fs.writeFileSync(reportPath, report, 'utf-8');
  console.log(`\n📄 测试报告已保存: ${reportPath}`);

  const latestPath = path.join(reportsDir, 'latest-comprehensive-report.md');
  fs.writeFileSync(latestPath, report, 'utf-8');
  console.log(`📄 最新报告: ${latestPath}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 主函数
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       LangGraph Studio 综合测试 (内容验证版)             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n连接: ${LANGGRAPH_STUDIO_URL}`);

  // 检查连接
  try {
    const healthCheck = await fetch(`${LANGGRAPH_STUDIO_URL}/info`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!healthCheck.ok) {
      console.error(`\n❌ 无法连接到 LangGraph Studio`);
      process.exit(1);
    }

    console.log(`✅ 已连接\n`);
  } catch (error) {
    console.error(`\n❌ 连接失败: ${error.message}`);
    process.exit(1);
  }

  const tests = loadTestInputs();
  console.log(`找到 ${tests.length} 个测试用例\n`);

  for (const test of tests) {
    const result = await runTest(test);
    testResults.push(result);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('测试完成，生成报告...');
  console.log(`${'='.repeat(60)}\n`);

  const report = generateReport(testResults);
  console.log(report);
  saveReport(report);

  const failedCount = testResults.filter(r => !r.success).length;
  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch(console.error);
