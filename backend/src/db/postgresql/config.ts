/**
 * PostgreSQL Connection Configuration
 *
 * Environment-based configuration for PostgreSQL connection
 * Supports both individual parameters and connection string
 *
 * Environment Variables:
 * - DATABASE_URL: Full connection string (takes precedence)
 * - PGHOST: Database host (default: localhost)
 * - PGPORT: Database port (default: 5432)
 * - PGDATABASE: Database name (default: starfit)
 * - PGUSER: Database user (default: postgres)
 * - PGPASSWORD: Database password
 * - PGPOOL_SIZE: Connection pool size (default: 20)
 * - PGCONNECTION_TIMEOUT: Connection timeout in ms (default: 2000)
 * - PGIDLE_TIMEOUT: Idle timeout in ms (default: 30000)
 *
 * @version 3.0.0
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface PostgresConfig {
  // Connection string (takes precedence over individual params)
  connectionString?: string;

  // Individual connection parameters
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;

  // Pool configuration
  pool: {
    max: number;
    min: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
  };

  // SSL configuration
  ssl?: boolean | {
    rejectUnauthorized: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULTS: Required<Pick<PostgresConfig, 'host' | 'port' | 'database' | 'user'>> & {
  pool: Required<PostgresConfig['pool']>;
} = {
  host: 'localhost',
  port: 5432,
  database: 'starfit',
  user: 'postgres',
  pool: {
    max: 20,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
};

// ============================================================================
// Configuration Loader
// ============================================================================

/**
 * Load PostgreSQL configuration from environment
 * Priority: DATABASE_URL > individual env vars > defaults
 */
export function loadPostgresConfig(): PostgresConfig {
  // Check for connection string first
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    // Parse connection string to extract components
    const parsed = parseConnectionString(connectionString);

    // Debug logging
    console.log('[loadPostgresConfig] Connection string found:', connectionString);
    console.log('[loadPostgresConfig] Parsed components:', {
      ...parsed,
      password: parsed.password ? '***' : undefined
    });

    return {
      connectionString,
      host: parsed.host || DEFAULTS.host,
      port: parsed.port || DEFAULTS.port,
      database: parsed.database || DEFAULTS.database,
      user: parsed.user || DEFAULTS.user,
      password: parsed.password,
      pool: {
        max: parseInt(process.env.PGPOOL_SIZE || '20'),
        min: parseInt(process.env.PGPOOL_MIN || '2'),
        idleTimeoutMillis: parseInt(process.env.PGIDLE_TIMEOUT || '30000'),
        connectionTimeoutMillis: parseInt(process.env.PGCONNECTION_TIMEOUT || '2000'),
      },
    };
  }

  // Build from individual environment variables
  console.log('[loadPostgresConfig] Using individual env vars');

  return {
    host: process.env.PGHOST || DEFAULTS.host,
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || DEFAULTS.database,
    user: process.env.PGUSER || DEFAULTS.user,
    password: process.env.PGPASSWORD,
    pool: {
      max: parseInt(process.env.PGPOOL_SIZE || '20'),
      min: parseInt(process.env.PGPOOL_MIN || '2'),
      idleTimeoutMillis: parseInt(process.env.PGIDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.PGCONNECTION_TIMEOUT || '2000'),
    },
    ssl: parseSSLConfig(),
  };
}

/**
 * Parse connection URL to extract components
 */
function parseConnectionString(connectionString: string): {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
} {
  try {
    const url = new URL(connectionString);

    return {
      host: url.hostname,
      port: url.port ? parseInt(url.port) : undefined,
      database: url.pathname.slice(1), // Remove leading slash
      user: url.username,
      password: url.password || undefined,
    };
  } catch (error) {
    return {};
  }
}

/**
 * Parse SSL configuration from environment
 */
function parseSSLConfig(): PostgresConfig['ssl'] {
  const sslMode = process.env.PGSSLMODE?.toLowerCase();

  if (sslMode === 'disable' || sslMode === 'false') {
    return false;
  }

  if (sslMode === 'require' || sslMode === 'true') {
    return {
      rejectUnauthorized: process.env.PGSSLREJECTUNAUTHORIZED !== '0',
    };
  }

  if (process.env.PGCA || process.env.PGCERT || process.env.PGKEY) {
    return {
      rejectUnauthorized: process.env.PGSSLREJECTUNAUTHORIZED !== '0',
      ca: process.env.PGCA,
      cert: process.env.PGCERT,
      key: process.env.PGKEY,
    };
  }

  return undefined;
}

/**
 * Validate configuration
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: PostgresConfig): void {
  if (!config.connectionString) {
    if (!config.host) {
      throw new Error('PostgreSQL host is required (set PGHOST or DATABASE_URL)');
    }
    if (!config.database) {
      throw new Error('PostgreSQL database is required (set PGDATABASE or DATABASE_URL)');
    }
    if (!config.user) {
      throw new Error('PostgreSQL user is required (set PGUSER or DATABASE_URL)');
    }
  }

  if (config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid PostgreSQL port: ${config.port}`);
  }

  if (config.pool.max < config.pool.min) {
    throw new Error(`Pool max (${config.pool.max}) must be >= min (${config.pool.min})`);
  }

  if (config.pool.connectionTimeoutMillis < 0) {
    throw new Error('Connection timeout must be non-negative');
  }

  if (config.pool.idleTimeoutMillis < 0) {
    throw new Error('Idle timeout must be non-negative');
  }
}

/**
 * Get configuration for logging (sanitized)
 */
export function getConfigForLogging(config: PostgresConfig): Record<string, any> {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    hasPassword: !!config.password,
    connectionString: config.connectionString ? '***CONFIGURED***' : undefined,
    pool: config.pool,
    ssl: !!config.ssl,
  };
}

/**
 * Create connection string from config
 */
export function buildConnectionString(config: PostgresConfig): string {
  if (config.connectionString) {
    return config.connectionString;
  }

  const auth = config.password
    ? `${config.user}:${config.password}`
    : config.user;

  const ssl = config.ssl ? '?sslmode=require' : '';

  return `postgresql://${auth}@${config.host}:${config.port}/${config.database}${ssl}`;
}

// ============================================================================
// Environment-Specific Presets
// ============================================================================

export const PRESETS: Record<string, Partial<PostgresConfig>> = {
  development: {
    pool: {
      max: 5,
      min: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 2000,
    },
  },

  test: {
    pool: {
      max: 3,
      min: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 1000,
    },
  },

  production: {
    pool: {
      max: 50,
      min: 5,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 5000,
    },
    ssl: {
      rejectUnauthorized: true,
    },
  },
};

/**
 * Load configuration with preset applied
 */
export function loadConfigWithPreset(preset?: string): PostgresConfig {
  const config = loadPostgresConfig();

  if (preset && PRESETS[preset]) {
    const presetConfig = PRESETS[preset];

    if (presetConfig.pool) {
      config.pool = { ...config.pool, ...presetConfig.pool };
    }

    if (presetConfig.ssl !== undefined) {
      config.ssl = presetConfig.ssl;
    }
  }

  return config;
}

// ============================================================================
// Singleton Configuration
// ============================================================================

let cachedConfig: PostgresConfig | null = null;

/**
 * Get cached configuration or load fresh
 */
export function getPostgresConfig(preset?: string): PostgresConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfigWithPreset(preset);
    validateConfig(cachedConfig);
  }

  return cachedConfig;
}

/**
 * Reset cached configuration (useful for testing)
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

// ============================================================================
// Agent Runtime Checkpointer Connection (M-RT)
// ============================================================================

/**
 * Connection string for the agent-runtime LangGraph checkpointer (M-RT).
 *
 * Targets the SAME PostgreSQL instance as the business database. Isolation is
 * logical (a dedicated `agent_runtime` schema applied via PostgresSaver's native
 * `{ schema }` option in agentRuntime.ts), not a separate database/host.
 *
 * P006 injectable-side-effect-boundary: this returns only the connection string;
 * the agent-runtime module owns its own isolated pool and never reaches into the
 * business DB pool. The runtime checkpointer is injected into M3 by the caller.
 */
export function getAgentRuntimeConnectionString(): string {
  return buildConnectionString(getPostgresConfig());
}
