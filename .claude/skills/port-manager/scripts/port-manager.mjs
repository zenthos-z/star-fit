#!/usr/bin/env node
/**
 * Port Manager - 项目端口管理工具
 *
 * 用法:
 *   node port-manager.js status          - 显示所有项目端口状态
 *   node port-manager.js kill <port>     - 关闭指定端口的进程
 *   node port-manager.js kill-all        - 关闭所有项目相关端口
 *   node port-manager.js restart-backend - 重启后端服务
 */

import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 项目端口配置
const PROJECT_PORTS = {
  frontend: { port: 43112, name: '前端 Vite', desc: 'npm run dev' },
  backend: { port: 43111, name: '后端 API', desc: 'cd backend && npm run dev' },
  langgraph: { port: 43110, name: 'LangGraph Studio', desc: 'cd backend && npm run studio' },
  postgres: { port: 5432, name: 'PostgreSQL', desc: '数据库服务 (通常不在此管理)' },
  docs: { port: 5173, name: 'Docs 文档站', desc: 'npm run docs:dev' },
};

/**
 * 获取指定端口的占用进程信息
 * @param {number} port
 * @returns {Array<{pid: string, protocol: string, state: string}>}
 */
function getPortProcess(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const lines = output.trim().split('\n').filter(Boolean);
    const processes = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const protocol = parts[0];
        const localAddr = parts[1];
        const state = parts[3] || '';
        const pid = parts[4];

        // 只匹配精确端口
        if (localAddr.includes(`:${port}`)) {
          processes.push({ pid, protocol, state });
        }
      }
    }

    return processes;
  } catch {
    return [];
  }
}

/**
 * 获取进程名称
 * @param {string} pid
 * @returns {string}
 */
function getProcessName(pid) {
  try {
    const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const match = output.match(/^(.+?)\s+\d+/);
    return match ? match[1].trim() : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

/**
 * 杀死指定 PID 的进程
 * @param {string} pid
 * @returns {boolean}
 */
function killProcess(pid) {
  try {
    execSync(`taskkill /F /PID ${pid}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 关闭指定端口的所有进程
 * @param {number} port
 * @returns {{success: boolean, killed: number, message: string}}
 */
function killPort(port) {
  const processes = getPortProcess(port);

  if (processes.length === 0) {
    return { success: true, killed: 0, message: `端口 ${port} 没有被占用` };
  }

  let killed = 0;
  const uniquePids = [...new Set(processes.map(p => p.pid))];

  for (const pid of uniquePids) {
    const processName = getProcessName(pid);
    if (killProcess(pid)) {
      console.log(`  [OK] 已终止 PID ${pid} (${processName})`);
      killed++;
    } else {
      console.log(`  [FAIL] 无法终止 PID ${pid} (${processName})`);
    }
  }

  return {
    success: killed > 0,
    killed,
    message: `端口 ${port}: 已终止 ${killed}/${uniquePids.length} 个进程`
  };
}

/**
 * 显示所有项目端口状态
 */
function showStatus() {
  console.log('\n========================================');
  console.log('  Starfit 项目端口状态');
  console.log('========================================\n');

  for (const [key, config] of Object.entries(PROJECT_PORTS)) {
    const processes = getPortProcess(config.port);
    const status = processes.length > 0 ? '\x1b[32m● 运行中\x1b[0m' : '\x1b[90m○ 空闲\x1b[0m';

    console.log(`  ${config.name} (端口 ${config.port})`);
    console.log(`    状态: ${status}`);
    console.log(`    命令: ${config.desc}`);

    if (processes.length > 0) {
      const uniquePids = [...new Set(processes.map(p => p.pid))];
      for (const pid of uniquePids) {
        const processName = getProcessName(pid);
        console.log(`    PID: ${pid} (${processName})`);
      }
    }
    console.log('');
  }

  console.log('========================================\n');
}

/**
 * 关闭所有项目相关端口
 */
function killAll() {
  console.log('\n关闭所有项目端口...\n');

  // 排除 PostgreSQL，通常不应该自动关闭数据库
  const portsToKill = Object.entries(PROJECT_PORTS)
    .filter(([key]) => key !== 'postgres')
    .map(([key, config]) => config.port);

  for (const port of portsToKill) {
    console.log(`处理端口 ${port}...`);
    const result = killPort(port);
    console.log(`  ${result.message}\n`);
  }
}

/**
 * 重启后端服务
 */
function restartBackend() {
  console.log('\n重启后端服务...\n');

  // 先关闭后端端口
  console.log('1. 关闭现有后端进程...');
  const killResult = killPort(PROJECT_PORTS.backend.port);
  console.log(`   ${killResult.message}`);

  // 等待端口释放
  console.log('\n2. 等待端口释放...');
  let retries = 0;
  while (retries < 10) {
    const processes = getPortProcess(PROJECT_PORTS.backend.port);
    if (processes.length === 0) break;
    execSync('timeout /t 1 /nobreak > nul', { shell: true });
    retries++;
  }

  // 启动后端
  console.log('\n3. 启动后端服务...');
  const backendPath = path.resolve(process.cwd(), 'backend');

  // 使用 spawn 启动，不等待
  const child = spawn('npm', ['run', 'dev'], {
    cwd: backendPath,
    detached: true,
    shell: true,
    stdio: 'inherit'
  });

  child.unref();
  console.log('\n后端服务已启动 (PID: ' + child.pid + ')');
  console.log('API 地址: http://localhost:' + PROJECT_PORTS.backend.port);
}

/**
 * 快速关闭单个端口
 */
function quickKill(port) {
  const portNum = parseInt(port, 10);
  if (isNaN(portNum)) {
    console.error(`错误: 无效的端口号 "${port}"`);
    process.exit(1);
  }

  console.log(`\n关闭端口 ${portNum}...\n`);
  const result = killPort(portNum);
  console.log(result.message);
}

// CLI 入口
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'status':
    showStatus();
    break;

  case 'kill':
    if (!args[1]) {
      console.error('用法: node port-manager.js kill <port>');
      process.exit(1);
    }
    quickKill(args[1]);
    break;

  case 'kill-all':
    killAll();
    break;

  // 快捷关闭命令
  case 'kill-backend':
    console.log(`\n关闭后端服务 (端口 ${PROJECT_PORTS.backend.port})...\n`);
    console.log(killPort(PROJECT_PORTS.backend.port).message);
    break;

  case 'kill-frontend':
    console.log(`\n关闭前端服务 (端口 ${PROJECT_PORTS.frontend.port})...\n`);
    console.log(killPort(PROJECT_PORTS.frontend.port).message);
    break;

  case 'kill-studio':
    console.log(`\n关闭 LangGraph Studio (端口 ${PROJECT_PORTS.langgraph.port})...\n`);
    console.log(killPort(PROJECT_PORTS.langgraph.port).message);
    break;

  case 'kill-docs':
    console.log(`\n关闭文档站 (端口 ${PROJECT_PORTS.docs.port})...\n`);
    console.log(killPort(PROJECT_PORTS.docs.port).message);
    break;

  case 'restart-backend':
    restartBackend();
    break;

  case 'help':
  case '--help':
  case '-h':
    console.log(`
Port Manager - 项目端口管理工具

用法:
  node port-manager.mjs status           显示所有项目端口状态
  node port-manager.mjs kill <port>      关闭指定端口的进程
  node port-manager.mjs kill-backend     关闭后端服务 (43111)
  node port-manager.mjs kill-frontend    关闭前端服务 (43112)
  node port-manager.mjs kill-studio      关闭 LangGraph Studio (43110)
  node port-manager.mjs kill-docs        关闭文档站 (5173)
  node port-manager.mjs kill-all         关闭所有项目相关端口
  node port-manager.mjs restart-backend  重启后端服务

项目端口:
  43112  前端 Vite 开发服务器
  43111  后端 API 服务
  43110  LangGraph Studio
  5173   Docs 文档站
  5432   PostgreSQL (不自动管理)
`);
    break;

  default:
    if (command && /^\d+$/.test(command)) {
      // 如果第一个参数是数字，直接当作端口号处理
      quickKill(command);
    } else {
      console.log('未知命令。使用 --help 查看帮助。');
      process.exit(1);
    }
}
