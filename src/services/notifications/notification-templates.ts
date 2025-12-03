import { NotificationData } from './notification-service';

export class NotificationTemplates {
  static transaction(notification: {
    walletAddress: string;
    walletAlias?: string;
    amount: number;
    currency: string;
    type: 'sent' | 'received';
    hash: string;
    marketId?: string;
  }): NotificationData {
    const action = notification.type === 'sent' ? 'Sent' : 'Received';
    const walletName = notification.walletAlias ||
      `${notification.walletAddress.slice(0, 8)}...${notification.walletAddress.slice(-6)}`;

    return {
      userId: 0, // Will be set by the caller
      type: 'transaction',
      title: `Transaction ${action}`,
      message: `${action} ${notification.amount} ${notification.currency} from ${walletName}`,
      priority: notification.amount > 1000 ? 'high' : 'medium',
      metadata: {
        transactionHash: notification.hash,
        timestamp: Date.now()
      },
      data: notification
    };
  }

  static positionChange(notification: {
    walletAddress: string;
    walletAlias?: string;
    marketId: string;
    marketTitle: string;
    oldPosition: number;
    newPosition: number;
    percentageChange: number;
    currency: string;
  }): NotificationData {
    const changeDirection = notification.percentageChange > 0 ? 'increased' : 'decreased';
    const changeIcon = notification.percentageChange > 0 ? '📈' : '📉';
    const walletName = notification.walletAlias ||
      `${notification.walletAddress.slice(0, 8)}...${notification.walletAddress.slice(-6)}`;

    return {
      userId: 0, // Will be set by the caller
      type: 'position',
      title: `${changeIcon} Position Change`,
      message: `Position ${changeDirection} by ${Math.abs(notification.percentageChange).toFixed(2)}%\n\n` +
        `Market: ${notification.marketTitle}\n` +
        `Wallet: ${walletName}\n` +
        `New Position: ${notification.newPosition} ${notification.currency}`,
      priority: Math.abs(notification.percentageChange) > 50 ? 'high' : 'medium',
      metadata: {
        marketId: notification.marketId,
        timestamp: Date.now()
      },
      data: notification
    };
  }

  static marketResolution(notification: {
    marketId: string;
    marketTitle: string;
    outcome: string;
    finalPrice: number;
    currency: string;
    affectedWallets: string[];
  }): NotificationData {
    return {
      userId: 0, // Will be set by the caller
      type: 'resolution',
      title: '🎯 Market Resolved',
      message: `Market: ${notification.marketTitle}\n\n` +
        `Outcome: ${notification.outcome}\n` +
        `Final Price: ${notification.finalPrice} ${notification.currency}`,
      priority: 'high',
      metadata: {
        marketId: notification.marketId,
        timestamp: Date.now()
      },
      data: notification
    };
  }

  static priceAlert(notification: {
    walletAddress: string;
    walletAlias?: string;
    marketId: string;
    marketTitle: string;
    currentPrice: number;
    targetPrice: number;
    currency: string;
    alertType: 'above' | 'below';
  }): NotificationData {
    const direction = notification.alertType === 'above' ? 'above' : 'below';
    const directionIcon = notification.alertType === 'above' ? '⬆️' : '⬇️';
    const walletName = notification.walletAlias ||
      `${notification.walletAddress.slice(0, 8)}...${notification.walletAddress.slice(-6)}`;

    return {
      userId: 0, // Will be set by the caller
      type: 'price_alert',
      title: `${directionIcon} Price Alert`,
      message: `Price moved ${direction} target\n\n` +
        `Market: ${notification.marketTitle}\n` +
        `Current: ${notification.currentPrice} ${notification.currency}\n` +
        `Target: ${notification.targetPrice} ${notification.currency}\n` +
        `Wallet: ${walletName}`,
      priority: 'medium',
      metadata: {
        marketId: notification.marketId,
        timestamp: Date.now()
      },
      data: notification
    };
  }

  static systemAlert(notification: {
    title: string;
    message: string;
    severity: 'info' | 'warning' | 'error';
    actionUrl?: string;
  }): NotificationData {
    const priorityMap = {
      info: 'low',
      warning: 'medium',
      error: 'urgent'
    };

    return {
      userId: 0, // Will be set by the caller
      type: 'system',
      title: notification.title,
      message: notification.message,
      priority: priorityMap[notification.severity],
      metadata: {
        timestamp: Date.now()
      },
      data: notification
    };
  }

  static largePosition(notification: {
    walletAddress: string;
    walletAlias?: string;
    marketId: string;
    marketTitle: string;
    positionSize: number;
    currency: string;
    threshold: number;
  }): NotificationData {
    const walletName = notification.walletAlias ||
      `${notification.walletAddress.slice(0, 8)}...${notification.walletAddress.slice(-6)}`;

    return {
      userId: 0, // Will be set by the caller
      type: 'position',
      title: '🚨 Large Position Alert',
      message: `Large position detected\n\n` +
        `Market: ${notification.marketTitle}\n` +
        `Wallet: ${walletName}\n` +
        `Position: ${notification.positionSize} ${notification.currency}\n` +
        `Threshold: ${notification.threshold} ${notification.currency}`,
      priority: 'high',
      metadata: {
        marketId: notification.marketId,
        timestamp: Date.now()
      },
      data: notification
    };
  }

  static walletStatusChange(notification: {
    walletAddress: string;
    walletAlias?: string;
    status: 'active' | 'inactive' | 'error';
    message: string;
  }): NotificationData {
    const statusIcons = {
      active: '🟢',
      inactive: '🟡',
      error: '🔴'
    };

    const walletName = notification.walletAlias ||
      `${notification.walletAddress.slice(0, 8)}...${notification.walletAddress.slice(-6)}`;

    return {
      userId: 0, // Will be set by the caller
      type: 'system',
      title: `${statusIcons[notification.status]} Wallet Status`,
      message: `Wallet: ${walletName}\n\n${notification.message}`,
      priority: notification.status === 'error' ? 'urgent' : 'low',
      metadata: {
        timestamp: Date.now()
      },
      data: notification
    };
  }

  static dailyDigest(notification: {
    summary: {
      totalTransactions: number;
      totalVolume: number;
      marketChanges: number;
      resolutions: number;
    };
    topWallets: Array<{
      address: string;
      alias?: string;
      volume: number;
      transactions: number;
    }>;
    currency: string;
  }): NotificationData {
    let message = `📊 Daily Market Digest\n\n` +
      `📈 *Summary:*\n` +
      `• Total Transactions: ${notification.summary.totalTransactions}\n` +
      `• Total Volume: ${notification.summary.totalVolume} ${notification.currency}\n` +
      `• Market Changes: ${notification.summary.marketChanges}\n` +
      `• Resolutions: ${notification.summary.resolutions}\n\n` +
      `🏆 *Top Performers:*\n`;

    notification.topWallets.forEach((wallet, index) => {
      const walletName = wallet.alias ||
        `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}`;
      message += `${index + 1}. ${walletName}: ${wallet.volume} ${notification.currency}\n`;
    });

    return {
      userId: 0, // Will be set by the caller
      type: 'system',
      title: '📊 Daily Digest',
      message,
      priority: 'low',
      metadata: {
        timestamp: Date.now()
      },
      data: notification
    };
  }
}