/**
 * Consensus Notification Formatter
 * Formats consensus signals for Telegram notifications
 */

import { ConsensusSignal } from './consensus-detector';

/**
 * Get emoji for confidence level
 */
function getConfidenceEmoji(level: string): string {
  switch (level) {
    case 'VERY_HIGH': return '🔥';
    case 'HIGH': return '💪';
    case 'MEDIUM': return '📊';
    case 'LOW': return '📉';
    default: return '📊';
  }
}

/**
 * Format currency value
 */
function formatValue(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

/**
 * Format short wallet address
 */
function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Escape special characters for Telegram Markdown
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Format consensus signal for Telegram notification
 */
export function formatConsensusNotification(signal: ConsensusSignal): string {
  const emoji = getConfidenceEmoji(signal.confidenceLevel);
  const sideEmoji = signal.side === 'YES' ? '🟢' : '🔴';

  let message = `🎯 *CONSENSUS DETECTED* ${emoji}\n\n`;

  // Market info
  message += `📊 *${escapeMarkdown(signal.marketTitle)}*\n`;
  message += `${sideEmoji} Side: *${signal.side}*\n`;
  message += `👥 ${signal.walletCount} smart wallets agree\n`;
  message += `💰 Total: *${formatValue(signal.totalValue)}*\n`;
  message += `📈 Confidence: *${signal.confidenceScore}%* (${signal.confidenceLevel})\n\n`;

  // Wallet breakdown
  message += `*Wallets:*\n`;
  for (const wallet of signal.wallets.slice(0, 5)) { // Show top 5
    const pct = wallet.portfolioPercent.toFixed(1);
    message += `• ${escapeMarkdown(wallet.alias)}: ${formatValue(wallet.value)} (${pct}%)\n`;
  }

  if (signal.wallets.length > 5) {
    message += `_...and ${signal.wallets.length - 5} more_\n`;
  }

  // Link to market
  if (signal.marketSlug) {
    message += `\n🔗 [View on Polymarket](https://polymarket.com/event/${signal.marketSlug})`;
  }

  return message;
}

/**
 * Format multiple consensus signals as a digest
 */
export function formatConsensusDigest(signals: ConsensusSignal[]): string {
  if (signals.length === 0) {
    return '📭 No consensus signals detected today.';
  }

  let message = `🎯 *CONSENSUS DIGEST*\n`;
  message += `Found ${signals.length} signal(s)\n\n`;

  for (let i = 0; i < Math.min(signals.length, 5); i++) {
    const signal = signals[i];
    const emoji = getConfidenceEmoji(signal.confidenceLevel);
    const sideEmoji = signal.side === 'YES' ? '🟢' : '🔴';

    message += `${i + 1}. ${emoji} ${sideEmoji} *${escapeMarkdown(signal.marketTitle.slice(0, 50))}*\n`;
    message += `   ${signal.walletCount} wallets • ${formatValue(signal.totalValue)} • ${signal.confidenceScore}%\n\n`;
  }

  if (signals.length > 5) {
    message += `_...and ${signals.length - 5} more signals_`;
  }

  return message;
}

/**
 * Format scan status message
 */
export function formatScanStatus(
  walletsScanned: number,
  positionsFound: number,
  signalsDetected: number,
  durationMs: number
): string {
  const duration = (durationMs / 1000).toFixed(1);

  return `✅ *Consensus Scan Complete*\n\n` +
    `📊 Wallets scanned: ${walletsScanned}\n` +
    `📍 Positions found: ${positionsFound}\n` +
    `🎯 Signals detected: ${signalsDetected}\n` +
    `⏱️ Duration: ${duration}s`;
}
