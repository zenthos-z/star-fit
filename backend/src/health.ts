/**
 * 健康检查端点
 * 提供系统和服务的健康状态监控
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from './utils/logger.js';
import { getPostgresClient as getDb } from './db/index.js';

const logger = createLogger({ component: 'HealthCheck' });

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    database: {
      status: 'pass' | 'fail';
      connected: boolean;
      latency?: number;
      size?: number;
    };
    memory: {
      status: 'pass' | 'fail';
      used: number;
      total: number;
      percentage: number;
    };
    disk: {
      status: 'pass' | 'fail';
      used: number;
      total: number;
      percentage: number;
    };
  };
}

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', { logLevel: 'warn' }, healthCheckHandler);
  app.get('/health/ready', { logLevel: 'warn' }, readinessCheckHandler);
  app.get('/health/live', { logLevel: 'warn' }, livenessCheckHandler);
}

async function healthCheckHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const startTime = Date.now();

  try {
    const dbCheck = await checkDatabase();
    const memCheck = checkMemory();
    const diskCheck = checkDisk();
    
    const overallStatus = determineOverallStatus([dbCheck, memCheck, diskCheck]);
    
    const response: HealthCheckResponse = {
      status: overallStatus,
      timestamp: Date.now(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || 'unknown',
      environment: process.env.NODE_ENV || 'development',
      checks: {
        database: dbCheck,
        memory: memCheck,
        disk: diskCheck,
      },
    };
    
    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
    
    logger.debug('Health check completed', {
      status: overallStatus,
      duration: Date.now() - startTime,
    });
    
    reply.status(statusCode).send(response);
  } catch (error) {
    logger.error('Health check failed', error instanceof Error ? error : new Error(String(error)));
    reply.status(503).send({
      status: 'unhealthy',
      timestamp: Date.now(),
      error: 'Health check failed',
    });
  }
}

async function readinessCheckHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const dbCheck = await checkDatabase();
    
    if (dbCheck.status === 'fail') {
      reply.status(503).send({
        status: 'not-ready',
        timestamp: Date.now(),
        checks: {
          database: dbCheck,
        },
      });
      return;
    }
    
    reply.status(200).send({
      status: 'ready',
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error('Readiness check failed', error instanceof Error ? error : new Error(String(error)));
    reply.status(503).send({
      status: 'not-ready',
      timestamp: Date.now(),
      error: 'Readiness check failed',
    });
  }
}

async function livenessCheckHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.status(200).send({
    status: 'alive',
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
}

async function checkDatabase() {
  const startTime = Date.now();

  try {
    const db = getDb();
    await db.query('SELECT 1');
    const latency = Date.now() - startTime;

    const status = latency < 1000 ? 'pass' : 'fail';

    return {
      status: status as 'pass' | 'fail',
      connected: true,
      latency,
    };
  } catch (error) {
    logger.error('Database health check failed', error instanceof Error ? error : new Error(String(error)));

    return {
      status: 'fail' as 'pass' | 'fail',
      connected: false,
    };
  }
}

function checkMemory() {
  const used = process.memoryUsage();
  const total = require('os').totalmem();
  const percentage = (used.heapUsed / total) * 100;
  
  const status = percentage < 90 ? 'pass' : 'fail';
  
  return {
    status: status as 'pass' | 'fail',
    used: used.heapUsed,
    total,
    percentage,
  };
}

function checkDisk() {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  
  try {
    const stats = fs.statSync(path.join(process.cwd(), 'gemini_gym.db'));
    const diskUsage = process.platform === 'win32' 
      ? checkDiskUsageWindows()
      : checkDiskUsageUnix();
    
    if (!diskUsage) {
      return { status: 'pass' as 'pass' | 'fail', used: 0, total: 0, percentage: 0 };
    }

    const percentage = (diskUsage.used / diskUsage.total) * 100;
    const status = percentage < 90 ? 'pass' : 'fail';
    
    return {
      status: status as 'pass' | 'fail',
      used: diskUsage.used,
      total: diskUsage.total,
      percentage,
    };
  } catch (error) {
    logger.warn('Disk health check skipped', error instanceof Error ? error : new Error(String(error)));
    
    return {
      status: 'pass' as 'pass' | 'fail',
      used: 0,
      total: 0,
      percentage: 0,
    };
  }
}

function checkDiskUsageWindows() {
  const exec = require('child_process').execSync;
  try {
    const output = exec('wmic logicaldisk get size,freespace').toString();
    const lines = output.split('\n').filter((line: string) => line.trim());
    const parts = lines[1]?.trim().split(/\s+/);
    
    if (parts && parts.length >= 2) {
      const total = parseInt(parts[0]) * 1024 * 1024;
      const free = parseInt(parts[1]) * 1024 * 1024;
      
      return {
        total,
        used: total - free,
      };
    }
  } catch {
    return { total: 0, used: 0 };
  }
}

function checkDiskUsageUnix() {
  const exec = require('child_process').execSync;
  try {
    const output = exec('df -k .').toString();
    const lines = output.split('\n');
    const parts = lines[1]?.trim().split(/\s+/);
    
    if (parts && parts.length >= 4) {
      const total = parseInt(parts[1]) * 1024;
      const used = parseInt(parts[2]) * 1024;
      
      return {
        total,
        used,
      };
    }
  } catch {
    return { total: 0, used: 0 };
  }
}

function determineOverallStatus(checks: Array<{ status: 'pass' | 'fail' }>): 'healthy' | 'degraded' | 'unhealthy' {
  const failed = checks.filter(c => c.status === 'fail').length;
  
  if (failed === 0) {
    return 'healthy';
  } else if (failed < checks.length) {
    return 'degraded';
  } else {
    return 'unhealthy';
  }
}

export function setupGracefulShutdown(app: FastifyInstance): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown`);
    
    try {
      await app.close();
      logger.info('Server closed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error instanceof Error ? error : new Error(String(error)));
      process.exit(1);
    }
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  logger.info('Graceful shutdown handlers registered');
}
