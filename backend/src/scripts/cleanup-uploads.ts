#!/usr/bin/env tsx
/**
 * Uploads Cleanup Script
 *
 * Removes old test uploads from backend/uploads/
 * Based on file age and pattern matching.
 */

import { statSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface FileInfo {
  name: string;
  path: string;
  size: number;
  age: number; // days
  mtime: Date;
}

function getFileInfo(filePath: string, fileName: string): FileInfo {
  const stats = statSync(filePath);
  const age = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24); // days

  return {
    name: fileName,
    path: filePath,
    size: stats.size,
    age: Math.round(age),
    mtime: stats.mtime,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

async function main() {
  const uploadsDir = join(__dirname, '..', '..', '..', 'backend', 'uploads');

  console.log(`\n📁 Analyzing uploads directory: ${uploadsDir}\n`);

  // Get all files in uploads directory
  const files = readdirSync(uploadsDir);
  const fileInfos: FileInfo[] = [];

  for (const file of files) {
    if (file === '.' || file === '..' || file === 'temp' || file === 'videos') {
      continue;
    }

    const filePath = join(uploadsDir, file);
    try {
      const stats = statSync(filePath);
      if (stats.isFile()) {
        fileInfos.push(getFileInfo(filePath, file));
      } else if (stats.isDirectory()) {
        // Handle subdirectories like videos/
        const subFiles = readdirSync(filePath);
        for (const subFile of subFiles) {
          if (subFile === '.' || subFile === '..') continue;
          const subPath = join(filePath, subFile);
          try {
            const subStats = statSync(subPath);
            if (subStats.isFile()) {
              fileInfos.push(getFileInfo(subPath, `${file}/${subFile}`));
            }
          } catch (error) {
            console.error(`  Error reading ${subPath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`  Error reading ${filePath}:`, error);
    }
  }

  // Sort by age (oldest first)
  fileInfos.sort((a, b) => b.age - a.age);

  console.log(`📊 Summary:`);
  console.log(`   Total files: ${fileInfos.length}`);
  const totalSize = fileInfos.reduce((sum, f) => sum + f.size, 0);
  console.log(`   Total size: ${formatSize(totalSize)}\n`);

  // Group by age
  const oldFiles = fileInfos.filter(f => f.age > 30);
  const recentFiles = fileInfos.filter(f => f.age <= 30);

  console.log(`📅 Files by Age:`);
  console.log(`   Older than 30 days: ${oldFiles.length} (${formatSize(oldFiles.reduce((sum, f) => sum + f.size, 0))})`);
  console.log(`   Recent (≤30 days): ${recentFiles.length} (${formatSize(recentFiles.reduce((sum, f) => sum + f.size, 0))})\n`);

  // Show oldest files
  if (oldFiles.length > 0) {
    console.log(`🗂️  Oldest Files (candidates for cleanup):\n`);
    oldFiles.slice(0, 20).forEach(file => {
      console.log(`   ${file.age} days ago  ${formatSize(file.size).padStart(8)}  ${file.name}`);
    });

    console.log(`\n💡 To delete old files, run:\n`);
    console.log(`   rm ${oldFiles.map(f => `"${join(uploadsDir, f.name)}"`).join(' ')}\n`);
  }

  // Show very old test files (December 2025)
  const dec2025Files = fileInfos.filter(f => {
    const date = new Date(2025, 11, 1); // December 1, 2025
    return f.mtime < date;
  });

  if (dec2025Files.length > 0) {
    console.log(`🔴 Very Old Test Files (before December 2025):\n`);
    dec2025Files.forEach(file => {
      console.log(`   ${file.age} days ago  ${formatSize(file.size).padStart(8)}  ${file.name}`);
    });
    console.log(`\n💡 Recommended cleanup command:\n`);
    console.log(`   rm ${dec2025Files.map(f => `"${join(uploadsDir, f.name)}"`).join(' ')}\n`);
  }

  console.log(`✅ Analysis complete!\n`);
}

main().catch(console.error);
