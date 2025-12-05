/**
 * Position Diff Detector
 * Compares two position snapshots and detects changes (BUY/SELL)
 */

export interface PositionSnapshot {
  conditionId: string;
  asset: string;
  size: number;
  avgPrice: number;
  title: string;
  eventSlug: string;
  outcome: string; // YES/NO
  timestamp: number;
}

export interface PositionChange {
  type: 'BUY' | 'SELL' | 'NEW' | 'CLOSED';
  conditionId: string;
  asset: string;
  title: string;
  eventSlug: string;
  outcome: string;
  deltaShares: number;
  price: number;
  totalValue: number;
}

/**
 * Create a unique key for position (conditionId + outcome)
 */
export function getPositionKey(position: { conditionId: string; outcome: string }): string {
  return `${position.conditionId}:${position.outcome}`;
}

/**
 * Detect changes between two position snapshots
 * @param previous Previous snapshot (Map of positionKey -> PositionSnapshot)
 * @param current Current snapshot (Map of positionKey -> PositionSnapshot)
 * @returns Array of detected changes
 */
export function detectChanges(
  previous: Map<string, PositionSnapshot>,
  current: Map<string, PositionSnapshot>
): PositionChange[] {
  const changes: PositionChange[] = [];

  // Check current positions against previous
  for (const [key, currentPos] of current) {
    const previousPos = previous.get(key);

    if (!previousPos) {
      // NEW position - didn't exist before
      changes.push({
        type: 'NEW',
        conditionId: currentPos.conditionId,
        asset: currentPos.asset,
        title: currentPos.title,
        eventSlug: currentPos.eventSlug,
        outcome: currentPos.outcome,
        deltaShares: currentPos.size,
        price: currentPos.avgPrice,
        totalValue: currentPos.size * currentPos.avgPrice,
      });
    } else {
      const sizeDelta = currentPos.size - previousPos.size;
      const threshold = 0.001; // Ignore tiny changes

      if (sizeDelta > threshold) {
        // BUY - size increased
        changes.push({
          type: 'BUY',
          conditionId: currentPos.conditionId,
          asset: currentPos.asset,
          title: currentPos.title,
          eventSlug: currentPos.eventSlug,
          outcome: currentPos.outcome,
          deltaShares: sizeDelta,
          price: currentPos.avgPrice, // Use current avg price as estimate
          totalValue: sizeDelta * currentPos.avgPrice,
        });
      } else if (sizeDelta < -threshold) {
        // SELL - size decreased
        changes.push({
          type: 'SELL',
          conditionId: currentPos.conditionId,
          asset: currentPos.asset,
          title: currentPos.title,
          eventSlug: currentPos.eventSlug,
          outcome: currentPos.outcome,
          deltaShares: Math.abs(sizeDelta),
          price: previousPos.avgPrice, // Use previous price for sell
          totalValue: Math.abs(sizeDelta) * previousPos.avgPrice,
        });
      }
    }
  }

  // Check for closed positions (in previous but not in current)
  for (const [key, previousPos] of previous) {
    if (!current.has(key)) {
      // CLOSED - position no longer exists
      changes.push({
        type: 'CLOSED',
        conditionId: previousPos.conditionId,
        asset: previousPos.asset,
        title: previousPos.title,
        eventSlug: previousPos.eventSlug,
        outcome: previousPos.outcome,
        deltaShares: previousPos.size,
        price: previousPos.avgPrice,
        totalValue: previousPos.size * previousPos.avgPrice,
      });
    }
  }

  return changes;
}

/**
 * Convert API positions to snapshot map
 */
export function createSnapshotFromPositions(
  positions: Array<{
    conditionId?: string;
    asset?: string;
    size?: number;
    avgPrice?: number;
    title?: string;
    eventSlug?: string;
    outcome?: string;
    side?: string;
  }>
): Map<string, PositionSnapshot> {
  const snapshot = new Map<string, PositionSnapshot>();

  for (const pos of positions) {
    if (!pos.conditionId || !pos.size || pos.size <= 0) continue;

    const outcome = pos.outcome || pos.side || 'YES';
    const key = getPositionKey({ conditionId: pos.conditionId, outcome });

    snapshot.set(key, {
      conditionId: pos.conditionId,
      asset: pos.asset || '',
      size: pos.size,
      avgPrice: pos.avgPrice || 0,
      title: pos.title || 'Unknown Market',
      eventSlug: pos.eventSlug || '',
      outcome,
      timestamp: Date.now(),
    });
  }

  return snapshot;
}

/**
 * Format notification message for a position change
 */
export function formatNotification(change: PositionChange, walletAddress: string): string {
  const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  const action = change.type === 'NEW' || change.type === 'BUY' ? 'Buy' : 'Sell';
  const shares = change.deltaShares.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const price = change.price.toFixed(2);
  const total = change.totalValue.toFixed(2);
  const marketUrl = change.eventSlug
    ? `https://polymarket.com/event/${change.eventSlug}`
    : null;

  // Format: 0xABC...DEF Buy Yes | [Russia-Ukraine Ceasefire](url) | 1,000 @ $0.45 ($450)
  const titlePart = marketUrl
    ? `[${change.title}](${marketUrl})`
    : change.title;

  return `${shortAddress} ${action} ${change.outcome} | ${titlePart} | ${shares} @ $${price} ($${total})`;
}
