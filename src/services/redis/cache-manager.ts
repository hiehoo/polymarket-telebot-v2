/**
 * Cache Manager for API Responses
 * Provides intelligent caching layer for Polymarket API responses and computational results
 */

import { redisClient } from './redis-client';
import { logger } from '@/utils/logger';
import { AppError, ErrorType } from '@/utils/error-handler';
import { cacheConfig, redisKeys, ttl } from '@/config/redis';
import type {
  CacheEntry,
  CacheOptions,
  CacheConfig,
  RedisResult,
  PolymarketCacheData,
  WalletActivityData,
} from '@/types/redis';

export class CacheManager {
  private metricsEnabled: boolean;
  private compressionEnabled: boolean;
  private metrics = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    invalidations: 0,
    errors: 0,
    totalOperations: 0,
  };

  constructor() {
    this.metricsEnabled = cacheConfig.enableMetrics;
    this.compressionEnabled = cacheConfig.compressionThreshold > 0;
  }

  /**
   * Get cached data
   */
  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now();

    try {
      const cacheKey = redisKeys.cache(key);
      const cachedData = await redisClient.get(cacheKey);

      if (!cachedData) {
        this.updateMetrics('miss');
        logger.debug('Cache miss', { key, operationTime: Date.now() - startTime });
        return null;
      }

      const cacheEntry: CacheEntry<T> = await this.deserializeEntry(cachedData);

      // Check if entry is expired
      if (Date.now() > cacheEntry.expiresAt) {
        await this.delete(key);
        this.updateMetrics('miss');
        logger.debug('Cache miss (expired)', {
          key,
          expiredAt: new Date(cacheEntry.expiresAt).toISOString(),
          operationTime: Date.now() - startTime,
        });
        return null;
      }

      // Check version if specified
      if (cacheEntry.version && await this.isVersionStale(key, cacheEntry.version)) {
        await this.delete(key);
        this.updateMetrics('miss');
        logger.debug('Cache miss (stale version)', { key, version: cacheEntry.version });
        return null;
      }

      this.updateMetrics('hit');
      logger.debug('Cache hit', {
        key,
        ttl: cacheEntry.ttl,
        version: cacheEntry.version,
        operationTime: Date.now() - startTime,
      });

      return cacheEntry.value;

    } catch (error) {
      this.updateMetrics('error');
      logger.error('Cache get failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
        operationTime: Date.now() - startTime,
      });
      return null;
    }
  }

  /**
   * Set cached data
   */
  async set<T>(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<boolean> {
    const startTime = Date.now();

    try {
      const finalTtl = options.ttl || cacheConfig.defaultTtl;
      const now = Date.now();

      const cacheEntry: CacheEntry<T> = {
        key,
        value,
        ttl: finalTtl,
        createdAt: now,
        expiresAt: now + (finalTtl * 1000),
        tags: options.tags || [],
        version: options.version,
      };

      const serializedEntry = await this.serializeEntry(cacheEntry, options);
      const cacheKey = redisKeys.cache(key);

      await redisClient.set(cacheKey, serializedEntry, finalTtl);

      // Store version if specified
      if (options.version) {
        await this.setVersion(key, options.version);
      }

      // Store tags for invalidation
      if (options.tags && options.tags.length > 0) {
        await this.addTags(key, options.tags);
      }

      this.updateMetrics('set');
      logger.debug('Cache set', {
        key,
        ttl: finalTtl,
        tags: options.tags,
        version: options.version,
        size: serializedEntry.length,
        operationTime: Date.now() - startTime,
      });

      return true;

    } catch (error) {
      this.updateMetrics('error');
      logger.error('Cache set failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
        operationTime: Date.now() - startTime,
      });
      return false;
    }
  }

  /**
   * Delete cached data
   */
  async delete(key: string): Promise<boolean> {
    const startTime = Date.now();

    try {
      const cacheKey = redisKeys.cache(key);

      // Get tags for cleanup
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        const cacheEntry: CacheEntry = await this.deserializeEntry(cachedData);
        if (cacheEntry.tags) {
          await this.removeTags(key, cacheEntry.tags);
        }
      }

      const result = await redisClient.del(cacheKey);
      const deleted = result > 0;

      if (deleted) {
        this.updateMetrics('delete');
        logger.debug('Cache delete', {
          key,
          operationTime: Date.now() - startTime,
        });
      }

      return deleted;

    } catch (error) {
      this.updateMetrics('error');
      logger.error('Cache delete failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
        operationTime: Date.now() - startTime,
      });
      return false;
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    try {
      const cacheKey = redisKeys.cache(key);
      const exists = await redisClient.exists(cacheKey);
      return exists > 0;
    } catch (error) {
      logger.error('Cache exists check failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Get or set pattern - returns cached value or sets new one
   */
  async getOrSet<T>(
    key: string,
    valueProvider: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T | null> {
    try {
      // Try to get from cache first
      const cached = await this.get<T>(key);
      if (cached !== null) {
        return cached;
      }

      // Get fresh value
      const value = await valueProvider();
      if (value === null || value === undefined) {
        return null;
      }

      // Cache the value
      await this.set(key, value, options);
      return value;

    } catch (error) {
      logger.error('Get or set operation failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    const startTime = Date.now();
    let invalidatedCount = 0;

    try {
      for (const tag of tags) {
        const tagKey = redisKeys.cacheTag(tag);
        const keys = await redisClient.smembers(tagKey);

        if (keys.length > 0) {
          await redisClient.del(tagKey);
          await redisClient.del(...keys.map(k => redisKeys.cache(k)));
          invalidatedCount += keys.length;
        }
      }

      this.updateMetrics('invalidate');
      logger.info('Cache invalidated by tags', {
        tags,
        invalidatedCount,
        operationTime: Date.now() - startTime,
      });

      return invalidatedCount;

    } catch (error) {
      this.updateMetrics('error');
      logger.error('Cache invalidation failed', {
        tags,
        error: error instanceof Error ? error.message : 'Unknown error',
        operationTime: Date.now() - startTime,
      });
      return 0;
    }
  }

  /**
   * Invalidate cache by pattern
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    const startTime = Date.now();
    let invalidatedCount = 0;

    try {
      const cachePattern = redisKeys.cache(pattern);
      const scanResult = await redisClient.scan('0', 'MATCH', cachePattern, 'COUNT', 1000);
      const keys = scanResult[1];

      if (keys.length > 0) {
        const result = await redisClient.del(...keys);
        invalidatedCount = result;
      }

      this.updateMetrics('invalidate');
      logger.info('Cache invalidated by pattern', {
        pattern,
        invalidatedCount,
        operationTime: Date.now() - startTime,
      });

      return invalidatedCount;

    } catch (error) {
      this.updateMetrics('error');
      logger.error('Cache pattern invalidation failed', {
        pattern,
        error: error instanceof Error ? error.message : 'Unknown error',
        operationTime: Date.now() - startTime,
      });
      return 0;
    }
  }

  /**
   * Polymarket specific cache methods
   */
  async cachePolymarketMarkets(markets: any[], source: 'api' | 'websocket' | 'hybrid' = 'api'): Promise<boolean> {
    return this.set(
      redisKeys.polymarket.markets,
      { markets, lastUpdate: Date.now(), source },
      {
        ttl: ttl.polymarket.markets,
        tags: ['polymarket', 'markets'],
        priority: 'high',
      }
    );
  }

  async getPolymarketMarkets(): Promise<PolymarketCacheData | null> {
    return this.get<PolymarketCacheData>(redisKeys.polymarket.markets);
  }

  async cacheMarketPrices(prices: Record<string, number>): Promise<boolean> {
    return this.set(
      redisKeys.polymarket.prices,
      prices,
      {
        ttl: ttl.polymarket.prices,
        tags: ['polymarket', 'prices'],
        priority: 'high',
      }
    );
  }

  async getMarketPrices(): Promise<Record<string, number> | null> {
    return this.get<Record<string, number>>(redisKeys.polymarket.prices);
  }

  async cacheMarketPrice(marketId: string, price: number): Promise<boolean> {
    return this.set(
      redisKeys.polymarket.price(marketId),
      price,
      {
        ttl: ttl.polymarket.prices,
        tags: ['polymarket', 'prices', `market:${marketId}`],
        priority: 'high',
      }
    );
  }

  async getMarketPrice(marketId: string): Promise<number | null> {
    return this.get<number>(redisKeys.polymarket.price(marketId));
  }

  async cacheMarketVolumes(volumes: Record<string, number>): Promise<boolean> {
    return this.set(
      redisKeys.polymarket.volumes,
      volumes,
      {
        ttl: ttl.polymarket.volumes,
        tags: ['polymarket', 'volumes'],
      }
    );
  }

  async getMarketVolumes(): Promise<Record<string, number> | null> {
    return this.get<Record<string, number>>(redisKeys.polymarket.volumes);
  }

  async cacheMarketLiquidity(liquidity: Record<string, number>): Promise<boolean> {
    return this.set(
      redisKeys.polymarket.liquidity,
      liquidity,
      {
        ttl: ttl.polymarket.liquidity,
        tags: ['polymarket', 'liquidity'],
        priority: 'high',
      }
    );
  }

  async getMarketLiquidity(): Promise<Record<string, number> | null> {
    return this.get<Record<string, number>>(redisKeys.polymarket.liquidity);
  }

  /**
   * Wallet activity caching
   */
  async cacheWalletActivity(walletAddress: string, activity: WalletActivityData): Promise<boolean> {
    return this.set(
      redisKeys.wallet.activity(walletAddress),
      activity,
      {
        ttl: ttl.cache.medium,
        tags: ['wallet', 'activity', `wallet:${walletAddress}`],
      }
    );
  }

  async getWalletActivity(walletAddress: string): Promise<WalletActivityData | null> {
    return this.get<WalletActivityData>(redisKeys.wallet.activity(walletAddress));
  }

  async cacheWalletProfile(walletAddress: string, profile: any): Promise<boolean> {
    return this.set(
      redisKeys.wallet.profile(walletAddress),
      profile,
      {
        ttl: ttl.cache.long,
        tags: ['wallet', 'profile', `wallet:${walletAddress}`],
      }
    );
  }

  async getWalletProfile(walletAddress: string): Promise<any | null> {
    return this.get(redisKeys.wallet.profile(walletAddress));
  }

  /**
   * Rate limiting cache
   */
  async checkRateLimit(identifier: string, window: number, limit: number): Promise<boolean> {
    const rateLimitKey = redisKeys.rateLimit(identifier, window);

    try {
      const current = await redisClient.incr(rateLimitKey);

      if (current === 1) {
        // Set expiration for the window
        await redisClient.expire(rateLimitKey, Math.ceil(window / 1000));
      }

      return current <= limit;

    } catch (error) {
      logger.error('Rate limit check failed', {
        identifier,
        window,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Allow request if rate limiting fails
      return true;
    }
  }

  /**
   * Cache warming and preloading
   */
  async warmCache(keys: Array<{ key: string; valueProvider: () => Promise<any>; options?: CacheOptions }>): Promise<number> {
    let warmedCount = 0;
    const startTime = Date.now();

    try {
      const promises = keys.map(async ({ key, valueProvider, options }) => {
        try {
          const exists = await this.exists(key);
          if (!exists) {
            const value = await valueProvider();
            if (value !== null && value !== undefined) {
              await this.set(key, value, options);
              return true;
            }
          }
          return false;
        } catch (error) {
          logger.warn('Cache warming failed for key', {
            key,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return false;
        }
      });

      const results = await Promise.all(promises);
      warmedCount = results.filter(Boolean).length;

      logger.info('Cache warming completed', {
        totalKeys: keys.length,
        warmedCount,
        operationTime: Date.now() - startTime,
      });

    } catch (error) {
      logger.error('Cache warming failed', {
        totalKeys: keys.length,
        error: error instanceof Error ? error.message : 'Unknown error',
        operationTime: Date.now() - startTime,
      });
    }

    return warmedCount;
  }

  /**
   * Cache statistics and monitoring
   */
  getMetrics(): {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
    invalidations: number;
    errors: number;
    totalOperations: number;
    hitRate: number;
  } {
    const total = this.metrics.totalOperations;
    return {
      ...this.metrics,
      hitRate: total > 0 ? (this.metrics.hits / total) * 100 : 0,
    };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      invalidations: 0,
      errors: 0,
      totalOperations: 0,
    };
  }

  async getCacheSize(): Promise<number> {
    try {
      const pattern = redisKeys.cache('*');
      const scanResult = await redisClient.scan('0', 'MATCH', pattern, 'COUNT', 1000);
      return scanResult[1].length;
    } catch (error) {
      logger.error('Failed to get cache size', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  /**
   * Private helper methods
   */
  private async serializeEntry<T>(entry: CacheEntry<T>, options: CacheOptions): Promise<string> {
    let serialized = JSON.stringify(entry);

    // Compression for large entries
    if (this.compressionEnabled && serialized.length > cacheConfig.compressionThreshold) {
      // TODO: Implement compression (e.g., gzip)
      logger.debug('Compression threshold reached, but compression not implemented yet', {
        key: entry.key,
        size: serialized.length,
        threshold: cacheConfig.compressionThreshold,
      });
    }

    return serialized;
  }

  private async deserializeEntry<T>(serialized: string): Promise<CacheEntry<T>> {
    try {
      return JSON.parse(serialized) as CacheEntry<T>;
    } catch (error) {
      throw new AppError('Invalid cache entry format', ErrorType.DATABASE);
    }
  }

  private async setVersion(key: string, version: number): Promise<void> {
    try {
      const versionKey = redisKeys.cacheVersion(key);
      await redisClient.set(versionKey, version.toString(), cacheConfig.defaultTtl);
    } catch (error) {
      logger.warn('Failed to set version', {
        key,
        version,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async isVersionStale(key: string, currentVersion: number): Promise<boolean> {
    try {
      const versionKey = redisKeys.cacheVersion(key);
      const storedVersion = await redisClient.get(versionKey);

      if (!storedVersion) {
        return false;
      }

      return parseInt(storedVersion, 10) !== currentVersion;
    } catch (error) {
      logger.warn('Failed to check version staleness', {
        key,
        currentVersion,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  private async addTags(key: string, tags: string[]): Promise<void> {
    try {
      for (const tag of tags) {
        const tagKey = redisKeys.cacheTag(tag);
        await redisClient.sadd(tagKey, key);
      }
    } catch (error) {
      logger.warn('Failed to add tags', {
        key,
        tags,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async removeTags(key: string, tags: string[]): Promise<void> {
    try {
      for (const tag of tags) {
        const tagKey = redisKeys.cacheTag(tag);
        await redisClient.srem(tagKey, key);
      }
    } catch (error) {
      logger.warn('Failed to remove tags', {
        key,
        tags,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private updateMetrics(operation: 'hit' | 'miss' | 'set' | 'delete' | 'invalidate' | 'error'): void {
    if (!this.metricsEnabled) {
      return;
    }

    switch (operation) {
      case 'hit':
        this.metrics.hits++;
        break;
      case 'miss':
        this.metrics.misses++;
        break;
      case 'set':
        this.metrics.sets++;
        break;
      case 'delete':
        this.metrics.deletes++;
        break;
      case 'invalidate':
        this.metrics.invalidations++;
        break;
      case 'error':
        this.metrics.errors++;
        break;
    }

    this.metrics.totalOperations++;
  }
}

// Create and export singleton instance
export const cacheManager = new CacheManager();

// Export types and utilities
export { CacheManager };
export { CacheManager as RedisCacheManager };