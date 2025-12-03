/**
 * Redis Configuration Management
 * Handles Redis-specific configuration with environment variable mapping and validation
 */

import { config } from './index';
import type {
  RedisConfig,
  RedisPoolConfig,
  SessionConfig,
  CacheConfig,
  RateLimitConfig
} from '@/types/redis';

// Parse Redis URL into components
function parseRedisUrl(url: string): Partial<RedisConfig> {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 6379,
      password: parsed.password || undefined,
      database: parseInt(parsed.pathname.slice(1)) || 0,
      tls: parsed.protocol === 'rediss:' ? { rejectUnauthorized: false } : undefined,
    };
  } catch (error) {
    throw new Error(`Invalid Redis URL: ${url}`);
  }
}

// Redis connection configuration
export const redisConfig: RedisConfig = {
  url: config.database.redisUrl,
  ...parseRedisUrl(config.database.redisUrl),
  keyPrefix: process.env['REDIS_KEY_PREFIX'] || 'polymarket:',
  retryDelayOnFailover: parseInt(process.env['REDIS_RETRY_DELAY'] || '100', 10),
  maxRetriesPerRequest: parseInt(process.env['REDIS_MAX_RETRIES'] || '3', 10),
  lazyConnect: process.env['REDIS_LAZY_CONNECT'] === 'true',
  keepAlive: parseInt(process.env['REDIS_KEEP_ALIVE'] || '30000', 10),
  connectTimeout: parseInt(process.env['REDIS_CONNECT_TIMEOUT'] || '10000', 10),
  commandTimeout: parseInt(process.env['REDIS_COMMAND_TIMEOUT'] || '5000', 10),
  enableOfflineQueue: process.env['REDIS_OFFLINE_QUEUE'] !== 'false',
  maxMemoryPolicy: process.env['REDIS_MEMORY_POLICY'] || 'allkeys-lru',
  ...(process.env['NODE_ENV'] === 'production' && {
    tls: {
      rejectUnauthorized: process.env['REDIS_TLS_REJECT_UNAUTHORIZED'] !== 'false',
    },
  }),
};

// Redis connection pool configuration
export const redisPoolConfig: RedisPoolConfig = {
  min: parseInt(process.env['REDIS_POOL_MIN'] || '2', 10),
  max: parseInt(process.env['REDIS_POOL_MAX'] || '10', 10),
  acquireTimeoutMillis: parseInt(process.env['REDIS_POOL_ACQUIRE_TIMEOUT'] || '30000', 10),
  idleTimeoutMillis: parseInt(process.env['REDIS_POOL_IDLE_TIMEOUT'] || '30000', 10),
  createTimeoutMillis: parseInt(process.env['REDIS_POOL_CREATE_TIMEOUT'] || '30000', 10),
  destroyTimeoutMillis: parseInt(process.env['REDIS_POOL_DESTROY_TIMEOUT'] || '5000', 10),
  reapIntervalMillis: parseInt(process.env['REDIS_POOL_REAP_INTERVAL'] || '1000', 10),
  createRetryIntervalMillis: parseInt(process.env['REDIS_POOL_CREATE_RETRY_INTERVAL'] || '100', 10),
};

// Session management configuration
export const sessionConfig: SessionConfig = {
  keyPrefix: `${redisConfig.keyPrefix}session:`,
  defaultTtl: parseInt(process.env['SESSION_DEFAULT_TTL'] || '86400', 10), // 24 hours
  maxSessions: parseInt(process.env['SESSION_MAX_CONCURRENT'] || '10000', 10),
  cleanupInterval: parseInt(process.env['SESSION_CLEANUP_INTERVAL'] || '300000', 10), // 5 minutes
  compression: process.env['SESSION_COMPRESSION'] === 'true',
  encryption: process.env['SESSION_ENCRYPTION'] === 'true',
};

// Caching configuration
export const cacheConfig: CacheConfig = {
  defaultTtl: parseInt(process.env['CACHE_DEFAULT_TTL'] || '300', 10), // 5 minutes
  maxSize: parseInt(process.env['CACHE_MAX_SIZE'] || '1073741824', 10), // 1GB
  evictionPolicy: process.env['CACHE_EVICTION_POLICY'] || 'allkeys-lru',
  compressionThreshold: parseInt(process.env['CACHE_COMPRESSION_THRESHOLD'] || '1024', 10), // 1KB
  enableMetrics: process.env['CACHE_ENABLE_METRICS'] !== 'false',
  invalidationStrategy: (process.env['CACHE_INVALIDATION_STRATEGY'] as any) || 'time',
};

// Rate limiting configuration
export const rateLimitConfig: RateLimitConfig = {
  windowMs: config.rateLimit.windowMs,
  maxRequests: config.rateLimit.maxRequests,
  keyGenerator: (identifier: string) => `${redisConfig.keyPrefix}rate_limit:${identifier}`,
  skipSuccessfulRequests: process.env['RATE_LIMIT_SKIP_SUCCESS'] === 'true',
  skipFailedRequests: process.env['RATE_LIMIT_SKIP_FAILED'] === 'true',
};

// Key generation functions for different data types
export const redisKeys = {
  // Session keys
  session: (userId: number) => `${sessionConfig.keyPrefix}${userId}`,
  sessionIndex: (field: string) => `${sessionConfig.keyPrefix}index:${field}`,

  // Cache keys
  cache: (key: string) => `${redisConfig.keyPrefix}cache:${key}`,
  cacheTag: (tag: string) => `${redisConfig.keyPrefix}tag:${tag}`,
  cacheVersion: (key: string) => `${redisConfig.keyPrefix}version:${key}`,

  // Rate limiting keys
  rateLimit: (identifier: string, window: number) =>
    `${redisConfig.keyPrefix}rate_limit:${identifier}:${Math.floor(Date.now() / window)}`,

  // Polymarket data keys
  polymarket: {
    markets: `${redisConfig.keyPrefix}polymarket:markets`,
    market: (marketId: string) => `${redisConfig.keyPrefix}polymarket:market:${marketId}`,
    prices: `${redisConfig.keyPrefix}polymarket:prices`,
    price: (marketId: string) => `${redisConfig.keyPrefix}polymarket:price:${marketId}`,
    volumes: `${redisConfig.keyPrefix}polymarket:volumes`,
    volume: (marketId: string) => `${redisConfig.keyPrefix}polymarket:volume:${marketId}`,
    liquidity: `${redisConfig.keyPrefix}polymarket:liquidity`,
    liquidityPool: (marketId: string) => `${redisConfig.keyPrefix}polymarket:liquidity:${marketId}`,
  },

  // Wallet tracking keys
  wallet: {
    profile: (address: string) => `${redisConfig.keyPrefix}wallet:${address}:profile`,
    activity: (address: string) => `${redisConfig.keyPrefix}wallet:${address}:activity`,
    positions: (address: string) => `${redisConfig.keyPrefix}wallet:${address}:positions`,
    transactions: (address: string) => `${redisConfig.keyPrefix}wallet:${address}:transactions`,
    lastUpdate: (address: string) => `${redisConfig.keyPrefix}wallet:${address}:last_update`,
  },

  // Pub/Sub channels
  channels: {
    polymarket: {
      prices: `${redisConfig.keyPrefix}channel:polymarket:prices`,
      volumes: `${redisConfig.keyPrefix}channel:polymarket:volumes`,
      liquidity: `${redisConfig.keyPrefix}channel:polymarket:liquidity`,
      resolutions: `${redisConfig.keyPrefix}channel:polymarket:resolutions`,
      newMarkets: `${redisConfig.keyPrefix}channel:polymarket:new_markets`,
    },
    notifications: {
      general: `${redisConfig.keyPrefix}channel:notifications:general`,
      priceAlerts: `${redisConfig.keyPrefix}channel:notifications:price_alerts`,
      resolutions: `${redisConfig.keyPrefix}channel:notifications:resolutions`,
      system: `${redisConfig.keyPrefix}channel:notifications:system`,
    },
    system: {
      health: `${redisConfig.keyPrefix}channel:system:health`,
      metrics: `${redisConfig.keyPrefix}channel:system:metrics`,
      errors: `${redisConfig.keyPrefix}channel:system:errors`,
    },
  },

  // Health and monitoring keys
  health: {
    status: `${redisConfig.keyPrefix}health:status`,
    metrics: `${redisConfig.keyPrefix}health:metrics`,
    heartbeat: `${redisConfig.keyPrefix}health:heartbeat`,
  },

  // Lock keys for distributed operations
  locks: {
    marketUpdate: `${redisConfig.keyPrefix}lock:market_update`,
    sessionCleanup: `${redisConfig.keyPrefix}lock:session_cleanup`,
    cacheCleanup: `${redisConfig.keyPrefix}lock:cache_cleanup`,
    notificationBatch: `${redisConfig.keyPrefix}lock:notification_batch`,
  },
};

// TTL constants (in seconds)
export const ttl = {
  session: sessionConfig.defaultTtl,
  cache: {
    short: 60, // 1 minute
    medium: 300, // 5 minutes
    long: 3600, // 1 hour
    daily: 86400, // 24 hours
  },
  polymarket: {
    prices: 30, // 30 seconds for price data
    volumes: 120, // 2 minutes for volume data
    markets: 600, // 10 minutes for market data
    liquidity: 60, // 1 minute for liquidity data
  },
  rateLimit: config.rateLimit.windowMs / 1000, // Convert to seconds
  lock: 30, // 30 seconds for distributed locks
  health: 60, // 1 minute for health data
};

// Validate Redis configuration
export function validateRedisConfig(): void {
  const requiredEnvVars = ['REDIS_URL'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required Redis environment variables: ${missingVars.join(', ')}`);
  }

  // Validate Redis URL format
  try {
    new URL(redisConfig.url!);
  } catch (error) {
    throw new Error(`Invalid Redis URL format: ${redisConfig.url}`);
  }

  // Validate numeric configurations
  const numericConfigs = [
    { name: 'REDIS_POOL_MIN', value: redisPoolConfig.min, min: 1, max: 100 },
    { name: 'REDIS_POOL_MAX', value: redisPoolConfig.max, min: 1, max: 100 },
    { name: 'SESSION_DEFAULT_TTL', value: sessionConfig.defaultTtl, min: 60, max: 86400 },
    { name: 'CACHE_DEFAULT_TTL', value: cacheConfig.defaultTtl, min: 1, max: 3600 },
  ];

  for (const { name, value, min, max } of numericConfigs) {
    if (value < min || value > max) {
      throw new Error(`${name} must be between ${min} and ${max}, got ${value}`);
    }
  }

  // Validate pool configuration
  if (redisPoolConfig.min > redisPoolConfig.max) {
    throw new Error('REDIS_POOL_MIN cannot be greater than REDIS_POOL_MAX');
  }

  // Validate cache size
  if (cacheConfig.maxSize < 1024 * 1024) { // Less than 1MB
    throw new Error('CACHE_MAX_SIZE must be at least 1MB (1048576 bytes)');
  }
}

// Configuration for different environments
export const environmentConfigs = {
  development: {
    ...redisConfig,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    commandTimeout: 5000,
  },
  test: {
    ...redisConfig,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    keyPrefix: 'test:',
  },
  staging: {
    ...redisConfig,
    maxRetriesPerRequest: 5,
    keepAlive: 60000,
    connectTimeout: 15000,
  },
  production: {
    ...redisConfig,
    maxRetriesPerRequest: 10,
    keepAlive: 120000,
    connectTimeout: 20000,
    enableOfflineQueue: true,
    tls: {
      rejectUnauthorized: true,
    },
  },
};

// Get environment-specific configuration
export function getEnvironmentRedisConfig(): RedisConfig {
  const env = config.server.nodeEnv;
  return environmentConfigs[env as keyof typeof environmentConfigs] || redisConfig;
}

// Export all configurations
export {
  redisConfig as default,
  redisKeys as keys,
};
// ttl is already exported above

// Mock redis client for testing (in development environment)
let redisClient: any = null;

if (process.env['NODE_ENV'] === 'test') {
  // Mock Redis client for testing
  redisClient = {
    on: jest.fn(),
    off: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    publish: jest.fn().mockResolvedValue(true),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    hget: jest.fn().mockResolvedValue(null),
    hset: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1),
    llen: jest.fn().mockResolvedValue(0),
    lpush: jest.fn().mockResolvedValue(1),
    rpop: jest.fn().mockResolvedValue(null),
    sadd: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    srem: jest.fn().mockResolvedValue(1),
    zadd: jest.fn().mockResolvedValue(1),
    zrange: jest.fn().mockResolvedValue([]),
    zrem: jest.fn().mockResolvedValue(1),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn().mockResolvedValue(undefined),
  };
}

// Type exports for backward compatibility
export type {
  RedisConfig,
  RedisPoolConfig,
  SessionConfig,
  CacheConfig,
  RateLimitConfig,
};

// Export redis client for testing
export { redisClient };