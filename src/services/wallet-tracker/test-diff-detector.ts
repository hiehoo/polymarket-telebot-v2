/**
 * Unit test for position diff detector
 * Run: npx ts-node -r tsconfig-paths/register src/services/wallet-tracker/test-diff-detector.ts
 */

import {
  PositionSnapshot,
  detectChanges,
  formatNotification,
  getPositionKey,
} from './position-diff-detector';

function createTestSnapshot(): Map<string, PositionSnapshot> {
  const snapshot = new Map<string, PositionSnapshot>();

  // Position 1: 100 shares of YES @ $0.45
  snapshot.set('cond1:YES', {
    conditionId: 'cond1',
    asset: 'asset1',
    size: 100,
    avgPrice: 0.45,
    title: 'Trump wins 2024',
    eventSlug: 'trump-wins-2024',
    outcome: 'YES',
    timestamp: Date.now(),
  });

  // Position 2: 50 shares of NO @ $0.30
  snapshot.set('cond2:NO', {
    conditionId: 'cond2',
    asset: 'asset2',
    size: 50,
    avgPrice: 0.30,
    title: 'Fed rate hike',
    eventSlug: 'fed-rate-hike-2025',
    outcome: 'NO',
    timestamp: Date.now(),
  });

  // Position 3: 200 shares of YES @ $0.65
  snapshot.set('cond3:YES', {
    conditionId: 'cond3',
    asset: 'asset3',
    size: 200,
    avgPrice: 0.65,
    title: 'Bitcoin above $100k',
    eventSlug: 'bitcoin-100k-2025',
    outcome: 'YES',
    timestamp: Date.now(),
  });

  return snapshot;
}

function test1_NewPosition(): void {
  console.log('\n📝 Test 1: Detect NEW position');
  console.log('─'.repeat(60));

  const previous = new Map<string, PositionSnapshot>();
  const current = createTestSnapshot();

  const changes = detectChanges(previous, current);

  console.log(`Expected: 3 NEW changes`);
  console.log(`Actual: ${changes.length} changes`);

  if (changes.length === 3 && changes.every(c => c.type === 'NEW')) {
    console.log('✅ PASS');
  } else {
    console.log('❌ FAIL');
    console.log('Changes:', changes);
  }
}

function test2_BuyMore(): void {
  console.log('\n📝 Test 2: Detect BUY (size increase)');
  console.log('─'.repeat(60));

  const previous = createTestSnapshot();
  const current = new Map(previous);

  // Increase position 1 from 100 to 150
  const pos = current.get('cond1:YES')!;
  current.set('cond1:YES', { ...pos, size: 150 });

  const changes = detectChanges(previous, current);

  console.log(`Expected: 1 BUY change with deltaShares=50`);
  console.log(`Actual: ${changes.length} changes`);

  if (
    changes.length === 1 &&
    changes[0].type === 'BUY' &&
    Math.abs(changes[0].deltaShares - 50) < 0.01
  ) {
    console.log('✅ PASS');
    console.log('Notification:', formatNotification(changes[0], '0x1234567890abcdef'));
  } else {
    console.log('❌ FAIL');
    console.log('Changes:', changes);
  }
}

function test3_SellPartial(): void {
  console.log('\n📝 Test 3: Detect SELL (size decrease)');
  console.log('─'.repeat(60));

  const previous = createTestSnapshot();
  const current = new Map(previous);

  // Decrease position 1 from 100 to 40
  const pos = current.get('cond1:YES')!;
  current.set('cond1:YES', { ...pos, size: 40 });

  const changes = detectChanges(previous, current);

  console.log(`Expected: 1 SELL change with deltaShares=60`);
  console.log(`Actual: ${changes.length} changes`);

  if (
    changes.length === 1 &&
    changes[0].type === 'SELL' &&
    Math.abs(changes[0].deltaShares - 60) < 0.01
  ) {
    console.log('✅ PASS');
    console.log('Notification:', formatNotification(changes[0], '0x1234567890abcdef'));
  } else {
    console.log('❌ FAIL');
    console.log('Changes:', changes);
  }
}

function test4_ClosePosition(): void {
  console.log('\n📝 Test 4: Detect CLOSED position');
  console.log('─'.repeat(60));

  const previous = createTestSnapshot();
  const current = new Map(previous);

  // Remove position 2
  current.delete('cond2:NO');

  const changes = detectChanges(previous, current);

  console.log(`Expected: 1 CLOSED change`);
  console.log(`Actual: ${changes.length} changes`);

  if (changes.length === 1 && changes[0].type === 'CLOSED') {
    console.log('✅ PASS');
    console.log('Notification:', formatNotification(changes[0], '0x1234567890abcdef'));
  } else {
    console.log('❌ FAIL');
    console.log('Changes:', changes);
  }
}

function test5_MultipleChanges(): void {
  console.log('\n📝 Test 5: Detect multiple changes');
  console.log('─'.repeat(60));

  const previous = createTestSnapshot();
  const current = new Map(previous);

  // 1. Buy more of position 1 (100 -> 200)
  const pos1 = current.get('cond1:YES')!;
  current.set('cond1:YES', { ...pos1, size: 200 });

  // 2. Close position 2
  current.delete('cond2:NO');

  // 3. Add new position 4
  current.set('cond4:YES', {
    conditionId: 'cond4',
    asset: 'asset4',
    size: 75,
    avgPrice: 0.55,
    title: 'Russia-Ukraine Ceasefire',
    eventSlug: 'russia-ukraine-ceasefire-2025',
    outcome: 'YES',
    timestamp: Date.now(),
  });

  const changes = detectChanges(previous, current);

  console.log(`Expected: 3 changes (1 BUY, 1 CLOSED, 1 NEW)`);
  console.log(`Actual: ${changes.length} changes`);

  const buyChanges = changes.filter(c => c.type === 'BUY');
  const closedChanges = changes.filter(c => c.type === 'CLOSED');
  const newChanges = changes.filter(c => c.type === 'NEW');

  if (
    changes.length === 3 &&
    buyChanges.length === 1 &&
    closedChanges.length === 1 &&
    newChanges.length === 1
  ) {
    console.log('✅ PASS');
    console.log('\nNotifications:');
    changes.forEach(c => {
      console.log('  ' + formatNotification(c, '0xABCD1234EFGH5678'));
    });
  } else {
    console.log('❌ FAIL');
    console.log('Changes:', changes);
  }
}

function test6_NoChanges(): void {
  console.log('\n📝 Test 6: No changes');
  console.log('─'.repeat(60));

  const previous = createTestSnapshot();
  const current = new Map(previous);

  const changes = detectChanges(previous, current);

  console.log(`Expected: 0 changes`);
  console.log(`Actual: ${changes.length} changes`);

  if (changes.length === 0) {
    console.log('✅ PASS');
  } else {
    console.log('❌ FAIL');
    console.log('Changes:', changes);
  }
}

function test7_SmallChangeIgnored(): void {
  console.log('\n📝 Test 7: Small changes ignored (below threshold)');
  console.log('─'.repeat(60));

  const previous = createTestSnapshot();
  const current = new Map(previous);

  // Very small change (0.0001 shares)
  const pos1 = current.get('cond1:YES')!;
  current.set('cond1:YES', { ...pos1, size: pos1.size + 0.0001 });

  const changes = detectChanges(previous, current);

  console.log(`Expected: 0 changes (below 0.001 threshold)`);
  console.log(`Actual: ${changes.length} changes`);

  if (changes.length === 0) {
    console.log('✅ PASS');
  } else {
    console.log('❌ FAIL');
    console.log('Changes:', changes);
  }
}

// Run all tests
console.log('═'.repeat(60));
console.log('🧪 Position Diff Detector Unit Tests');
console.log('═'.repeat(60));

test1_NewPosition();
test2_BuyMore();
test3_SellPartial();
test4_ClosePosition();
test5_MultipleChanges();
test6_NoChanges();
test7_SmallChangeIgnored();

console.log('\n' + '═'.repeat(60));
console.log('✅ All tests completed');
console.log('═'.repeat(60));
