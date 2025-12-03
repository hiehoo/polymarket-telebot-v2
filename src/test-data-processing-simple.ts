import logger from '@/utils/logger';
import databasePool from '@/services/database/connection-pool';

class SimpleDataProcessingTest {
  async run(): Promise<void> {
    logger.info('Starting simple data processing integration test...');

    try {
      // Test 1: Database connection
      logger.info('Test 1: Database connection...');
      const dbHealth = await databasePool.healthCheck();
      logger.info('✅ Database health check', dbHealth);

      // Test 2: Basic query
      logger.info('Test 2: Basic database query...');
      const result = await databasePool.query('SELECT NOW() as current_time, version() as version');
      logger.info('✅ Database query successful', {
        currentTime: result[0]?.current_time,
        version: result[0]?.version?.split(' ')[1],
      });

      // Test 3: Transaction
      logger.info('Test 3: Database transaction...');
      await databasePool.transaction(async (client) => {
        const txResult = await client.query('SELECT COUNT(*) as count FROM pg_tables WHERE schemaname = \'public\'');
        logger.info('✅ Database transaction successful', {
          tableCount: txResult[0]?.count,
        });
      });

      // Test 4: Connection stats
      logger.info('Test 4: Connection statistics...');
      const stats = databasePool.getStats();
      logger.info('✅ Connection stats', stats);

      logger.info('🎉 All simple integration tests passed!');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('💥 Simple integration test failed', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    } finally {
      await databasePool.close();
      logger.info('✅ Database connections closed');
    }
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  const test = new SimpleDataProcessingTest();
  test.run()
    .then(() => {
      logger.info('🎉 Simple integration tests completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Simple integration tests failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      process.exit(1);
    });
}

export default SimpleDataProcessingTest;