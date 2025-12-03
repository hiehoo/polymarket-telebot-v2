import databasePool, {
  query,
  getClient,
  transaction,
  getDatabaseStats,
  checkDatabaseHealth,
  closeDatabasePool,
  DatabasePool
} from '../connection-pool';

/**
 * Example usage of the PostgreSQL connection pool
 * This file demonstrates how to use the database connection pool
 */

// Basic query examples
export async function basicQueryExamples() {
  try {
    // Simple query
    const users = await query('SELECT * FROM users WHERE is_active = true LIMIT 10');
    console.log('Active users:', users);

    // Query with parameters (prevent SQL injection)
    const userById = await query(
      'SELECT * FROM users WHERE id = $1 AND is_active = true',
      [123]
    );
    console.log('User by ID:', userById);

    // Query with multiple parameters
    const recentActivity = await query(
      `SELECT wallet_address, activity_type, occurred_at
       FROM wallet_activity
       WHERE wallet_address = ANY($1)
       AND occurred_at >= $2
       ORDER BY occurred_at DESC
       LIMIT 50`,
      [['0x123...', '0x456...'], '2025-12-01']
    );
    console.log('Recent wallet activity:', recentActivity);

  } catch (error) {
    console.error('Query failed:', error);
  }
}

// Transaction examples
export async function transactionExamples() {
  try {
    const result = await transaction(async (client) => {
      // Insert new user
      const userResult = await client.query(
        `INSERT INTO users (telegram_id, telegram_username, ethereum_address, is_active, notification_preferences)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [123456789, 'john_doe', '0x123...', true, {
          enabled: true,
          position_updates: true,
          transactions: true,
          resolutions: true,
          price_alerts: true,
          large_positions: true,
          min_position_size: 1000,
          min_transaction_amount: 100,
          price_change_threshold: 5
        }]
      );

      const userId = userResult.rows[0].id;

      // Add tracked wallet for this user
      await client.query(
        `INSERT INTO tracked_wallets (user_id, wallet_address, alias, is_active)
         VALUES ($1, $2, $3, $4)`,
        [userId, '0x456...', 'Main Wallet', true]
      );

      // Set up notification preferences
      await client.query(
        `INSERT INTO position_alerts (user_id, condition_id, wallet_address, alert_type, threshold_value, is_active)
         VALUES ($1, $2, $3, $4, $5, $6),
                ($1, $7, $3, $8, $9, $6),
                ($1, $10, $3, $11, $12, $6)`,
        [
          userId,
          'position_size_alert',
          '0x456...',
          'position_size_threshold',
          50000,
          true,
          'transaction_alert',
          'transaction_amount_threshold',
          10000,
          'resolution_alert',
          null // resolution alerts apply to all tracked wallets
        ]
      );

      return {
        userId: userResult.rows[0].id,
        createdAt: userResult.rows[0].created_at
      };
    });

    console.log('Transaction completed successfully:', result);

  } catch (error) {
    console.error('Transaction failed:', error);
  }
}

// Manual client management example
export async function manualClientExample() {
  const client = await getClient();

  try {
    // Multiple operations with the same client
    await client.query('BEGIN'); // Start manual transaction

    // Check if user exists
    const userCheck = await client.query(
      'SELECT id FROM users WHERE telegram_id = $1 FOR UPDATE',
      [123456789]
    );

    if (userCheck.rows.length === 0) {
      // Create user if doesn't exist
      const createResult = await client.query(
        `INSERT INTO users (telegram_id, telegram_username, is_active)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [123456789, 'new_user', true]
      );

      console.log('Created new user with ID:', createResult.rows[0].id);
    } else {
      console.log('User already exists with ID:', userCheck.rows[0].id);
    }

    await client.query('COMMIT'); // Commit manual transaction

  } catch (error) {
    await client.query('ROLLBACK'); // Rollback on error
    console.error('Manual client operation failed:', error);
  } finally {
    client.release(); // Always release the client
  }
}

// Database statistics and health monitoring
export async function monitoringExamples() {
  try {
    // Get current pool statistics
    const stats = getDatabaseStats();
    console.log('Database Pool Statistics:', {
      totalConnections: stats.totalCount,
      idleConnections: stats.idleCount,
      activeConnections: stats.activeCount,
      waitingConnections: stats.waitingCount,
      averageResponseTime: stats.averageResponseTime,
      utilizationPercent: stats.totalCount > 0 ?
        Math.round((stats.activeCount / stats.totalCount) * 100) : 0
    });

    // Check database health
    const health = await checkDatabaseHealth();
    console.log('Database Health Status:', health.status);

    if (health.status === 'unhealthy') {
      console.warn('Database health issues detected:', health.details);

      // Take action based on health issues
      if (health.details.pool?.status === 'exhausted') {
        console.warn('Connection pool is exhausted - consider increasing pool size');
      }

      if (health.details.connectivity?.status === 'slow') {
        console.warn('Database responses are slow - check query performance');
      }
    }

    return { stats, health };

  } catch (error) {
    console.error('Monitoring failed:', error);
    return null;
  }
}

// Advanced query examples for Polymarket use cases
export async function polymarketQueryExamples() {
  try {
    // Get user's tracked wallets with their latest activity
    const trackedWallets = await query(`
      SELECT
        tw.id,
        tw.wallet_address,
        tw.alias,
        tw.is_active,
        tw.last_activity_at,
        COALESCE(latest_activity.latest_activity, 'Never') as latest_activity
      FROM tracked_wallets tw
      LEFT JOIN LATERAL (
        SELECT
          wallet_address,
          occurred_at as latest_activity,
          activity_type as latest_type
        FROM wallet_activity wa
        WHERE wa.wallet_address = tw.wallet_address
        ORDER BY wa.occurred_at DESC
        LIMIT 1
      ) latest_activity ON true
      WHERE tw.user_id = $1 AND tw.is_active = true
      ORDER BY tw.created_at DESC
    `, [123]); // user_id

    console.log('Tracked wallets with latest activity:', trackedWallets);

    // Get wallet activity summary for notifications
    const activitySummary = await query(`
      SELECT
        wa.wallet_address,
        COUNT(*) as total_activities,
        COUNT(CASE WHEN wa.occurred_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as activities_24h,
        COUNT(CASE WHEN wa.occurred_at >= NOW() - INTERVAL '7 days' THEN 1 END) as activities_7d,
        MAX(wa.occurred_at) as last_activity
      FROM wallet_activity wa
      WHERE wa.wallet_address = ANY($1)
      GROUP BY wa.wallet_address
      ORDER BY last_activity DESC NULLS LAST
    `, [['0x123...', '0x456...', '0x789...']]);

    console.log('Wallet activity summary:', activitySummary);

    // Get market resolutions that might affect tracked wallets
    const relevantMarkets = await query(`
      SELECT
        mr.condition_id,
        mr.condition_question,
        mr.resolution_outcome,
        mr.resolved_at,
        -- Find any positions these wallets had in these markets
        (
          SELECT JSON_AGG(DISTINCT wa.wallet_address)
          FROM wallet_activity wa
          WHERE wa.activity_data->>'market_id' = mr.condition_id
            AND wa.wallet_address = ANY($1)
            AND wa.occurred_at <= mr.resolved_at
        ) as affected_wallets
      FROM market_resolutions mr
      WHERE mr.resolved_at >= NOW() - INTERVAL '7 days'
        AND EXISTS (
          SELECT 1 FROM wallet_activity wa
          WHERE wa.activity_data->>'market_id' = mr.condition_id
            AND wa.wallet_address = ANY($1)
        )
      ORDER BY mr.resolved_at DESC
    `, [['0x123...', '0x456...', '0x789...']]);

    console.log('Recent market resolutions affecting tracked wallets:', relevantMarkets);

    return { trackedWallets, activitySummary, relevantMarkets };

  } catch (error) {
    console.error('Polymarket queries failed:', error);
    return null;
  }
}

// Batch operations for better performance
export async function batchOperationExamples() {
  try {
    await transaction(async (client) => {
      // Batch insert wallet activities
      const activities = [
        {
          wallet_address: '0x123...',
          activity_type: 'transaction',
          activity_data: { amount: '1000', token: 'USDC', market_id: '123' },
          occurred_at: new Date()
        },
        {
          wallet_address: '0x456...',
          activity_type: 'position_update',
          activity_data: { position_size: '5000', outcome: 'YES', market_id: '123' },
          occurred_at: new Date()
        },
        {
          wallet_address: '0x789...',
          activity_type: 'resolution',
          activity_data: { outcome: 'YES', market_id: '123', payout: '10000' },
          occurred_at: new Date()
        }
      ];

      // Create temporary table for batch insert
      await client.query(`
        CREATE TEMP TABLE temp_wallet_activities (
          wallet_address VARCHAR(42),
          activity_type VARCHAR(50),
          activity_data JSONB,
          occurred_at TIMESTAMP
        )
      `);

      // Insert into temp table
      const valuesQuery = activities.map((_, index) =>
        `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4})`
      ).join(', ');

      await client.query(`
        INSERT INTO temp_wallet_activities (wallet_address, activity_type, activity_data, occurred_at)
        VALUES ${valuesQuery}
      `, activities.flatMap(a => [a.wallet_address, a.activity_type, JSON.stringify(a.activity_data), a.occurred_at]));

      // Move from temp to main table (this is more efficient than individual inserts)
      await client.query(`
        INSERT INTO wallet_activity (wallet_address, activity_type, activity_data, occurred_at, is_processed)
        SELECT wallet_address, activity_type, activity_data, occurred_at, false
        FROM temp_wallet_activities
      `);

      // Drop temp table
      await client.query('DROP TABLE temp_wallet_activities');

      console.log(`Batch inserted ${activities.length} wallet activities`);

      // Batch update notification preferences
      const userIds = [123, 456, 789];
      const newPreferences = {
        enabled: true,
        position_updates: false,
        transactions: true,
        resolutions: true,
        price_alerts: true,
        large_positions: false,
        min_position_size: 5000,
        min_transaction_amount: 500,
        price_change_threshold: 10
      };

      await client.query(`
        UPDATE users
        SET
          notification_preferences = $2,
          updated_at = NOW()
        WHERE id = ANY($1)
      `, [userIds, JSON.stringify(newPreferences)]);

      console.log(`Updated notification preferences for ${userIds.length} users`);
    });

  } catch (error) {
    console.error('Batch operations failed:', error);
  }
}

// Cleanup and shutdown example
export async function cleanupExample() {
  try {
    console.log('Gracefully shutting down database connection pool...');
    await closeDatabasePool();
    console.log('Database pool closed successfully');
  } catch (error) {
    console.error('Error during database cleanup:', error);
  }
}

// Main example runner
export async function runAllExamples() {
  console.log('🚀 Starting PostgreSQL connection pool examples...');

  // Check database health first
  console.log('\n📊 Checking database health...');
  await monitoringExamples();

  // Run basic query examples
  console.log('\n🔍 Running basic query examples...');
  await basicQueryExamples();

  // Run transaction examples
  console.log('\n💳 Running transaction examples...');
  await transactionExamples();

  // Run manual client example
  console.log('\n🎮 Running manual client example...');
  await manualClientExample();

  // Run Polymarket-specific examples
  console.log('\n📈 Running Polymarket query examples...');
  await polymarketQueryExamples();

  // Run batch operation examples
  console.log('\n⚡ Running batch operation examples...');
  await batchOperationExamples();

  // Final monitoring check
  console.log('\n📊 Final database statistics...');
  await monitoringExamples();

  console.log('\n✅ All examples completed successfully!');
}

// Export individual functions for testing
export default {
  basicQueryExamples,
  transactionExamples,
  manualClientExample,
  monitoringExamples,
  polymarketQueryExamples,
  batchOperationExamples,
  cleanupExample,
  runAllExamples
};