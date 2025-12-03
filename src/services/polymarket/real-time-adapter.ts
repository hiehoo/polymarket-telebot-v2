import { EventEmitter } from 'events';
import { RealTimeDataClient } from '@polymarket/real-time-data-client';
import { logger } from '../../utils/logger';
import { ProcessingEvent } from '../../types/data-processing';
import { PolymarketEvent } from '../../types/polymarket';

interface RealTimeAdapterConfig {
  enabledTopics?: string[];
  clobAuth?: {
    key: string;
    secret: string;
    passphrase: string;
  };
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
}

interface PolymarketMessage {
  topic: string;
  type: string;
  payload: any;
}

export class RealTimeDataAdapter extends EventEmitter {
  private client: RealTimeDataClient | null = null;
  private config: RealTimeAdapterConfig;
  private isConnected = false;
  private reconnectAttempts = 0;
  private subscriptions: Set<string> = new Set();

  constructor(config: RealTimeAdapterConfig = {}) {
    super();

    this.config = {
      enabledTopics: ['activity', 'clob_market', 'crypto_prices'],
      autoReconnect: true,
      maxReconnectAttempts: 10,
      ...config
    };

    logger.info('Real-time data adapter initialized', {
      enabledTopics: this.config.enabledTopics,
      hasAuth: !!this.config.clobAuth
    });
  }

  async connect(): Promise<void> {
    try {
      logger.info('Connecting to Polymarket real-time data client...');

      this.client = new RealTimeDataClient({
        onMessage: (client: any, message: any) => {
          this.handleMessage(message);
        },
        onConnect: (client: RealTimeDataClient) => {
          this.handleConnect(client);
        },
      });

      await this.client.connect();

    } catch (error) {
      logger.error('Failed to connect to real-time data client:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.disconnect();
        this.client = null;
      }
      this.isConnected = false;
      this.subscriptions.clear();
      logger.info('Disconnected from real-time data client');
    } catch (error) {
      logger.error('Error disconnecting from real-time data client:', error);
    }
  }

  async subscribe(topic: string, filters?: any): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error('Client not connected');
    }

    try {
      const subscription: any = {
        topic,
        type: '*'
      };

      // Add filters if provided
      if (filters) {
        subscription.filters = JSON.stringify(filters);
      }

      // Add authentication for CLOB topics
      if ((topic === 'clob_user' || topic === 'clob_market') && this.config.clobAuth) {
        subscription.clob_auth = this.config.clobAuth;
      }

      await this.client.subscribe({
        subscriptions: [subscription]
      });

      this.subscriptions.add(topic);
      logger.info(`Subscribed to topic: ${topic}`, { filters });

    } catch (error) {
      logger.error(`Failed to subscribe to topic ${topic}:`, error);
      throw error;
    }
  }

  async unsubscribe(topic: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      // Note: The official client doesn't seem to have an unsubscribe method
      // We'll track subscriptions locally for now
      this.subscriptions.delete(topic);
      logger.info(`Unsubscribed from topic: ${topic}`);
    } catch (error) {
      logger.error(`Failed to unsubscribe from topic ${topic}:`, error);
    }
  }

  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  isClientConnected(): boolean {
    return this.isConnected;
  }

  private handleConnect(client: RealTimeDataClient): void {
    this.isConnected = true;
    this.reconnectAttempts = 0;

    logger.info('Real-time data client connected successfully');
    this.emit('connected');

    // Subscribe to default topics
    this.subscribeToDefaultTopics();
  }

  private handleDisconnect(): void {
    this.isConnected = false;
    this.subscriptions.clear();

    logger.warn('Real-time data client disconnected');
    this.emit('disconnected');

    // Handle reconnection
    if (this.config.autoReconnect && this.reconnectAttempts < (this.config.maxReconnectAttempts || 10)) {
      this.scheduleReconnect();
    }
  }

  private handleError(error: Error): void {
    logger.error('Real-time data client error:', error);
    this.emit('error', error);
  }

  private handleMessage(message: PolymarketMessage): void {
    try {
      const event = this.transformMessage(message);
      if (event) {
        this.emit('message', event);
        logger.debug('Processed real-time message', {
          topic: message.topic,
          type: message.type,
          eventType: event.type
        });
      }
    } catch (error) {
      logger.error('Error processing real-time message:', error);
    }
  }

  private transformMessage(message: PolymarketMessage): ProcessingEvent | null {
    const { topic, type, payload } = message;

    try {
      switch (topic) {
        case 'activity':
          return this.transformActivityMessage(type, payload);

        case 'clob_market':
          return this.transformClobMarketMessage(type, payload);

        case 'clob_user':
          return this.transformClobUserMessage(type, payload);

        case 'crypto_prices':
        case 'equity_prices':
          return this.transformPriceMessage(type, payload);

        default:
          logger.debug(`Unhandled topic: ${topic}`);
          return null;
      }
    } catch (error) {
      logger.error(`Error transforming message for topic ${topic}:`, error);
      return null;
    }
  }

  private transformActivityMessage(type: string, payload: any): ProcessingEvent {
    return {
      id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'TRANSACTION',
      timestamp: new Date(),
      data: {
        transaction: {
          id: payload.id || payload.transactionId,
          user: payload.user || payload.address,
          type: payload.side === 'buy' ? 'BUY' : 'SELL',
          conditionId: payload.conditionId || payload.market_id,
          outcome: payload.outcome,
          amount: parseFloat(payload.size || payload.amount || '0'),
          price: parseFloat(payload.price || '0'),
          timestamp: payload.timestamp || new Date().toISOString(),
          hash: payload.hash || payload.txHash || '',
          blockNumber: payload.blockNumber,
          gasUsed: payload.gasUsed,
          fee: payload.fee
        }
      },
      processedAt: null as any,
      processingTime: 0,
      status: 'pending',
      retryCount: 0,
      metadata: {
        source: 'websocket',
        priority: 'medium'
      }
    };
  }

  private transformClobMarketMessage(type: string, payload: any): ProcessingEvent {
    return {
      id: `clob_market_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'PRICE_UPDATE',
      timestamp: new Date(),
      data: {
        marketData: {
          conditionId: payload.conditionId || payload.market_id,
          price: parseFloat(payload.price || '0'),
          probability: parseFloat(payload.probability || '0'),
          volume24h: parseFloat(payload.volume24h || '0'),
          liquidity: parseFloat(payload.liquidity || '0'),
          timestamp: payload.timestamp || new Date().toISOString(),
          priceChange24h: parseFloat(payload.priceChange24h || '0')
        }
      },
      processedAt: null as any,
      processingTime: 0,
      status: 'pending',
      retryCount: 0,
      metadata: {
        source: 'websocket',
        priority: 'medium'
      }
    };
  }

  private transformClobUserMessage(type: string, payload: any): ProcessingEvent {
    return {
      id: `clob_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'POSITION_UPDATE',
      timestamp: new Date(),
      data: {
        position: {
          id: payload.id || payload.positionId,
          user: payload.user || payload.address,
          conditionId: payload.conditionId || payload.market_id,
          outcome: payload.outcome,
          side: payload.side === 'buy' ? 'YES' : 'NO',
          size: parseFloat(payload.size || '0'),
          price: parseFloat(payload.price || '0'),
          createdAt: payload.createdAt || new Date().toISOString(),
          updatedAt: payload.updatedAt || new Date().toISOString(),
          status: payload.status || 'ACTIVE'
        }
      },
      processedAt: null as any,
      processingTime: 0,
      status: 'pending',
      retryCount: 0,
      metadata: {
        source: 'websocket',
        priority: 'medium'
      }
    };
  }

  private transformPriceMessage(type: string, payload: any): ProcessingEvent {
    return {
      id: `price_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'PRICE_UPDATE',
      timestamp: new Date(),
      data: {
        marketData: {
          conditionId: payload.symbol || payload.conditionId,
          price: parseFloat(payload.price || '0'),
          probability: parseFloat(payload.probability || '0'),
          volume24h: parseFloat(payload.volume || '0'),
          priceChange24h: parseFloat(payload.change24h || '0'),
          timestamp: payload.timestamp || new Date().toISOString(),
        }
      },
      processedAt: null as any,
      processingTime: 0,
      status: 'pending',
      retryCount: 0,
      metadata: {
        source: 'websocket',
        priority: 'medium'
      }
    };
  }

  private async subscribeToDefaultTopics(): Promise<void> {
    if (!this.config.enabledTopics) return;

    for (const topic of this.config.enabledTopics) {
      try {
        await this.subscribe(topic);
      } catch (error) {
        logger.error(`Failed to subscribe to default topic ${topic}:`, error);
      }
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    setTimeout(() => {
      if (this.reconnectAttempts <= (this.config.maxReconnectAttempts || 10)) {
        this.connect().catch(error => {
          logger.error('Reconnect attempt failed:', error);
        });
      } else {
        logger.error('Max reconnect attempts reached');
        this.emit('maxReconnectAttemptsReached');
      }
    }, delay);
  }

  // Utility methods for backward compatibility
  getStats() {
    return {
      connected: this.isConnected,
      subscriptions: this.subscriptions.size,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

export default RealTimeDataAdapter;