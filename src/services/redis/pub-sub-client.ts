/**
 * Pub/Sub Client for Real-time Data
 * Handles Redis pub/sub for Polymarket WebSocket data and real-time notifications
 */

import { EventEmitter } from 'events';
import { redisClient } from './redis-client';
import { logger } from '@/utils/logger';
import { AppError, ErrorType } from '@/utils/error-handler';
import { redisKeys } from '@/config/redis';
import type {
  PubSubMessage,
  PubSubSubscription,
  PubSubSubscription as Subscription,
} from '@/types/redis';

export class PubSubClient extends EventEmitter {
  private publisher: any = null; // Redis client for publishing
  private subscriber: any = null; // Redis client for subscribing
  private subscriptions: Map<string, PubSubSubscription> = new Map();
  private subscriptionPatterns: Map<string, PubSubSubscription> = new Map();
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isShuttingDown = false;

  constructor() {
    super();
    this.setupErrorHandling();
  }

  /**
   * Initialize pub/sub connections
   */
  async connect(): Promise<void> {
    try {
      logger.info('Initializing Redis pub/sub connections');

      // Get separate Redis clients for pub/sub
      this.publisher = await this.createPublisher();
      this.subscriber = await this.createSubscriber();

      this.isConnected = true;
      this.reconnectAttempts = 0;

      logger.info('Redis pub/sub client connected successfully', {
        publisherConnected: !!this.publisher,
        subscriberConnected: !!this.subscriber,
      });

      this.emit('connected');

    } catch (error) {
      logger.error('Failed to connect Redis pub/sub client', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new AppError(
        `Failed to connect Redis pub/sub: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorType.WEBSOCKET,
        500
      );
    }
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(
    channel: string,
    callback: (message: PubSubMessage) => void | Promise<void>,
    options: { pattern?: string; active?: boolean } = {}
  ): Promise<void> {
    try {
      if (!this.isConnected) {
        throw new AppError('Pub/sub client not connected', ErrorType.WEBSOCKET);
      }

      const subscription: PubSubSubscription = {
        channel,
        pattern: options.pattern,
        callback,
        active: options.active !== false,
        subscribedAt: Date.now(),
        messageCount: 0,
      };

      if (options.pattern) {
        await this.subscriber.psubscribe(options.pattern);
        this.subscriptionPatterns.set(options.pattern, subscription);
        logger.debug('Subscribed to pattern', {
          pattern: options.pattern,
          channel,
        });
      } else {
        await this.subscriber.subscribe(channel);
        this.subscriptions.set(channel, subscription);
        logger.debug('Subscribed to channel', { channel });
      }

      this.emit('subscribed', { channel, pattern: options.pattern });

    } catch (error) {
      logger.error('Failed to subscribe', {
        channel,
        pattern: options.pattern,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new AppError(
        `Failed to subscribe to ${channel}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorType.WEBSOCKET
      );
    }
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel?: string, pattern?: string): Promise<void> {
    try {
      if (!this.isConnected) {
        return;
      }

      if (pattern) {
        await this.subscriber.punsubscribe(pattern);
        this.subscriptionPatterns.delete(pattern);
        logger.debug('Unsubscribed from pattern', { pattern });
      } else if (channel) {
        await this.subscriber.unsubscribe(channel);
        this.subscriptions.delete(channel);
        logger.debug('Unsubscribed from channel', { channel });
      } else {
        // Unsubscribe from all
        await this.subscriber.punsubscribe('*');
        await this.subscriber.unsubscribe('*');
        this.subscriptions.clear();
        this.subscriptionPatterns.clear();
        logger.debug('Unsubscribed from all channels and patterns');
      }

      this.emit('unsubscribed', { channel, pattern });

    } catch (error) {
      logger.error('Failed to unsubscribe', {
        channel,
        pattern,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Publish a message to a channel
   */
  async publish(
    channel: string,
    data: any,
    options: {
      messageId?: string;
      source?: string;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<boolean> {
    try {
      if (!this.isConnected) {
        throw new AppError('Pub/sub client not connected', ErrorType.WEBSOCKET);
      }

      const message: PubSubMessage = {
        channel,
        data,
        timestamp: Date.now(),
        messageId: options.messageId || this.generateMessageId(),
        source: options.source || 'unknown',
        metadata: options.metadata || {},
      };

      const serializedMessage = JSON.stringify(message);
      const result = await this.publisher.publish(channel, serializedMessage);

      logger.debug('Message published', {
        channel,
        messageId: message.messageId,
        source: message.source,
        subscribers: result,
        size: serializedMessage.length,
      });

      this.emit('published', { channel, message, subscribers: result });

      return result > 0;

    } catch (error) {
      logger.error('Failed to publish message', {
        channel,
        messageId: options.messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Publish Polymarket price updates
   */
  async publishPriceUpdate(
    marketId: string,
    price: number,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    return this.publish(redisKeys.channels.polymarket.prices, {
      type: 'price_update',
      marketId,
      price,
      timestamp: Date.now(),
    }, {
      source: 'polymarket',
      metadata: {
        ...metadata,
        category: 'price',
      },
    });
  }

  /**
   * Publish Polymarket volume updates
   */
  async publishVolumeUpdate(
    marketId: string,
    volume: number,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    return this.publish(redisKeys.channels.polymarket.volumes, {
      type: 'volume_update',
      marketId,
      volume,
      timestamp: Date.now(),
    }, {
      source: 'polymarket',
      metadata: {
        ...metadata,
        category: 'volume',
      },
    });
  }

  /**
   * Publish Polymarket liquidity updates
   */
  async publishLiquidityUpdate(
    marketId: string,
    liquidity: number,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    return this.publish(redisKeys.channels.polymarket.liquidity, {
      type: 'liquidity_update',
      marketId,
      liquidity,
      timestamp: Date.now(),
    }, {
      source: 'polymarket',
      metadata: {
        ...metadata,
        category: 'liquidity',
      },
    });
  }

  /**
   * Publish market resolution events
   */
  async publishResolution(
    marketId: string,
    outcome: string,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    return this.publish(redisKeys.channels.polymarket.resolutions, {
      type: 'resolution',
      marketId,
      outcome,
      timestamp: Date.now(),
    }, {
      source: 'polymarket',
      metadata: {
        ...metadata,
        category: 'resolution',
        priority: 'high',
      },
    });
  }

  /**
   * Publish new market events
   */
  async publishNewMarket(
    market: any,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    return this.publish(redisKeys.channels.polymarket.newMarkets, {
      type: 'new_market',
      market,
      timestamp: Date.now(),
    }, {
      source: 'polymarket',
      metadata: {
        ...metadata,
        category: 'market',
        priority: 'medium',
      },
    });
  }

  /**
   * Publish user notifications
   */
  async publishNotification(
    userId: number,
    type: string,
    content: any,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    const channel = `${redisKeys.channels.notifications.general}:${userId}`;

    return this.publish(channel, {
      type,
      userId,
      content,
      timestamp: Date.now(),
    }, {
      source: 'notification_service',
      metadata: {
        ...metadata,
        category: 'notification',
        userId,
      },
    });
  }

  /**
   * Publish price alerts
   */
  async publishPriceAlert(
    userIds: number[],
    marketId: string,
    price: number,
    threshold: number,
    metadata?: Record<string, any>
  ): Promise<boolean[]> {
    const promises = userIds.map(userId =>
      this.publish(`${redisKeys.channels.notifications.priceAlerts}:${userId}`, {
        type: 'price_alert',
        userId,
        marketId,
        price,
        threshold,
        timestamp: Date.now(),
      }, {
        source: 'alert_service',
        metadata: {
          ...metadata,
          category: 'alert',
          marketId,
          threshold,
        },
      })
    );

    return Promise.all(promises);
  }

  /**
   * Publish resolution alerts
   */
  async publishResolutionAlert(
    userIds: number[],
    marketId: string,
    outcome: string,
    metadata?: Record<string, any>
  ): Promise<boolean[]> {
    const promises = userIds.map(userId =>
      this.publish(`${redisKeys.channels.notifications.resolutions}:${userId}`, {
        type: 'resolution_alert',
        userId,
        marketId,
        outcome,
        timestamp: Date.now(),
      }, {
        source: 'alert_service',
        metadata: {
          ...metadata,
          category: 'alert',
          marketId,
          outcome,
        },
      })
    );

    return Promise.all(promises);
  }

  /**
   * Publish system health events
   */
  async publishHealthEvent(
    status: 'healthy' | 'degraded' | 'unhealthy',
    details: Record<string, any>
  ): Promise<boolean> {
    return this.publish(redisKeys.channels.system.health, {
      type: 'health_event',
      status,
      details,
      timestamp: Date.now(),
    }, {
      source: 'health_monitor',
      metadata: {
        category: 'system',
        priority: status === 'unhealthy' ? 'high' : 'low',
      },
    });
  }

  /**
   * Publish system metrics
   */
  async publishMetrics(
    metrics: Record<string, any>,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    return this.publish(redisKeys.channels.system.metrics, {
      type: 'metrics',
      metrics,
      timestamp: Date.now(),
    }, {
      source: 'metrics_collector',
      metadata: {
        ...metadata,
        category: 'system',
      },
    });
  }

  /**
   * Publish system errors
   */
  async publishError(
    error: Error,
    context: Record<string, any>
  ): Promise<boolean> {
    return this.publish(redisKeys.channels.system.errors, {
      type: 'error',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      context,
      timestamp: Date.now(),
    }, {
      source: 'error_handler',
      metadata: {
        category: 'system',
        priority: 'high',
      },
    });
  }

  /**
   * Get subscription statistics
   */
  getSubscriptionStats(): {
    total: number;
    active: number;
    channels: Array<{ channel: string; active: boolean; messageCount: number }>;
    patterns: Array<{ pattern: string; active: boolean; messageCount: number }>;
  } {
    const channels = Array.from(this.subscriptions.entries()).map(([channel, sub]) => ({
      channel,
      active: sub.active,
      messageCount: sub.messageCount,
    }));

    const patterns = Array.from(this.subscriptionPatterns.entries()).map(([pattern, sub]) => ({
      pattern,
      active: sub.active,
      messageCount: sub.messageCount,
    }));

    const total = channels.length + patterns.length;
    const active = channels.filter(c => c.active).length + patterns.filter(p => p.active).length;

    return {
      total,
      active,
      channels,
      patterns,
    };
  }

  /**
   * Check if connected
   */
  isPubSubConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get connected status
   */
  getStatus(): {
    connected: boolean;
    subscriptions: number;
    patterns: number;
    reconnectAttempts: number;
  } {
    return {
      connected: this.isConnected,
      subscriptions: this.subscriptions.size,
      patterns: this.subscriptionPatterns.size,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Disconnect pub/sub client
   */
  async disconnect(): Promise<void> {
    this.isShuttingDown = true;

    try {
      // Unsubscribe from all channels
      await this.unsubscribe();

      // Close connections
      if (this.publisher) {
        await this.publisher.quit();
        this.publisher = null;
      }

      if (this.subscriber) {
        await this.subscriber.quit();
        this.subscriber = null;
      }

      this.isConnected = false;
      this.subscriptions.clear();
      this.subscriptionPatterns.clear();

      logger.info('Redis pub/sub client disconnected successfully');
      this.emit('disconnected');

    } catch (error) {
      logger.error('Error disconnecting Redis pub/sub client', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Private helper methods
   */
  private async createPublisher(): Promise<any> {
    try {
      // Create a new Redis client for publishing
      const publisher = new (redisClient.constructor as any)();
      await publisher.connect();
      return publisher;
    } catch (error) {
      logger.error('Failed to create publisher client', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async createSubscriber(): Promise<any> {
    try {
      // Create a new Redis client for subscribing
      const subscriber = new (redisClient.constructor as any)();
      await subscriber.connect();

      // Set up message handlers
      subscriber.on('message', this.handleMessage.bind(this));
      subscriber.on('pmessage', this.handlePatternMessage.bind(this));
      subscriber.on('error', this.handleSubscriberError.bind(this));

      return subscriber;
    } catch (error) {
      logger.error('Failed to create subscriber client', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private handleMessage(channel: string, message: string): void {
    try {
      const parsedMessage: PubSubMessage = JSON.parse(message);
      const subscription = this.subscriptions.get(channel);

      if (subscription && subscription.active) {
        subscription.messageCount++;
        subscription.lastMessageAt = Date.now();

        // Execute callback
        this.executeCallback(subscription.callback, parsedMessage);

        logger.debug('Channel message processed', {
          channel,
          messageId: parsedMessage.messageId,
          messageCount: subscription.messageCount,
        });
      }

    } catch (error) {
      logger.error('Failed to handle channel message', {
        channel,
        message: message.substring(0, 200), // Truncate for logging
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private handlePatternMessage(pattern: string, channel: string, message: string): void {
    try {
      const parsedMessage: PubSubMessage = JSON.parse(message);
      const subscription = this.subscriptionPatterns.get(pattern);

      if (subscription && subscription.active) {
        subscription.messageCount++;
        subscription.lastMessageAt = Date.now();

        // Execute callback
        this.executeCallback(subscription.callback, parsedMessage);

        logger.debug('Pattern message processed', {
          pattern,
          channel,
          messageId: parsedMessage.messageId,
          messageCount: subscription.messageCount,
        });
      }

    } catch (error) {
      logger.error('Failed to handle pattern message', {
        pattern,
        channel,
        message: message.substring(0, 200), // Truncate for logging
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async executeCallback(
    callback: (message: PubSubMessage) => void | Promise<void>,
    message: PubSubMessage
  ): Promise<void> {
    try {
      await callback(message);
    } catch (error) {
      logger.error('Callback execution failed', {
        messageId: message.messageId,
        channel: message.channel,
        source: message.source,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Emit error event for global handling
      this.emit('callbackError', { message, error });
    }
  }

  private handleSubscriberError(error: Error): void {
    logger.error('Subscriber error', {
      error: error.message,
      stack: error.stack,
    });

    this.emit('subscriberError', { error });

    // Attempt reconnection if not shutting down
    if (!this.isShuttingDown) {
      this.scheduleReconnection();
    }
  }

  private scheduleReconnection(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached for pub/sub client');
      this.emit('reconnectionFailed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info('Scheduling pub/sub reconnection', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delay,
    });

    setTimeout(async () => {
      if (!this.isShuttingDown) {
        try {
          this.isConnected = false;
          await this.connect();

          // Resubscribe to previous subscriptions
          await this.resubscribeAll();

          this.emit('reconnected');
          logger.info('Pub/sub client reconnected successfully');

        } catch (error) {
          logger.error('Pub/sub reconnection failed', {
            attempt: this.reconnectAttempts,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          this.scheduleReconnection();
        }
      }
    }, delay);
  }

  private async resubscribeAll(): Promise<void> {
    const resubscriptions: Promise<void>[] = [];

    // Resubscribe to channels
    for (const [channel, subscription] of this.subscriptions) {
      if (subscription.active) {
        resubscriptions.push(this.subscribe(channel, subscription.callback, {
          active: true,
        }));
      }
    }

    // Resubscribe to patterns
    for (const [pattern, subscription] of this.subscriptionPatterns) {
      if (subscription.active) {
        resubscriptions.push(this.subscribe('', subscription.callback, {
          pattern,
          active: true,
        }));
      }
    }

    try {
      await Promise.all(resubscriptions);
      logger.info('Resubscribed to all previous subscriptions', {
        channels: this.subscriptions.size,
        patterns: this.subscriptionPatterns.size,
      });
    } catch (error) {
      logger.error('Failed to resubscribe to all channels', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupErrorHandling(): void {
    // Handle process termination
    const gracefulShutdown = async () => {
      await this.disconnect();
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGUSR2', gracefulShutdown); // nodemon restart
  }
}

// Create and export singleton instance
export const pubSubClient = new PubSubClient();

// Export types and utilities
export { PubSubClient };