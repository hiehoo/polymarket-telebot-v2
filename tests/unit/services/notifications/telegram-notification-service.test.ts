import { TelegramNotificationService } from '@/services/notifications/telegram-notification-service';
import { Telegraf } from 'telegraf';
import PolymarketWebSocketClient from '@/services/polymarket/websocket-client';
import { NotificationService } from '@/services/notifications/notification-service';
import { RealTimeNotificationService } from '@/services/notifications/realtime-notification-service';
import { NotificationDispatcher } from '@/services/notifications/notification-dispatcher';
import { NotificationQueueManager } from '@/services/notifications/notification-queue-manager';
import { EnhancedNotificationTemplates } from '@/services/notifications/notification-templates-enhanced';
import { NotificationHistoryAnalytics } from '@/services/notifications/notification-history-analytics';
import { UserPreferenceFilter } from '@/services/notifications/user-preference-filter';
import { NotificationMonitoringAnalytics } from '@/services/notifications/notification-monitoring-analytics';
import { redisClient } from '@/config/redis';
import { NotificationData, TelegramUserPreferences } from '@/types/telegram';
import { ProcessingEvent } from '@/types/data-processing';

// Mock dependencies
jest.mock('@/services/notifications/notification-service');
jest.mock('@/services/notifications/realtime-notification-service');
jest.mock('@/services/notifications/notification-dispatcher');
jest.mock('@/services/notifications/notification-queue-manager');
jest.mock('@/services/notifications/notification-templates-enhanced');
jest.mock('@/services/notifications/notification-history-analytics');
jest.mock('@/services/notifications/user-preference-filter');
jest.mock('@/services/notifications/notification-monitoring-analytics');
jest.mock('@/config/redis');

const MockNotificationService = NotificationService as jest.MockedClass<typeof NotificationService>;
const MockRealTimeNotificationService = RealTimeNotificationService as jest.MockedClass<typeof RealTimeNotificationService>;
const MockNotificationDispatcher = NotificationDispatcher as jest.MockedClass<typeof NotificationDispatcher>;
const MockNotificationQueueManager = NotificationQueueManager as jest.MockedClass<typeof NotificationQueueManager>;
const MockEnhancedNotificationTemplates = EnhancedNotificationTemplates as jest.MockedClass<typeof EnhancedNotificationTemplates>;
const MockNotificationHistoryAnalytics = NotificationHistoryAnalytics as jest.MockedClass<typeof NotificationHistoryAnalytics>;
const MockUserPreferenceFilter = UserPreferenceFilter as jest.MockedClass<typeof UserPreferenceFilter>;
const MockNotificationMonitoringAnalytics = NotificationMonitoringAnalytics as jest.MockedClass<typeof NotificationMonitoringAnalytics>;
const MockRedisClient = redisClient as jest.Mocked<typeof redisClient>;

describe('TelegramNotificationService', () => {
  let service: TelegramNotificationService;
  let mockBot: jest.Mocked<Telegraf>;
  let mockWebSocketClient: jest.Mocked<PolymarketWebSocketClient>;

  const mockConfig = {
    botToken: 'test-bot-token',
    enableRealTimeNotifications: true,
    enableBatching: true,
    enableHistory: true,
    enableAnalytics: true,
    enableMonitoring: true,
    targetDeliveryTime: 200,
    targetSuccessRate: 95,
    maxQueueDepth: 1000,
    maxConcurrentNotifications: 10,
    enableRateLimiting: true,
    rateLimits: {
      perSecond: 5,
      perMinute: 30,
      perHour: 100,
    },
    maxRetries: 3,
    retryDelay: 2000,
    retryBackoffMultiplier: 2,
    enableCaching: true,
    cacheTimeout: 3600,
  };

  beforeEach(() => {
    mockBot = {
      on: jest.fn(),
      emit: jest.fn(),
      start: jest.fn(),
      catch: jest.fn(),
    } as any;

    mockWebSocketClient = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      subscribe: jest.fn(),
      on: jest.fn(),
      isConnected: jest.fn(),
      getStats: jest.fn(),
    } as any;

    MockNotificationService.mockImplementation(() => ({
      sendNotification: jest.fn(),
    } as any));

    MockNotificationQueueManager.mockImplementation(() => ({
      addWorker: jest.fn(),
      shutdown: jest.fn(),
      enqueue: jest.fn(),
      getQueueStatus: jest.fn().mockResolvedValue({
        size: 0,
        processing: 0,
      }),
    } as any));

    service = new TelegramNotificationService(
      mockBot,
      mockWebSocketClient,
      mockConfig
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(service).toBeDefined();
      expect(mockBot.on).toHaveBeenCalledTimes(1);
      expect(mockWebSocketClient.on).toHaveBeenCalledTimes(3);
    });

    it('should initialize all services with correct parameters', () => {
      expect(MockNotificationService).toHaveBeenCalled();
      expect(MockNotificationQueueManager).toHaveBeenCalledWith({
        maxQueueSize: mockConfig.maxQueueDepth,
        enablePriorityQueuing: true,
        enableDeadLetterQueue: true,
        maxRetries: mockConfig.maxRetries,
      });
    });
  });

  describe('start()', () => {
    it('should start the service successfully', async () => {
      const mockRealTimeService = {
        shutdown: jest.fn(),
      };
      MockRealTimeNotificationService.mockImplementation(() => mockRealTimeService as any);

      await expect(service.start()).resolves.not.toThrow();

      expect(mockWebSocketClient.connect).toHaveBeenCalled();
      expect(MockNotificationQueueManager.prototype.addWorker).toHaveBeenCalledWith('main');
    });

    it('should warm up caches if caching is enabled', async () => {
      const mockWarmupCaches = jest.spyOn(service as any, 'warmupCaches').mockResolvedValue(undefined);

      await service.start();

      expect(mockWarmupCaches).toHaveBeenCalled();
    });

    it('should handle connection errors gracefully', async () => {
      mockWebSocketClient.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(service.start()).rejects.toThrow('Connection failed');
    });
  });

  describe('stop()', () => {
    it('should stop the service gracefully', async () => {
      const mockRealTimeService = {
        shutdown: jest.fn(),
      };
      MockRealTimeNotificationService.mockImplementation(() => mockRealTimeService as any);

      // Mock service as started
      (service as any).isStarted = true;

      await expect(service.stop()).resolves.not.toThrow();

      expect(mockWebSocketClient.disconnect).toHaveBeenCalled();
      expect(MockNotificationQueueManager.prototype.shutdown).toHaveBeenCalled();
    });
  });

  describe('restart()', () => {
    it('should restart the service', async () => {
      const mockStop = jest.spyOn(service, 'stop').mockResolvedValue(undefined);
      const mockStart = jest.spyOn(service, 'start').mockResolvedValue(undefined);

      await service.restart();

      expect(mockStop).toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalled();
    });
  });

  describe('handleWebSocketEvent()', () => {
    const mockEvent: ProcessingEvent = {
      type: 'TRANSACTION',
      userId: 12345,
      conditionId: 'test-condition-id',
      data: {
        transaction: {
          hash: '0x123',
          amount: 1000,
          from: '0xfrom',
          to: '0xto',
        },
      },
    };

    beforeEach(() => {
      MockRedisClient.smembers = jest.fn().mockResolvedValue(['12345', '67890']);
    });

    it('should process WebSocket events successfully', async () => {
      const mockGetInterestedUsers = jest.spyOn(service as any, 'getInterestedUsers')
        .mockResolvedValue([12345, 67890]);

      const mockGenerateAndSendNotification = jest.spyOn(service as any, 'generateAndSendNotification')
        .mockResolvedValue(undefined);

      await (service as any).handleWebSocketEvent(mockEvent);

      expect(mockGetInterestedUsers).toHaveBeenCalledWith(mockEvent);
      expect(mockGenerateAndSendNotification).toHaveBeenCalledTimes(2);
    });

    it('should skip processing when no interested users found', async () => {
      const mockGetInterestedUsers = jest.spyOn(service as any, 'getInterestedUsers')
        .mockResolvedValue([]);

      const mockGenerateAndSendNotification = jest.spyOn(service as any, 'generateAndSendNotification')
        .mockResolvedValue(undefined);

      await (service as any).handleWebSocketEvent(mockEvent);

      expect(mockGenerateAndSendNotification).not.toHaveBeenCalled();
    });

    it('should handle partial failures in batch processing', async () => {
      const mockGetInterestedUsers = jest.spyOn(service as any, 'getInterestedUsers')
        .mockResolvedValue([12345, 67890]);

      const mockGenerateAndSendNotification = jest.spyOn(service as any, 'generateAndSendNotification')
        .mockImplementation(async (userId: number) => {
          if (userId === 12345) throw new Error('Test error');
          return Promise.resolve();
        });

      await (service as any).handleWebSocketEvent(mockEvent);

      // Should still process all users, but some might fail
      expect(mockGenerateAndSendNotification).toHaveBeenCalledTimes(2);
    });
  });

  describe('getInterestedUsers()', () => {
    const mockEvent: ProcessingEvent = {
      type: 'TRANSACTION',
      userId: 12345,
      conditionId: 'test-condition-id',
      data: {},
    };

    beforeEach(() => {
      MockRedisClient.smembers = jest.fn();
    });

    it('should get users tracking specific wallet', async () => {
      MockRedisClient.smembers
        .mockReturnValueOnce(['12345', '67890']) // wallet tracking
        .mockReturnValueOnce([]) // condition tracking
        .mockReturnValueOnce([]); // global tracking

      const users = await (service as any).getInterestedUsers(mockEvent);

      expect(users).toEqual([12345, 67890]);
      expect(MockRedisClient.smembers).toHaveBeenCalledWith('tracking:user:12345');
    });

    it('should get users tracking specific condition', async () => {
      MockRedisClient.smembers
        .mockReturnValueOnce([]) // wallet tracking
        .mockReturnValueOnce(['11111', '22222']) // condition tracking
        .mockReturnValueOnce([]); // global tracking

      const users = await (service as any).getInterestedUsers(mockEvent);

      expect(users).toEqual([11111, 22222]);
      expect(MockRedisClient.smembers).toHaveBeenCalledWith('tracking:condition:test-condition-id');
    });

    it('should get users tracking all activity', async () => {
      MockRedisClient.smembers
        .mockReturnValueOnce([]) // wallet tracking
        .mockReturnValueOnce([]) // condition tracking
        .mockReturnValueOnce(['99999']); // global tracking

      const users = await (service as any).getInterestedUsers(mockEvent);

      expect(users).toEqual([99999]);
      expect(MockRedisClient.smembers).toHaveBeenCalledWith('tracking:global');
    });

    it('should handle Redis errors gracefully', async () => {
      MockRedisClient.smembers.mockImplementation(() => {
        throw new Error('Redis error');
      });

      const users = await (service as any).getInterestedUsers(mockEvent);

      expect(users).toEqual([]);
    });

    it('should remove duplicate user IDs', async () => {
      MockRedisClient.smembers
        .mockReturnValueOnce(['12345']) // wallet tracking
        .mockReturnValueOnce(['12345', '67890']) // condition tracking
        .mockReturnValueOnce(['12345', '99999']); // global tracking

      const users = await (service as any).getInterestedUsers(mockEvent);

      expect(users).toEqual([12345, 67890, 99999]);
    });
  });

  describe('generateAndSendNotification()', () => {
    const mockEvent: ProcessingEvent = {
      type: 'TRANSACTION',
      userId: 12345,
      conditionId: 'test-condition-id',
      data: {
        transaction: {
          hash: '0x123',
          amount: 1000,
          from: '0xfrom',
          to: '0xto',
        },
      },
    };

    const mockNotificationData: NotificationData = {
      type: 'transaction',
      title: 'Transaction Notification',
      message: 'New transaction detected',
      userId: 12345,
      priority: 'normal',
      metadata: {
        source: 'websocket',
        timestamp: Date.now(),
      },
    };

    const mockUserPreferences: TelegramUserPreferences = {
      userId: 12345,
      notifications: {
        enabled: true,
        types: {
          positionUpdates: true,
          transactions: true,
          resolutions: true,
          priceAlerts: true,
          largePositions: true,
        },
        thresholds: {
          minPositionSize: 100,
          minTransactionAmount: 1000,
          priceChangeThreshold: 5,
        },
      },
      wallets: [],
      favorites: [],
      language: 'en',
      timezone: 'UTC',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      jest.spyOn(service as any, 'getUserPreferences').mockResolvedValue(mockUserPreferences);
      jest.spyOn(service as any, 'determineTemplateType').mockReturnValue('transaction');
      MockEnhancedNotificationTemplates.prototype.generateNotification.mockReturnValue(mockNotificationData);
    });

    it('should generate and send notification successfully', async () => {
      const mockPreferenceFilterResult = {
        shouldDeliver: true,
        reason: '',
        modifiedContent: null,
        priority: 'normal',
        tags: [],
        scheduledFor: undefined,
      };
      MockUserPreferenceFilter.prototype.shouldDeliverNotification.mockResolvedValue(mockPreferenceFilterResult);

      const mockSendNotification = jest.spyOn(service as any, 'sendNotification').mockResolvedValue('notification-id');

      await (service as any).generateAndSendNotification(12345, mockEvent);

      expect(MockEnhancedNotificationTemplates.prototype.generateNotification).toHaveBeenCalled();
      expect(MockUserPreferenceFilter.prototype.shouldDeliverNotification).toHaveBeenCalled();
      expect(mockSendNotification).toHaveBeenCalledWith(mockNotificationData, { scheduledFor: undefined });
    });

    it('should skip notification if user has disabled notifications', async () => {
      const disabledPreferences = { ...mockUserPreferences };
      disabledPreferences.notifications.enabled = false;

      jest.spyOn(service as any, 'getUserPreferences').mockResolvedValue(disabledPreferences);

      await (service as any).generateAndSendNotification(12345, mockEvent);

      expect(MockUserPreferenceFilter.prototype.shouldDeliverNotification).not.toHaveBeenCalled();
    });

    it('should skip notification if preference filter blocks it', async () => {
      const mockPreferenceFilterResult = {
        shouldDeliver: false,
        reason: 'User preference blocked',
        modifiedContent: null,
        priority: 'normal',
        tags: [],
        scheduledFor: undefined,
      };
      MockUserPreferenceFilter.prototype.shouldDeliverNotification.mockResolvedValue(mockPreferenceFilterResult);

      const mockRecordNotificationFiltered = jest.spyOn(service as any, 'recordNotificationFiltered');

      await (service as any).generateAndSendNotification(12345, mockEvent);

      expect(mockRecordNotificationFiltered).toHaveBeenCalledWith(12345, mockNotificationData, 'User preference blocked');
    });

    it('should apply preference filter modifications', async () => {
      const modifiedNotification = { ...mockNotificationData, title: 'Modified Title' };
      const mockPreferenceFilterResult = {
        shouldDeliver: true,
        reason: '',
        modifiedContent: { title: 'Modified Title' },
        priority: 'high',
        tags: ['urgent'],
        scheduledFor: undefined,
      };
      MockUserPreferenceFilter.prototype.shouldDeliverNotification.mockResolvedValue(mockPreferenceFilterResult);

      const mockSendNotification = jest.spyOn(service as any, 'sendNotification').mockResolvedValue('notification-id');

      await (service as any).generateAndSendNotification(12345, mockEvent);

      expect(modifiedNotification.title).toBe('Modified Title');
      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Modified Title',
          priority: 'high',
          metadata: expect.objectContaining({
            tags: ['urgent'],
          }),
        }),
        { scheduledFor: undefined }
      );
    });

    it('should handle errors in notification generation', async () => {
      jest.spyOn(service as any, 'getUserPreferences').mockRejectedValue(new Error('Database error'));

      await expect(
        (service as any).generateAndSendNotification(12345, mockEvent)
      ).rejects.toThrow('Database error');
    });
  });

  describe('determineTemplateType()', () => {
    it('should determine transaction template based on amount', () => {
      const largeAmountEvent = { type: 'TRANSACTION', data: { transaction: { amount: 15000 } } };
      const mediumAmountEvent = { type: 'TRANSACTION', data: { transaction: { amount: 5000 } } };
      const smallAmountEvent = { type: 'TRANSACTION', data: { transaction: { amount: 500 } } };

      expect((service as any).determineTemplateType(largeAmountEvent as ProcessingEvent)).toBe('transaction_large');
      expect((service as any).determineTemplateType(mediumAmountEvent as ProcessingEvent)).toBe('transaction_medium');
      expect((service as any).determineTemplateType(smallAmountEvent as ProcessingEvent)).toBe('transaction_small');
    });

    it('should determine position update template based on action', () => {
      const openEvent = { type: 'POSITION_UPDATE', data: { position: { previousSize: 0 } } };
      const increaseEvent = { type: 'POSITION_UPDATE', data: { position: { previousSize: 10, size: 20 } } };
      const decreaseEvent = { type: 'POSITION_UPDATE', data: { position: { previousSize: 20, size: 10 } } };
      const closeEvent = { type: 'POSITION_UPDATE', data: { position: { previousSize: 10, size: 0 } } };

      expect((service as any).determineTemplateType(openEvent as ProcessingEvent)).toBe('position_opened');
      expect((service as any).determineTemplateType(increaseEvent as ProcessingEvent)).toBe('position_increased');
      expect((service as any).determineTemplateType(decreaseEvent as ProcessingEvent)).toBe('position_decreased');
      expect((service as any).determineTemplateType(closeEvent as ProcessingEvent)).toBe('position_closed');
    });

    it('should determine resolution template based on resolution type', () => {
      const yesEvent = { type: 'RESOLUTION', data: { resolution: 'YES' } };
      const noEvent = { type: 'RESOLUTION', data: { resolution: 'NO' } };
      const otherEvent = { type: 'RESOLUTION', data: { resolution: 'MAYBE' } };

      expect((service as any).determineTemplateType(yesEvent as ProcessingEvent)).toBe('market_resolved_yes');
      expect((service as any).determineTemplateType(noEvent as ProcessingEvent)).toBe('market_resolved_no');
      expect((service as any).determineTemplateType(otherEvent as ProcessingEvent)).toBe('market_resolved_ambiguous');
    });

    it('should determine price update template based on change', () => {
      const spikeUpEvent = { type: 'PRICE_UPDATE', data: { priceChange: 25 } };
      const spikeDownEvent = { type: 'PRICE_UPDATE', data: { priceChange: -25 } };
      const normalEvent = { type: 'PRICE_UPDATE', data: { priceChange: 10 } };

      expect((service as any).determineTemplateType(spikeUpEvent as ProcessingEvent)).toBe('price_spike_up');
      expect((service as any).determineTemplateType(spikeDownEvent as ProcessingEvent)).toBe('price_spike_down');
      expect((service as any).determineTemplateType(normalEvent as ProcessingEvent)).toBe('price_threshold_crossed');
    });

    it('should default to system template for unknown types', () => {
      const unknownEvent = { type: 'UNKNOWN_TYPE', data: {} };

      expect((service as any).determineTemplateType(unknownEvent as ProcessingEvent)).toBe('system');
    });
  });

  describe('getUserPreferences()', () => {
    const mockUserPreferences: TelegramUserPreferences = {
      userId: 12345,
      notifications: {
        enabled: true,
        types: {
          positionUpdates: true,
          transactions: true,
          resolutions: true,
          priceAlerts: true,
          largePositions: true,
        },
        thresholds: {
          minPositionSize: 100,
          minTransactionAmount: 1000,
          priceChangeThreshold: 5,
        },
      },
      wallets: [],
      favorites: [],
      language: 'en',
      timezone: 'UTC',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      MockRedisClient.hget = jest.fn();
    });

    it('should get user preferences from Redis', async () => {
      MockRedisClient.hget.mockResolvedValue(JSON.stringify(mockUserPreferences));

      const preferences = await (service as any).getUserPreferences(12345);

      expect(preferences).toEqual(mockUserPreferences);
      expect(MockRedisClient.hget).toHaveBeenCalledWith('user:12345:preferences', 'preferences');
    });

    it('should return null if preferences not found', async () => {
      MockRedisClient.hget.mockResolvedValue(null);

      const preferences = await (service as any).getUserPreferences(12345);

      expect(preferences).toBeNull();
    });

    it('should handle JSON parsing errors', async () => {
      MockRedisClient.hget.mockResolvedValue('invalid-json');

      const preferences = await (service as any).getUserPreferences(12345);

      expect(preferences).toBeNull();
    });

    it('should handle Redis errors gracefully', async () => {
      MockRedisClient.hget.mockImplementation(() => {
        throw new Error('Redis connection error');
      });

      const preferences = await (service as any).getUserPreferences(12345);

      expect(preferences).toBeNull();
    });
  });

  describe('sendNotification()', () => {
    const mockNotification: NotificationData = {
      type: 'transaction',
      title: 'Test Notification',
      message: 'Test message',
      userId: 12345,
      priority: 'normal',
      metadata: {
        source: 'test',
        timestamp: Date.now(),
      },
    };

    beforeEach(() => {
      MockNotificationQueueManager.prototype.enqueue = jest.fn();
      MockNotificationDispatcher.prototype.enqueue = jest.fn();
    });

    it('should send notification immediately for immediate delivery', async () => {
      MockNotificationDispatcher.prototype.enqueue.mockResolvedValue('dispatcher-id');

      const result = await (service as any).sendNotification(mockNotification);

      expect(result).toBe('dispatcher-id');
      expect(MockNotificationDispatcher.prototype.enqueue).toHaveBeenCalledWith(mockNotification, {
        priority: 'normal',
      });
    });

    it('should schedule notification for future delivery', async () => {
      const futureDate = new Date(Date.now() + 5000);
      MockNotificationQueueManager.prototype.enqueue.mockResolvedValue('queue-id');

      const result = await (service as any).sendNotification(mockNotification, {
        scheduledFor: futureDate,
      });

      expect(result).toBe('queue-id');
      expect(MockNotificationQueueManager.prototype.enqueue).toHaveBeenCalledWith(mockNotification, {
        delay: 5000,
        priority: 'normal',
        retryable: true,
      });
    });

    it('should handle errors in notification sending', async () => {
      MockNotificationDispatcher.prototype.enqueue.mockImplementation(() => {
        throw new Error('Send failed');
      });

      await expect(
        (service as any).sendNotification(mockNotification)
      ).rejects.toThrow('Send failed');
    });
  });

  describe('getServiceStatus()', () => {
    beforeEach(() => {
      jest.spyOn(service as any, 'startTime').mockReturnValue(new Date(Date.now() - 3600000)); // 1 hour ago
      const mockWsClientStats = {
        subscribedChannels: ['transactions', 'positions'],
        messagesReceived: 100,
        lastMessageAt: new Date(),
      };
      mockWebSocketClient.getStats.mockReturnValue(mockWsClientStats);
    });

    it('should return complete service status', async () => {
      MockNotificationQueueManager.prototype.getQueueStatus.mockResolvedValue({
        size: 5,
        processing: 2,
      });

      MockNotificationDispatcher.prototype.getMetrics.mockReturnValue({
        totalDispatched: 50,
        totalFailed: 2,
        averageDispatchTime: 150,
      });

      MockNotificationMonitoringAnalytics.prototype.getHealthStatus.mockResolvedValue({
        status: 'healthy',
        checks: { allPassed: true },
      });

      const status = await service.getServiceStatus();

      expect(status).toMatchObject({
        websocket: {
          connected: false,
          subscriptions: 2,
          messagesReceived: 100,
        },
        notification: {
          queued: 5,
          processing: 2,
          delivered: 50,
          failed: 2,
          averageDeliveryTime: 150,
        },
        system: {
          uptime: expect.any(Number),
          memoryUsage: expect.any(Number),
          cpuUsage: 0,
          health: 'healthy',
        },
      });
    });

    it('should handle errors in status retrieval', async () => {
      MockNotificationQueueManager.prototype.getQueueStatus.mockRejectedValue(new Error('Queue error'));

      await expect(service.getServiceStatus()).rejects.toThrow('Queue error');
    });
  });

  describe('updateConfig()', () => {
    it('should update configuration and child services', () => {
      const newConfig = {
        ...mockConfig,
        targetSuccessRate: 99,
        targetDeliveryTime: 150,
      };

      service.updateConfig(newConfig);

      expect((service as any).config).toEqual(newConfig);
    });
  });

  describe('Public API Methods', () => {
    describe('sendManualNotification()', () => {
      it('should send manual notification with user ID', async () => {
        const mockSendNotification = jest.spyOn(service as any, 'sendNotification')
          .mockResolvedValue('manual-id');

        const notificationData = {
          type: 'transaction',
          title: 'Manual Test',
          message: 'Manual message',
        };

        const result = await service.sendManualNotification(12345, notificationData);

        expect(result).toBe('manual-id');
        expect(mockSendNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 12345,
            metadata: expect.objectContaining({
              source: 'manual',
              timestamp: expect.any(Number),
            }),
          })
        );
      });
    });

    describe('sendBroadcastNotification()', () => {
      beforeEach(() => {
        MockRedisClient.smembers.mockResolvedValue(['12345', '67890', '99999']);
      });

      it('should send broadcast to all active users', async () => {
        const mockSendManualNotification = jest.spyOn(service, 'sendManualNotification')
          .mockResolvedValue('broadcast-id');

        const notificationData = {
          type: 'transaction',
          title: 'Broadcast Test',
          message: 'Broadcast message',
        };

        const result = await service.sendBroadcastNotification(notificationData);

        expect(result).toEqual(['broadcast-id', 'broadcast-id', 'broadcast-id']);
        expect(mockSendManualNotification).toHaveBeenCalledTimes(3);
      });

      it('should apply user filter', async () => {
        const mockSendManualNotification = jest.fn()
          .mockResolvedValue('broadcast-id');

        const notificationData = {
          type: 'transaction',
          title: 'Filtered Broadcast',
          message: 'Filtered message',
        };

        await service.sendBroadcastNotification(notificationData, (userId) => userId === 12345);

        expect(mockSendManualNotification).toHaveBeenCalledTimes(1);
        expect(mockSendManualNotification).toHaveBeenCalledWith(12345, notificationData);
      });

      it('should handle Redis errors in broadcast', async () => {
        MockRedisClient.smembers.mockImplementation(() => {
          throw new Error('Redis error');
        });

        await expect(
          service.sendBroadcastNotification({ type: 'transaction', title: 'Test', message: 'Test' })
        ).rejects.toThrow('Redis error');
      });
    });

    describe('updateUserPreferences()', () => {
      it('should update user preferences through preference filter', async () => {
        MockUserPreferenceFilter.prototype.updateUserPreferences.mockResolvedValue(true);

        const preferences = {
          notifications: { enabled: false },
        };

        const result = await service.updateUserPreferences(12345, preferences);

        expect(result).toBe(true);
        expect(MockUserPreferenceFilter.prototype.updateUserPreferences).toHaveBeenCalledWith(12345, preferences);
      });

      it('should handle errors in preference update', async () => {
        MockUserPreferenceFilter.prototype.updateUserPreferences.mockImplementation(() => {
          throw new Error('Update failed');
        });

        await expect(
          service.updateUserPreferences(12345, { notifications: { enabled: false } })
        ).resolves.toBe(false);
      });
    });

    describe('getUserNotificationHistory()', () => {
      it('should get user notification history through analytics', async () => {
        const mockHistory = [
          {
            id: '1',
            type: 'transaction',
            title: 'Test',
            message: 'Test message',
            timestamp: new Date(),
          },
        ];

        MockNotificationHistoryAnalytics.prototype.getNotificationHistory.mockResolvedValue(mockHistory);

        const result = await service.getUserNotificationHistory(12345, {
          limit: 10,
          type: 'transaction',
        });

        expect(result).toBe(mockHistory);
        expect(MockNotificationHistoryAnalytics.prototype.getNotificationHistory).toHaveBeenCalledWith({
          userId: 12345,
          type: 'transaction',
          dateRange: undefined,
          limit: 10,
          offset: undefined,
        });
      });
    });

    describe('getSystemAnalytics()', () => {
      it('should get system analytics', async () => {
        const mockAnalytics = {
          totalNotifications: 1000,
          successfulDeliveries: 950,
          averageDeliveryTime: 150,
        };

        MockNotificationHistoryAnalytics.prototype.getNotificationAnalytics.mockResolvedValue(mockAnalytics);

        const result = await service.getSystemAnalytics();

        expect(result).toBe(mockAnalytics);
        expect(MockNotificationHistoryAnalytics.prototype.getNotificationAnalytics).toHaveBeenCalled();
      });
    });

    describe('getMonitoringDashboard()', () => {
      it('should get monitoring dashboard', async () => {
        const mockDashboard = {
          overallHealth: 'healthy',
          activeUsers: 1000,
          queueDepth: 5,
          deliveryRate: 95,
        };

        MockNotificationMonitoringAnalytics.prototype.getSystemOverview.mockResolvedValue(mockDashboard);

        const result = await service.getMonitoringDashboard();

        expect(result).toBe(mockDashboard);
        expect(MockNotificationMonitoringAnalytics.prototype.getSystemOverview).toHaveBeenCalled();
      });
    });
  });
});