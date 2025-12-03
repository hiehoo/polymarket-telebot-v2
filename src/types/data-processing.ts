import { PolymarketEvent, PolymarketWebSocketMessage } from './polymarket';

// Re-export types for convenience
export { PolymarketEvent, PolymarketWebSocketMessage };

export interface DataProcessingConfig {
  batchSize: number;
  processingInterval: number;
  maxRetries: number;
  retryDelay: number;
  bufferSize: number;
  healthCheckInterval: number;
  metricsInterval: number;
}

export interface WebSocketClientConfig {
  url: string;
  apiKey: string;
  reconnectAttempts: number;
  reconnectDelay: number;
  heartbeatInterval: number;
  messageTimeout: number;
  subscriptions: string[];
  compression?: boolean;
}

export interface RestClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout: number;
  maxRetries: number;
  retryDelay: number;
  rateLimit: {
    requestsPerSecond: number;
    burstLimit: number;
  };
  cache: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  };
}

export interface ProcessingMetrics {
  processedMessages: number;
  failedMessages: number;
  averageProcessingTime: number;
  lastProcessedTimestamp?: Date;
  uptime: number;
  memoryUsage: number;
  bufferUtilization: number;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  errorRate: number;
}

export interface WebSocketConnectionStats {
  connectedAt?: Date;
  lastMessageAt?: Date;
  reconnectCount: number;
  messagesReceived: number;
  messagesProcessed: number;
  bytesReceived: number;
  latency: number;
  subscribedChannels: string[];
}

export interface RestClientStats {
  requestsMade: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  lastRequestAt?: Date;
  rateLimitHits: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface DataProcessorStats {
  totalProcessed: number;
  processingErrors: number;
  averageProcessingTime: number;
  queueSize: number;
  batchSize: number;
  lastBatchProcessedAt?: Date;
  throughput: number;
}

export interface NormalizedMarketData {
  conditionId: string;
  symbol: string;
  question: string;
  outcomes: Array<{
    name: string;
    price: number;
    probability: number;
    volume24h?: number;
    priceChange24h?: number;
  }>;
  marketData: {
    currentPrice: number;
    probability: number;
    volume24h: number;
    priceChange24h: number;
    liquidity: number;
    timestamp: Date;
  };
  metadata: {
    category?: string;
    tags?: string[];
    endTime: Date;
    status: 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
    source: 'polymarket';
    lastUpdated: Date;
  };
}

export interface NormalizedTransaction {
  id: string;
  user: string;
  type: 'BUY' | 'SELL' | 'CANCEL';
  conditionId: string;
  outcome: string;
  amount: number;
  price: number;
  value: number;
  fee?: number;
  timestamp: Date;
  hash: string;
  blockNumber?: number;
  gasUsed?: number;
  metadata: {
    source: 'polymarket';
    processedAt: Date;
  };
}

export interface NormalizedPosition {
  id: string;
  user: string;
  conditionId: string;
  outcome: string;
  side: 'YES' | 'NO';
  size: number;
  averagePrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  createdAt: Date;
  updatedAt: Date;
  status: 'ACTIVE' | 'SETTLED' | 'CANCELLED';
  payouts?: Record<string, number>;
  metadata: {
    source: 'polymarket';
    lastUpdated: Date;
  };
}

export interface ProcessingEvent extends PolymarketEvent {
  id: string;
  processedAt: Date;
  processingTime: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  retryCount: number;
  metadata: {
    source: 'websocket' | 'rest' | 'polling';
    priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent';
    batchId?: string;
  };
}

export interface DataAccessQuery {
  type: 'positions' | 'transactions' | 'conditions' | 'market-data' | 'events';
  filters?: Record<string, any>;
  pagination?: {
    limit: number;
    offset: number;
  };
  sorting?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  include?: string[];
}

export interface DataAccessResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  metadata: {
    queryTime: number;
    cacheHit: boolean;
    source: 'database' | 'cache' | 'api';
  };
}

export interface CacheOptions {
  ttl: number;
  tags?: string[];
  compress?: boolean;
}

export interface NotificationTrigger {
  type: 'price_change' | 'position_update' | 'transaction' | 'market_resolution' | 'volume_spike';
  conditionId: string;
  userId?: string;
  threshold?: number;
  data: any;
  timestamp: Date;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  components: {
    websocket: {
      status: 'connected' | 'disconnected' | 'error';
      lastMessage?: Date;
      latency?: number;
    };
    restApi: {
      status: 'online' | 'error' | 'rate_limited';
      lastRequest?: Date;
      responseTime?: number;
    };
    database: {
      status: 'connected' | 'error';
      responseTime?: number;
    };
    redis: {
      status: 'connected' | 'error';
      responseTime?: number;
    };
    processor: {
      status: 'running' | 'stalled' | 'error';
      queueSize: number;
      processingRate: number;
    };
  };
  metrics: ProcessingMetrics;
  errors: string[];
}

export interface DataProcessingError extends Error {
  type: 'validation' | 'network' | 'processing' | 'storage' | 'rate_limit';
  code: string;
  details?: any;
  timestamp: Date;
  retryable: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SubscriptionFilter {
  conditionIds?: string[];
  users?: string[];
  outcomes?: string[];
  eventTypes?: string[];
  priceThreshold?: {
    min?: number;
    max?: number;
  };
  volumeThreshold?: {
    min?: number;
  };
}

export interface WebSocketSubscription {
  id: string;
  channel: string;
  filters: SubscriptionFilter;
  active: boolean;
  createdAt: Date;
  lastMessage?: Date;
  messageCount: number;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: Date;
  retryAfter?: number;
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    requestId: string;
    timestamp: Date;
    rateLimit?: RateLimitInfo;
  };
}

export interface WebSocketMessageHandler {
  canHandle(message: PolymarketWebSocketMessage): boolean;
  handle(message: PolymarketWebSocketMessage): Promise<ProcessingEvent | null>;
  priority: number;
}

export interface DataTransformer {
  name: string;
  transform<T, R>(data: T): Promise<R>;
  validate<T>(data: T): boolean;
  getSchema(): any;
}

export interface EventProcessor {
  process(event: ProcessingEvent): Promise<void>;
  canProcess(event: ProcessingEvent): boolean;
  getPriority(): number;
}

export interface CacheManager {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: CacheOptions): Promise<void>;
  delete(key: string): Promise<void>;
  clear(pattern?: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getStats(): {
    hits: number;
    misses: number;
    hitRate: number;
    size: number;
  };
}

export interface QueueManager {
  enqueue(event: ProcessingEvent): Promise<void>;
  dequeue(): Promise<ProcessingEvent | null>;
  peek(): Promise<ProcessingEvent | null>;
  size(): Promise<number>;
  clear(): Promise<void>;
  getStats(): {
    size: number;
    processed: number;
    failed: number;
    averageProcessingTime: number;
  };
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors: string[];
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
  halfOpenMaxCalls: number;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  lastFailureTime?: Date;
  nextAttempt?: Date;
  calls: number;
}