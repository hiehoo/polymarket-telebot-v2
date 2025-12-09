# Consensus Signal Scanner - Codebase Scout Report
**Date**: 2025-12-09  
**Project**: PolyBot  
**Topic**: Consensus Signal Scanner Implementation  
**Status**: Complete

---

## Executive Summary

Comprehensive codebase scout completed. Located 28+ relevant files across 5 core domains:
1. Wallet tracker service structure (active monitoring pattern)
2. Polymarket API integration (REST & WebSocket clients)
3. Database repository patterns (PostgreSQL persistence)
4. Telegram notification pipeline (message delivery & preferences)
5. Configuration management (environment-based config)

**Key Finding**: Existing `WalletActivityTracker` provides excellent foundation pattern for consensus signal scanner - same polling architecture, Redis caching, and notification dispatch mechanisms.

---

## 1. Wallet Tracker Service Structure

### Core Service Files
- **Path**: `/Users/hieuho/PolyBot/src/services/wallet-tracker/`
- **Pattern**: Event-based polling service with Redis caching + PostgreSQL persistence

#### Primary Files:
| File | Purpose | Key Classes/Exports |
|------|---------|-------------------|
| `wallet-activity-tracker.ts` (573 lines) | Main tracker service orchestrating polling, position detection, notification | `WalletActivityTracker`, `TrackerConfig`, `createWalletActivityTracker()` |
| `wallet-tracker-repository.ts` (440 lines) | PostgreSQL persistence layer for wallet tracking data | `WalletTrackerRepository`, `TrackedWalletRecord`, `WalletSubscriber` |
| `position-diff-detector.ts` | Position change detection & notification formatting | `PositionSnapshot`, `PositionChange`, `detectChanges()` |
| `index.ts` | Service entry point & exports | Aggregates public API |

#### Key Architectural Patterns:

**Service Configuration**:
```typescript
interface TrackerConfig {
  redis: SimpleRedisClient;
  polymarketService: PolymarketService;
  bot: Telegraf<Context>;
  pollIntervalMs?: number;
  maxWallets?: number;
  enabled?: boolean;
}
```

**Polling Strategy**:
- Round-robin wallet polling with configurable intervals
- Staggered to avoid rate limits: `pollDelay = Math.max(1000, Math.floor(pollIntervalMs / walletCount))`
- Default: 60-second poll interval, spreads across tracked wallets

**Data Persistence**:
- PostgreSQL `tracked_wallets` table via `WalletTrackerRepository`
- Redis for ephemeral snapshots with 24-hour TTL: `wallet_tracker:snapshot:{wallet}`
- Fallback snapshot deserialization with error recovery

**Notification Thresholds**:
- Min order value: `$500` (configurable via config)
- Min portfolio percent: `2%` (configurable via config)
- Skips insignificant changes with structured logging

---

## 2. Polymarket Service API Methods

### REST Client
**Path**: `/Users/hieuho/PolyBot/src/services/polymarket/`

#### Core Service (`polymarket.ts`)
- **273 lines** - Main PolymarketService orchestrator
- **Key Methods**:
  - `getWalletPositions(walletAddress, limit)` - Fetch wallet positions with market context
  - `getWalletPositionsWithMarketData()` - Enriched positions with market metadata
  - `getMarketDetails(marketId)` - Condition/market data lookup
  - `getMarkets(limit)` - Fetch top markets
  - `getOrderBook(marketId)` - Order book snapshots
  - `getUserTransactions(walletAddress, limit)` - Transaction history
  - `getUserProfile(walletAddress)` - User profile data
  - `healthCheck()` - Service health validation

#### REST Client (`rest-client.ts`)
- Low-level Polymarket REST API client
- Methods: `getConditions()`, `getPositions()`, `getTransactions()`, `getUser()`, `getOrderBook()`
- Built-in caching & rate limiting
- Error handling with fallback data

#### WebSocket Client (`websocket-client.ts`)
- Real-time data subscriptions (limited public topics)
- Event: `activity`, `crypto_prices`
- Reconnection with exponential backoff
- Public channels only (no auth-required clob_market/clob_user)

#### RealTimeDataAdapter (`real-time-adapter.ts`)
- Wraps Polymarket Real-time Data API
- Topics: `activity`, `crypto_prices`, `order_updates`
- Auto-reconnection with max attempt limits

---

## 3. Database Repository Patterns

### Connection Pool & Schema
**Path**: `/Users/hieuho/PolyBot/src/services/database/`

#### Key Files:
| File | Purpose |
|------|---------|
| `connection-pool.ts` | PostgreSQL pool management, query execution, health checks |
| `user-service.ts` | User/account operations via repo pattern |

#### Database Access Patterns:

**Pattern: Parameterized Queries**
```typescript
const results = await query<{ id: string }>(
  'SELECT id FROM users WHERE telegram_id = $1',
  [telegramId]
);
```

**Pattern: Transaction Support**
```typescript
await transaction(async (client) => {
  // Multiple operations within transaction
});
```

**Schema Tables Used**:
- `users` - Telegram users (telegram_id, is_active, created_at, updated_at)
- `tracked_wallets` - Wallet tracking (user_id, wallet_address, alias, is_active)
- `polymarket_market_data` - Market snapshots
- `polymarket_positions` - User positions
- `polymarket_transactions` - Transaction history

#### Repository Interface Pattern:
```typescript
class WalletTrackerRepository {
  async ensureUser(telegramId, chatId)
  async addTrackedWallet(telegramId, chatId, walletAddress, alias)
  async removeTrackedWallet(telegramId, walletAddress)
  async getUserTrackedWallets(telegramId)
  async getAllTrackedWallets()
  async getWalletSubscribers(walletAddress)
  async getAllWalletAliases()
  async getStats() // Returns { totalWallets, totalUsers, totalSubscriptions }
}
```

---

## 4. Telegram Notification Patterns

### Notification Services
**Path**: `/Users/hieuho/PolyBot/src/services/notifications/`

#### Core Notification System
| File | Purpose | Key Features |
|------|---------|--------------|
| `notification-service.ts` (252 lines) | Core notification queueing & delivery | Redis-backed queue, preference filters, priority system |
| `telegram-notification-service.ts` (869 lines) | Complete Telegram integration | WebSocket event handling, template-based messages, rate limiting |
| `notification-dispatcher.ts` | Async notification dispatch | Retries, batching, rate limiting |
| `notification-queue-manager.ts` | Priority queue with dead-letter queue | Retry logic, worker pool |
| `notification-templates.ts` | Message template generation | Type-specific formatting |
| `notification-history-analytics.ts` | Delivery tracking & analytics | Success/failure metrics, user history |
| `user-preference-filter.ts` | User preference evaluation | Quiet hours, thresholds, deduplication |
| `notification-monitoring-analytics.ts` | System health monitoring | Alert thresholds, performance tracking |

#### Notification Data Structure:
```typescript
interface NotificationData {
  userId: number;
  type: 'transaction' | 'position' | 'resolution' | 'price_alert' | 'system';
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  metadata?: {
    walletId?: string;
    transactionHash?: string;
    marketId?: string;
    timestamp: number;
  };
}
```

#### User Preferences:
```typescript
interface TelegramUserPreferences {
  notifications: {
    enabled: boolean;
    types: {
      transactions: boolean;
      positions: boolean;
      resolutions: boolean;
      priceAlerts: boolean;
      system: boolean;
    };
    thresholds: {
      minPositionSize: number;
      minTransactionAmount: number;
      priceChangeThreshold: number;
    };
    quietHours?: {
      enabled: boolean;
      start: string; // "09:00"
      end: string;   // "22:00"
      timezone: string;
    };
  };
}
```

#### Sending Notifications:
```typescript
// Via NotificationService
await notificationService.sendNotification(notificationData);

// Via TelegramNotificationService
await telegramNotificationService.sendManualNotification(userId, notification);
await telegramNotificationService.sendBroadcastNotification(notification);
```

#### Redis Keys Pattern:
```
tracking:user:{userId}           # Set of tracked wallets
tracking:condition:{conditionId} # Set of users tracking market
tracking:global                  # Users tracking all activity
notif_prefs:{userId}             # User notification preferences
user:{userId}:preferences        # Detailed preference object
notification_queue               # Sorted set of pending notifications
notification_processing          # Processing lock key
```

---

## 5. Configuration Structure

### Config Files
**Path**: `/Users/hieuho/PolyBot/src/config/`

#### Main Configuration (`index.ts`):
```typescript
interface Config {
  telegram: { botToken: string };
  polymarket: {
    apiKey: string;
    apiUrl: string;
    gammaApiUrl: string;
    dataApiUrl: string;
    wsUrl: string;
  };
  database: { url: string; redisUrl: string };
  security: { jwtSecret: string; encryptionKey: string };
  server: { nodeEnv: string; logLevel: string; port: number };
  rateLimit: { windowMs: number; maxRequests: number };
  notifications: {
    batchSize: number;
    delayMs: number;
    minOrderValue: number;        // Default: $500
    minPortfolioPercent: number;  // Default: 2%
  };
  health: {
    checkIntervalMs: number;
    maxReconnectAttempts: number;
    reconnectDelayMs: number;
  };
}
```

#### Polymarket Config (`polymarket.ts`):
**Processing Configuration**:
```typescript
polymarketDataProcessingConfig = {
  batchSize: 100,
  processingInterval: 1000,      // ms
  maxRetries: 3,
  retryDelay: 2000,              // ms
  bufferSize: 10000,
  healthCheckInterval: 30000,
  metricsInterval: 60000
}
```

**WebSocket Configuration**:
```typescript
polymarketWebSocketConfig = {
  url: config.polymarket.wsUrl,
  reconnectAttempts: 10,
  reconnectDelay: 5000,
  heartbeatInterval: 30000,
  messageTimeout: 60000,
  subscriptions: ['market_data', 'transactions', 'positions', 'resolutions'],
  compression: true
}
```

**Event Filters**:
```typescript
polymarketEventFilters = {
  marketData: {
    priceChangeThreshold: 0.05,    // 5%
    volumeSpikeMultiplier: 2.0,
    minMarketCap: 1000,            // $1000
    maxPriceUpdateAge: 300         // 5 min
  },
  transactions: {
    minAmount: 10,                 // $10
    highValueThreshold: 1000,      // $1000
    excludeWallets: [],
    includeWallets: []
  },
  positions: {
    minSize: 10,                   // $10
    pnlThreshold: 100,             // $100
    trackNewPositions: true,
    trackClosures: true
  },
  resolutions: {
    autoNotify: true,
    includeExpiredMarkets: false,
    resolutionDelayMinutes: 5
  }
}
```

**Notification Rules**:
```typescript
polymarketNotificationRules = {
  priceChange: {
    enabled: true,
    threshold: 0.05,               // 5%
    cooldownMinutes: 15
  },
  highValueTransactions: {
    enabled: true,
    threshold: 1000,               // $1000
    excludeKnownWhales: false
  },
  positionUpdates: {
    enabled: true,
    pnlThreshold: 100,             // $100
    notifyClosures: true
  },
  marketResolutions: {
    enabled: true,
    delayMinutes: 5,
    includeCancelled: false
  },
  volumeSpikes: {
    enabled: true,
    multiplier: 2.0,
    minVolume: 1000,               // $1000
    cooldownMinutes: 30
  }
}
```

**Cache Configuration**:
```typescript
polymarketCacheConfig = {
  marketData: { ttl: 60, maxSize: 500 },      // 1 min
  conditions: { ttl: 300, maxSize: 1000 },    // 5 min
  userPositions: { ttl: 120, maxSize: 200 },  // 2 min
  transactions: { ttl: 1800, maxSize: 1000 }, // 30 min
  resolutions: { ttl: 86400, maxSize: 100 }   // 24 hr
}
```

---

## 6. Data Access Layer

### DataAccessLayer Service
**Path**: `/Users/hieuho/PolyBot/src/services/data-access.ts`

**Features**:
- Unified query interface with caching
- Health check monitoring
- Metrics collection
- Cache lifecycle management

**Query Methods**:
```typescript
async getMarketData(params: { conditionId?, limit?, offset? })
async getTransactions(params: { user?, conditionId?, minValue?, maxValue? })
async getPositions(params: { user?, conditionId?, minSize?, maxSize? })
async getConditions(params: { category?, status?, searchText?, limit? })
async getUser(walletAddress: string)
async query<T>(dataAccessQuery: DataAccessQuery)
```

**Cache Management**:
- In-memory cache with TTL expiration
- Pattern-based cache invalidation
- Tag-based cache clearing
- Automatic cleanup at 5-minute intervals

---

## 7. Type Definitions

### Type Files
**Path**: `/Users/hieuho/PolyBot/src/types/`

#### Key Types:
| File | Contains |
|------|----------|
| `polymarket.ts` | `PolymarketPosition`, `PolymarketTransaction`, `PolymarketCondition`, `PolymarketUser`, `PolymarketOrderBook` |
| `telegram.ts` | `TelegramUserPreferences`, `NotificationData` |
| `database.ts` | `DatabaseConnection`, `QueryResult`, schema types |
| `data-processing.ts` | `ProcessingEvent`, `NotificationTrigger`, `CacheManager`, monitoring types |

---

## 8. Utility Functions

### Logger
**Path**: `/Users/hieuho/PolyBot/src/utils/logger.ts`
- Winston-based structured logging
- Log levels: debug, info, warn, error
- Contextual metadata support

### Error Handler
**Path**: `/Users/hieuho/PolyBot/src/utils/error-handler.ts`
- Centralized error classification
- `ApiError`, `DatabaseError`, `ValidationError` classes
- Standardized error response format

---

## Implementation Recommendations for Consensus Signal Scanner

### Architecture Approach:
1. **Base on WalletActivityTracker**: Reuse polling mechanism + notification dispatch
2. **Extend PolymarketService**: Add consensus detection methods
3. **Create ConsensusSignalRepository**: Similar pattern to WalletTrackerRepository
4. **Use ExistingNotificationSystem**: Leverage TelegramNotificationService with new templates

### New Files to Create:
1. `src/services/consensus-signal/consensus-signal-scanner.ts` - Main service
2. `src/services/consensus-signal/consensus-detector.ts` - Algorithm implementation
3. `src/services/consensus-signal/consensus-signal-repository.ts` - PostgreSQL persistence
4. `src/config/consensus-signal.ts` - Configuration

### Database Tables Needed:
```sql
-- Tracked consensus markers
CREATE TABLE consensus_signals (
  id UUID PRIMARY KEY,
  wallet_address VARCHAR(255) NOT NULL,
  signal_type VARCHAR(50),      -- 'whale_accumulation', 'protocol_shift', etc.
  confidence_score DECIMAL(5,2),
  detected_at TIMESTAMP DEFAULT NOW(),
  notification_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Consensus signal history
CREATE TABLE consensus_signal_history (
  id UUID PRIMARY KEY,
  signal_id UUID REFERENCES consensus_signals(id),
  event_type VARCHAR(100),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Integration Points:
- Use `polymarketService.getWalletPositions()` for data fetching
- Store persistent state in PostgreSQL via new repository
- Use `TelegramNotificationService.sendManualNotification()` for alerts
- Leverage existing Redis for ephemeral consensus cache

---

## File Summary Table

| Category | File Path | Lines | Key Purpose |
|----------|-----------|-------|------------|
| **Wallet Tracker** | `wallet-activity-tracker.ts` | 573 | Polling orchestrator pattern |
| | `wallet-tracker-repository.ts` | 440 | PostgreSQL persistence layer |
| | `position-diff-detector.ts` | ~200 | Change detection algorithm |
| **Polymarket API** | `polymarket.ts` | 583 | Main service orchestrator |
| | `rest-client.ts` | ~400 | REST API client |
| | `websocket-client.ts` | ~300 | WebSocket real-time client |
| | `real-time-adapter.ts` | ~250 | Real-time data wrapper |
| **Database** | `connection-pool.ts` | ~350 | Connection management |
| | `user-service.ts` | ~150 | User operations |
| **Notifications** | `notification-service.ts` | 252 | Core queue & dispatch |
| | `telegram-notification-service.ts` | 869 | Telegram integration |
| | `notification-dispatcher.ts` | ~200 | Async dispatch |
| | `user-preference-filter.ts` | ~200 | Preference evaluation |
| **Config** | `config/index.ts` | 106 | Main config |
| | `config/polymarket.ts` | 330 | Polymarket-specific config |
| | `config/redis.ts` | ~100 | Redis config |
| **Data Access** | `data-access.ts` | 1040 | Unified query layer |
| **Types** | `types/polymarket.ts` | ~150 | API type definitions |
| | `types/telegram.ts` | ~100 | Telegram types |
| | `types/database.ts` | ~150 | Database types |
| | `types/data-processing.ts` | ~200 | Processing types |

---

## Unresolved Questions

1. **Consensus Definition**: What specific wallet behaviors/patterns should trigger consensus signals? (Large accumulations, coordinated buys, whale movements?)
2. **Time Windows**: What lookback period for signal detection? (1 hour, 24 hours, 7 days?)
3. **Confidence Scoring**: How to weight multiple signals into final confidence score?
4. **Persistence**: Should consensus signals be stored permanently or ephemeral?
5. **Alert Frequency**: Per-wallet per-day limits or no deduplication?
6. **User Filtering**: Should users opt-in to consensus alerts or broadcast to all?

---

**Report Generated**: 2025-12-09  
**Scout Status**: Complete - All 5 domains covered with file locations and implementation patterns documented.
