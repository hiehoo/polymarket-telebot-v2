import { Context, MiddlewareFn } from 'telegraf';
import { redisClient } from '../../services/redis/redis-client';
import { logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface RateLimitContext extends Context {
  rateLimit?: {
    remaining: number;
    resetTime: number;
  };
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (ctx: Context) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 requests per minute
  skipSuccessfulRequests: false,
  skipFailedRequests: false
};

export const createRateLimitMiddleware = (config: Partial<RateLimitConfig> = {}) => {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  return async (ctx: RateLimitContext, next: () => Promise<void>) => {
    try {
      if (!ctx.from) {
        return next();
      }

      const key = finalConfig.keyGenerator
        ? finalConfig.keyGenerator(ctx)
        : `rate_limit:${ctx.from.id}`;

      const currentTime = Date.now();
      const windowStart = currentTime - finalConfig.windowMs;

      // Redis pipeline operations are atomic - all commands execute together
      // This prevents race conditions for rate limit checking
      const pipeline = redisClient.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      pipeline.expire(key, Math.ceil(finalConfig.windowMs / 1000));

      const results = await pipeline.exec();
      const currentCount = results?.[1]?.[1] as number || 0;

      if (currentCount >= finalConfig.maxRequests) {
        const ttl = await redisClient.ttl(key);
        ctx.rateLimit = {
          remaining: 0,
          resetTime: Date.now() + (ttl * 1000)
        };

        logger.warn(`Rate limit exceeded for user ${ctx.from.id}`);
        await ctx.reply(
          '⚠️ Too many requests. Please wait a moment before trying again.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      await redisClient.zadd(key, currentTime, `${currentTime}-${Math.random()}`);

      ctx.rateLimit = {
        remaining: Math.max(0, finalConfig.maxRequests - currentCount - 1),
        resetTime: currentTime + finalConfig.windowMs
      };

      await next();
    } catch (error) {
      logger.error('Rate limit middleware error:', error);
      await next();
    }
  };
};

export const rateLimitMiddleware = createRateLimitMiddleware();

export const strictRateLimitMiddleware = createRateLimitMiddleware({
  windowMs: 60 * 1000,
  maxRequests: 10
});

export const apiRateLimitMiddleware = createRateLimitMiddleware({
  windowMs: 60 * 1000,
  maxRequests: 100
});