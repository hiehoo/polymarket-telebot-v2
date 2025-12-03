import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { config } from '@/config';
import logger from '@/utils/logger';
import { ApiError, WebSocketError, handleError } from '@/utils/error-handler';
import {
  RestClientConfig,
  RestClientStats,
  ProcessingEvent,
  CacheOptions,
  RateLimitInfo,
  ApiResponse,
  DataAccessQuery,
  DataAccessResult,
  CircuitBreakerConfig,
  CircuitBreakerState,
} from '@/types/data-processing';
import {
  polymarketRestConfig,
  polymarketApiEndpoints,
  polymarketGammaEndpoints,
  polymarketDataEndpoints,
  polymarketApiParams,
  polymarketRetryPolicy,
  polymarketCacheConfig,
  polymarketDebugConfig,
} from '@/config/polymarket';
import {
  PolymarketPosition,
  PolymarketTransaction,
  PolymarketCondition,
  PolymarketMarketData,
  PolymarketUser,
  PolymarketOrderBook,
  PolymarketHistoricalData,
  PolymarketApiError,
} from '@/types/polymarket';
import databasePool from '@/services/database/connection-pool';
import { CacheManager } from '@/types/data-processing';

export class PolymarketRestClient {
  private client: AxiosInstance;
  private gammaClient: AxiosInstance;
  private dataClient: AxiosInstance;
  private config: RestClientConfig;
  private stats: RestClientStats;
  private circuitBreaker: CircuitBreakerState;
  private circuitBreakerConfig: CircuitBreakerConfig;
  private cache: CacheManager;
  private requestQueue: Array<() => Promise<any>> = [];
  private processing = false;
  private lastRateLimitReset = new Date();
  private rateLimitTracker = new Map<string, number>();

  constructor(customConfig?: Partial<RestClientConfig>, cacheManager?: CacheManager) {
    this.config = { ...polymarketRestConfig, ...customConfig };
    this.cache = cacheManager || this.createDefaultCache();

    this.stats = {
      requestsMade: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      rateLimitHits: 0,
      cacheHits: 0,
      cacheMisses: 0,
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

    this.initializeAxiosClient();
    this.setupRateLimiting();
    this.startMetricsCollection();
  }

  private createDefaultCache(): CacheManager {
    // Simple in-memory cache implementation
    // In production, this should be replaced with Redis
    const memoryCache = new Map<string, { value: any; expires: number; tags: string[] }>();

    return {
      async get<T>(key: string): Promise<T | null> {
        const item = memoryCache.get(key);
        if (!item) {
          return null;
        }

        if (Date.now() > item.expires) {
          memoryCache.delete(key);
          return null;
        }

        return item.value;
      },

      async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
        const expires = Date.now() + (options?.ttl || 300) * 1000;
        memoryCache.set(key, {
          value,
          expires,
          tags: options?.tags || [],
        });

        // Clean up expired entries periodically
        if (memoryCache.size > 1000) {
          const now = Date.now();
          for (const [k, v] of memoryCache.entries()) {
            if (now > v.expires) {
              memoryCache.delete(k);
            }
          }
        }
      },

      async delete(key: string): Promise<void> {
        memoryCache.delete(key);
      },

      async clear(pattern?: string): Promise<void> {
        if (!pattern) {
          memoryCache.clear();
          return;
        }

        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        for (const key of memoryCache.keys()) {
          if (regex.test(key)) {
            memoryCache.delete(key);
          }
        }
      },

      async exists(key: string): Promise<boolean> {
        const item = memoryCache.get(key);
        return item !== undefined && Date.now() <= item.expires;
      },

      getStats() {
        return {
          hits: 0,
          misses: 0,
          hitRate: 0,
          size: memoryCache.size,
        };
      },
    };
  }

  private initializeAxiosClient(): void {
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'PolymarketTeleBot/1.0',
        'X-Client-Version': '1.0.0',
      },
    });

    // Initialize Gamma API client (no auth required for read-only access)
    this.gammaClient = axios.create({
      baseURL: config.polymarket.gammaApiUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PolymarketTeleBot/1.0',
        'X-Client-Version': '1.0.0',
      },
    });

    // Initialize Data API client (no auth required for read-only access)
    this.dataClient = axios.create({
      baseURL: config.polymarket.dataApiUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PolymarketTeleBot/1.0',
        'X-Client-Version': '1.0.0',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        (config as any).metadata = { requestId, startTime: Date.now() };

        if (polymarketDebugConfig.logRequests) {
          logger.debug('API request', {
            method: config.method?.toUpperCase(),
            url: config.url,
            requestId,
            params: config.params,
            data: config.data,
          });
        }

        return config;
      },
      (error) => {
        logger.error('Request interceptor error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        const config = response.config as any;
        const duration = Date.now() - config.metadata?.startTime;
        const requestId = config.metadata?.requestId;

        this.updateStats(true, duration);

        if (polymarketDebugConfig.logRequests) {
          logger.debug('API response', {
            requestId,
            status: response.status,
            duration,
            dataSize: JSON.stringify(response.data).length,
          });
        }

        return response;
      },
      (error: AxiosError) => {
        const config = error.config as any;
        const duration = Date.now() - config?.metadata?.startTime;
        const requestId = config?.metadata?.requestId;

        this.updateStats(false, duration);

        if (polymarketDebugConfig.logRequests) {
          logger.error('API error', {
            requestId,
            status: error.response?.status,
            duration,
            error: error.message,
            data: error.response?.data,
          });
        }

        return Promise.reject(this.handleApiError(error));
      }
    );
  }

  private setupRateLimiting(): void {
    setInterval(() => {
      this.resetRateLimits();
    }, 60000); // Reset every minute
  }

  private startMetricsCollection(): void {
    setInterval(() => {
      this.emitStats();
    }, 60000); // Every minute
  }

  private updateStats(success: boolean, duration: number): void {
    this.stats.requestsMade++;

    if (success) {
      this.stats.successfulRequests++;
    } else {
      this.stats.failedRequests++;
    }

    this.stats.averageResponseTime =
      (this.stats.averageResponseTime * (this.stats.requestsMade - 1) + duration) / this.stats.requestsMade;
    this.stats.lastRequestAt = new Date();
  }

  private emitStats(): void {
    this.emit('stats', this.stats);
  }

  private handleApiError(error: AxiosError): ApiError {
    const status = error.response?.status;
    const data = error.response?.data as PolymarketApiError;

    let message = 'API request failed';
    let type = 'API';

    if (data?.message) {
      message = data.message;
    } else if (error.message) {
      message = error.message;
    }

    if (status === 429) {
      type = 'RATE_LIMIT';
      this.handleRateLimit(data);
    } else if (status && status >= 500) {
      type = 'SERVER_ERROR';
    } else if (status && status >= 400) {
      type = 'CLIENT_ERROR';
    }

    this.updateCircuitBreaker(false);

    return new ApiError(message, status);
  }

  private handleRateLimit(data?: PolymarketApiError): void {
    this.stats.rateLimitHits++;

    const now = Date.now();
    const resetTime = data?.details?.resetTime ? new Date(data.details.resetTime).getTime() : now + 60000;
    const retryAfter = data?.details?.retryAfter || 60;

    this.lastRateLimitReset = new Date(resetTime);

    logger.warn('API rate limit hit', {
      resetTime: new Date(resetTime),
      retryAfter,
      totalHits: this.stats.rateLimitHits,
    });

    this.emit('rateLimit', {
      limit: data?.details?.limit || this.config.rateLimit.requestsPerSecond,
      remaining: data?.details?.remaining || 0,
      resetTime: new Date(resetTime),
      retryAfter,
    } as RateLimitInfo);
  }

  private resetRateLimits(): void {
    const now = Date.now();
    if (now >= this.lastRateLimitReset.getTime()) {
      this.rateLimitTracker.clear();
    }
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

  private async checkCircuitBreaker(): Promise<void> {
    if (this.circuitBreaker.state === 'open') {
      const now = new Date();
      const nextAttempt = this.circuitBreaker.nextAttempt;

      if (nextAttempt && now < nextAttempt) {
        throw new ApiError('Circuit breaker is open', 503);
      } else {
        this.circuitBreaker.state = 'half_open';
        this.circuitBreaker.calls = 0;
      }
    }

    if (this.circuitBreaker.state === 'half_open') {
      this.circuitBreaker.calls++;
      if (this.circuitBreaker.calls > this.circuitBreakerConfig.halfOpenMaxCalls) {
        throw new ApiError('Circuit breaker is half open and limit reached', 503);
      }
    }
  }

  private async executeWithRetry<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    retryPolicy = polymarketRetryPolicy.networkErrors
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
      try {
        await this.checkCircuitBreaker();
        const response = await requestFn();
        this.updateCircuitBreaker(true);
        return response.data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === retryPolicy.maxRetries) {
          break;
        }

        if (this.shouldRetry(lastError, retryPolicy)) {
          const delay = this.calculateRetryDelay(attempt, retryPolicy);
          logger.warn(`API request failed, retrying in ${delay}ms`, {
            attempt: attempt + 1,
            maxRetries: retryPolicy.maxRetries,
            error: lastError.message,
          });

          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }

    this.updateCircuitBreaker(false);
    throw lastError;
  }

  private shouldRetry(error: Error, retryPolicy: any): boolean {
    if (error instanceof ApiError) {
      // Don't retry client errors (4xx) except rate limit
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        return error.statusCode === 429;
      }
    }

    // Default retryable error conditions if retryableErrors is not defined
    const retryableErrors = retryPolicy.retryableErrors || [
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'socket hang up',
      'network timeout'
    ];

    return retryableErrors.some((code: string) =>
      error.message.includes(code) || error.message.toLowerCase().includes('timeout')
    );
  }

  private calculateRetryDelay(attempt: number, retryPolicy: any): number {
    let delay = retryPolicy.baseDelay * Math.pow(retryPolicy.backoffMultiplier, attempt);

    if (delay > retryPolicy.maxDelay) {
      delay = retryPolicy.maxDelay;
    }

    if (retryPolicy.jitter) {
      delay += Math.random() * delay * 0.1; // Add 10% jitter
    }

    return Math.round(delay);
  }

  private async getCacheKey(endpoint: string, params?: any): Promise<string> {
    const paramStr = params ? JSON.stringify(params) : '';
    return `polymarket:${endpoint}:${Buffer.from(paramStr).toString('base64')}`;
  }

  // Public API methods

  async getConditions(params?: {
    limit?: number;
    offset?: number;
    category?: string;
    status?: string;
    tags?: string[];
  }): Promise<PolymarketCondition[]> {
    const cacheKey = await this.getCacheKey('conditions', params);

    if (this.config.cache.enabled) {
      const cached = await this.cache.get<PolymarketCondition[]>(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(polymarketApiEndpoints.conditions, {
          params: { ...polymarketApiParams.default, ...params },
        }),
        polymarketRetryPolicy.networkErrors
      );

      if (this.config.cache.enabled) {
        await this.cache.set(cacheKey, response, {
          ttl: polymarketCacheConfig.conditions.ttl,
          tags: polymarketCacheConfig.conditions.tags,
        });
      }

      return response;
    } catch (error) {
      throw new ApiError(`Failed to fetch conditions: ${error}`);
    }
  }

  // New method to fetch market from Gamma API
  async getMarketFromGamma(conditionId: string): Promise<PolymarketCondition | null> {
    try {
      // Try to find market in events first (more likely to have condition IDs)
      const eventsResponse = await this.gammaClient.get(polymarketGammaEndpoints.events, {
        params: {
          closed: false,
          limit: 50,
        }
      });

      // Look for market with matching condition ID in events
      if (eventsResponse.data && Array.isArray(eventsResponse.data)) {
        for (const event of eventsResponse.data) {
          if (event.markets && Array.isArray(event.markets)) {
            for (const market of event.markets) {
              if (market.conditionId === conditionId || market.condition_id === conditionId) {
                return {
                  id: market.conditionId || market.condition_id,
                  question: market.question || event.title,
                  title: event.title,
                  slug: event.slug || market.slug,
                  description: market.description || event.description || '',
                  outcomes: market.outcomes || ['Yes', 'No'],
                  endTime: market.endTime || event.endDate,
                  status: market.closed ? 'RESOLVED' : 'ACTIVE',
                  volume: market.volume,
                  liquidity: market.liquidity,
                };
              }
            }
          }
        }
      }

      // If not found in events, try markets endpoint directly
      const marketsResponse = await this.gammaClient.get(polymarketGammaEndpoints.markets, {
        params: {
          condition_id: conditionId,
          limit: 1,
        }
      });

      if (marketsResponse.data && Array.isArray(marketsResponse.data) && marketsResponse.data.length > 0) {
        const market = marketsResponse.data[0];
        return {
          id: market.conditionId || market.condition_id,
          question: market.question,
          title: market.title,
          slug: market.slug,
          description: market.description || '',
          outcomes: market.outcomes || ['Yes', 'No'],
          endTime: market.endTime || market.end_time,
          status: market.closed ? 'RESOLVED' : 'ACTIVE',
          volume: market.volume,
          liquidity: market.liquidity,
        };
      }

      return null;
    } catch (error) {
      logger.warn(`Failed to fetch market from Gamma API for condition ${conditionId}:`, error);
      return null;
    }
  }

  async getCondition(conditionId: string): Promise<PolymarketCondition> {
    const cacheKey = await this.getCacheKey(`condition:${conditionId}`);

    if (this.config.cache.enabled) {
      const cached = await this.cache.get<PolymarketCondition>(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    // Try CLOB API first (may require auth for some data)
    try {
      // Try to get market from CLOB API with condition_id filter
      const response = await this.executeWithRetry(() =>
        this.client.get(polymarketApiEndpoints.markets, {
          params: { condition_id: conditionId, limit: 1 }
        }),
        polymarketRetryPolicy.networkErrors
      );

      if (response && Array.isArray(response) && response.length > 0) {
        const market = response[0];
        const condition: PolymarketCondition = {
          id: market.conditionId || market.condition_id || conditionId,
          question: market.question || market.title,
          description: market.description || '',
          outcomes: market.outcomes || ['Yes', 'No'],
          endTime: market.endTime || market.end_time,
          status: market.closed ? 'RESOLVED' : 'ACTIVE',
          volume: market.volume,
          liquidity: market.liquidity,
        };

        if (this.config.cache.enabled) {
          await this.cache.set(cacheKey, condition, {
            ttl: polymarketCacheConfig.conditions.ttl,
            tags: polymarketCacheConfig.conditions.tags,
          });
        }

        return condition;
      }
    } catch (error) {
      logger.warn(`CLOB API failed for condition ${conditionId}:`, error);
    }

    // Try Gamma API as fallback
    try {
      const gammaResult = await this.getMarketFromGamma(conditionId);
      if (gammaResult) {
        if (this.config.cache.enabled) {
          await this.cache.set(cacheKey, gammaResult, {
            ttl: polymarketCacheConfig.conditions.ttl,
            tags: polymarketCacheConfig.conditions.tags,
          });
        }
        return gammaResult;
      }
    } catch (error) {
      logger.warn(`Gamma API failed for condition ${conditionId}:`, error);
    }

    // If both APIs fail, throw an error
    throw new ApiError(`Failed to fetch condition ${conditionId} from both CLOB and Gamma APIs`);
  }

  async getMarket(marketId: string): Promise<PolymarketCondition> {
    // Market and condition are essentially the same in Polymarket API
    return this.getCondition(marketId);
  }

  async getMarketData(conditionId: string, params?: {
    interval?: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
    startTime?: string;
    endTime?: string;
  }): Promise<PolymarketMarketData[]> {
    const cacheKey = await this.getCacheKey(`market-data:${conditionId}`, params);

    if (this.config.cache.enabled) {
      const cached = await this.cache.get<PolymarketMarketData[]>(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(`${polymarketApiEndpoints.marketData}/${conditionId}`, {
          params: { ...polymarketApiParams.marketData, ...params },
        }),
        polymarketRetryPolicy.networkErrors
      );

      if (this.config.cache.enabled) {
        await this.cache.set(cacheKey, response, {
          ttl: polymarketCacheConfig.marketData.ttl,
          tags: polymarketCacheConfig.marketData.tags,
        });
      }

      return response;
    } catch (error) {
      throw new ApiError(`Failed to fetch market data for ${conditionId}: ${error}`);
    }
  }

  async getTransactions(params?: {
    user?: string;
    conditionId?: string;
    type?: string[];
    limit?: number;
    offset?: number;
    startTime?: string;
    endTime?: string;
  }): Promise<PolymarketTransaction[]> {
    const cacheKey = await this.getCacheKey('transactions', params);

    if (this.config.cache.enabled) {
      const cached = await this.cache.get<PolymarketTransaction[]>(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(polymarketApiEndpoints.transactions, {
          params: { ...polymarketApiParams.transactions, ...params },
        }),
        polymarketRetryPolicy.networkErrors
      );

      if (this.config.cache.enabled) {
        await this.cache.set(cacheKey, response, {
          ttl: polymarketCacheConfig.transactions.ttl,
          tags: polymarketCacheConfig.transactions.tags,
        });
      }

      return response;
    } catch (error) {
      throw new ApiError(`Failed to fetch transactions: ${error}`);
    }
  }

  // New method to fetch positions from Data API
  async getPositionsFromDataAPI(params?: {
    user?: string;
    conditionId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<PolymarketPosition[]> {
    try {
      const queryParams: any = {};

      if (params?.user) {
        queryParams.user = params.user;
      }
      if (params?.conditionId) {
        queryParams.condition_id = params.conditionId;
      }
      if (params?.status) {
        queryParams.status = params.status;
      }
      if (params?.limit) {
        queryParams.limit = params.limit;
      }
      if (params?.offset) {
        queryParams.offset = params.offset;
      }

      const response = await this.executeWithRetry(() =>
        this.dataClient.get(polymarketDataEndpoints.positions, {
          params: queryParams,
        }),
        polymarketRetryPolicy.networkErrors
      );

      return response;
    } catch (error) {
      logger.warn(`Failed to fetch positions from Data API:`, error);
      throw new ApiError(`Failed to fetch positions from Data API: ${error}`);
    }
  }

  async getPositions(params?: {
    user?: string;
    conditionId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<PolymarketPosition[]> {
    const cacheKey = await this.getCacheKey('positions', params);

    if (this.config.cache.enabled) {
      const cached = await this.cache.get<PolymarketPosition[]>(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    // Try Data API first (primary source for positions)
    try {
      const response = await this.getPositionsFromDataAPI(params);

      if (this.config.cache.enabled) {
        await this.cache.set(cacheKey, response, {
          ttl: polymarketCacheConfig.userPositions.ttl,
          tags: polymarketCacheConfig.userPositions.tags,
        });
      }

      return response;
    } catch (error) {
      logger.warn('Data API failed for positions, trying CLOB API as fallback:', error);
    }

    // Fallback to CLOB API if Data API fails
    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(polymarketApiEndpoints.positions, {
          params: { ...polymarketApiParams.positions, ...params },
        }),
        polymarketRetryPolicy.networkErrors
      );

      if (this.config.cache.enabled) {
        await this.cache.set(cacheKey, response, {
          ttl: polymarketCacheConfig.userPositions.ttl,
          tags: polymarketCacheConfig.userPositions.tags,
        });
      }

      return response;
    } catch (error) {
      throw new ApiError(`Failed to fetch positions from both Data API and CLOB API: ${error}`);
    }
  }

  async getOrderBook(conditionId: string): Promise<PolymarketOrderBook> {
    const cacheKey = await this.getCacheKey(`order-book:${conditionId}`);

    if (this.config.cache.enabled) {
      const cached = await this.cache.get<PolymarketOrderBook>(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(`${polymarketApiEndpoints.orderBook}/${conditionId}`),
        polymarketRetryPolicy.networkErrors
      );

      if (this.config.cache.enabled) {
        await this.cache.set(cacheKey, response, {
          ttl: polymarketCacheConfig.marketData.ttl,
          tags: polymarketCacheConfig.marketData.tags,
        });
      }

      return response;
    } catch (error) {
      throw new ApiError(`Failed to fetch order book for ${conditionId}: ${error}`);
    }
  }

  async getPriceHistory(conditionId: string, params: {
    interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
    startTime: string;
    endTime: string;
  }): Promise<PolymarketHistoricalData> {
    const cacheKey = await this.getCacheKey(`price-history:${conditionId}`, params);

    if (this.config.cache.enabled) {
      const cached = await this.cache.get<PolymarketHistoricalData>(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(`${polymarketApiEndpoints.priceHistory}/${conditionId}`, {
          params,
        }),
        polymarketRetryPolicy.networkErrors
      );

      if (this.config.cache.enabled) {
        await this.cache.set(cacheKey, response, {
          ttl: polymarketCacheConfig.marketData.ttl,
          tags: polymarketCacheConfig.marketData.tags,
        });
      }

      return response;
    } catch (error) {
      throw new ApiError(`Failed to fetch price history for ${conditionId}: ${error}`);
    }
  }

  async getUser(walletAddress: string): Promise<PolymarketUser> {
    const cacheKey = await this.getCacheKey(`user:${walletAddress}`);

    if (this.config.cache.enabled) {
      const cached = await this.cache.get<PolymarketUser>(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(`${polymarketApiEndpoints.portfolio}/${walletAddress}`),
        polymarketRetryPolicy.networkErrors
      );

      if (this.config.cache.enabled) {
        await this.cache.set(cacheKey, response, {
          ttl: polymarketCacheConfig.userPositions.ttl,
          tags: polymarketCacheConfig.userPositions.tags,
        });
      }

      return response;
    } catch (error) {
      throw new ApiError(`Failed to fetch user data for ${walletAddress}: ${error}`);
    }
  }

  async search(query: string, params?: {
    type?: 'condition' | 'user' | 'all';
    limit?: number;
    category?: string;
  }): Promise<any> {
    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(polymarketApiEndpoints.search, {
          params: { q: query, ...params },
        }),
        polymarketRetryPolicy.networkErrors
      );

      return response;
    } catch (error) {
      throw new ApiError(`Failed to search: ${error}`);
    }
  }

  async getTrending(params?: {
    category?: string;
    timeframe?: '1h' | '24h' | '7d';
    limit?: number;
  }): Promise<any> {
    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(polymarketApiEndpoints.trending, { params }),
        polymarketRetryPolicy.networkErrors
      );

      return response;
    } catch (error) {
      throw new ApiError(`Failed to fetch trending markets: ${error}`);
    }
  }

  async getCategories(): Promise<any> {
    const cacheKey = await this.getCacheKey('categories');

    if (this.config.cache.enabled) {
      const cached = await this.cache.get<any>(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(polymarketApiEndpoints.categories),
        polymarketRetryPolicy.networkErrors
      );

      if (this.config.cache.enabled) {
        await this.cache.set(cacheKey, response, {
          ttl: polymarketCacheConfig.conditions.ttl,
          tags: ['categories'],
        });
      }

      return response;
    } catch (error) {
      throw new ApiError(`Failed to fetch categories: ${error}`);
    }
  }

  // Health and status methods

  async checkHealth(): Promise<{ status: string; timestamp: string; services: any }> {
    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(polymarketApiEndpoints.health),
        polymarketRetryPolicy.networkErrors
      );

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: response,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: { error: error.message },
      };
    }
  }

  async getStatus(): Promise<any> {
    try {
      const response = await this.executeWithRetry(() =>
        this.client.get(polymarketApiEndpoints.status),
        polymarketRetryPolicy.networkErrors
      );

      return response;
    } catch (error) {
      throw new ApiError(`Failed to fetch status: ${error}`);
    }
  }

  // Data access methods for other components

  async query<T>(query: DataAccessQuery): Promise<DataAccessResult<T>> {
    const startTime = Date.now();
    const cacheKey = await this.getCacheKey(`query:${JSON.stringify(query)}`);

    try {
      let data: T[];
      let total: number;
      let cacheHit = false;

      // Check cache first
      if (this.config.cache.enabled) {
        const cached = await this.cache.get<DataAccessResult<T>>(cacheKey);
        if (cached) {
          this.stats.cacheHits++;
          return cached;
        }
        this.stats.cacheMisses++;
      }

      // Execute query based on type
      switch (query.type) {
        case 'conditions':
          data = await this.getConditions(query.filters) as unknown as T[];
          total = data.length;
          break;
        case 'transactions':
          data = await this.getTransactions(query.filters) as unknown as T[];
          total = data.length;
          break;
        case 'positions':
          data = await this.getPositions(query.filters) as unknown as T[];
          total = data.length;
          break;
        case 'market-data':
          const conditionId = query.filters?.conditionId;
          if (!conditionId) {
            throw new ApiError('conditionId is required for market-data queries');
          }
          data = await this.getMarketData(conditionId, query.filters) as unknown as T[];
          total = data.length;
          break;
        default:
          throw new ApiError(`Unsupported query type: ${query.type}`);
      }

      // Apply pagination
      if (query.pagination) {
        const { limit, offset } = query.pagination;
        data = data.slice(offset, offset + limit);
      }

      // Apply sorting
      if (query.sorting) {
        const { field, direction } = query.sorting;
        data.sort((a: any, b: any) => {
          const aVal = a[field];
          const bVal = b[field];

          if (direction === 'asc') {
            return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
          } else {
            return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
          }
        });
      }

      // Filter included fields
      if (query.include && query.include.length > 0) {
        data = data.map((item: any) => {
          const filtered: any = {};
          query.include!.forEach(field => {
            if (item[field] !== undefined) {
              filtered[field] = item[field];
            }
          });
          return filtered;
        });
      }

      const result: DataAccessResult<T> = {
        data,
        total,
        hasMore: query.pagination ?
          query.pagination.offset + data.length < total :
          false,
        metadata: {
          queryTime: Date.now() - startTime,
          cacheHit,
          source: 'api',
        },
      };

      // Cache result
      if (this.config.cache.enabled) {
        await this.cache.set(cacheKey, result, {
          ttl: 300, // 5 minutes
          tags: ['query'],
        });
      }

      return result;

    } catch (error) {
      throw new ApiError(`Query failed: ${error}`);
    }
  }

  // Utility methods

  getStats(): RestClientStats {
    return { ...this.stats };
  }

  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  getRateLimitInfo(): RateLimitInfo | null {
    if (this.stats.rateLimitHits === 0) {
      return null;
    }

    return {
      limit: this.config.rateLimit.requestsPerSecond,
      remaining: Math.max(0, this.config.rateLimit.requestsPerSecond - this.stats.rateLimitHits),
      resetTime: this.lastRateLimitReset,
    };
  }

  getCacheStats(): ReturnType<CacheManager['getStats']> {
    return this.cache.getStats();
  }

  async clearCache(pattern?: string): Promise<void> {
    await this.cache.clear(pattern);
  }

  private emit(event: string, data: any): void {
    // In a real implementation, this would emit to event listeners
    // For now, we'll just log
    if (polymarketDebugConfig.logRequests) {
      logger.debug('REST client event', { event, data });
    }
  }
}

export default PolymarketRestClient;