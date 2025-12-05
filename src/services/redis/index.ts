/**
 * Redis Services Entry Point
 * Main entry point for all Redis-related services and utilities
 */

import { simpleRedisClient } from './simple-redis-client';
import { logger } from '@/utils/logger';
import { AppError, ErrorType } from '@/utils/error-handler';

// Export all main services
export {
  simpleRedisClient,
};

// Export classes for direct use
export {
  SimpleRedisClient,
} from './simple-redis-client';

// Export types
export type {
  RedisConfig,
  RedisPoolConfig,
  SessionConfig,
  CacheConfig,
  RateLimitConfig,
  UserSession,
  CacheEntry,
  CacheOptions,
  PubSubMessage,
  PubSubSubscription,
  RedisConnectionStatus,
  RedisHealthStatus,
  RedisMetrics,
  PolymarketCacheData,
  WalletActivityData,
} from '@/types/redis';

/**
 * Initialize all Redis services
 */
export async function initializeRedisServices(): Promise<void> {
  try {
    logger.info('Initializing Redis services...');

    // Initialize simple Redis client
    await simpleRedisClient.connect();

    logger.info('Redis services initialized successfully', {
      clientConnected: simpleRedisClient.isClientConnected(),
    });

  } catch (error) {
    logger.error('Failed to initialize Redis services', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw new AppError(
      `Redis services initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ErrorType.DATABASE,
      500
    );
  }
}

/**
 * Shutdown all Redis services
 */
export async function shutdownRedisServices(): Promise<void> {
  try {
    logger.info('Shutting down Redis services...');

    // Shutdown simple Redis client
    await simpleRedisClient.disconnect();

    logger.info('Redis services shutdown successfully');

  } catch (error) {
    logger.error('Error during Redis services shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Get Redis service status
 */
export function getRedisServiceStatus(): {
  client: {
    connected: boolean;
  };
} {
  return {
    client: {
      connected: simpleRedisClient.isClientConnected(),
    },
  };
}

/**
 * Health check for Redis services
 */
export async function checkRedisServicesHealth(): Promise<{
  overall: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    client: boolean;
  };
  details: Record<string, any>;
}> {
  try {
    const results = {
      client: false,
    };

    const details: Record<string, any> = {};

    // Check simple Redis client
    try {
      results.client = simpleRedisClient.isClientConnected();
      details.client = { connected: results.client };
    } catch (error) {
      details.client = { error: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Determine overall health
    const overall: 'healthy' | 'degraded' | 'unhealthy' = results.client ? 'healthy' : 'unhealthy';

    return {
      overall,
      services: results,
      details,
    };

  } catch (error) {
    logger.error('Redis services health check failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      overall: 'unhealthy',
      services: {
        client: false,
      },
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

// Default export
export default {
  initialize: initializeRedisServices,
  shutdown: shutdownRedisServices,
  getStatus: getRedisServiceStatus,
  checkHealth: checkRedisServicesHealth,
  simpleRedisClient,
};
