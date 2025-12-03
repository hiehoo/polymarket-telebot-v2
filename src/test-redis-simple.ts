/**
 * Simple Redis Test Script
 * Basic validation of Redis connectivity and core operations
 */

import { simpleRedisClient } from './services/redis';
import { logger } from './utils/logger';

async function testBasicRedisOperations(): Promise<{
  success: boolean;
  operations: {
    connection: boolean;
    set: boolean;
    get: boolean;
    del: boolean;
    hash: boolean;
    setOps: boolean;
    ping: boolean;
  };
  details: Record<string, any>;
}> {
  const results = {
    connection: false,
    set: false,
    get: false,
    del: false,
    hash: false,
    setOps: false,
    ping: false,
  };

  const details: Record<string, any> = {};

  try {
    console.log('🔌 Testing Redis connection...');
    await simpleRedisClient.connect();
    results.connection = simpleRedisClient.isClientConnected();
    details.connection = 'Connected successfully';

    console.log('🏓 Testing Redis PING...');
    const pingResponse = await simpleRedisClient.ping();
    results.ping = pingResponse === 'PONG';
    details.ping = { response: pingResponse };

    console.log('💾 Testing Redis SET/GET...');
    const testKey = `test:${Date.now()}`;
    const testValue = { message: 'Hello Redis!', timestamp: Date.now() };
    await simpleRedisClient.set(testKey, testValue, 60);
    results.set = true;

    const retrievedValue = await simpleRedisClient.get(testKey);
    const parsedValue = retrievedValue ? JSON.parse(retrievedValue) : null;
    results.get = parsedValue?.message === testValue.message;
    details.getSet = { key: testKey, original: testValue, retrieved: parsedValue };

    console.log('🗑️ Testing Redis DEL...');
    const deleteResult = await simpleRedisClient.del(testKey);
    results.del = deleteResult > 0;
    details.del = { key: testKey, deleted: deleteResult };

    console.log('📝 Testing Redis HASH operations...');
    const hashKey = `hash:${Date.now()}`;
    await simpleRedisClient.hset(hashKey, 'field1', 'value1');
    await simpleRedisClient.hset(hashKey, 'field2', 'value2');

    const hashValue1 = await simpleRedisClient.hget(hashKey, 'field1');
    const allHashValues = await simpleRedisClient.hgetall(hashKey);

    results.hash = hashValue1 === 'value1' && allHashValues.field1 === 'value1';
    details.hash = { key: hashKey, field1: hashValue1, allFields: allHashValues };

    await simpleRedisClient.del(hashKey);

    console.log('👥 Testing Redis SET operations...');
    const setKey = `set:${Date.now()}`;
    await simpleRedisClient.sadd(setKey, 'member1', 'member2', 'member3');

    const setMembers = await simpleRedisClient.smembers(setKey);
    const isMember = await simpleRedisClient.sismember(setKey, 'member1');

    results.setOps = setMembers.includes('member1') && isMember === 1;
    details.setOps = { key: setKey, members: setMembers, isMember1: isMember };

    await simpleRedisClient.del(setKey);

    console.log('📊 Testing Redis INFO...');
    const info = await simpleRedisClient.info('server');
    details.info = info.includes('redis_version');

    const success = Object.values(results).every(Boolean);

    return {
      success,
      operations: results,
      details,
    };

  } catch (error) {
    console.error('❌ Redis test failed:', error);
    details.error = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      operations: results,
      details,
    };
  }
}

async function main(): Promise<void> {
  console.log('🚀 Starting Simple Redis Tests');
  console.log('=' .repeat(50));

  try {
    const testResult = await testBasicRedisOperations();

    console.log('\n📊 Test Results:');
    console.log('=' .repeat(30));

    Object.entries(testResult.operations).forEach(([operation, success]) => {
      const status = success ? '✅' : '❌';
      const operationName = operation.charAt(0).toUpperCase() + operation.slice(1);
      console.log(`${status} ${operationName}`);
    });

    console.log('\n📋 Detailed Results:');
    console.log(JSON.stringify(testResult.details, null, 2));

    if (testResult.success) {
      console.log('\n🎉 All Redis operations passed!');
      console.log('Redis configuration and basic functionality is working correctly.');
    } else {
      console.log('\n❌ Some Redis operations failed.');
      console.log('Please check your Redis server configuration and connectivity.');
    }

    console.log('\n🧹 Cleaning up...');
    await simpleRedisClient.flushall();
    await simpleRedisClient.disconnect();
    console.log('✅ Cleanup completed.');

    process.exit(testResult.success ? 0 : 1);

  } catch (error) {
    console.error('💥 Test execution failed:', error);
    console.error('Please ensure Redis server is running and accessible.');

    try {
      await simpleRedisClient.disconnect();
    } catch (disconnectError) {
      console.error('Failed to disconnect from Redis:', disconnectError);
    }

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

export { testBasicRedisOperations, main };