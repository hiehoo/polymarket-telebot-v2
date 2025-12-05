/**
 * Wallet Activity Tracker Test Script
 *
 * Usage: npx ts-node -r tsconfig-paths/register src/services/wallet-tracker/test-wallet-tracker.ts <wallet_address>
 *
 * Example: npx ts-node -r tsconfig-paths/register src/services/wallet-tracker/test-wallet-tracker.ts 0x1234...
 */

import axios from 'axios';
import {
  PositionSnapshot,
  PositionChange,
  detectChanges,
  createSnapshotFromPositions,
  formatNotification,
} from './position-diff-detector';

const DATA_API_URL = 'https://data-api.polymarket.com';
const POLL_INTERVAL_MS = 60000; // 60 seconds
const MAX_POLLS = 5;

interface DataApiPosition {
  conditionId: string;
  asset: string;
  size: number;
  avgPrice: number;
  title: string;
  eventSlug: string;
  outcome: string;
  side: string;
  curPrice?: number;
  cashPnl?: number;
  currentValue?: number;
}

async function fetchPositions(walletAddress: string): Promise<DataApiPosition[]> {
  try {
    const response = await axios.get(`${DATA_API_URL}/positions`, {
      params: {
        user: walletAddress,
        limit: 500,
        sizeThreshold: 0.01, // Filter out resolved/empty positions
      },
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PolymarketTeleBot/1.0',
      },
    });

    return response.data || [];
  } catch (error) {
    console.error('Failed to fetch positions:', error);
    return [];
  }
}

function printSnapshot(snapshot: Map<string, PositionSnapshot>): void {
  console.log('\n📊 Current Positions:');
  console.log('─'.repeat(80));

  if (snapshot.size === 0) {
    console.log('  No positions found');
    return;
  }

  let index = 1;
  for (const [key, pos] of snapshot) {
    const marketUrl = pos.eventSlug
      ? `https://polymarket.com/event/${pos.eventSlug}`
      : 'N/A';

    console.log(`  ${index}. ${pos.title}`);
    console.log(`     ${pos.outcome} | ${pos.size.toFixed(2)} shares @ $${pos.avgPrice.toFixed(2)}`);
    console.log(`     URL: ${marketUrl}`);
    console.log('');
    index++;
  }
}

function printChanges(changes: PositionChange[], walletAddress: string): void {
  if (changes.length === 0) {
    console.log('✅ No changes detected');
    return;
  }

  console.log(`\n🔔 Detected ${changes.length} change(s):`);
  console.log('─'.repeat(80));

  for (const change of changes) {
    const notification = formatNotification(change, walletAddress);
    console.log(`  ${notification}`);
    console.log('');
  }
}

function simulateChange(
  snapshot: Map<string, PositionSnapshot>
): Map<string, PositionSnapshot> {
  // For testing: simulate a change by modifying a random position
  const newSnapshot = new Map(snapshot);

  if (newSnapshot.size > 0) {
    const keys = Array.from(newSnapshot.keys());
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    const pos = newSnapshot.get(randomKey)!;

    // Randomly increase or decrease size by 10-50%
    const changePercent = (Math.random() * 0.4 + 0.1) * (Math.random() > 0.5 ? 1 : -1);
    const newSize = Math.max(0.1, pos.size * (1 + changePercent));

    newSnapshot.set(randomKey, {
      ...pos,
      size: newSize,
      timestamp: Date.now(),
    });

    console.log(`\n🧪 [SIMULATION] Modified position "${pos.title}" from ${pos.size.toFixed(2)} to ${newSize.toFixed(2)} shares`);
  }

  return newSnapshot;
}

async function main(): Promise<void> {
  const walletAddress = process.argv[2];
  const simulateMode = process.argv.includes('--simulate');

  if (!walletAddress) {
    console.error('Usage: npx ts-node -r tsconfig-paths/register src/services/wallet-tracker/test-wallet-tracker.ts <wallet_address> [--simulate]');
    console.error('');
    console.error('Options:');
    console.error('  --simulate    Simulate position changes for testing');
    process.exit(1);
  }

  console.log('═'.repeat(80));
  console.log('🔍 Wallet Activity Tracker Test');
  console.log('═'.repeat(80));
  console.log(`📍 Wallet: ${walletAddress}`);
  console.log(`⏱️  Polling interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`🔢 Max polls: ${MAX_POLLS}`);
  console.log(`🧪 Simulation mode: ${simulateMode ? 'ON' : 'OFF'}`);
  console.log('═'.repeat(80));

  // Fetch initial snapshot
  console.log('\n📥 Fetching initial positions...');
  const initialPositions = await fetchPositions(walletAddress);
  let previousSnapshot = createSnapshotFromPositions(initialPositions);

  console.log(`✅ Found ${previousSnapshot.size} active positions`);
  printSnapshot(previousSnapshot);

  if (previousSnapshot.size === 0) {
    console.log('\n⚠️  No positions found for this wallet. The tracker will still run to detect new positions.');
  }

  // Start polling loop
  let pollCount = 0;

  const poll = async (): Promise<void> => {
    pollCount++;
    console.log('\n' + '═'.repeat(80));
    console.log(`📡 Poll #${pollCount} - ${new Date().toLocaleTimeString()}`);
    console.log('═'.repeat(80));

    let currentSnapshot: Map<string, PositionSnapshot>;

    if (simulateMode && pollCount > 1) {
      // Simulate changes for testing
      currentSnapshot = await simulateChange(previousSnapshot);
    } else {
      // Fetch real data
      const currentPositions = await fetchPositions(walletAddress);
      currentSnapshot = createSnapshotFromPositions(currentPositions);
    }

    console.log(`📊 Current positions: ${currentSnapshot.size}`);

    // Detect changes
    const changes = detectChanges(previousSnapshot, currentSnapshot);
    printChanges(changes, walletAddress);

    // Update snapshot
    previousSnapshot = currentSnapshot;

    if (pollCount >= MAX_POLLS) {
      console.log('\n' + '═'.repeat(80));
      console.log(`✅ Test complete after ${MAX_POLLS} polls`);
      console.log('═'.repeat(80));
      process.exit(0);
    }
  };

  // Run first poll immediately
  await poll();

  // Schedule subsequent polls
  const interval = setInterval(async () => {
    try {
      await poll();
    } catch (error) {
      console.error('Poll error:', error);
    }
  }, POLL_INTERVAL_MS);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping tracker...');
    clearInterval(interval);
    process.exit(0);
  });

  console.log(`\n⏳ Waiting ${POLL_INTERVAL_MS / 1000}s for next poll... (Press Ctrl+C to stop)`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
