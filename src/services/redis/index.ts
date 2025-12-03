/**
 * Redis Services Entry Point
 * Main entry point for all Redis-related services and utilities
 */

import { simpleRedisClient } from './simple-redis-client';
// import { redisClient } from './redis-client';
// import { sessionManager } from './session-manager';
// import { cacheManager } from './cache-manager';
// import { pubSubClient } from './pub-sub-client';
import { runRedisIntegrationTests } from './test-integration';
import { logger } from '@/utils/logger';
import { AppError, ErrorType } from '@/utils/error-handler';

// Export all main services
export {
  simpleRedisClient,
  // redisClient,
  // sessionManager,
  // cacheManager,
  // pubSubClient,
};

// Export classes for direct use
export {
  SimpleRedisClient,
} from './simple-redis-client';
/*
export {
  RedisClient,
} from './redis-client';

export {
  SessionManager,
} from './session-manager';

export {
  CacheManager,
  CacheManager as RedisCacheManager,
} from './cache-manager';

export {
  PubSubClient,
} from './pub-sub-client';
*/

// Export testing utilities
export {
  runRedisIntegrationTests,
  RedisIntegrationTester,
} from './test-integration';

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
  sessionManager: {
    initialized: boolean;
  };
  cacheManager: {
    initialized: boolean;
  };
  pubSubClient: {
    initialized: boolean;
  };
} {
  return {
    client: {
      connected: simpleRedisClient.isClientConnected(),
    },
    sessionManager: {
      initialized: false, // Commented out for now
    },
    cacheManager: {
      initialized: false, // Commented out for now
    },
    pubSubClient: {
      initialized: false, // Commented out for now
    },
  };
}

/**
 * Health check for all Redis services
 */
export async function checkRedisServicesHealth(): Promise<{
  overall: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    client: boolean;
    sessionManager: boolean;
    cacheManager: boolean;
    pubSubClient: boolean;
  };
  details: Record<string, any>;
}> {
  try {
    const results = {
      client: false,
      sessionManager: false,
      cacheManager: false,
      pubSubClient: false,
    };

    const details: Record<string, any> = {};

    // Check Redis client
    try {
      const health = await redisClient.getHealthStatus();
      results.client = health.status === 'healthy';
      details.client = health;
    } catch (error) {
      details.client = { error: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Check session manager
    try {
      // Session manager is healthy if we can perform basic operations
      const stats = await sessionManager.getSessionStats();
      results.sessionManager = true;
      details.sessionManager = stats;
    } catch (error) {
      details.sessionManager = { error: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Check cache manager
    try {
      const metrics = cacheManager.getMetrics();
      results.cacheManager = true;
      details.cacheManager = metrics;
    } catch (error) {
      details.cacheManager = { error: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Check pub/sub client
    try {
      const status = pubSubClient.getStatus();
      results.pubSubClient = status.connected;
      details.pubSubClient = status;
    } catch (error) {
      details.pubSubClient = { error: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Determine overall health
    const healthyCount = Object.values(results).filter(Boolean).length;
    let overall: 'healthy' | 'degraded' | 'unhealthy';

    if (healthyCount === 4) {
      overall = 'healthy';
    } else if (healthyCount >= 2) {
      overall = 'degraded';
    } else {
      overall = 'unhealthy';
    }

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
        sessionManager: false,
        cacheManager: false,
        pubSubClient: false,
      },
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down Redis services');
  try {
    await shutdownRedisServices();
    process.exit(0);
  } catch (error) {
    logger.error('Error during SIGTERM shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down Redis services');
  try {
    await shutdownRedisServices();
    process.exit(0);
  } catch (error) {
    logger.error('Error during SIGINT shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
});

// Handle nodemon restarts
process.on('SIGUSR2', async () => {
  logger.info('SIGUSR2 received, shutting down Redis services for restart');
  try {
    await shutdownRedisServices();
    process.kill(process.pid, 'SIGUSR2'); // Re-emit signal for nodemon
  } catch (error) {
    logger.error('Error during SIGUSR2 shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
});

// Export convenience function for quick testing
export async function testRedisServices(): Promise<{
  success: boolean;
  report: string;
  health: any;
}> {
  try {
    // Run integration tests
    const testResult = await runRedisIntegrationTests();

    // Check health
    const health = await checkRedisServicesHealth();

    return {
      success: testResult.success && health.overall !== 'unhealthy',
      report: testResult.report,
      health,
    };

  } catch (error) {
    logger.error('Redis services test failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      report: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      health: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}

// Default export
export default {
  initialize: initializeRedisServices,
  shutdown: shutdownRedisServices,
  getStatus: getRedisServiceStatus,
  checkHealth: checkRedisServicesHealth,
  test: testRedisServices,
  redisClient,
  sessionManager,
  cacheManager,
  pubSubClient,
};