import WebSocket from 'ws';
import EventEmitter from 'events';
import { config } from '@/config';
import logger from '@/utils/logger';
import { WebSocketError, ApiError, handleError } from '@/utils/error-handler';
import {
  WebSocketClientConfig,
  WebSocketConnectionStats,
  WebSocketSubscription,
  ProcessingEvent,
  SubscriptionFilter,
  PolymarketWebSocketMessage,
  PolymarketEvent,
  RateLimitInfo,
  CircuitBreakerConfig,
  CircuitBreakerState,
} from '@/types/data-processing';
import {
  polymarketWebSocketConfig,
  polymarketWebSocketChannels,
  polymarketRetryPolicy,
  polymarketDebugConfig,
} from '@/config/polymarket';
import { PolymarketPosition, PolymarketTransaction, PolymarketCondition, PolymarketMarketData } from '@/types/polymarket';

export class PolymarketWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: WebSocketClientConfig;
  private stats: WebSocketConnectionStats;
  private subscriptions: Map<string, WebSocketSubscription> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private messageTimer: NodeJS.Timeout | null = null;
  private messageQueue: PolymarketWebSocketMessage[] = [];
  private processing = false;
  private circuitBreaker: CircuitBreakerState;
  private circuitBreakerConfig: CircuitBreakerConfig;
  private rateLimit: RateLimitInfo | null = null;

  constructor(customConfig?: Partial<WebSocketClientConfig>) {
    super();

    this.config = { ...polymarketWebSocketConfig, ...customConfig };
    this.stats = {
      reconnectCount: 0,
      messagesReceived: 0,
      messagesProcessed: 0,
      bytesReceived: 0,
      latency: 0,
      subscribedChannels: [],
    };

    this.circuitBreakerConfig = {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      monitoringPeriod: 300000, // 5 minutes
      halfOpenMaxCalls: 3,
    };

    this.circuitBreaker = {
      state: 'closed',
      failures: 0,
      calls: 0,
    };

    this.setupErrorHandling();
    this.startMetricsCollection();
  }

  private setupErrorHandling(): void {
    this.on('error', (error) => {
      handleError(error);
    });

    process.on('SIGINT', () => {
      this.disconnect();
    });

    process.on('SIGTERM', () => {
      this.disconnect();
    });
  }

  private startMetricsCollection(): void {
    setInterval(() => {
      this.emit('stats', this.stats);
    }, this.config.heartbeatInterval);
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      logger.warn('WebSocket already connected');
      return;
    }

    if (this.circuitBreaker.state === 'open') {
      const now = Date.now();
      if (now < (this.circuitBreaker.nextAttempt?.getTime() || 0)) {
        throw new WebSocketError('Circuit breaker is open');
      } else {
        this.circuitBreaker.state = 'half_open';
        this.circuitBreaker.calls = 0;
      }
    }

    try {
      logger.info('Connecting to Polymarket WebSocket', {
        url: this.config.url,
        attempt: this.reconnectAttempts + 1,
      });

      this.ws = new WebSocket(this.config.url, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'User-Agent': 'PolymarketTeleBot/1.0',
          'X-Client-Version': '1.0.0',
        },
        perMessageDeflate: this.config.compression,
        handshakeTimeout: this.config.messageTimeout,
      });

      this.setupWebSocketHandlers();

      await this.waitForConnection();
      this.onConnectionEstablished();

    } catch (error) {
      this.onConnectionFailed(error);
      throw error;
    }
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      logger.info('WebSocket connection opened');
      this.stats.connectedAt = new Date();
      this.emit('connected');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error: Error) => {
      this.onWebSocketError(error);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.onWebSocketClose(code, reason.toString());
    });

    this.ws.on('ping', (data: Buffer) => {
      if (this.ws) {
        this.ws.pong(data);
      }
    });

    this.ws.on('pong', (data: Buffer) => {
      this.updateLatency();
    });
  }

  private waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new WebSocketError('WebSocket not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new WebSocketError('Connection timeout'));
      }, this.config.messageTimeout);

      const onOpen = () => {
        clearTimeout(timeout);
        resolve();
      };

      const onError = (error: Error) => {
        clearTimeout(timeout);
        reject(new WebSocketError(`Connection failed: ${error.message}`));
      };

      this.ws.once('open', onOpen);
      this.ws.once('error', onError);
    });
  }

  private onConnectionEstablished(): void {
    this.reconnectAttempts = 0;
    this.updateCircuitBreaker(true);
    this.startHeartbeat();
    this.startMessageProcessing();

    // Resubscribe to channels
    this.resubscribeToChannels();

    this.emit('ready');
    logger.info('WebSocket client ready', {
      subscribedChannels: this.stats.subscribedChannels,
      connectedAt: this.stats.connectedAt,
    });
  }

  private onConnectionFailed(error: any): void {
    this.reconnectAttempts++;
    this.updateCircuitBreaker(false);

    logger.error('WebSocket connection failed', {
      error: error.message,
      attempt: this.reconnectAttempts,
      maxAttempts: this.config.reconnectAttempts,
    });

    if (this.reconnectAttempts < this.config.reconnectAttempts) {
      this.scheduleReconnect();
    } else {
      logger.error('Max reconnection attempts reached, giving up');
      this.emit('maxReconnectAttemptsReached');
    }
  }

  private onWebSocketError(error: Error): void {
    logger.error('WebSocket error', {
      error: error.message,
      stack: error.stack,
      state: this.circuitBreaker.state,
    });

    this.emit('error', new WebSocketError(`WebSocket error: ${error.message}`));
  }

  private onWebSocketClose(code: number, reason: string): void {
    logger.warn('WebSocket connection closed', {
      code,
      reason,
      wasClean: code === 1000,
    });

    this.stats.connectedAt = undefined;
    this.clearHeartbeat();
    this.clearMessageTimer();
    this.emit('disconnected', { code, reason });

    // Attempt reconnection if not a normal closure
    if (code !== 1000) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = this.calculateReconnectDelay();
    logger.info(`Scheduling reconnect in ${delay}ms`, {
      attempt: this.reconnectAttempts,
      maxAttempts: this.config.reconnectAttempts,
    });

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        logger.error('Reconnect failed', { error: error.message });
      });
    }, delay);
  }

  private calculateReconnectDelay(): number {
    const baseDelay = this.config.reconnectDelay;
    const exponentialDelay = baseDelay * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = Math.random() * baseDelay;
    return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const startTime = Date.now();
        this.ws.ping();

        // Set timeout for pong response
        setTimeout(() => {
          if (Date.now() - startTime > this.config.heartbeatInterval * 2) {
            logger.warn('WebSocket heartbeat timeout');
            this.ws?.terminate();
          }
        }, this.config.heartbeatInterval * 2);
      }
    }, this.config.heartbeatInterval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = this.parseMessage(data);
      this.stats.messagesReceived++;
      this.stats.bytesReceived += (data as any).length || (data as ArrayBuffer).byteLength || 0;
      this.stats.lastMessageAt = new Date();

      if (polymarketDebugConfig.logWebSocket) {
        logger.debug('WebSocket message received', {
          type: message.event,
          size: (data as any).length || (data as ArrayBuffer).byteLength || 0,
          timestamp: message.timestamp,
        });
      }

      // Handle rate limit messages
      if (this.handleRateLimit(message)) {
        return;
      }

      // Check if we should process this message (circuit breaker)
      if (!this.canProcessMessage()) {
        logger.warn('Message blocked by circuit breaker');
        return;
      }

      // Add to queue for processing
      this.messageQueue.push(message);

      // Trigger immediate processing if not already processing
      if (!this.processing) {
        this.processMessageQueue();
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to handle WebSocket message', {
        error: errorMessage,
        size: (data as any).length || (data as ArrayBuffer).byteLength || 0,
      });
    }
  }

  private parseMessage(data: WebSocket.Data): PolymarketWebSocketMessage {
    let message: any;

    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      throw new WebSocketError(`Invalid JSON message: ${error}`);
    }

    // Validate message structure
    if (!message.event || !message.timestamp) {
      throw new WebSocketError('Invalid message format');
    }

    return message as PolymarketWebSocketMessage;
  }

  private handleRateLimit(message: PolymarketWebSocketMessage): boolean {
    if (message.event === 'rate_limit') {
      this.rateLimit = {
        limit: message.data.limit,
        remaining: message.data.remaining,
        resetTime: new Date(message.data.resetTime),
        retryAfter: message.data.retryAfter,
      };

      logger.warn('WebSocket rate limit hit', {
        limit: this.rateLimit.limit,
        remaining: this.rateLimit.remaining,
        resetTime: this.rateLimit.resetTime,
        retryAfter: this.rateLimit.retryAfter,
      });

      this.emit('rateLimit', this.rateLimit);
      return true;
    }

    return false;
  }

  private canProcessMessage(): boolean {
    if (this.circuitBreaker.state === 'open') {
      return false;
    }

    if (this.circuitBreaker.state === 'half_open') {
      this.circuitBreaker.calls++;
      if (this.circuitBreaker.calls > this.circuitBreakerConfig.halfOpenMaxCalls) {
        return false;
      }
    }

    return true;
  }

  private async processMessageQueue(): Promise<void> {
    if (this.processing) return;

    this.processing = true;

    try {
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (!message) break;

        await this.processMessage(message);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error processing message queue', { error: errorMessage });
    } finally {
      this.processing = false;
    }
  }

  private async processMessage(message: PolymarketWebSocketMessage): Promise<void> {
    const startTime = Date.now();

    try {
      // Convert WebSocket message to processing event
      const processingEvent = await this.convertToProcessingEvent(message);
      if (!processingEvent) return;

      this.stats.messagesProcessed++;

      this.emit('message', processingEvent);

      if (polymarketDebugConfig.logProcessing) {
        logger.debug('Message processed', {
          type: processingEvent.type,
          processingTime: Date.now() - startTime,
          conditionId: processingEvent.conditionId,
        });
      }

    } catch (error) {
      this.updateCircuitBreaker(false);
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to process message', {
        error: errorMessage,
        message: message.event,
        processingTime: Date.now() - startTime,
      });

      this.emit('processingError', { message, error: errorMessage });
    }
  }

  private async convertToProcessingEvent(message: PolymarketWebSocketMessage): Promise<ProcessingEvent | null> {
    let polymarketEvent: PolymarketEvent;

    try {
      switch (message.event) {
        case 'market_data':
          polymarketEvent = this.convertMarketDataMessage(message);
          break;
        case 'transaction':
          polymarketEvent = this.convertTransactionMessage(message);
          break;
        case 'position_update':
          polymarketEvent = this.convertPositionMessage(message);
          break;
        case 'condition_update':
          polymarketEvent = this.convertConditionMessage(message);
          break;
        case 'resolution':
          polymarketEvent = this.convertResolutionMessage(message);
          break;
        default:
          logger.warn('Unknown message type', { event: message.event });
          return null;
      }

      return {
        ...polymarketEvent,
        id: `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        processedAt: new Date(),
        processingTime: 0,
        status: 'pending',
        retryCount: 0,
        metadata: {
          source: 'websocket',
          priority: this.determineMessagePriority(polymarketEvent),
        },
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to convert message: ${errorMessage}`);
    }
  }

  private convertMarketDataMessage(message: PolymarketWebSocketMessage): PolymarketEvent {
    const data = message.data as PolymarketMarketData;

    return {
      type: 'PRICE_UPDATE',
      data: {
        marketData: data,
      },
      timestamp: message.timestamp,
      conditionId: data.conditionId,
    };
  }

  private convertTransactionMessage(message: PolymarketWebSocketMessage): PolymarketEvent {
    const data = message.data as PolymarketTransaction;

    return {
      type: 'TRANSACTION',
      data: {
        transaction: data,
      },
      timestamp: message.timestamp,
      userId: data.user,
      conditionId: data.conditionId,
    };
  }

  private convertPositionMessage(message: PolymarketWebSocketMessage): PolymarketEvent {
    const data = message.data as PolymarketPosition;

    return {
      type: 'POSITION_UPDATE',
      data: {
        position: data,
      },
      timestamp: message.timestamp,
      userId: data.user,
      conditionId: data.conditionId,
    };
  }

  private convertConditionMessage(message: PolymarketWebSocketMessage): PolymarketEvent {
    const data = message.data as PolymarketCondition;

    return {
      type: 'CONDITION_UPDATE',
      data: {
        condition: data,
      },
      timestamp: message.timestamp,
      conditionId: data.id,
    };
  }

  private convertResolutionMessage(message: PolymarketWebSocketMessage): PolymarketEvent {
    const data = message.data as { condition: PolymarketCondition; resolution: any };

    return {
      type: 'RESOLUTION',
      data: {
        condition: data.condition,
        marketData: undefined,
        position: undefined,
        transaction: undefined,
      },
      timestamp: message.timestamp,
      conditionId: data.condition.id,
    };
  }

  private determineMessagePriority(event: PolymarketEvent): 'low' | 'medium' | 'high' | 'critical' {
    switch (event.type) {
      case 'RESOLUTION':
        return 'critical';
      case 'TRANSACTION':
        return event.data.transaction?.amount && event.data.transaction.amount > 1000 ? 'high' : 'medium';
      case 'POSITION_UPDATE':
        return 'medium';
      case 'PRICE_UPDATE':
        return 'low';
      default:
        return 'medium';
    }
  }

  private updateLatency(): void {
    // This would be calculated based on ping/pong timing
    // For now, we'll use a simple estimate
    this.stats.latency = Math.random() * 100; // Mock latency
  }

  private updateCircuitBreaker(success: boolean): void {
    if (success) {
      this.circuitBreaker.failures = 0;
      if (this.circuitBreaker.state === 'half_open') {
        this.circuitBreaker.state = 'closed';
      }
    } else {
      this.circuitBreaker.failures++;

      if (this.circuitBreaker.failures >= this.circuitBreakerConfig.failureThreshold) {
        this.circuitBreaker.state = 'open';
        this.circuitBreaker.lastFailureTime = new Date();
        this.circuitBreaker.nextAttempt = new Date(
          Date.now() + this.circuitBreakerConfig.resetTimeout
        );
      }
    }
  }

  async subscribe(channel: string, filters?: SubscriptionFilter): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new WebSocketError('WebSocket not connected');
    }

    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const subscription: WebSocketSubscription = {
      id: subscriptionId,
      channel,
      filters: filters || {},
      active: true,
      createdAt: new Date(),
      messageCount: 0,
    };

    try {
      const subscribeMessage = {
        action: 'subscribe',
        channel,
        subscriptionId,
        filters,
      };

      this.ws.send(JSON.stringify(subscribeMessage));

      this.subscriptions.set(subscriptionId, subscription);

      if (!this.stats.subscribedChannels.includes(channel)) {
        this.stats.subscribedChannels.push(channel);
      }

      logger.info('Subscribed to channel', {
        channel,
        subscriptionId,
        filters,
      });

      this.emit('subscribed', { channel, subscriptionId });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new WebSocketError(`Failed to subscribe to ${channel}: ${errorMessage}`);
    }
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new WebSocketError('WebSocket not connected');
    }

    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new WebSocketError(`Subscription not found: ${subscriptionId}`);
    }

    try {
      const unsubscribeMessage = {
        action: 'unsubscribe',
        subscriptionId,
      };

      this.ws.send(JSON.stringify(unsubscribeMessage));

      subscription.active = false;
      this.subscriptions.delete(subscriptionId);

      // Remove channel from subscribed list if no more subscriptions
      const hasOtherSubscriptions = Array.from(this.subscriptions.values())
        .some(sub => sub.channel === subscription.channel && sub.active);

      if (!hasOtherSubscriptions) {
        const index = this.stats.subscribedChannels.indexOf(subscription.channel);
        if (index > -1) {
          this.stats.subscribedChannels.splice(index, 1);
        }
      }

      logger.info('Unsubscribed from channel', {
        channel: subscription.channel,
        subscriptionId,
      });

      this.emit('unsubscribed', { channel: subscription.channel, subscriptionId });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new WebSocketError(`Failed to unsubscribe: ${errorMessage}`);
    }
  }

  private resubscribeToChannels(): void {
    const subscriptions = Array.from(this.subscriptions.values());
    this.subscriptions.clear();
    this.stats.subscribedChannels = [];

    for (const subscription of subscriptions) {
      if (subscription.active) {
        this.subscribe(subscription.channel, subscription.filters).catch((error) => {
          logger.error('Failed to resubscribe', {
            channel: subscription.channel,
            error: error.message,
          });
        });
      }
    }
  }

  private startMessageProcessing(): void {
    if (this.messageTimer) {
      clearInterval(this.messageTimer);
    }

    this.messageTimer = setInterval(() => {
      if (this.messageQueue.length > 0 && !this.processing) {
        this.processMessageQueue();
      }
    }, 100); // Process every 100ms
  }

  private clearMessageTimer(): void {
    if (this.messageTimer) {
      clearInterval(this.messageTimer);
      this.messageTimer = null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.clearHeartbeat();
    this.clearMessageTimer();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Unsubscribe from all channels
      const unsubscribePromises = Array.from(this.subscriptions.keys())
        .map(id => this.unsubscribe(id).catch(() => {})); // Ignore errors during disconnect

      await Promise.all(unsubscribePromises);

      // Close connection
      this.ws.close(1000, 'Client disconnecting');
    }

    this.ws = null;
    this.stats.connectedAt = undefined;

    logger.info('WebSocket client disconnected');
    this.emit('disconnected');
  }

  getStats(): WebSocketConnectionStats {
    return { ...this.stats };
  }

  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimit ? { ...this.rateLimit } : null;
  }

  getSubscriptions(): WebSocketSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getConnectionState(): 'connected' | 'disconnected' | 'connecting' | 'reconnecting' {
    if (!this.ws) return 'disconnected';
    if (this.reconnectAttempts > 0) return 'reconnecting';
    if (this.ws.readyState === WebSocket.CONNECTING) return 'connecting';
    if (this.ws.readyState === WebSocket.OPEN) return 'connected';
    return 'disconnected';
  }
}

export default PolymarketWebSocketClient;