/**
 * Redis Test Script
 * Quick validation script for Redis components
 */

import { initializeRedisServices, testRedisServices } from './services/redis';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  try {
    console.log('🚀 Initializing Redis services...');

    // Initialize all Redis services
    await initializeRedisServices();

    console.log('✅ Redis services initialized successfully');

    // Run comprehensive tests
    console.log('🧪 Running Redis integration tests...');
    const testResult = await testRedisServices();

    console.log('📊 Test Results:');
    console.log(`   Success: ${testResult.success ? '✅' : '❌'}`);
    console.log(`   Health Status: ${testResult.health.overall}`);

    // Show abbreviated report
    const reportLines = testResult.report.split('\n').slice(0, 20);
    console.log('\n📋 Test Report (first 20 lines):');
    reportLines.forEach((line, index) => {
      if (line.trim()) {
        console.log(`   ${index + 1}: ${line}`);
      }
    });

    if (testResult.success) {
      console.log('\n🎉 All Redis components are working correctly!');
    } else {
      console.log('\n❌ Some Redis components have issues. Please review the full report.');
      process.exit(1);
    }

  } catch (error) {
    console.error('💥 Redis test failed:', error);
    console.error('Please check your Redis configuration and ensure Redis server is running.');
    process.exit(1);
  }
}

// Only run tests if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { main };