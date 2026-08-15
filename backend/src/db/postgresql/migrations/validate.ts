/**
 * Migration Validator
 *
 * Validates migration SQL files without executing them
 * Checks for syntax errors, required fields, and naming conventions
 *
 * @version 1.0.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ValidationResult {
  filename: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  filepath: string;
}

/**
 * Parse migration filename
 */
function parseMigrationFilename(filename: string): { version: string; name: string } | null {
  const match = filename.match(/^(\d+)_(.+)\.sql$/);
  if (!match) return null;
  const [, version, name] = match;
  return { version, name };
}

/**
 * Validate SQL migration file
 */
function validateMigrationFile(filepath: string, filename: string): ValidationResult {
  const result: ValidationResult = {
    filename,
    valid: true,
    errors: [],
    warnings: [],
  };

  // Check filename format
  const parsed = parseMigrationFilename(filename);
  if (!parsed) {
    result.errors.push(`Invalid filename format. Expected: ###_description.sql`);
    result.valid = false;
    return result;
  }

  // Read SQL content
  let content: string;
  try {
    content = fs.readFileSync(filepath, 'utf-8');
  } catch (error) {
    result.errors.push(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
    result.valid = false;
    return result;
  }

  // Check if file is empty
  if (!content.trim()) {
    result.errors.push('File is empty');
    result.valid = false;
    return result;
  }

  // Basic SQL syntax checks
  const statements = content
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  if (statements.length === 0) {
    result.errors.push('No SQL statements found');
    result.valid = false;
    return result;
  }

  // Check for common SQL patterns
  const hasCreateTable = content.toUpperCase().includes('CREATE TABLE');
  const hasCreateIndex = content.toUpperCase().includes('CREATE INDEX');
  const hasInsert = content.toUpperCase().includes('INSERT INTO');

  // Warnings for best practices
  if (hasCreateTable && !hasCreateIndex) {
    result.warnings.push('CREATE TABLE without any CREATE INDEX - consider adding indexes for performance');
  }

  if (!content.toUpperCase().includes('IF NOT EXISTS') && hasCreateTable) {
    result.warnings.push('CREATE TABLE without IF NOT EXISTS - consider adding for idempotency');
  }

  // Check for migration metadata insertion
  if (hasCreateTable && !hasInsert) {
    result.warnings.push('Migration creates table but does not insert metadata record');
  }

  return result;
}

/**
 * Validate all migration files
 */
function validateAllMigrations(): ValidationResult[] {
  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && f !== 'validate.ts');

  const results: ValidationResult[] = [];

  for (const file of files) {
    const filepath = path.join(migrationsDir, file);
    const result = validateMigrationFile(filepath, file);
    results.push(result);
  }

  return results;
}

/**
 * Main validation function
 */
export function validateMigrations(): {
  valid: boolean;
  totalFiles: number;
  validFiles: number;
  results: ValidationResult[];
} {
  console.log('🔍 Validating migration files...\n');

  const results = validateAllMigrations();
  const validFiles = results.filter(r => r.valid).length;
  const totalFiles = results.length;

  // Print results
  for (const result of results) {
    const icon = result.valid ? '✅' : '❌';
    console.log(`${icon} ${result.filename}`);

    if (result.errors.length > 0) {
      console.log('   Errors:');
      result.errors.forEach(e => console.log(`   - ${e}`));
    }

    if (result.warnings.length > 0) {
      console.log('   Warnings:');
      result.warnings.forEach(w => console.log(`   - ${w}`));
    }

    if (result.errors.length > 0 || result.warnings.length > 0) {
      console.log('');
    }
  }

  console.log(`\n📊 Summary: ${validFiles}/${totalFiles} files valid\n`);

  return {
    valid: validFiles === totalFiles,
    totalFiles,
    validFiles,
    results,
  };
}

/**
 * List all migration files
 */
export function listMigrations(): MigrationFile[] {
  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && f.match(/^\d+_/))
    .sort();

  return files.map(filename => {
    const parsed = parseMigrationFilename(filename);
    if (!parsed) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }
    return {
      version: parsed.version,
      name: parsed.name,
      filename,
      filepath: path.join(migrationsDir, filename),
    };
  });
}

// Run validation if executed directly
const args = process.argv.slice(2);
const command = args[0] || 'validate';

if (command === 'validate') {
  const result = validateMigrations();
  process.exit(result.valid ? 0 : 1);
} else if (command === 'list') {
  console.log('📋 Migration files:\n');
  const migrations = listMigrations();
  migrations.forEach(m => {
    console.log(`  ${m.version}_${m.name} (${m.filename})`);
  });
  console.log(`\nTotal: ${migrations.length} migrations\n`);
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Available commands: validate, list');
  process.exit(1);
}
