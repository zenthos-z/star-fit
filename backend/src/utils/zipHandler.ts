/**
 * ZIP Handler Utility
 *
 * 提供 ZIP 文件的创建和解析功能
 * 用于动作库的导入/导出
 */

import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { Readable } from 'stream';
import type { ZipFileMap } from '../types/exerciseLibraryIO.js';

export const ZipHandler = {
  /**
   * 创建 ZIP 归档
   * @param structure 文件结构映射，路径作为 key，内容（Buffer 或字符串）作为 value
   * @returns ZIP 文件的 Buffer
   */
  async createArchive(structure: Record<string, string | Buffer>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver('zip', {
        zlib: { level: 9 } // 最高压缩级别
      });

      // 收集数据块
      archive.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      // 完成时合并所有块
      archive.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      // 错误处理
      archive.on('error', (err: Error) => {
        reject(new Error(`Failed to create ZIP archive: ${err.message}`));
      });

      // 添加文件到归档
      Object.entries(structure).forEach(([filePath, content]) => {
        if (content instanceof Buffer) {
          archive.append(content, { name: filePath });
        } else {
          archive.append(content, { name: filePath });
        }
      });

      // 完成归档
      archive.finalize();
    });
  },

  /**
   * 解析 ZIP 归档
   * @param zipBuffer ZIP 文件的 Buffer
   * @returns 文件映射，路径作为 key，内容作为 value
   */
  async extractArchive(zipBuffer: Buffer): Promise<ZipFileMap> {
    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      const result: ZipFileMap = {};

      for (const entry of entries) {
        // 跳过目录
        if (entry.isDirectory) {
          continue;
        }

        // 获取文件路径（保持原始路径结构）
        const entryName = entry.entryName;

        // 读取文件内容
        try {
          result[entryName] = entry.getData();
        } catch (err) {
          // 如果无法读取（如加密文件），跳过
          console.warn(`[ZipHandler] Failed to read file: ${entryName}`);
        }
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to extract ZIP archive: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  /**
   * 验证 ZIP 结构
   * @param extractedData 解压后的文件映射
   * @returns 验证结果
   */
  validateZipStructure(extractedData: ZipFileMap): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // 检查必需文件
    if (!extractedData['manifest.json']) {
      errors.push('Missing required file: manifest.json');
    }

    if (!extractedData['exercises.json']) {
      errors.push('Missing required file: exercises.json');
    }

    // 验证 manifest.json 格式
    if (extractedData['manifest.json']) {
      try {
        const manifest = JSON.parse(extractedData['manifest.json'] as string);
        if (!manifest.version || typeof manifest.version !== 'string') {
          errors.push('Invalid manifest.json: missing or invalid version field');
        }
        if (!manifest.exportedAt || typeof manifest.exportedAt !== 'string') {
          errors.push('Invalid manifest.json: missing or invalid exportedAt field');
        }
      } catch (e) {
        errors.push(`Invalid manifest.json: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 验证 exercises.json 格式
    if (extractedData['exercises.json']) {
      try {
        const exercises = JSON.parse(extractedData['exercises.json'] as string);
        if (!Array.isArray(exercises)) {
          errors.push('Invalid exercises.json: must be an array');
        }
      } catch (e) {
        errors.push(`Invalid exercises.json: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  },

  /**
   * 从 Buffer 创建可读流
   * @param buffer 文件 Buffer
   * @returns 可读流
   */
  bufferToStream(buffer: Buffer): Readable {
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    return stream;
  },

  /**
   * 获取 ZIP 文件列表（不含内容）
   * @param zipBuffer ZIP 文件的 Buffer
   * @returns 文件路径列表
   */
  listFiles(zipBuffer: Buffer): string[] {
    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      return entries
        .filter(entry => !entry.isDirectory)
        .map(entry => entry.entryName);
    } catch (error) {
      throw new Error(`Failed to list ZIP files: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  /**
   * 验证文件是否为有效的 ZIP 文件
   * @param buffer 文件 Buffer
   * @returns 是否为有效的 ZIP 文件
   */
  isValidZip(buffer: Buffer): boolean {
    try {
      // ZIP 文件以魔数 0x04034b50 开头（小端序）
      if (buffer.length < 4) {
        return false;
      }

      const header = buffer.readUInt32LE(0);
      return header === 0x04034b50;
    } catch {
      return false;
    }
  }
};
