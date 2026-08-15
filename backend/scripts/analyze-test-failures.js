/**
 * 分析失败的测试 - 通过 LangSmith API 获取详细 trace
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// LangSmith 配置
const LANGCHAIN_API_KEY = process.env.LANGCHAIN_API_KEY;
const LANGCHAIN_PROJECT = process.env.LANGCHAIN_PROJECT || 'starfit-mas-dev';
const LANGCHAIN_ENDPOINT = process.env.LANGCHAIN_ENDPOINT || 'https://api.smith.langchain.com';

async function getRecentRuns(limit = 20) {
  const response = await fetch(
    `${LANGCHAIN_ENDPOINT}/runs?project_name=${LANGCHAIN_PROJECT}&limit=${limit}`,
    {
      headers: {
        'x-api-key': LANGCHAIN_API_KEY
      }
    }
  );

  if (!response.ok) {
    throw new Error(`获取 runs 失败: ${response.statusText}`);
  }

  return await response.json();
}

async function getRunDetails(runId) {
  const response = await fetch(
    `${LANGCHAIN_ENDPOINT}/runs/${runId}`,
    {
      headers: {
        'x-api-key': LANGCHAIN_API_KEY
      }
    }
  );

  if (!response.ok) {
    throw new Error(`获取 run 详情失败: ${response.statusText}`);
  }

  return await response.json();
}

async function analyzeFailures() {
  console.log('正在获取最近的测试运行...\n');

  const runs = await getRecentRuns(50);

  // 筛选出测试失败的运行
  const failedRuns = runs.filter(r => r.status !== 'success');

  console.log(`找到 ${failedRuns.length} 个非成功的运行\n`);

  const analysis = {
    summary: {},
    details: []
  };

  for (const run of failedRuns) {
    console.log(`分析 run: ${run.id}`);
    console.log(`  输入: ${JSON.stringify(run.inputs).substring(0, 100)}...`);
    console.log(`  状态: ${run.status}`);
    console.log(`  错误: ${run.error || '无'}`);

    if (run.error) {
      analysis.summary[run.error] = (analysis.summary[run.error] || 0) + 1;

      analysis.details.push({
        id: run.id,
        input: run.inputs,
        error: run.error,
        status: run.status
      });
    }

    console.log();
  }

  // 输出分析报告
  console.log('='.repeat(60));
  console.log('错误分析报告');
  console.log('='.repeat(60));
  console.log();

  for (const [error, count] of Object.entries(analysis.summary)) {
    console.log(`${error}: ${count} 次`);
  }

  return analysis;
}

analyzeFailures().catch(console.error);
