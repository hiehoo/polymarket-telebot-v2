import { EventEmitter } from 'events';
import { config } from '../config';
import { logger } from '../utils/logger';
import { PolymarketRestClient } from './polymarket/rest-client';
import { RealTimeDataAdapter } from './polymarket/real-time-adapter';
import {
  PolymarketPosition,
  PolymarketTransaction,
  PolymarketCondition,
  PolymarketMarketData,
  PolymarketUser,
  PolymarketOrderBook,
  PolymarketHistoricalData
} from '../types/polymarket';
import {
  RestClientConfig,
  WebSocketClientConfig,
  ProcessingEvent,
  CacheManager
} from '../types/data-processing';

interface PolymarketServiceConfig {
  rest?: Partial<RestClientConfig>;
  websocket?: Partial<WebSocketClientConfig>;
  enableWebSocket?: boolean;
  enableCaching?: boolean;
  enableMetrics?: boolean;
}

interface MarketData {
  id: string;
  question: string;
  description: string;
  outcomes: string[];
  volume: number;
  liquidity: number;
  endDate: string;
  resolved: boolean;
  slug?: string;
}

interface WalletPosition {
  marketId: string;
  market: string;
  position: string;
  shares: number;
  value: number;
  pnl: number;
  entryPrice?: number;
  marketData?: MarketData;
  // URL-related fields from Data API
  slug?: string;
  eventSlug?: string;
  title?: string;
}

interface ServiceStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  cacheHitRate: number;
  websocketConnected: boolean;
  lastHealthCheck: Date | null;
}

export class PolymarketService extends EventEmitter {
  private restClient: PolymarketRestClient;
  private rtdClient: RealTimeDataAdapter | null = null;
  private config: PolymarketServiceConfig;
  private stats: ServiceStats;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(customConfig?: PolymarketServiceConfig) {
    super();

    this.config = {
      enableWebSocket: true,
      enableCaching: true,
      enableMetrics: true,
      ...customConfig
    };

    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      websocketConnected: false,
      lastHealthCheck: null
    };

    // Initialize REST client
    this.restClient = new PolymarketRestClient(this.config.rest);

    // Initialize Real-time Data client if enabled
    if (this.config.enableWebSocket) {
      this.initializeRealTimeDataClient();
    }

    // Setup metrics collection
    if (this.config.enableMetrics) {
      this.setupMetricsCollection();
    }

    // Start health check monitoring
    this.startHealthCheck();

    logger.info('Polymarket service initialized', {
      websocketEnabled: this.config.enableWebSocket,
      cachingEnabled: this.config.enableCaching,
      metricsEnabled: this.config.enableMetrics
    });
  }

  private initializeRealTimeDataClient(): void {
    try {
      // Note: clob_market requires authentication and token IDs, so we only enable public topics
      this.rtdClient = new RealTimeDataAdapter({
        enabledTopics: ['activity', 'crypto_prices'],
        autoReconnect: true,
        maxReconnectAttempts: 10
      });

      // Setup Real-time Data client event handlers
      this.rtdClient.on('connected', () => {
        this.stats.websocketConnected = true;
        this.emit('websocket:connected');
        logger.info('Real-time data client connected');
      });

      this.rtdClient.on('disconnected', () => {
        this.stats.websocketConnected = false;
        this.emit('websocket:disconnected');
        logger.warn('Real-time data client disconnected');
      });

      this.rtdClient.on('error', (error) => {
        logger.error('Real-time data client error:', error);
        this.emit('websocket:error', error);
      });

      this.rtdClient.on('message', (event: ProcessingEvent) => {
        this.handleWebSocketMessage(event);
      });

      this.rtdClient.on('maxReconnectAttemptsReached', () => {
        logger.error('Real-time data client max reconnect attempts reached');
        this.stats.websocketConnected = false;
      });

    } catch (error) {
      logger.error('Failed to initialize real-time data client:', error);
      this.rtdClient = null;
    }
  }

  private setupMetricsCollection(): void {
    // Collect metrics from REST client
    setInterval(() => {
      const restStats = this.restClient.getStats();
      this.stats.totalRequests = restStats.requestsMade;
      this.stats.successfulRequests = restStats.successfulRequests;
      this.stats.failedRequests = restStats.failedRequests;
      this.stats.averageResponseTime = restStats.averageResponseTime;
      this.stats.cacheHitRate = restStats.cacheHits / (restStats.cacheHits + restStats.cacheMisses) * 100;

      this.emit('stats', this.stats);
    }, 30000); // Every 30 seconds
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const isHealthy = await this.healthCheck();
        this.stats.lastHealthCheck = new Date();

        if (!isHealthy) {
          logger.warn('Health check failed');
          this.emit('health:check:failed');
        }
      } catch (error) {
        logger.error('Health check error:', error);
        this.emit('health:check:error', error);
      }
    }, 60000); // Every minute
  }

  private handleWebSocketMessage(event: ProcessingEvent): void {
    try {
      // Forward real-time events to service consumers
      this.emit('realtime:event', event);

      // Handle specific event types
      switch (event.type) {
        case 'POSITION_UPDATE':
          this.emit('position:updated', event.data);
          break;
        case 'TRANSACTION':
          this.emit('transaction:new', event.data);
          break;
        case 'RESOLUTION':
          this.emit('market:resolved', event.data);
          break;
        case 'PRICE_UPDATE':
          this.emit('price:changed', event.data);
          break;
        default:
          logger.debug('Unhandled real-time event type:', event.type);
      }
    } catch (error) {
      logger.error('Error handling real-time message:', error);
    }
  }

  // Public API methods compatible with SimplePolymarketService

  async getMarkets(limit = 10): Promise<MarketData[]> {
    try {
      const startTime = Date.now();

      const conditions = await this.restClient.getConditions({
        limit
      });

      const markets: MarketData[] = conditions.map(condition => ({
        id: condition.id,
        question: condition.question || condition.title || 'Unknown Market',
        description: condition.description || '',
        outcomes: condition.outcomes || ['Yes', 'No'],
        volume: condition.volume || 0,
        liquidity: condition.liquidity || 0,
        endDate: condition.endTime,
        resolved: condition.status === 'RESOLVED'
      }));

      this.recordRequestTime(Date.now() - startTime);
      this.stats.successfulRequests++;

      logger.info(`Fetched ${markets.length} markets from Polymarket API`);
      return markets;

    } catch (error: any) {
      this.stats.failedRequests++;
      logger.error('Error fetching markets:', {
        error: error.message,
        status: error.response?.status
      });
      return [];
    }
  }

  async getWalletPositions(walletAddress: string, limit = 500): Promise<WalletPosition[]> {
    try {
      const startTime = Date.now();

      const positions = await this.restClient.getPositions({
        user: walletAddress,
        limit,
        sizeThreshold: 0.01 // Filter out resolved/empty positions
      });

      const walletPositions: WalletPosition[] = positions.map(position => ({
        marketId: position.conditionId,
        market: position.title || position.conditionId, // Use title from Data API
        position: position.side || position.outcome || 'UNKNOWN',
        shares: position.size || 0,
        value: position.currentValue || (position.price || 0) * (position.size || 0),
        pnl: position.cashPnl || 0, // Use P&L from Data API
        entryPrice: position.avgPrice || position.price || 0,
        // URL-related fields from Data API
        slug: position.slug,
        eventSlug: position.eventSlug,
        title: position.title
      }));

      this.recordRequestTime(Date.now() - startTime);
      this.stats.successfulRequests++;

      logger.info(`Fetched ${walletPositions.length} positions for wallet ${walletAddress}`);
      return walletPositions;

    } catch (error: any) {
      this.stats.failedRequests++;
      logger.error('Error fetching wallet positions:', {
        error: error.message,
        status: error.response?.status,
        walletAddress
      });
      return [];
    }
  }

  async getWalletPositionsWithMarketData(walletAddress: string): Promise<WalletPosition[]> {
    try {
      const positions = await this.getWalletPositions(walletAddress);

      logger.info(`Fetching market data for ${positions.length} positions`);

      // Fetch market data for each position in parallel
      const positionsWithMarketData = await Promise.allSettled(
        positions.map(async (position) => {
          try {
            const marketData = await this.getMarketDetails(position.marketId);

            // Calculate proper value and P&L if market data is available
            let updatedValue = position.value;
            let calculatedPnl = 0;

            if (marketData && position.entryPrice) {
              // Get current price from market data
              const currentPrice = marketData.volume > 0 ?
                (marketData.liquidity && marketData.liquidity > 0 ?
                  Math.min(marketData.liquidity / marketData.volume, 1) : 0.5) :
                0.5; // Default to 50% if no market data

              updatedValue = currentPrice * position.shares;
              calculatedPnl = (currentPrice - position.entryPrice) * position.shares;
            }

            return {
              ...position,
              market: position.title || marketData?.question || position.marketId,
              value: position.value > 0 ? position.value : updatedValue, // Prefer Data API value
              pnl: position.pnl !== 0 ? position.pnl : calculatedPnl, // Prefer Data API P&L
              marketData
            };
          } catch (error) {
            logger.warn(`Failed to fetch market data for ${position.marketId}:`, error);
            return position;
          }
        })
      );

      const enrichedPositions = positionsWithMarketData
        .filter((result): result is PromiseFulfilledResult<WalletPosition> => result.status === 'fulfilled')
        .map(result => result.value);

      logger.info(`Successfully enriched ${enrichedPositions.filter(p => p.marketData).length}/${positions.length} positions with market data`);

      return enrichedPositions;

    } catch (error: any) {
      logger.error('Error fetching wallet positions with market data:', {
        error: error.message,
        status: error.response?.status,
        walletAddress
      });
      return [];
    }
  }

  async getMarketDetails(marketId: string): Promise<MarketData | null> {
    try {
      const startTime = Date.now();

      const condition = await this.restClient.getCondition(marketId);

      if (!condition) {
        // Create a fallback market data with basic info
        logger.warn(`No condition data found for ${marketId}, creating fallback`);
        const shortId = marketId.substring(0, 8);
        return {
          id: marketId,
          question: `Prediction Market ${shortId}`,
          description: `Market data temporarily unavailable for ${shortId}. This is likely a valid Polymarket condition but details cannot be fetched at the moment.`,
          outcomes: ['Yes', 'No'],
          volume: 0,
          liquidity: 0,
          endDate: new Date().toISOString(),
          resolved: false
        };
      }

      const marketData: MarketData = {
        id: condition.id,
        question: condition.question || condition.title || `Prediction Market ${marketId.substring(0, 8)}`,
        description: condition.description || '',
        outcomes: condition.outcomes || ['Yes', 'No'],
        volume: condition.volume || 0,
        liquidity: condition.liquidity || 0,
        endDate: condition.endTime || new Date().toISOString(),
        resolved: condition.status === 'RESOLVED'
      };

      this.recordRequestTime(Date.now() - startTime);
      this.stats.successfulRequests++;

      return marketData;

    } catch (error: any) {
      this.stats.failedRequests++;
      logger.error('Error fetching market details:', {
        error: error.message,
        status: error.response?.status,
        marketId
      });

      // Return fallback market data instead of null with a more user-friendly name
      const shortId = marketId.substring(0, 8);
      return {
        id: marketId,
        question: `Prediction Market ${shortId}`,
        description: `Market data temporarily unavailable for ${shortId}. This is likely a valid Polymarket condition but details cannot be fetched at the moment.`,
        outcomes: ['Yes', 'No'],
        volume: 0,
        liquidity: 0,
        endDate: new Date().toISOString(),
        resolved: false
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const startTime = Date.now();

      // Test REST client health (simulate health check with a simple request)
      try {
        await this.restClient.getConditions({ limit: 1 });
        var restHealth = true;
      } catch (error) {
        var restHealth = false;
      }

      // Test Real-time Data client health if enabled
      let wsHealth = true;
      if (this.rtdClient) {
        wsHealth = this.stats.websocketConnected;
      }

      const isHealthy = restHealth && wsHealth;

      this.recordRequestTime(Date.now() - startTime);

      if (isHealthy) {
        this.stats.successfulRequests++;
        logger.info('Polymarket service health check passed');
      } else {
        this.stats.failedRequests++;
        logger.warn('Polymarket service health check failed', {
          restHealth,
          wsHealth
        });
      }

      return isHealthy;

    } catch (error: any) {
      this.stats.failedRequests++;
      logger.error('Polymarket service health check failed:', {
        error: error.message,
        status: error.response?.status
      });
      return false;
    }
  }

  // Advanced API methods

  async getOrderBook(marketId: string): Promise<PolymarketOrderBook | null> {
    try {
      return await this.restClient.getOrderBook(marketId);
    } catch (error) {
      logger.error('Error fetching order book:', error);
      return null;
    }
  }

  async getUserTransactions(walletAddress: string, limit = 50): Promise<PolymarketTransaction[]> {
    try {
      return await this.restClient.getTransactions({
        user: walletAddress,
        limit
      });
    } catch (error) {
      logger.error('Error fetching user transactions:', error);
      return [];
    }
  }

  async getUserProfile(walletAddress: string): Promise<PolymarketUser | null> {
    try {
      return await this.restClient.getUser(walletAddress);
    } catch (error) {
      logger.error('Error fetching user profile:', error);
      return null;
    }
  }

  // Real-time Data subscription methods

  async subscribeToMarket(marketId: string): Promise<void> {
    // clob_market subscription requires authentication and token IDs
    // For public bot, we use polling via Gamma/Data APIs instead
    logger.debug(`Market subscription skipped (requires auth): ${marketId}`);
  }

  async subscribeToWallet(walletAddress: string): Promise<void> {
    // clob_user subscription requires authentication
    // For public bot, we use polling via Data API instead
    logger.debug(`Wallet subscription skipped (requires auth): ${walletAddress}`);
  }

  async subscribeToActivity(): Promise<void> {
    if (!this.rtdClient) {
      throw new Error('Real-time data client not available');
    }

    try {
      await this.rtdClient.subscribe('activity');
      logger.info('Subscribed to general trading activity');
    } catch (error) {
      logger.error('Error subscribing to activity:', error);
      throw error;
    }
  }

  async unsubscribeFromMarket(marketId: string): Promise<void> {
    // No-op: clob_market subscription requires authentication
    logger.debug(`Market unsubscription skipped (requires auth): ${marketId}`);
  }

  async unsubscribeFromWallet(walletAddress: string): Promise<void> {
    // No-op: clob_user subscription requires authentication
    logger.debug(`Wallet unsubscription skipped (requires auth): ${walletAddress}`);
  }

  // Utility methods

  getStats(): ServiceStats {
    return { ...this.stats };
  }

  getRestClient(): PolymarketRestClient {
    return this.restClient;
  }

  async connect(): Promise<void> {
    try {
      if (this.rtdClient) {
        await this.rtdClient.connect();
      }
      logger.info('Polymarket service connected');
    } catch (error) {
      logger.error('Error connecting Polymarket service:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.rtdClient) {
        await this.rtdClient.disconnect();
      }

      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      logger.info('Polymarket service disconnected');
    } catch (error) {
      logger.error('Error disconnecting Polymarket service:', error);
    }
  }

  private recordRequestTime(duration: number): void {
    this.stats.totalRequests++;
    this.stats.averageResponseTime =
      (this.stats.averageResponseTime * (this.stats.totalRequests - 1) + duration) / this.stats.totalRequests;
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    logger.info('Shutting down Polymarket service...');

    try {
      await this.disconnect();
      this.removeAllListeners();
      logger.info('Polymarket service shutdown complete');
    } catch (error) {
      logger.error('Error during service shutdown:', error);
    }
  }
}

// Factory function for easy initialization
export function createPolymarketService(config?: PolymarketServiceConfig): PolymarketService {
  return new PolymarketService(config);
}

// Default export
export default PolymarketService;