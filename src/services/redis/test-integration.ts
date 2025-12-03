/**
 * Redis Integration Test Suite
 * Comprehensive testing and validation of all Redis components
 */

import { redisClient } from './redis-client';
import { sessionManager } from './session-manager';
import { cacheManager } from './cache-manager';
import { pubSubClient } from './pub-sub-client';
import { logger } from '@/utils/logger';
import { AppError, ErrorType } from '@/utils/error-handler';
import type { UserSession, PolymarketCacheData } from '@/types/redis';

interface TestResult {
  testName: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, any>;
}

interface TestSuite {
  suiteName: string;
  tests: TestResult[];
  totalDuration: number;
  passedTests: number;
  failedTests: number;
}

export class RedisIntegrationTester {
  private results: TestSuite[] = [];

  /**
   * Run complete Redis integration test suite
   */
  async runAllTests(): Promise<{
    overallSuccess: boolean;
    suites: TestSuite[];
    summary: {
      totalTests: number;
      passedTests: number;
      failedTests: number;
      totalDuration: number;
      successRate: number;
    };
  }> {
    logger.info('Starting Redis integration test suite');

    const startTime = Date.now();

    try {
      // Run test suites
      await this.testRedisClient();
      await this.testSessionManager();
      await this.testCacheManager();
      await this.testPubSubClient();
      await this.testCrossComponentIntegration();

      const totalDuration = Date.now() - startTime;
      const summary = this.calculateSummary();

      logger.info('Redis integration test suite completed', {
        totalDuration,
        ...summary,
      });

      return {
        overallSuccess: summary.successRate === 100,
        suites: this.results,
        summary: {
          ...summary,
          totalDuration,
        },
      };

    } catch (error) {
      logger.error('Redis integration test suite failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        totalDuration: Date.now() - startTime,
      });

      throw error;
    }
  }

  /**
   * Test Redis client functionality
   */
  private async testRedisClient(): Promise<void> {
    const suiteName = 'Redis Client';
    const tests: TestResult[] = [];
    const startTime = Date.now();

    logger.info(`Testing ${suiteName}`);

    // Test connection
    tests.push(await this.runTest('Connection', async () => {
      const isConnected = redisClient.isHealthy();
      if (!isConnected) {
        throw new Error('Redis client is not healthy');
      }
      return { connected: true };
    }));

    // Test basic operations
    tests.push(await this.runTest('Basic Operations', async () => {
      const testKey = `test:basic:${Date.now()}`;
      const testValue = 'test-value';

      // Set operation
      await redisClient.set(testKey, testValue, 60);

      // Get operation
      const retrievedValue = await redisClient.get(testKey);

      if (retrievedValue !== testValue) {
        throw new Error(`Expected ${testValue}, got ${retrievedValue}`);
      }

      // Delete operation
      const deleteResult = await redisClient.del(testKey);

      return {
        setGetCorrect: retrievedValue === testValue,
        deleteSuccessful: deleteResult > 0,
      };
    }));

    // Test hash operations
    tests.push(await this.runTest('Hash Operations', async () => {
      const testKey = `test:hash:${Date.now()}`;
      const field = 'testField';
      const value = 'testValue';

      await redisClient.hset(testKey, field, value);
      const retrievedValue = await redisClient.hget(testKey, field);

      const allHash = await redisClient.hgetall(testKey);
      await redisClient.del(testKey);

      return {
        hgetCorrect: retrievedValue === value,
        hgetAllCorrect: allHash[field] === value,
      };
    }));

    // Test set operations
    tests.push(await this.runTest('Set Operations', async () => {
      const testKey = `test:set:${Date.now()}`;
      const member1 = 'member1';
      const member2 = 'member2';

      await redisClient.sadd(testKey, member1, member2);
      const members = await redisClient.smembers(testKey);

      const isMember1 = await redisClient.sismember(testKey, member1);
      const removeResult = await redisClient.srem(testKey, member1);

      await redisClient.del(testKey);

      return {
        saddCorrect: members.includes(member1) && members.includes(member2),
        sismemberCorrect: isMember1 === 1,
        sremCorrect: removeResult > 0,
      };
    }));

    // Test sorted set operations
    tests.push(await this.runTest('Sorted Set Operations', async () => {
      const testKey = `test:zset:${Date.now()}`;
      const member = 'member1';
      const score = 100;

      await redisClient.zadd(testKey, score, member);
      const retrievedScore = await redisClient.zscore(testKey, member);

      const range = await redisClient.zrange(testKey, 0, -1);
      await redisClient.del(testKey);

      return {
        zaddCorrect: retrievedScore === score.toString(),
        zrangeCorrect: range.includes(member),
      };
    }));

    // Test batch operations
    tests.push(await this.runTest('Batch Operations', async () => {
      const testKey1 = `test:batch1:${Date.now()}`;
      const testKey2 = `test:batch2:${Date.now()}`;
      const testValue1 = 'value1';
      const testValue2 = 'value2';

      const batchResult = await redisClient.batch([
        { type: 'set', key: testKey1, value: testValue1 },
        { type: 'set', key: testKey2, value: testValue2 },
        { type: 'get', key: testKey1 },
        { type: 'get', key: testKey2 },
      ]);

      // Cleanup
      await redisClient.del(testKey1, testKey2);

      return {
        batchSuccess: batchResult.successful >= 4,
        batchFailed: batchResult.failed === 0,
      };
    }));

    // Test health monitoring
    tests.push(await this.runTest('Health Monitoring', async () => {
      const healthStatus = await redisClient.getHealthStatus();
      const metrics = redisClient.getMetrics();

      return {
        healthyStatus: healthStatus.status === 'healthy' || healthStatus.status === 'degraded',
        connected: healthStatus.connected,
        hasMetrics: metrics.operations.get >= 0,
      };
    }));

    const totalDuration = Date.now() - startTime;
    const passedTests = tests.filter(t => t.passed).length;
    const failedTests = tests.length - passedTests;

    this.results.push({
      suiteName,
      tests,
      totalDuration,
      passedTests,
      failedTests,
    });

    logger.info(`${suiteName} tests completed`, {
      total: tests.length,
      passed: passedTests,
      failed: failedTests,
      duration: totalDuration,
    });
  }

  /**
   * Test session manager functionality
   */
  private async testSessionManager(): Promise<void> {
    const suiteName = 'Session Manager';
    const tests: TestResult[] = [];
    const startTime = Date.now();

    logger.info(`Testing ${suiteName}`);

    // Initialize session manager
    tests.push(await this.runTest('Initialization', async () => {
      await sessionManager.initialize();
      return { initialized: true };
    }));

    // Test session creation
    const testUserId = 12345;
    tests.push(await this.runTest('Session Creation', async () => {
      const session: UserSession = {
        telegramUserId: testUserId,
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        languageCode: 'en',
        isActive: true,
        lastActivity: Date.now(),
        createdAt: Date.now(),
        preferences: {
          notifications: {
            positions: true,
            transactions: true,
            resolutions: true,
            priceAlerts: true,
            marketUpdates: false,
          },
          thresholds: {
            minPositionSize: 100,
            maxPositionSize: 10000,
            priceChangePercent: 5,
          },
          wallets: [],
        },
        metadata: {},
      };

      await sessionManager.createOrUpdateSession(testUserId, session);
      return { sessionCreated: true };
    }));

    // Test session retrieval
    tests.push(await this.runTest('Session Retrieval', async () => {
      const session = await sessionManager.getSession(testUserId);

      if (!session) {
        throw new Error('Session not found');
      }

      if (session.telegramUserId !== testUserId) {
        throw new Error('Session data mismatch');
      }

      return {
        sessionRetrieved: true,
        correctUserId: session.telegramUserId === testUserId,
        isActive: session.isActive,
      };
    }));

    // Test session updates
    tests.push(await this.runTest('Session Updates', async () => {
      const updates = {
        firstName: 'Updated',
        isActive: false,
      };

      const updateSuccess = await sessionManager.updateSessionFields(testUserId, updates);
      const updatedSession = await sessionManager.getSession(testUserId);

      return {
        updateSuccess,
        firstNameUpdated: updatedSession?.firstName === 'Updated',
        isActiveUpdated: updatedSession?.isActive === false,
      };
    }));

    // Test preference updates
    tests.push(await this.runTest('Preference Updates', async () => {
      const preferences = {
        notifications: {
          positions: false,
          transactions: true,
          resolutions: false,
          priceAlerts: true,
          marketUpdates: true,
        },
        thresholds: {
          minPositionSize: 200,
          maxPositionSize: 20000,
          priceChangePercent: 10,
        },
        wallets: ['0x1234567890123456789012345678901234567890'],
      };

      const updateSuccess = await sessionManager.updatePreferences(testUserId, preferences);
      const session = await sessionManager.getSession(testUserId);

      return {
        updateSuccess,
        notificationsUpdated: session?.preferences.notifications.marketUpdates === true,
        thresholdsUpdated: session?.preferences.thresholds.minPositionSize === 200,
      };
    }));

    // Test wallet tracking
    tests.push(await this.runTest('Wallet Tracking', async () => {
      const walletAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

      const addSuccess = await sessionManager.addTrackedWallet(testUserId, walletAddress);
      const trackedWallets = await sessionManager.getTrackedWallets(testUserId);

      const removeSuccess = await sessionManager.removeTrackedWallet(testUserId, walletAddress);
      const walletsAfterRemoval = await sessionManager.getTrackedWallets(testUserId);

      return {
        addSuccess,
        walletAdded: trackedWallets.includes(walletAddress.toLowerCase()),
        removeSuccess,
        walletRemoved: !walletsAfterRemoval.includes(walletAddress.toLowerCase()),
      };
    }));

    // Test session activation/deactivation
    tests.push(await this.runTest('Session Activation/Deactivation', async () => {
      const deactivateSuccess = await sessionManager.deactivateSession(testUserId);
      const deactivatedSession = await sessionManager.getSession(testUserId);

      const activateSuccess = await sessionManager.activateSession(testUserId);
      const activatedSession = await sessionManager.getSession(testUserId);

      return {
        deactivateSuccess,
        deactivated: deactivatedSession?.isActive === false,
        activateSuccess,
        activated: activatedSession?.isActive === true,
      };
    }));

    // Test session deletion
    tests.push(await this.runTest('Session Deletion', async () => {
      const deleteSuccess = await sessionManager.deleteSession(testUserId);
      const sessionAfterDeletion = await sessionManager.getSession(testUserId);

      return {
        deleteSuccess,
        sessionDeleted: sessionAfterDeletion === null,
      };
    }));

    // Test session statistics
    tests.push(await this.runTest('Session Statistics', async () => {
      const stats = await sessionManager.getSessionStats();

      return {
        statsRetrieved: true,
        hasValidStructure: typeof stats.total === 'number' &&
                         typeof stats.active === 'number' &&
                         typeof stats.inactive === 'number',
      };
    }));

    // Test session cleanup
    tests.push(await this.runTest('Session Cleanup', async () => {
      const cleanedCount = await sessionManager.cleanupExpiredSessions();

      return {
        cleanupCompleted: true,
        cleanedCount,
      };
    }));

    const totalDuration = Date.now() - startTime;
    const passedTests = tests.filter(t => t.passed).length;
    const failedTests = tests.length - passedTests;

    this.results.push({
      suiteName,
      tests,
      totalDuration,
      passedTests,
      failedTests,
    });

    logger.info(`${suiteName} tests completed`, {
      total: tests.length,
      passed: passedTests,
      failed: failedTests,
      duration: totalDuration,
    });
  }

  /**
   * Test cache manager functionality
   */
  private async testCacheManager(): Promise<void> {
    const suiteName = 'Cache Manager';
    const tests: TestResult[] = [];
    const startTime = Date.now();

    logger.info(`Testing ${suiteName}`);

    // Test basic cache operations
    tests.push(await this.runTest('Basic Cache Operations', async () => {
      const testKey = `test:cache:${Date.now()}`;
      const testValue = { data: 'test-data', number: 123 };

      const setSuccess = await cacheManager.set(testKey, testValue, { ttl: 60 });
      const retrievedValue = await cacheManager.get(testKey);
      const exists = await cacheManager.exists(testKey);

      const deleteSuccess = await cacheManager.delete(testKey);
      const existsAfterDeletion = await cacheManager.exists(testKey);

      return {
        setSuccess,
        getCorrect: JSON.stringify(retrievedValue) === JSON.stringify(testValue),
        existsCorrect: exists === true,
        deleteSuccess,
        existsAfterDeletionCorrect: existsAfterDeletion === false,
      };
    }));

    // Test cache with tags
    tests.push(await this.runTest('Cache with Tags', async () => {
      const testKey1 = `test:tagged1:${Date.now()}`;
      const testKey2 = `test:tagged2:${Date.now()}`;
      const testTags = ['test-tag', 'integration-test'];

      await cacheManager.set(testKey1, 'value1', { tags: testTags, ttl: 60 });
      await cacheManager.set(testKey2, 'value2', { tags: testTags, ttl: 60 });

      const invalidatedCount = await cacheManager.invalidateByTags(testTags);

      const value1AfterInvalidation = await cacheManager.get(testKey1);
      const value2AfterInvalidation = await cacheManager.get(testKey2);

      return {
        valuesSetCorrectly: true,
        invalidatedCount,
        bothValuesInvalidated: value1AfterInvalidation === null && value2AfterInvalidation === null,
      };
    }));

    // Test get-or-set pattern
    tests.push(await this.runTest('Get or Set Pattern', async () => {
      const testKey = `test:getorset:${Date.now()}`;
      let callCount = 0;

      const valueProvider = async () => {
        callCount++;
        return `computed-value-${callCount}`;
      };

      const value1 = await cacheManager.getOrSet(testKey, valueProvider, { ttl: 60 });
      const value2 = await cacheManager.getOrSet(testKey, valueProvider, { ttl: 60 });

      await cacheManager.delete(testKey);

      const value3 = await cacheManager.getOrSet(testKey, valueProvider, { ttl: 60 });

      return {
        firstCallCorrect: value1 === 'computed-value-1',
        secondCallCached: value2 === 'computed-value-1' && callCount === 1,
        thirdCallRecomputed: value3 === 'computed-value-2' && callCount === 2,
      };
    }));

    // Test Polymarket caching
    tests.push(await this.runTest('Polymarket Caching', async () => {
      const markets = [
        { id: 'market1', question: 'Will X happen?', outcomes: ['Yes', 'No'] },
        { id: 'market2', question: 'Will Y occur?', outcomes: ['True', 'False'] },
      ];

      const prices = { market1: 0.65, market2: 0.35 };
      const volumes = { market1: 100000, market2: 75000 };

      await cacheManager.cachePolymarketMarkets(markets, 'api');
      await cacheManager.cacheMarketPrices(prices);
      await cacheManager.cacheMarketVolumes(volumes);

      const cachedMarkets = await cacheManager.getPolymarketMarkets();
      const cachedPrices = await cacheManager.getMarketPrices();
      const cachedVolumes = await cacheManager.getMarketVolumes();

      return {
        marketsCached: cachedMarkets !== null && Array.isArray(cachedMarkets.markets) && cachedMarkets.markets.length > 0,
        pricesCached: cachedPrices !== null && cachedPrices.market1 === 0.65,
        volumesCached: cachedVolumes !== null && cachedVolumes.market1 === 100000,
      };
    }));

    // Test wallet activity caching
    tests.push(await this.runTest('Wallet Activity Caching', async () => {
      const walletAddress = '0x1234567890123456789012345678901234567890';
      const walletActivity = {
        wallet: walletAddress,
        activities: [
          { type: 'buy', amount: 100, timestamp: Date.now() },
          { type: 'sell', amount: 50, timestamp: Date.now() - 1000 },
        ],
        lastActivity: Date.now(),
        totalVolume: 150,
        winRate: 0.75,
        activeMarkets: ['market1', 'market2'],
      };

      await cacheManager.cacheWalletActivity(walletAddress, walletActivity);
      const cachedActivity = await cacheManager.getWalletActivity(walletAddress);

      return {
        activityCached: cachedActivity !== null,
        correctWallet: cachedActivity?.wallet === walletAddress,
        correctVolume: cachedActivity?.totalVolume === 150,
      };
    }));

    // Test rate limiting
    tests.push(await this.runTest('Rate Limiting', async () => {
      const identifier = `test-rate-limit-${Date.now()}`;
      const window = 10000; // 10 seconds
      const limit = 3;

      // First 3 requests should be allowed
      const request1 = await cacheManager.checkRateLimit(identifier, window, limit);
      const request2 = await cacheManager.checkRateLimit(identifier, window, limit);
      const request3 = await cacheManager.checkRateLimit(identifier, window, limit);

      // 4th request should be blocked
      const request4 = await cacheManager.checkRateLimit(identifier, window, limit);

      return {
        first3Allowed: request1 && request2 && request3,
        fourthBlocked: !request4,
      };
    }));

    // Test cache warming
    tests.push(await this.runTest('Cache Warming', async () => {
      const warmKeys = [
        {
          key: `test:warm1:${Date.now()}`,
          valueProvider: async () => ({ data: 'warm-value-1' }),
        },
        {
          key: `test:warm2:${Date.now()}`,
          valueProvider: async () => ({ data: 'warm-value-2' }),
        },
      ];

      const warmedCount = await cacheManager.warmCache(warmKeys);

      const value1 = await cacheManager.get(warmKeys[0].key);
      const value2 = await cacheManager.get(warmKeys[1].key);

      return {
        warmedCorrectly: warmedCount === 2,
        valuesAvailable: value1 !== null && value2 !== null,
      };
    }));

    // Test cache invalidation by pattern
    tests.push(await this.runTest('Pattern-based Invalidation', async () => {
      const prefix = `test:pattern:${Date.now()}`;
      const key1 = `${prefix}:1`;
      const key2 = `${prefix}:2`;
      const key3 = `${prefix}:3`;

      await cacheManager.set(key1, 'value1', { ttl: 60 });
      await cacheManager.set(key2, 'value2', { ttl: 60 });
      await cacheManager.set(key3, 'value3', { ttl: 60 });

      const invalidatedCount = await cacheManager.invalidateByPattern(`${prefix}:*`);

      return {
        keysSet: true,
        invalidatedCorrectly: invalidatedCount === 3,
      };
    }));

    // Test cache metrics
    tests.push(await this.runTest('Cache Metrics', async () => {
      const metrics = cacheManager.getMetrics();
      const cacheSize = await cacheManager.getCacheSize();

      return {
        metricsAvailable: typeof metrics.hits === 'number' && typeof metrics.misses === 'number',
        hitRateCalculated: typeof metrics.hitRate === 'number',
        cacheSizeAvailable: typeof cacheSize === 'number',
      };
    }));

    const totalDuration = Date.now() - startTime;
    const passedTests = tests.filter(t => t.passed).length;
    const failedTests = tests.length - passedTests;

    this.results.push({
      suiteName,
      tests,
      totalDuration,
      passedTests,
      failedTests,
    });

    logger.info(`${suiteName} tests completed`, {
      total: tests.length,
      passed: passedTests,
      failed: failedTests,
      duration: totalDuration,
    });
  }

  /**
   * Test pub/sub client functionality
   */
  private async testPubSubClient(): Promise<void> {
    const suiteName = 'Pub/Sub Client';
    const tests: TestResult[] = [];
    const startTime = Date.now();

    logger.info(`Testing ${suiteName}`);

    // Initialize pub/sub client
    tests.push(await this.runTest('Initialization', async () => {
      await pubSubClient.connect();
      const status = pubSubClient.getStatus();

      return {
        connected: status.connected,
        subscriptionsCount: status.subscriptions,
        patternsCount: status.patterns,
      };
    }));

    // Test basic pub/sub
    tests.push(await this.runTest('Basic Pub/Sub', async () => {
      const testChannel = `test:channel:${Date.now()}`;
      const testMessage = { type: 'test', data: 'hello-world' };
      let messageReceived = false;
      let receivedMessage: any = null;

      const messageHandler = (message: any) => {
        messageReceived = true;
        receivedMessage = message;
      };

      await pubSubClient.subscribe(testChannel, messageHandler);

      // Small delay to ensure subscription is active
      await new Promise(resolve => setTimeout(resolve, 100));

      const published = await pubSubClient.publish(testChannel, testMessage);

      // Wait for message to be received
      await new Promise(resolve => setTimeout(resolve, 200));

      await pubSubClient.unsubscribe(testChannel);

      return {
        subscriptionSuccessful: true,
        publishSuccessful: published,
        messageReceived,
        correctMessage: receivedMessage && JSON.stringify(receivedMessage.data) === JSON.stringify(testMessage),
      };
    }));

    // Test pattern-based pub/sub
    tests.push(await this.runTest('Pattern-based Pub/Sub', async () => {
      const testPattern = `test:pattern:${Date.now()}:*`;
      const testChannel = `test:pattern:${Date.now()}:specific`;
      const testMessage = { type: 'pattern-test', data: 'pattern-message' };
      let messageReceived = false;

      const patternHandler = (message: any) => {
        messageReceived = true;
      };

      await pubSubClient.subscribe('', patternHandler, { pattern: testPattern });

      await new Promise(resolve => setTimeout(resolve, 100));

      const published = await pubSubClient.publish(testChannel, testMessage);

      await new Promise(resolve => setTimeout(resolve, 200));

      await pubSubClient.unsubscribe(undefined, testPattern);

      return {
        patternSubscriptionSuccessful: true,
        publishSuccessful: published,
        messageReceived,
      };
    }));

    // Test Polymarket-specific publishing
    tests.push(await this.runTest('Polymarket Publishing', async () => {
      const marketId = `test-market-${Date.now()}`;
      let priceUpdateReceived = false;
      let volumeUpdateReceived = false;
      let resolutionReceived = false;

      const priceHandler = () => { priceUpdateReceived = true; };
      const volumeHandler = () => { volumeUpdateReceived = true; };
      const resolutionHandler = () => { resolutionReceived = true; };

      await pubSubClient.subscribe(redisKeys.channels.polymarket.prices, priceHandler);
      await pubSubClient.subscribe(redisKeys.channels.polymarket.volumes, volumeHandler);
      await pubSubClient.subscribe(redisKeys.channels.polymarket.resolutions, resolutionHandler);

      await new Promise(resolve => setTimeout(resolve, 100));

      const pricePublished = await pubSubClient.publishPriceUpdate(marketId, 0.75);
      const volumePublished = await pubSubClient.publishVolumeUpdate(marketId, 100000);
      const resolutionPublished = await pubSubClient.publishResolution(marketId, 'Yes');

      await new Promise(resolve => setTimeout(resolve, 200));

      await pubSubClient.unsubscribe(redisKeys.channels.polymarket.prices);
      await pubSubClient.unsubscribe(redisKeys.channels.polymarket.volumes);
      await pubSubClient.unsubscribe(redisKeys.channels.polymarket.resolutions);

      return {
        priceUpdatePublished: pricePublished,
        volumeUpdatePublished: volumePublished,
        resolutionPublished: resolutionPublished,
        priceUpdateReceived,
        volumeUpdateReceived,
        resolutionReceived,
      };
    }));

    // Test notification publishing
    tests.push(await this.runTest('Notification Publishing', async () => {
      const userId = 99999;
      const notificationType = 'test_notification';
      const notificationContent = { message: 'Test notification' };
      let notificationReceived = false;

      const notificationHandler = () => { notificationReceived = true; };

      const notificationChannel = `${redisKeys.channels.notifications.general}:${userId}`;
      await pubSubClient.subscribe(notificationChannel, notificationHandler);

      await new Promise(resolve => setTimeout(resolve, 100));

      const published = await pubSubClient.publishNotification(
        userId,
        notificationType,
        notificationContent
      );

      await new Promise(resolve => setTimeout(resolve, 200));

      await pubSubClient.unsubscribe(notificationChannel);

      return {
        notificationPublished: published,
        notificationReceived,
      };
    }));

    // Test system event publishing
    tests.push(await this.runTest('System Event Publishing', async () => {
      let healthEventReceived = false;
      let metricsEventReceived = false;
      let errorEventReceived = false;

      const healthHandler = () => { healthEventReceived = true; };
      const metricsHandler = () => { metricsEventReceived = true; };
      const errorHandler = () => { errorEventReceived = true; };

      await pubSubClient.subscribe(redisKeys.channels.system.health, healthHandler);
      await pubSubClient.subscribe(redisKeys.channels.system.metrics, metricsHandler);
      await pubSubClient.subscribe(redisKeys.channels.system.errors, errorHandler);

      await new Promise(resolve => setTimeout(resolve, 100));

      const healthPublished = await pubSubClient.publishHealthEvent('healthy', { test: true });
      const metricsPublished = await pubSubClient.publishMetrics({ testMetric: 123 });
      const errorPublished = await pubSubClient.publishError(new Error('Test error'), { context: 'test' });

      await new Promise(resolve => setTimeout(resolve, 200));

      await pubSubClient.unsubscribe(redisKeys.channels.system.health);
      await pubSubClient.unsubscribe(redisKeys.channels.system.metrics);
      await pubSubClient.unsubscribe(redisKeys.channels.system.errors);

      return {
        healthEventPublished: healthPublished,
        metricsEventPublished: metricsPublished,
        errorEventPublished: errorPublished,
        healthEventReceived,
        metricsEventReceived,
        errorEventReceived,
      };
    }));

    // Test subscription statistics
    tests.push(await this.runTest('Subscription Statistics', async () => {
      const stats = pubSubClient.getSubscriptionStats();
      const status = pubSubClient.getStatus();

      return {
        statsAvailable: typeof stats.total === 'number' && typeof stats.active === 'number',
        hasChannelsArray: Array.isArray(stats.channels),
        hasPatternsArray: Array.isArray(stats.patterns),
        statusAvailable: typeof status.connected === 'boolean' && typeof status.subscriptions === 'number',
      };
    }));

    // Test multiple subscriptions
    tests.push(await this.runTest('Multiple Subscriptions', async () => {
      const channels = [
        `test:multi:${Date.now()}:1`,
        `test:multi:${Date.now()}:2`,
        `test:multi:${Date.now()}:3`,
      ];

      const handlers = channels.map(() => () => {});
      const receivedMessages = new Array(channels.length).fill(false);

      channels.forEach((channel, index) => {
        handlers[index] = () => { receivedMessages[index] = true; };
      });

      // Subscribe to all channels
      for (let i = 0; i < channels.length; i++) {
        await pubSubClient.subscribe(channels[i], handlers[i]);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      // Publish to all channels
      const publishResults = [];
      for (const channel of channels) {
        const result = await pubSubClient.publish(channel, { data: `message for ${channel}` });
        publishResults.push(result);
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      // Unsubscribe from all
      await pubSubClient.unsubscribe();

      return {
        allSubscriptionsSuccessful: true,
        allPublishesSuccessful: publishResults.every(p => p === true),
        allMessagesReceived: receivedMessages.every(received => received === true),
      };
    }));

    const totalDuration = Date.now() - startTime;
    const passedTests = tests.filter(t => t.passed).length;
    const failedTests = tests.length - passedTests;

    this.results.push({
      suiteName,
      tests,
      totalDuration,
      passedTests,
      failedTests,
    });

    logger.info(`${suiteName} tests completed`, {
      total: tests.length,
      passed: passedTests,
      failed: failedTests,
      duration: totalDuration,
    });
  }

  /**
   * Test cross-component integration
   */
  private async testCrossComponentIntegration(): Promise<void> {
    const suiteName = 'Cross-Component Integration';
    const tests: TestResult[] = [];
    const startTime = Date.now();

    logger.info(`Testing ${suiteName}`);

    // Test session and cache integration
    tests.push(await this.runTest('Session-Cache Integration', async () => {
      const userId = Math.floor(Math.random() * 100000);
      const sessionCacheKey = `session:${userId}`;

      // Create session
      const session: UserSession = {
        telegramUserId: userId,
        username: 'integration-user',
        firstName: 'Integration',
        lastName: 'Test',
        isActive: true,
        lastActivity: Date.now(),
        createdAt: Date.now(),
        preferences: {
          notifications: {
            positions: true,
            transactions: true,
            resolutions: true,
            priceAlerts: true,
            marketUpdates: false,
          },
          thresholds: {
            minPositionSize: 100,
            maxPositionSize: 10000,
            priceChangePercent: 5,
          },
          wallets: [],
        },
        metadata: {},
      };

      await sessionManager.createOrUpdateSession(userId, session);

      // Cache session data with get-or-set pattern
      const cachedSession = await cacheManager.getOrSet(
        sessionCacheKey,
        async () => sessionManager.getSession(userId),
        { ttl: 300 }
      );

      // Verify both are accessible
      const directSession = await sessionManager.getSession(userId);
      const cachedSessionDirect = await cacheManager.get(sessionCacheKey);

      // Cleanup
      await sessionManager.deleteSession(userId);
      await cacheManager.delete(sessionCacheKey);

      return {
        sessionCreated: directSession !== null,
        sessionCached: cachedSession !== null,
        sessionCachedDirect: cachedSessionDirect !== null,
        dataConsistent: cachedSession?.telegramUserId === directSession?.telegramUserId,
      };
    }));

    // Test cache and pub/sub integration
    tests.push(await this.runTest('Cache-PubSub Integration', async () => {
      const cacheKey = `integration:test:${Date.now()}`;
      const updateChannel = `cache:update:${Date.now()}`;
      let cacheUpdateReceived = false;

      // Subscribe to cache update notifications
      await pubSubClient.subscribe(updateChannel, () => {
        cacheUpdateReceived = true;
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Cache data and publish update
      const testData = { timestamp: Date.now(), data: 'integration-test' };
      await cacheManager.set(cacheKey, testData, { ttl: 300 });
      await pubSubClient.publish(updateChannel, {
        type: 'cache_update',
        key: cacheKey,
        operation: 'set',
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Get cached data
      const retrievedData = await cacheManager.get(cacheKey);

      // Cleanup
      await pubSubClient.unsubscribe(updateChannel);
      await cacheManager.delete(cacheKey);

      return {
        dataCached: retrievedData !== null,
        updatePublished: true,
        updateReceived: cacheUpdateReceived,
        dataConsistent: JSON.stringify(retrievedData) === JSON.stringify(testData),
      };
    }));

    // Test session and pub/sub integration
    tests.push(await this.runTest('Session-PubSub Integration', async () => {
      const userId = Math.floor(Math.random() * 100000);
      const notificationChannel = `${redisKeys.channels.notifications.general}:${userId}`;
      let notificationReceived = false;
      let receivedNotification: any = null;

      // Subscribe to user notifications
      await pubSubClient.subscribe(notificationChannel, (message) => {
        notificationReceived = true;
        receivedNotification = message;
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Create session and send notification
      const session: UserSession = {
        telegramUserId: userId,
        username: 'notification-user',
        isActive: true,
        lastActivity: Date.now(),
        createdAt: Date.now(),
        preferences: {
          notifications: {
            positions: true,
            transactions: true,
            resolutions: true,
            priceAlerts: true,
            marketUpdates: false,
          },
          thresholds: {
            minPositionSize: 100,
            maxPositionSize: 10000,
            priceChangePercent: 5,
          },
          wallets: [],
        },
        metadata: {},
      };

      await sessionManager.createOrUpdateSession(userId, session);
      await pubSubClient.publishNotification(
        userId,
        'session_created',
        { message: 'Session created successfully' }
      );

      await new Promise(resolve => setTimeout(resolve, 200));

      // Cleanup
      await sessionManager.deleteSession(userId);
      await pubSubClient.unsubscribe(notificationChannel);

      return {
        sessionCreated: true,
        notificationSent: true,
        notificationReceived,
        correctNotificationType: receivedNotification?.data.type === 'session_created',
      };
    }));

    // Test performance under load
    tests.push(await this.runTest('Performance Under Load', async () => {
      const operationCount = 50;
      const startTime = Date.now();

      // Concurrent operations
      const promises = [];

      // Cache operations
      for (let i = 0; i < operationCount; i++) {
        promises.push(
          cacheManager.set(`load:test:${i}`, { index: i }, { ttl: 60 })
        );
      }

      // Session operations
      for (let i = 0; i < Math.min(operationCount, 20); i++) { // Limit session ops
        const userId = 50000 + i;
        const session: UserSession = {
          telegramUserId: userId,
          username: `loaduser${i}`,
          isActive: true,
          lastActivity: Date.now(),
          createdAt: Date.now(),
          preferences: {
            notifications: {
              positions: true,
              transactions: true,
              resolutions: true,
              priceAlerts: true,
              marketUpdates: false,
            },
            thresholds: {
              minPositionSize: 100,
              maxPositionSize: 10000,
              priceChangePercent: 5,
            },
            wallets: [],
          },
          metadata: {},
        };
        promises.push(sessionManager.createOrUpdateSession(userId, session));
      }

      // Pub/Sub operations
      const testChannel = `load:channel:${Date.now()}`;
      for (let i = 0; i < Math.min(operationCount, 10); i++) { // Limit pub/sub ops
        promises.push(
          pubSubClient.publish(testChannel, { index: i, timestamp: Date.now() })
        );
      }

      const results = await Promise.allSettled(promises);
      const totalDuration = Date.now() - startTime;

      const successfulOps = results.filter(r => r.status === 'fulfilled').length;
      const failedOps = results.filter(r => r.status === 'rejected').length;

      // Cleanup sessions
      for (let i = 0; i < Math.min(operationCount, 20); i++) {
        await sessionManager.deleteSession(50000 + i);
      }

      return {
        totalOperations: promises.length,
        successfulOperations: successfulOps,
        failedOperations: failedOps,
        totalDuration,
        operationsPerSecond: Math.round(promises.length / (totalDuration / 1000)),
        successRate: Math.round((successfulOps / promises.length) * 100),
      };
    }));

    // Test error handling across components
    tests.push(await this.runTest('Cross-Component Error Handling', async () => {
      const errors: Error[] = [];

      // Test invalid session operations
      try {
        await sessionManager.getSession(-1); // Invalid user ID
      } catch (error) {
        errors.push(error as Error);
      }

      // Test invalid cache operations
      try {
        await cacheManager.set('', null); // Invalid key/value
      } catch (error) {
        errors.push(error as Error);
      }

      // Test invalid pub/sub operations
      try {
        await pubSubClient.publish('', null); // Invalid channel/message
      } catch (error) {
        errors.push(error as Error);
      }

      return {
        errorCount: errors.length,
        errorsHandledGracefully: errors.length > 0,
        noCrashes: true, // If we get here, no crashes occurred
      };
    }));

    const totalDuration = Date.now() - startTime;
    const passedTests = tests.filter(t => t.passed).length;
    const failedTests = tests.length - passedTests;

    this.results.push({
      suiteName,
      tests,
      totalDuration,
      passedTests,
      failedTests,
    });

    logger.info(`${suiteName} tests completed`, {
      total: tests.length,
      passed: passedTests,
      failed: failedTests,
      duration: totalDuration,
    });
  }

  /**
   * Run a single test with error handling and timing
   */
  private async runTest(
    testName: string,
    testFn: () => Promise<Record<string, any>>
  ): Promise<TestResult> {
    const startTime = Date.now();

    try {
      const details = await testFn();
      const duration = Date.now() - startTime;

      logger.debug(`Test passed: ${testName}`, {
        duration,
        details: JSON.stringify(details).substring(0, 200), // Truncate for logging
      });

      return {
        testName,
        passed: true,
        duration,
        details,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Test failed: ${testName}`, {
        duration,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return {
        testName,
        passed: false,
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Calculate overall test summary
   */
  private calculateSummary(): {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    totalDuration: number;
    successRate: number;
  } {
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let totalDuration = 0;

    for (const suite of this.results) {
      totalTests += suite.tests.length;
      passedTests += suite.passedTests;
      failedTests += suite.failedTests;
      totalDuration += suite.totalDuration;
    }

    const successRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;

    return {
      totalTests,
      passedTests,
      failedTests,
      totalDuration,
      successRate,
    };
  }

  /**
   * Generate detailed test report
   */
  generateReport(): string {
    const summary = this.calculateSummary();
    let report = `# Redis Integration Test Report\n\n`;

    report += `## Summary\n`;
    report += `- **Total Tests**: ${summary.totalTests}\n`;
    report += `- **Passed**: ${summary.passedTests}\n`;
    report += `- **Failed**: ${summary.failedTests}\n`;
    report += `- **Success Rate**: ${summary.successRate.toFixed(2)}%\n`;
    report += `- **Total Duration**: ${summary.totalDuration}ms\n\n`;

    for (const suite of this.results) {
      report += `## ${suite.suiteName}\n`;
      report += `- **Tests**: ${suite.tests.length}\n`;
      report += `- **Passed**: ${suite.passedTests}\n`;
      report += `- **Failed**: ${suite.failedTests}\n`;
      report += `- **Duration**: ${suite.totalDuration}ms\n\n`;

      for (const test of suite.tests) {
        const status = test.passed ? '✅' : '❌';
        report += `### ${status} ${test.testName}\n`;
        report += `- **Duration**: ${test.duration}ms\n`;

        if (test.passed && test.details) {
          report += `- **Details**: ${JSON.stringify(test.details, null, 2)}\n`;
        } else if (!test.passed && test.error) {
          report += `- **Error**: ${test.error}\n`;
        }

        report += '\n';
      }
    }

    return report;
  }
}

/**
 * Run integration tests
 */
export async function runRedisIntegrationTests(): Promise<{
  success: boolean;
  report: string;
}> {
  const tester = new RedisIntegrationTester();

  try {
    const result = await tester.runAllTests();
    const report = tester.generateReport();

    logger.info('Redis integration tests completed', {
      overallSuccess: result.overallSuccess,
      totalTests: result.summary.totalTests,
      passedTests: result.summary.passedTests,
      failedTests: result.summary.failedTests,
      successRate: result.summary.successRate.toFixed(2),
    });

    return {
      success: result.overallSuccess,
      report,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Redis integration test suite failed', {
      error: errorMessage,
    });

    return {
      success: false,
      report: `# Test Suite Error\n\nThe test suite failed to run: ${errorMessage}`,
    };
  }
}

// Export for external use
export { RedisIntegrationTester };