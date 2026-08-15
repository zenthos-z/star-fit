#!/usr/bin/env node
/**
 * 独立端口管理服务器 - 增强版
 *
 * 功能：
 * - 提供端口管理的独立 API 服务
 * - 支持在 GUI 中直接执行系统命令
 * - 无需依赖主后端
 * - 自动打开浏览器访问 GUI
 *
 * 用法：
 *   node port-manager-server.mjs
 */

import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 服务器配置
const SERVER_PORT = 43113;
const HTML_FILE = path.join(__dirname, '../../../docs/小工具/port-manager-gui.html');

// 项目端口配置
const PROJECT_PORTS = {
  frontend: { port: 43112, name: '前端 Vite', desc: 'npm run dev' },
  backend: { port: 43111, name: '后端 API', desc: 'cd backend && npm run dev' },
  langgraph: { port: 43110, name: 'LangGraph Studio', desc: 'cd backend && npm run studio' },
  postgres: { port: 5432, name: 'PostgreSQL', desc: '数据库服务 (通常不在此管理)' },
  docs: { port: 5173, name: 'Docs 文档站', desc: 'npm run docs:dev' },
};

/**
 * 执行系统命令并返回结果
 */
function executeCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout = 5000 } = options;

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // 使用 spawn 执行命令
    const child = spawn('cmd', ['/c', command], {
      shell: true,
      windowsHide: true,
    });

    // 设置超时
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(new Error(`命令执行超时 (${timeout}ms): ${command}`));
    }, timeout);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;

      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`命令执行失败 (退出码 ${code}): ${stderr || stdout}`));
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`命令执行出错: ${error.message}`));
    });
  });
}

/**
 * 获取指定端口的占用进程信息
 */
async function getPortProcess(port) {
  try {
    const { stdout } = await executeCommand(`netstat -ano | findstr :${port}`);
    const lines = stdout.trim().split('\n').filter(Boolean);
    const processes = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const protocol = parts[0];
        const localAddr = parts[1];
        const state = parts[3] || '';
        const pid = parts[4];

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
 */
async function getProcessName(pid) {
  try {
    const { stdout } = await executeCommand(`tasklist /FI "PID eq ${pid}" /NH`);
    const match = stdout.match(/^(.+?)\s+\d+/);
    return match ? match[1].trim() : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

/**
 * 杀死指定 PID 的进程
 */
async function killProcess(pid) {
  try {
    await executeCommand(`taskkill /F /PID ${pid}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取所有项目端口状态
 */
async function getAllPortsStatus() {
  const portStatus = [];

  for (const [key, config] of Object.entries(PROJECT_PORTS)) {
    const processes = await getPortProcess(config.port);
    const status = processes.length > 0 ? 'running' : 'idle';

    const portInfo = {
      key,
      name: config.name,
      port: config.port,
      status,
      desc: config.desc,
      processes: [],
    };

    if (processes.length > 0) {
      const uniquePids = [...new Set(processes.map(p => p.pid))];
      for (const pid of uniquePids) {
        const processName = await getProcessName(pid);
        portInfo.processes.push({ pid, name: processName });
      }
    }

    portStatus.push(portInfo);
  }

  return portStatus;
}

/**
 * 关闭指定端口的所有进程
 */
async function killPort(port) {
  const processes = await getPortProcess(port);

  if (processes.length === 0) {
    return {
      success: true,
      killed: 0,
      message: `端口 ${port} 没有被占用`
    };
  }

  let killed = 0;
  const uniquePids = [...new Set(processes.map(p => p.pid))];
  const results = [];

  for (const pid of uniquePids) {
    const processName = await getProcessName(pid);
    if (await killProcess(pid)) {
      killed++;
      results.push({ pid, name: processName, success: true });
    } else {
      results.push({ pid, name: processName, success: false });
    }
  }

  return {
    success: killed > 0,
    killed,
    total: uniquePids.length,
    message: `端口 ${port}: 已终止 ${killed}/${uniquePids.length} 个进程`,
    results,
  };
}

/**
 * 执行用户命令（安全限制版）
 */
async function executeUserCommand(command) {
  // 安全检查：只允许特定命令
  const dangerousCommands = [
    'format', 'del', 'erase', 'rmdir', 'rd', 'shutdown',
    'restart', 'fatal', 'crash', 'rm', 'sudo', 'su'
  ];

  const commandLower = command.toLowerCase().trim();
  for (const dangerous of dangerousCommands) {
    if (commandLower.includes(dangerous)) {
      throw new Error(`安全限制: 不允许执行包含 "${dangerous}" 的命令`);
    }
  }

  try {
    const result = await executeCommand(command, { timeout: 10000 });
    return {
      success: true,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code
    };
  } catch (error) {
    return {
      success: false,
      command,
      error: error.message
    };
  }
}

/**
 * 获取系统信息
 */
async function getSystemInfo() {
  try {
    const hostnameResult = await executeCommand('hostname');
    const hostname = hostnameResult.stdout.trim();

    const whoamiResult = await executeCommand('whoami');
    const username = whoamiResult.stdout.trim();

    return {
      hostname,
      username,
      platform: 'win32',
      serverPort: SERVER_PORT
    };
  } catch {
    return {
      hostname: 'Unknown',
      username: 'Unknown',
      platform: 'win32',
      serverPort: SERVER_PORT
    };
  }
}

/**
 * 创建 HTTP 服务器
 */
function createServer() {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // Serve HTML file
    if (url.pathname === '/' || url.pathname === '/index.html') {
      try {
        let html = fs.readFileSync(HTML_FILE, 'utf8');
        // Update API_BASE to point to this server
        html = html.replace(/const API_BASE = 'http:\/\/localhost:\d+'/, `const API_BASE = 'http://localhost:${SERVER_PORT}'`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (error) {
        res.writeHead(404);
        res.end('HTML file not found');
      }
      return;
    }

    // API: Get server info
    if (url.pathname === '/api/info' && req.method === 'GET') {
      const info = await getSystemInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(info));
      return;
    }

    // API: Get ports status
    if (url.pathname === '/api/ports/status' && req.method === 'GET') {
      const ports = await getAllPortsStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ports }));
      return;
    }

    // API: Kill port process
    if (url.pathname === '/api/ports/kill' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { port } = JSON.parse(body);
          const result = await killPort(port);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }

    // API: Execute command
    if (url.pathname === '/api/command/execute' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { command } = JSON.parse(body);
          if (!command) {
            throw new Error('缺少 command 参数');
          }
          const result = await executeUserCommand(command);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  });

  return server;
}

/**
 * 打开浏览器
 */
function openBrowser() {
  const url = `http://localhost:${SERVER_PORT}`;

  try {
    // Windows
    execSync(`start ${url}`, { stdio: 'ignore', shell: true });
  } catch (error) {
    console.log(`请手动在浏览器中打开: ${url}`);
  }
}

/**
 * 主函数
 */
function main() {
  console.log('\n========================================');
  console.log('  Starfit 端口管理器服务器');
  console.log('========================================\n');

  const server = createServer();

  server.listen(SERVER_PORT, async () => {
    console.log(`✓ 服务器已启动: http://localhost:${SERVER_PORT}`);

    const systemInfo = await getSystemInfo();
    console.log(`✓ 主机: ${systemInfo.hostname}`);
    console.log(`✓ 用户: ${systemInfo.username}`);

    console.log(`\n✓ API 端点:`);
    console.log(`  - GET  /api/info`);
    console.log(`  - GET  /api/ports/status`);
    console.log(`  - POST /api/ports/kill`);
    console.log(`  - POST /api/command/execute`);
    console.log(`\n正在打开浏览器...\n`);

    setTimeout(() => {
      openBrowser();
    }, 500);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n✗ 端口 ${SERVER_PORT} 已被占用！`);
      console.log('\n可能的解决方案:');
      console.log('1. 关闭占用该端口的进程');
      console.log('2. 修改脚本中的 SERVER_PORT 常量使用其他端口\n');

      // 尝试查找占用端口的进程
      getPortProcess(SERVER_PORT).then(processes => {
        if (processes.length > 0) {
          console.log('占用端口的进程:');
          for (const p of processes) {
            getProcessName(p.pid).then(name => {
              console.log(`  - PID ${p.pid}: ${name}`);
            });
          }
        }
      });
    } else {
      console.error('\n服务器启动失败:', error.message);
    }
    process.exit(1);
  });

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    server.close(() => {
      console.log('服务器已关闭');
      process.exit(0);
    });
  });
}

// 启动服务器
main();
