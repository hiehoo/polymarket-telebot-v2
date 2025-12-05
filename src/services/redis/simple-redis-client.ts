/**
 * Simple Redis Client Implementation
 * Minimal Redis client focused on core functionality without complex type issues
 */

import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { logger } from '@/utils/logger';
import { AppError, ErrorType } from '@/utils/error-handler';
import { redisConfig } from '@/config/redis';

export class SimpleRedisClient extends EventEmitter {
  private client: Redis | null = null;
  private isConnected = false;

  async connect(): Promise<void> {
    try {
      logger.info('Connecting to Redis...', {
        url: redisConfig.url?.replace(/\/\/.*@/, '//***@'),
      });

      if (redisConfig.url) {
        this.client = new Redis(redisConfig.url);
      } else {
        this.client = new Redis({
          host: 'localhost',
          port: 6379,
        });
      }

      this.client.on('connect', () => {
        logger.info('Redis connected');
        this.isConnected = true;
        this.emit('connected');
      });

      this.client.on('error', (error) => {
        logger.error('Redis error', { error: error.message });
        this.isConnected = false;
        this.emit('error', error);
      });

      this.client.on('close', () => {
        logger.info('Redis connection closed');
        this.isConnected = false;
        this.emit('disconnected');
      });

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        if (!this.client) {
          reject(new Error('Redis client not initialized'));
          return;
        }

        const timeout = setTimeout(() => {
          reject(new Error('Redis connection timeout'));
        }, 10000);

        this.client.once('connect', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.client.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

    } catch (error) {
      logger.error('Failed to connect to Redis', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new AppError(
        `Redis connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorType.DATABASE,
        500
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
      this.isConnected = false;
      logger.info('Redis disconnected');
    }
  }

  private getClient(): Redis {
    if (!this.client || !this.isConnected) {
      throw new AppError('Redis not connected', ErrorType.DATABASE, 503);
    }
    return this.client;
  }

  // Basic operations
  async get(key: string): Promise<string | null> {
    try {
      return await this.getClient().get(key);
    } catch (error) {
      logger.error('Redis GET failed', { key, error });
      throw error;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<string> {
    try {
      const client = this.getClient();
      if (ttl) {
        return await client.setex(key, ttl, JSON.stringify(value));
      }
      return await client.set(key, JSON.stringify(value));
    } catch (error) {
      logger.error('Redis SET failed', { key, error });
      throw error;
    }
  }

  async del(key: string | string[]): Promise<number> {
    try {
      const keys = Array.isArray(key) ? key : [key];
      return await this.getClient().del(...keys);
    } catch (error) {
      logger.error('Redis DEL failed', { key, error });
      throw error;
    }
  }

  async exists(key: string): Promise<number> {
    try {
      return await this.getClient().exists(key);
    } catch (error) {
      logger.error('Redis EXISTS failed', { key, error });
      throw error;
    }
  }

  async expire(key: string, seconds: number): Promise<number> {
    try {
      return await this.getClient().expire(key, seconds);
    } catch (error) {
      logger.error('Redis EXPIRE failed', { key, error });
      throw error;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.getClient().ttl(key);
    } catch (error) {
      logger.error('Redis TTL failed', { key, error });
      throw error;
    }
  }

  // Hash operations
  async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.getClient().hget(key, field);
    } catch (error) {
      logger.error('Redis HGET failed', { key, field, error });
      throw error;
    }
  }

  async hset(key: string, field: string, value: any): Promise<number> {
    try {
      return await this.getClient().hset(key, field, JSON.stringify(value));
    } catch (error) {
      logger.error('Redis HSET failed', { key, field, error });
      throw error;
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.getClient().hgetall(key);
    } catch (error) {
      logger.error('Redis HGETALL failed', { key, error });
      throw error;
    }
  }

  async hdel(key: string, field: string | string[]): Promise<number> {
    try {
      const fields = Array.isArray(field) ? field : [field];
      return await this.getClient().hdel(key, ...fields);
    } catch (error) {
      logger.error('Redis HDEL failed', { key, field, error });
      throw error;
    }
  }

  // Set operations
  async sadd(key: string, member: string | string[]): Promise<number> {
    try {
      const members = Array.isArray(member) ? member : [member];
      return await this.getClient().sadd(key, ...members);
    } catch (error) {
      logger.error('Redis SADD failed', { key, member, error });
      throw error;
    }
  }

  async srem(key: string, member: string | string[]): Promise<number> {
    try {
      const members = Array.isArray(member) ? member : [member];
      return await this.getClient().srem(key, ...members);
    } catch (error) {
      logger.error('Redis SREM failed', { key, member, error });
      throw error;
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      return await this.getClient().smembers(key);
    } catch (error) {
      logger.error('Redis SMEMBERS failed', { key, error });
      throw error;
    }
  }

  async sismember(key: string, member: string): Promise<number> {
    try {
      return await this.getClient().sismember(key, member);
    } catch (error) {
      logger.error('Redis SISMEMBER failed', { key, member, error });
      throw error;
    }
  }

  // Sorted set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    try {
      return await this.getClient().zadd(key, score, member);
    } catch (error) {
      logger.error('Redis ZADD failed', { key, score, member, error });
      throw error;
    }
  }

  async zrem(key: string, member: string): Promise<number> {
    try {
      return await this.getClient().zrem(key, member);
    } catch (error) {
      logger.error('Redis ZREM failed', { key, member, error });
      throw error;
    }
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.getClient().zrange(key, start, stop);
    } catch (error) {
      logger.error('Redis ZRANGE failed', { key, start, stop, error });
      throw error;
    }
  }

  async zscore(key: string, member: string): Promise<string | null> {
    try {
      return await this.getClient().zscore(key, member);
    } catch (error) {
      logger.error('Redis ZSCORE failed', { key, member, error });
      throw error;
    }
  }

  // List operations
  async lpush(key: string, element: string | string[]): Promise<number> {
    try {
      const elements = Array.isArray(element) ? element : [element];
      return await this.getClient().lpush(key, ...elements);
    } catch (error) {
      logger.error('Redis LPUSH failed', { key, element, error });
      throw error;
    }
  }

  async rpush(key: string, element: string | string[]): Promise<number> {
    try {
      const elements = Array.isArray(element) ? element : [element];
      return await this.getClient().rpush(key, ...elements);
    } catch (error) {
      logger.error('Redis RPUSH failed', { key, element, error });
      throw error;
    }
  }

  async lpop(key: string): Promise<string | null> {
    try {
      return await this.getClient().lpop(key);
    } catch (error) {
      logger.error('Redis LPOP failed', { key, error });
      throw error;
    }
  }

  async rpop(key: string): Promise<string | null> {
    try {
      return await this.getClient().rpop(key);
    } catch (error) {
      logger.error('Redis RPOP failed', { key, error });
      throw error;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.getClient().lrange(key, start, stop);
    } catch (error) {
      logger.error('Redis LRANGE failed', { key, start, stop, error });
      throw error;
    }
  }

  // Utility operations
  async incr(key: string): Promise<number> {
    try {
      return await this.getClient().incr(key);
    } catch (error) {
      logger.error('Redis INCR failed', { key, error });
      throw error;
    }
  }

  async ping(): Promise<string> {
    try {
      return await this.getClient().ping();
    } catch (error) {
      logger.error('Redis PING failed', { error });
      throw error;
    }
  }

  async info(section?: string): Promise<string> {
    try {
      return await this.getClient().info(section);
    } catch (error) {
      logger.error('Redis INFO failed', { section, error });
      throw error;
    }
  }

  async scan(cursor: string, pattern?: string): Promise<[string, string[]]> {
    try {
      if (pattern) {
        return await this.getClient().scan(cursor, 'MATCH', pattern);
      }
      return await this.getClient().scan(cursor);
    } catch (error) {
      logger.error('Redis SCAN failed', { cursor, pattern, error });
      throw error;
    }
  }

  isClientConnected(): boolean {
    return this.isConnected;
  }

  async flushall(): Promise<string> {
    try {
      return await this.getClient().flushall();
    } catch (error) {
      logger.error('Redis FLUSHALL failed', { error });
      throw error;
    }
  }

  // Pub/Sub operations
  async publish(channel: string, message: string): Promise<number> {
    try {
      return await this.getClient().publish(channel, message);
    } catch (error) {
      logger.error('Redis PUBLISH failed', { channel, error });
      throw error;
    }
  }

  async subscribe(channel: string): Promise<void> {
    try {
      await this.getClient().subscribe(channel);
    } catch (error) {
      logger.error('Redis SUBSCRIBE failed', { channel, error });
      throw error;
    }
  }

  async unsubscribe(channel?: string): Promise<void> {
    try {
      await this.getClient().unsubscribe(channel);
    } catch (error) {
      logger.error('Redis UNSUBSCRIBE failed', { channel, error });
      throw error;
    }
  }
}

// Create and export singleton instance
export const simpleRedisClient = new SimpleRedisClient();