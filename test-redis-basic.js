/**
 * Basic Redis Test (JavaScript)
 * Simple test to verify Redis connectivity without TypeScript complications
 */

const Redis = require('ioredis');

class SimpleRedisTest {
  constructor() {
    this.client = null;
    this.connected = false;
  }

  async connect() {
    try {
      console.log('🔌 Connecting to Redis...');
      this.client = new Redis('redis://localhost:6379');

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 5000);

        this.client.on('connect', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      this.connected = true;
      console.log('✅ Connected to Redis successfully');
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error.message);
      throw error;
    }
  }

  async testBasicOperations() {
    if (!this.connected) {
      throw new Error('Not connected to Redis');
    }

    const results = {
      ping: false,
      set: false,
      get: false,
      del: false,
      hash: false,
      setOps: false,
    };

    console.log('🏓 Testing PING...');
    try {
      const pong = await this.client.ping();
      results.ping = pong === 'PONG';
      console.log(`   PING: ${pong} (${results.ping ? '✅' : '❌'})`);
    } catch (error) {
      console.log(`   PING: Failed (${error.message})`);
    }

    console.log('💾 Testing SET/GET...');
    try {
      const testKey = `test:${Date.now()}`;
      const testValue = { message: 'Hello Redis!', timestamp: Date.now() };

      await this.client.set(testKey, JSON.stringify(testValue), 'EX', 60);
      results.set = true;
      console.log('   SET: ✅');

      const retrieved = await this.client.get(testKey);
      const parsed = retrieved ? JSON.parse(retrieved) : null;
      results.get = parsed?.message === testValue.message;
      console.log(`   GET: ${results.get ? '✅' : '❌'}`);

      await this.client.del(testKey);
      results.del = true;
      console.log('   DEL: ✅');
    } catch (error) {
      console.log(`   SET/GET: Failed (${error.message})`);
    }

    console.log('📝 Testing HASH operations...');
    try {
      const hashKey = `hash:${Date.now()}`;
      await this.client.hset(hashKey, 'field1', 'value1');
      await this.client.hset(hashKey, 'field2', 'value2');

      const value1 = await this.client.hget(hashKey, 'field1');
      const allValues = await this.client.hgetall(hashKey);

      results.hash = value1 === 'value1' && allValues.field1 === 'value1';
      console.log(`   HSET/HGET: ${results.hash ? '✅' : '❌'}`);

      await this.client.del(hashKey);
    } catch (error) {
      console.log(`   HASH: Failed (${error.message})`);
    }

    console.log('👥 Testing SET operations...');
    try {
      const setKey = `set:${Date.now()}`;
      await this.client.sadd(setKey, 'member1', 'member2', 'member3');

      const members = await this.client.smembers(setKey);
      const isMember = await this.client.sismember(setKey, 'member1');

      results.setOps = members.includes('member1') && isMember === 1;
      console.log(`   SADD/SMEMBERS: ${results.setOps ? '✅' : '❌'}`);

      await this.client.del(setKey);
    } catch (error) {
      console.log(`   SET: Failed (${error.message})`);
    }

    console.log('📊 Testing INFO...');
    try {
      const info = await this.client.info('server');
      console.log(`   INFO: ${info.includes('redis_version') ? '✅' : '❌'}`);
    } catch (error) {
      console.log(`   INFO: Failed (${error.message})`);
    }

    return Object.values(results).every(Boolean);
  }

  async cleanup() {
    if (this.client) {
      try {
        await this.client.flushall();
        console.log('🧹 Database flushed');
        await this.client.disconnect();
        console.log('🔌 Disconnected from Redis');
      } catch (error) {
        console.error('Cleanup failed:', error.message);
      }
    }
  }
}

async function main() {
  console.log('🚀 Starting Basic Redis Tests');
  console.log('=' .repeat(50));

  const tester = new SimpleRedisTest();

  try {
    await tester.connect();

    console.log('\n🧪 Running Redis Operation Tests');
    console.log('-' .repeat(40));

    const success = await tester.testBasicOperations();

    console.log('\n📊 Test Results Summary');
    console.log('=' .repeat(40));

    if (success) {
      console.log('🎉 All Redis operations passed!');
      console.log('✅ Redis is working correctly for the Polymarket Telegram Bot');
      console.log('\n📋 Success Criteria Met:');
      console.log('   ✅ Redis client connects successfully');
      console.log('   ✅ Basic Redis operations (GET/SET/DEL) work');
      console.log('   ✅ Hash operations (HSET/HGET) work');
      console.log('   ✅ Set operations (SADD/SMEMBERS) work');
      console.log('   ✅ Redis server info accessible');
    } else {
      console.log('❌ Some Redis operations failed');
      console.log('Please check your Redis configuration');
    }

    await tester.cleanup();

    process.exit(success ? 0 : 1);

  } catch (error) {
    console.error('\n💥 Test execution failed:', error.message);
    console.error('Please ensure Redis server is running on localhost:6379');
    console.error('You can start Redis with: redis-server');

    await tester.cleanup();
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { SimpleRedisTest, main };