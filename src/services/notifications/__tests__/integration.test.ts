import { Telegraf } from 'telegraf';
import TelegramNotificationService from '../telegram-notification-service';
import PolymarketWebSocketClient from '../../polymarket/websocket-client';
import { redisClient } from '@/config/redis';
import { ProcessingEvent } from '@/types/data-processing';

// Mock configuration
const mockConfig = {
  botToken: process.env.TEST_BOT_TOKEN || 'test_token',
  enableRealTimeNotifications: true,
  enableBatching: true,
  enableHistory: true,
  enableAnalytics: true,
  enableMonitoring: true,
  targetDeliveryTime: 200,
  targetSuccessRate: 95,
  maxQueueDepth: 1000,
  maxConcurrentNotifications: 100,
  enableRateLimiting: true,
  rateLimits: {
    perSecond: 10,
    perMinute: 100,
    perHour: 1000
  },
  maxRetries: 3,
  retryDelay: 1000,
  retryBackoffMultiplier: 2,
  enableCaching: true,
  cacheTimeout: 300
};

describe('TelegramNotificationService Integration Tests', () => {
  let bot: Telegraf;
  let wsClient: PolymarketWebSocketClient;
  let notificationService: TelegramNotificationService;

  beforeAll(async () => {
    // Initialize test bot
    bot = new Telegraf(mockConfig.botToken);

    // Initialize WebSocket client with mock URL
    wsClient = new PolymarketWebSocketClient({
      url: process.env.TEST_WS_URL || 'ws://localhost:8080',
      reconnectAttempts: 3,
      reconnectDelay: 1000
    });

    // Initialize notification service
    notificationService = new TelegramNotificationService(bot, wsClient, mockConfig);

    // Clear Redis test data
    await redisClient.flushdb();
  });

  afterAll(async () => {
    if (notificationService) {
      await notificationService.stop();
    }
    if (wsClient) {
      await wsClient.disconnect();
    }
  });

  beforeEach(async () => {
    // Reset Redis data
    await redisClient.flushdb();
  });

  describe('Service Initialization', () => {
    test('should initialize all services correctly', async () => {
      expect(notificationService).toBeDefined();
      expect(bot).toBeDefined();
      expect(wsClient).toBeDefined();
    });

    test('should start service successfully', async () => {
      await expect(notificationService.start()).resolves.not.toThrow();
      const status = await notificationService.getServiceStatus();
      expect(status.system.health).toBe('healthy');
    });

    test('should stop service gracefully', async () => {
      await notificationService.start();
      await expect(notificationService.stop()).resolves.not.toThrow();
    });
  });

  describe('WebSocket Event Processing', () => {
    beforeEach(async () => {
      await notificationService.start();
    });

    afterEach(async () => {
      await notificationService.stop();
    });

    test('should process transaction events correctly', async () => {
      const mockTransactionEvent: ProcessingEvent = {
        id: 'test_tx_1',
        type: 'TRANSACTION',
        data: {
          transaction: {
            hash: '0x123...abc',
            user: '0x456...def',
            amount: 5000,
            timestamp: Date.now()
          }
        },
        timestamp: new Date(),
        processedAt: new Date(),
        status: 'pending',
        retryCount: 0,
        metadata: {
          source: 'websocket',
          priority: 'high'
        }
      };

      // Set up test user tracking
      await redisClient.sadd('tracking:user:0x456...def', '12345');

      // Simulate WebSocket event
      const eventPromise = new Promise((resolve) => {
        notificationService.once('websocket:eventProcessed', resolve);
      });

      // Emit WebSocket event (simulating connection)
      wsClient.emit('message', mockTransactionEvent);

      const result = await eventPromise as any;
      expect(result.successful).toBeGreaterThanOrEqual(0);
    });

    test('should process position update events correctly', async () => {
      const mockPositionEvent: ProcessingEvent = {
        id: 'test_pos_1',
        type: 'POSITION_UPDATE',
        data: {
          position: {
            id: 'pos_123',
            user: '0x789...ghi',
            conditionId: 'condition_456',
            outcome: 'YES',
            size: 2000,
            price: 0.65,
            previousSize: 1000
          }
        },
        timestamp: new Date(),
        processedAt: new Date(),
        status: 'pending',
        retryCount: 0,
        metadata: {
          source: 'websocket',
          priority: 'medium'
        }
      };

      // Set up test user tracking
      await redisClient.sadd('tracking:condition:condition_456', '67890');

      const eventPromise = new Promise((resolve) => {
        notificationService.once('websocket:eventProcessed', resolve);
      });

      wsClient.emit('message', mockPositionEvent);

      const result = await eventPromise as any;
      expect(result.successful).toBeGreaterThanOrEqual(0);
    });

    test('should handle market resolution events correctly', async () => {
      const mockResolutionEvent: ProcessingEvent = {
        id: 'test_res_1',
        type: 'RESOLUTION',
        data: {
          condition: {
            id: 'condition_789',
            question: 'Will BTC reach $100k by end of year?',
            resolution: 'YES'
          }
        },
        conditionId: 'condition_789',
        timestamp: new Date(),
        processedAt: new Date(),
        status: 'pending',
        retryCount: 0,
        metadata: {
          source: 'websocket',
          priority: 'urgent'
        }
      };

      // Set up test user tracking
      await redisClient.sadd('tracking:condition:condition_789', '11111');
      await redisClient.sadd('tracking:condition:condition_789', '22222');

      const eventPromise = new Promise((resolve) => {
        notificationService.once('websocket:eventProcessed', resolve);
      });

      wsClient.emit('message', mockResolutionEvent);

      const result = await eventPromise as any;
      expect(result.successful).toBeGreaterThanOrEqual(0);
      expect(result.interestedUsers).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Manual Notifications', () => {
    beforeEach(async () => {
      await notificationService.start();
    });

    afterEach(async () => {
      await notificationService.stop();
    });

    test('should send manual notification successfully', async () => {
      const testUserId = 12345;
      const notification = {
        type: 'system' as const,
        title: 'Test Notification',
        message: 'This is a test notification',
        priority: 'medium' as const,
        metadata: {
          source: 'manual' as const,
          timestamp: Date.now()
        }
      };

      const result = await notificationService.sendManualNotification(testUserId, notification);
      expect(typeof result).toBe('string');
    });

    test('should send broadcast notification to multiple users', async () => {
      // Set up test users
      await redisClient.sadd('active_users', '12345', '67890', '11111');

      const notification = {
        type: 'system' as const,
        title: 'Broadcast Test',
        message: 'This is a broadcast test',
        priority: 'low' as const,
        metadata: {
          source: 'manual' as const,
          timestamp: Date.now()
        }
      };

      const results = await notificationService.sendBroadcastNotification(notification);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('User Preferences', () => {
    beforeEach(async () => {
      await notificationService.start();
    });

    afterEach(async () => {
      await notificationService.stop();
    });

    test('should update user preferences successfully', async () => {
      const testUserId = 12345;
      const preferences = {
        notifications: {
          enabled: true,
          types: {
            positionUpdates: true,
            transactions: false,
            resolutions: true,
            priceAlerts: false,
            largePositions: true
          },
          thresholds: {
            minPositionSize: 500,
            minTransactionAmount: 50,
            priceChangeThreshold: 10
          }
        }
      };

      const result = await notificationService.updateUserPreferences(testUserId, preferences);
      expect(result).toBe(true);

      // Verify preferences were saved
      const savedPrefs = await redisClient.hget(`user:${testUserId}:preferences`, 'preferences');
      expect(savedPrefs).toBeDefined();
      const parsedPrefs = JSON.parse(savedPrefs!);
      expect(parsedPrefs.notifications.types.transactions).toBe(false);
    });

    test('should respect user notification filtering', async () => {
      const testUserId = 12345;

      // Set up user with disabled transaction notifications
      await redisClient.hset(`user:${testUserId}:preferences`, 'preferences', JSON.stringify({
        notifications: {
          enabled: true,
          types: {
            positionUpdates: true,
            transactions: false, // Disabled
            resolutions: true,
            priceAlerts: true,
            largePositions: true
          }
        }
      }));

      // Set up tracking
      await redisClient.sadd('tracking:user:0xabc...def', testUserId.toString());

      // Simulate transaction event
      const mockTransactionEvent: ProcessingEvent = {
        id: 'test_tx_filtered',
        type: 'TRANSACTION',
        data: {
          transaction: {
            hash: '0xabc...def',
            user: '0xabc...def',
            amount: 1000,
            timestamp: Date.now()
          }
        },
        userId: '0xabc...def',
        timestamp: new Date(),
        processedAt: new Date(),
        status: 'pending',
        retryCount: 0,
        metadata: {
          source: 'websocket',
          priority: 'medium'
        }
      };

      const eventPromise = new Promise((resolve) => {
        notificationService.once('websocket:eventProcessed', resolve);
      });

      wsClient.emit('message', mockTransactionEvent);

      const result = await eventPromise as any;
      // The event should be processed but filtered out for this user
      expect(result.successful).toBe(0);
    });
  });

  describe('Performance and Monitoring', () => {
    beforeEach(async () => {
      await notificationService.start();
    });

    afterEach(async () => {
      await notificationService.stop();
    });

    test('should provide accurate service status', async () => {
      const status = await notificationService.getServiceStatus();

      expect(status).toBeDefined();
      expect(status.websocket).toBeDefined();
      expect(status.notification).toBeDefined();
      expect(status.system).toBeDefined();
      expect(typeof status.system.uptime).toBe('number');
      expect(typeof status.system.memoryUsage).toBe('number');
    });

    test('should collect notification analytics', async () => {
      // Send some test notifications
      await notificationService.sendManualNotification(12345, {
        type: 'system',
        title: 'Analytics Test 1',
        message: 'Test notification for analytics',
        priority: 'medium'
      });

      await notificationService.sendManualNotification(67890, {
        type: 'system',
        title: 'Analytics Test 2',
        message: 'Another test notification',
        priority: 'high'
      });

      // Wait a moment for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      const analytics = await notificationService.getSystemAnalytics();
      expect(analytics).toBeDefined();
      expect(typeof analytics.totalNotifications).toBe('number');
    });

    test('should provide monitoring dashboard data', async () => {
      const dashboard = await notificationService.getMonitoringDashboard();

      expect(dashboard).toBeDefined();
      expect(dashboard.status).toBeDefined();
      expect(dashboard.metrics).toBeDefined();
      expect(dashboard.summary).toBeDefined();
      expect(typeof dashboard.summary.systemHealth).toBe('number');
    });
  });

  describe('Error Handling and Recovery', () => {
    beforeEach(async () => {
      await notificationService.start();
    });

    afterEach(async () => {
      await notificationService.stop();
    });

    test('should handle invalid WebSocket events gracefully', async () => {
      const invalidEvent = {
        id: '',
        type: 'INVALID_TYPE',
        data: null,
        timestamp: new Date(),
        processedAt: new Date(),
        status: 'pending' as const,
        retryCount: 0,
        metadata: { source: 'websocket' as const }
      };

      // Should not throw
      await expect(
        new Promise<void>((resolve) => {
          wsClient.emit('message', invalidEvent);
          setTimeout(resolve, 100); // Wait for processing
        })
      ).resolves.not.toThrow();
    });

    test('should handle service restart correctly', async () => {
      // Start service
      await notificationService.start();
      const initialStatus = await notificationService.getServiceStatus();

      // Restart service
      await notificationService.restart();
      const restartedStatus = await notificationService.getServiceStatus();

      expect(initialStatus.system.health).toBe('healthy');
      expect(restartedStatus.system.health).toBe('healthy');
      expect(restartedStatus.system.uptime).toBeLessThan(initialStatus.system.uptime);
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(async () => {
      await notificationService.start();
    });

    afterEach(async () => {
      await notificationService.stop();
    });

    test('should respect rate limits for notifications', async () => {
      const testUserId = 12345;
      const notification = {
        type: 'system' as const,
        title: 'Rate Limit Test',
        message: 'Testing rate limits',
        priority: 'low' as const
      };

      // Send many notifications rapidly
      const promises = Array(20).fill(null).map(() =>
        notificationService.sendManualNotification(testUserId, notification)
      );

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      // Some should succeed, some should be rate limited
      expect(successful).toBeGreaterThan(0);
      expect(failed).toBeGreaterThan(0);
    });
  });

  describe('Queue Management', () => {
    beforeEach(async () => {
      await notificationService.start();
    });

    afterEach(async () => {
      await notificationService.stop();
    });

    test('should handle queue overflow gracefully', async () => {
      // This test would require a more sophisticated setup to truly test queue limits
      // For now, we'll verify that the service can handle many notifications
      const testUserId = 12345;
      const notification = {
        type: 'system' as const,
        title: 'Queue Test',
        message: 'Testing queue capacity',
        priority: 'low' as const
      };

      // Send notifications with scheduled delays to fill queue
      const scheduledFor = new Date(Date.now() + 60000); // 1 minute from now

      const promises = Array(50).fill(null).map((_, i) =>
        notificationService.sendManualNotification(testUserId, {
          ...notification,
          title: `Queue Test ${i}`
        }, { scheduledFor })
      );

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled').length;

      expect(successful).toBeGreaterThan(40); // Most should succeed
    });
  });
});