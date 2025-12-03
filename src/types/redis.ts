/**
 * Redis Types and Interfaces
 * Defines TypeScript types for Redis operations, data structures, and configurations
 */

// Basic Redis configuration options
export interface RedisConfig {
  url: string;
  host?: string;
  port?: number;
  password?: string;
  database?: number;
  keyPrefix?: string;
  retryDelayOnFailover?: number;
  maxRetriesPerRequest?: number;
  lazyConnect?: boolean;
  keepAlive?: number;
  connectTimeout?: number;
  commandTimeout?: number;
  enableOfflineQueue?: boolean;
  maxMemoryPolicy?: string;
  tls?: {
    rejectUnauthorized?: boolean;
  };
}

// Connection pool configuration
export interface RedisPoolConfig {
  min: number;
  max: number;
  acquireTimeoutMillis: number;
  idleTimeoutMillis: number;
  createTimeoutMillis: number;
  destroyTimeoutMillis: number;
  reapIntervalMillis: number;
  createRetryIntervalMillis: number;
}

// Session data structure for Telegram users
export interface UserSession {
  telegramUserId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  isActive: boolean;
  lastActivity: number;
  createdAt: number;
  preferences: {
    notifications: {
      positions: boolean;
      transactions: boolean;
      resolutions: boolean;
      priceAlerts: boolean;
      marketUpdates: boolean;
    };
    thresholds: {
      minPositionSize: number;
      maxPositionSize: number;
      priceChangePercent: number;
    };
    wallets: string[];
  };
  metadata: Record<string, any>;
}

// Cache entry structure
export interface CacheEntry<T = any> {
  key: string;
  value: T;
  ttl: number;
  createdAt: number;
  expiresAt: number;
  tags?: string[];
  version?: number;
}

// Cache options
export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tags?: string[]; // Tags for cache invalidation
  version?: number; // Version for cache busting
  compress?: boolean; // Enable compression for large values
  serialize?: boolean; // Enable JSON serialization
  priority?: 'low' | 'normal' | 'high'; // Cache priority
}

// Rate limit configuration
export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (identifier: string) => string; // Custom key generator
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

// Rate limit result
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  totalHits: number;
  retryAfter?: number;
}

// Pub/Sub message structure
export interface PubSubMessage {
  channel: string;
  data: any;
  timestamp: number;
  messageId?: string;
  source?: string;
  metadata?: Record<string, any>;
}

// Pub/Sub subscription options
export interface PubSubSubscription {
  channel: string;
  pattern?: string; // For pattern-based subscriptions
  callback: (message: PubSubMessage) => void | Promise<void>;
  active: boolean;
  subscribedAt: number;
  lastMessageAt?: number;
  messageCount: number;
}

// Health check status
export interface RedisHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  connected: boolean;
  responseTime: number; // Response time in milliseconds
  memoryUsage: number; // Memory usage in bytes
  keyCount: number; // Total number of keys
  uptime: number; // Server uptime in seconds
  version: string; // Redis version
  errorCount: number;
  lastError?: string;
  timestamp: number;
}

// Performance metrics
export interface RedisMetrics {
  operations: {
    get: number;
    set: number;
    del: number;
    hget: number;
    hset: number;
    pub: number;
    sub: number;
    expire: number;
  };
  performance: {
    avgResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
    totalOperations: number;
    errorRate: number;
  };
  memory: {
    used: number;
    peak: number;
    limit: number;
    utilizationPercent: number;
  };
  connections: {
    active: number;
    idle: number;
    total: number;
  };
}

// Connection status
export type RedisConnectionStatus = 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'reconnecting' | 'error';

// Error types specific to Redis operations
export enum RedisErrorType {
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  MEMORY_ERROR = 'MEMORY_ERROR',
  KEY_ERROR = 'KEY_ERROR',
  SERIALIZE_ERROR = 'SERIALIZE_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  SESSION_ERROR = 'SESSION_ERROR',
  CACHE_ERROR = 'CACHE_ERROR',
  PUBSUB_ERROR = 'PUBSUB_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

// Event types for Redis client
export enum RedisEventType {
  CONNECT = 'connect',
  READY = 'ready',
  ERROR = 'error',
  CLOSE = 'close',
  RECONNECTING = 'reconnecting',
  END = 'end',
  SCAN = 'scan',
  STREAM = 'stream',
}

// Configuration for session storage
export interface SessionConfig {
  keyPrefix: string;
  defaultTtl: number; // Default TTL in seconds
  maxSessions: number; // Maximum concurrent sessions
  cleanupInterval: number; // Cleanup interval in milliseconds
  compression: boolean; // Enable session compression
  encryption: boolean; // Enable session encryption
}

// Configuration for caching
export interface CacheConfig {
  defaultTtl: number; // Default TTL in seconds
  maxSize: number; // Maximum cache size in bytes
  evictionPolicy: string; // Redis eviction policy
  compressionThreshold: number; // Size threshold for compression
  enableMetrics: boolean; // Enable cache metrics
  invalidationStrategy: 'time' | 'version' | 'tag' | 'manual';
}

// Polymarket specific data structures
export interface PolymarketCacheData {
  markets: any[];
  prices: Record<string, number>;
  volumes: Record<string, number>;
  liquidity: Record<string, number>;
  lastUpdate: number;
  source: 'api' | 'websocket' | 'hybrid';
}

export interface WalletActivityData {
  wallet: string;
  activities: any[];
  lastActivity: number;
  totalVolume: number;
  winRate: number;
  activeMarkets: string[];
}

// Index signatures for dynamic Redis data
export interface RedisHashData extends Record<string, string | number | boolean> {}
export interface RedisSetData extends Set<string> {}
export interface RedisListData extends Array<string | number> {}
export interface RedisStreamData extends Record<string, any> {}

// Utility types for Redis operations
export type RedisKey = string;
export type RedisValue = string | number | Buffer | any;
export type RedisField = string;
export type RedisScore = number;
export type RedisChannel = string;
export type RedisPattern = string;

// Response types for Redis operations
export type RedisResult<T = any> = Promise<{
  success: boolean;
  data?: T;
  error?: string;
  metrics?: {
    operationTime: number;
    operation: string;
    key?: string;
  };
}>;

// Batch operation types
export interface BatchOperation {
  type: 'get' | 'set' | 'del' | 'expire' | 'hget' | 'hset' | 'publish';
  key: string;
  value?: any;
  field?: string;
  ttl?: number;
  channel?: string;
}

export interface BatchResult {
  successful: number;
  failed: number;
  results: Array<{
    operation: BatchOperation;
    success: boolean;
    error?: string;
  }>;
  totalTime: number;
}