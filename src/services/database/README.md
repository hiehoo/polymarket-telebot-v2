# PostgreSQL Connection Pool

A production-ready PostgreSQL connection pool for the Polymarket Telegram Bot with comprehensive error handling, retry logic, health monitoring, and TypeScript support.

## Features

### ✅ Core Functionality
- **Connection Pooling**: Optimized pool configuration with min/max connections
- **Query Execution**: Parameterized queries with SQL injection prevention
- **Transaction Support**: ACID-compliant transactions with automatic rollback
- **Error Handling**: Comprehensive error handling with custom DatabaseError types
- **Retry Logic**: Exponential backoff retry for connection failures
- **Health Monitoring**: Real-time connection statistics and health checks

### ✅ Performance & Reliability
- **Response Time Tracking**: Average query response time monitoring
- **Connection Statistics**: Pool utilization and connection health metrics
- **Automatic Reconnection**: Resilient connection handling with backoff
- **Resource Management**: Proper connection cleanup and resource management
- **SSL Support**: Secure database connections with certificate validation

### ✅ Security
- **SQL Injection Prevention**: All queries use parameterized statements
- **Connection Security**: SSL/TLS support with certificate validation
- **Credential Management**: Secure handling of database credentials
- **Query Logging**: Comprehensive logging for security auditing

## Quick Start

```typescript
import databasePool, {
  query,
  transaction,
  getDatabaseStats,
  checkDatabaseHealth
} from '@/services/database/connection-pool';

// Simple query
const users = await query('SELECT * FROM users WHERE is_active = true');

// Query with parameters
const user = await query(
  'SELECT * FROM users WHERE id = $1',
  [userId]
);

// Transaction
const result = await transaction(async (client) => {
  await client.query('INSERT INTO users (name) VALUES ($1)', ['John']);
  return await client.query('SELECT * FROM users WHERE name = $1', ['John']);
});

// Health check
const health = await checkDatabaseHealth();
console.log('Database health:', health.status);

// Pool statistics
const stats = getDatabaseStats();
console.log('Pool utilization:', stats.activeCount / stats.totalCount);
```

## API Reference

### DatabasePool Class

#### Constructor
```typescript
constructor(poolConfig?: Partial<PoolConfig>)
```

#### Methods

##### query<T = any>(text: string, params?: any[]): Promise<T[]>
Execute a SQL query with optional parameters.

**Parameters:**
- `text`: SQL query string with parameter placeholders ($1, $2, etc.)
- `params`: Optional array of parameter values

**Returns:** Promise resolving to array of results

**Example:**
```typescript
const users = await databasePool.query(
  'SELECT * FROM users WHERE telegram_id = $1 AND is_active = $2',
  [123456789, true]
);
```

##### getClient(): Promise<PoolClient>
Get a raw PostgreSQL client from the pool.

**Returns:** Promise resolving to PoolClient

**Important:** Always release the client back to the pool:
```typescript
const client = await databasePool.getClient();
try {
  await client.query('BEGIN');
  // ... operations
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

##### transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>
Execute operations within a database transaction.

**Parameters:**
- `callback`: Function that receives a PoolClient for transaction operations

**Returns:** Promise resolving to the callback's return value

**Example:**
```typescript
const newUser = await databasePool.transaction(async (client) => {
  const result = await client.query(
    'INSERT INTO users (name) VALUES ($1) RETURNING id',
    ['John']
  );
  await client.query(
    'INSERT INTO user_preferences (user_id, preferences) VALUES ($1, $2)',
    [result.rows[0].id, { notifications: true }]
  );
  return result.rows[0];
});
```

##### getStats(): ConnectionStats
Get current connection pool statistics.

**Returns:** ConnectionStats object
```typescript
interface ConnectionStats {
  totalCount: number;        // Total connections in pool
  idleCount: number;         // Idle connections available
  waitingCount: number;       // Clients waiting for connections
  activeCount: number;        // Currently active connections
  averageResponseTime: number; // Average query response time in ms
}
```

##### healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }>
Perform a comprehensive health check of the database connection.

**Returns:** Health status with detailed information

**Example:**
```typescript
const health = await databasePool.healthCheck();
if (health.status === 'unhealthy') {
  console.error('Database health issues:', health.details);

  if (health.details.pool?.status === 'exhausted') {
    // Pool is exhausted - consider scaling up
  }

  if (health.details.connectivity?.status === 'slow') {
    // Slow responses - check query performance
  }
}
```

##### close(): Promise<void>
Gracefully close the database connection pool.

**Example:**
```typescript
// On application shutdown
process.on('SIGINT', async () => {
  await databasePool.close();
  process.exit(0);
});
```

### Utility Functions

#### query<T = any>(text: string, params?: any[]): Promise<T[]>
Convenience function for singleton pool queries.

#### getClient(): Promise<PoolClient>
Convenience function for singleton pool client acquisition.

#### transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>
Convenience function for singleton pool transactions.

#### getDatabaseStats(): ConnectionStats
Convenience function for singleton pool statistics.

#### checkDatabaseHealth(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }>
Convenience function for singleton pool health checks.

#### closeDatabasePool(): Promise<void>
Convenience function for closing singleton pool.

## Configuration

### PoolConfig Interface
```typescript
interface PoolConfig {
  min: number;                    // Minimum connections (default: 2)
  max: number;                    // Maximum connections (default: 10)
  idleTimeoutMillis: number;       // Idle timeout (default: 30000)
  connectionTimeoutMillis: number;  // Connection timeout (default: 5000)
  maxUses: number;                // Max uses per connection (default: 7500)
  allowExitOnIdle: boolean;       // Exit process when idle (default: false)
}
```

### Database URL Format
```
postgresql://[user[:password]@]host[:port][/database][?param1=value1&param2=value2]
```

**Examples:**
```bash
# Basic connection
DATABASE_URL=postgresql://user:password@localhost:5432/polymarket_bot

# With SSL
DATABASE_URL=postgresql://user:password@localhost:5432/polymarket_bot?sslmode=require

# With connection parameters
DATABASE_URL=postgresql://user:password@localhost:5432/polymarket_bot?sslmode=require&application_name=myapp
```

### Environment Variables
```bash
# SSL Configuration (optional)
DB_SSL_CERT=path/to/client.crt
DB_SSL_KEY=path/to/client.key
DB_SSL_CA=path/to/ca.crt

# Pool Configuration (optional - can be overridden in code)
DB_POOL_MIN=2
DB_POOL_MAX=10
DB_CONNECTION_TIMEOUT=5000
DB_IDLE_TIMEOUT=30000
```

## Best Practices

### 1. Use Parameterized Queries
Always use parameterized queries to prevent SQL injection:

```typescript
// ✅ Good - Parameterized
const users = await query('SELECT * FROM users WHERE id = $1', [userId]);

// ❌ Bad - SQL injection vulnerable
const users = await query(`SELECT * FROM users WHERE id = ${userId}`);
```

### 2. Use Transactions for Related Operations
Group related operations in transactions:

```typescript
// ✅ Good - Transaction ensures consistency
const result = await transaction(async (client) => {
  const userResult = await client.query(
    'INSERT INTO users (name) VALUES ($1) RETURNING id',
    ['John']
  );

  await client.query(
    'INSERT INTO user_preferences (user_id, preferences) VALUES ($1, $2)',
    [userResult.rows[0].id, { theme: 'dark' }]
  );

  return userResult.rows[0];
});

// ❌ Bad - Could leave database in inconsistent state
```

### 3. Handle Errors Appropriately
Use the built-in error handling and retry logic:

```typescript
try {
  const result = await query('SELECT * FROM large_table');
  return result;
} catch (error) {
  if (error instanceof DatabaseError) {
    // Handle database-specific errors
    logger.error('Database operation failed:', error);

    // Database pool will automatically retry connection errors
    // Don't implement manual retry logic for database errors
  } else {
    // Handle other types of errors
    logger.error('Unexpected error:', error);
    throw error;
  }
}
```

### 4. Monitor Pool Health
Regularly check pool statistics and health:

```typescript
// Set up periodic health checks
setInterval(async () => {
  const health = await checkDatabaseHealth();
  const stats = getDatabaseStats();

  if (health.status === 'unhealthy') {
    logger.error('Database health issues detected:', health.details);
    // Take appropriate action
  }

  const utilization = stats.totalCount > 0
    ? (stats.activeCount / stats.totalCount) * 100
    : 0;

  if (utilization > 80) {
    logger.warn('High database pool utilization:', utilization);
    // Consider scaling up
  }
}, 30000); // Check every 30 seconds
```

### 5. Graceful Shutdown
Always close the database pool on application shutdown:

```typescript
// Handle various shutdown signals
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
process.on('uncaughtException', handleShutdown);

async function handleShutdown(signal) {
  logger.info(`Received ${signal}, shutting down database pool...`);

  try {
    await closeDatabasePool();
    logger.info('Database pool closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error closing database pool:', error);
    process.exit(1);
  }
}
```

## Performance Tuning

### Connection Pool Size
- **Development**: 2-5 connections
- **Production**: 10-20 connections (adjust based on load)
- **High Load**: 20-50+ connections (monitor connection waiting)

### Query Optimization
- Use appropriate indexes on frequently queried columns
- Limit result sets with LIMIT clauses
- Use EXPLAIN ANALYZE for slow query optimization
- Consider prepared statements for frequently executed queries

### Connection Optimization
```typescript
const optimizedPool = new DatabasePool({
  min: 5,                    // Keep 5 warm connections
  max: 20,                   // Maximum 20 connections
  idleTimeoutMillis: 60000,     // Keep idle for 1 minute
  connectionTimeoutMillis: 10000, // 10 second connection timeout
  maxUses: 10000,              // Reuse connections 10,000 times
  allowExitOnIdle: false        // Don't exit when idle
});
```

## Troubleshooting

### Common Issues

#### Connection Exhaustion
**Symptoms**: `waitingCount > 0`, slow queries, timeouts
**Solutions**: Increase pool size, optimize queries, add connection timeout

#### SSL Certificate Issues
**Symptoms**: Connection refused, certificate validation errors
**Solutions**: Check certificate paths, verify CA bundle, disable SSL for local dev

#### High Response Times
**Symptoms**: `averageResponseTime > 1000ms`
**Solutions**: Add indexes, optimize queries, check database performance

#### Memory Leaks
**Symptoms**: Increasing memory usage over time
**Solutions**: Ensure clients are released, close connections properly

### Debug Logging
Enable debug logging for detailed information:

```typescript
// In your logger configuration
logger.level = 'debug';

// Or temporarily increase log level
process.env.LOG_LEVEL = 'debug';
```

### Health Check Details
Health check provides detailed diagnostic information:

```typescript
const health = await checkDatabaseHealth();

if (health.status === 'unhealthy') {
  console.log('Health Issues:', {
    connectivity: health.details.connectivity, // Connection status and response time
    pool: health.details.pool,              // Pool statistics and status
    error: health.details.error                // Error details if failed
  });
}
```

## Integration Examples

### Express.js Integration
```typescript
import express from 'express';
import { query, transaction } from '@/services/database/connection-pool';

const app = express();

// Get all users
app.get('/users', async (req, res) => {
  try {
    const users = await query('SELECT id, telegram_username, created_at FROM users WHERE is_active = true');
    res.json({ users });
  } catch (error) {
    logger.error('Failed to get users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create user with preferences
app.post('/users', async (req, res) => {
  try {
    const { telegramId, username, preferences } = req.body;

    const user = await transaction(async (client) => {
      const userResult = await client.query(
        'INSERT INTO users (telegram_id, telegram_username) VALUES ($1, $2) RETURNING id',
        [telegramId, username]
      );

      await client.query(
        'INSERT INTO notification_preferences (user_id, preferences) VALUES ($1, $2)',
        [userResult.rows[0].id, JSON.stringify(preferences)]
      );

      return userResult.rows[0];
    });

    res.status(201).json({ user });
  } catch (error) {
    logger.error('Failed to create user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### Background Job Integration
```typescript
// Example: Process wallet activities
export async function processWalletActivities() {
  const batchSize = 100;

  const unprocessed = await query(`
    SELECT id, wallet_address, activity_data
    FROM wallet_activity
    WHERE is_processed = false
    ORDER BY occurred_at ASC
    LIMIT $1
  `, [batchSize]);

  await transaction(async (client) => {
    for (const activity of unprocessed) {
      // Process activity (e.g., send notifications, update cache)
      await processActivity(activity);

      // Mark as processed
      await client.query(
        'UPDATE wallet_activity SET is_processed = true, processed_at = NOW() WHERE id = $1',
        [activity.id]
      );
    }
  });

  logger.info(`Processed ${unprocessed.length} wallet activities`);
}
```

## Migration Guide

### From pg Pool Direct Usage
```typescript
// Before (direct pg usage)
import { Pool } from 'pg';
const pool = new Pool({ connectionString: DATABASE_URL });

// After (using this connection pool)
import databasePool from '@/services/database/connection-pool';
// Pool is automatically initialized and configured
```

### From Basic Query Execution
```typescript
// Before
const result = await pool.query('SELECT * FROM users');

// After - with automatic retry, error handling, and logging
const result = await databasePool.query('SELECT * FROM users');
```

## License

This PostgreSQL connection pool is part of the Polymarket Telegram Bot project and is licensed under the MIT License.

## Support

For issues, questions, or contributions related to the database connection pool, please refer to the project documentation or create an issue in the project repository.