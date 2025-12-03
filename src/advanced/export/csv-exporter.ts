import { Logger } from '../../utils/logger';

export interface ExportData {
  wallets?: Array<{
    address: string;
    alias?: string;
    addedAt: Date;
    lastActivity?: Date;
    totalValue: number;
    currency: string;
  }>;
  transactions?: Array<{
    hash: string;
    walletAddress: string;
    walletAlias?: string;
    amount: number;
    currency: string;
    type: 'sent' | 'received';
    timestamp: Date;
    marketId?: string;
    marketTitle?: string;
  }>;
  positions?: Array<{
    walletAddress: string;
    walletAlias?: string;
    marketId: string;
    marketTitle: string;
    outcome: string;
    size: number;
    price: number;
    currency: string;
    pnl?: number;
    status: 'active' | 'closed';
    createdAt: Date;
    closedAt?: Date;
  }>;
  alerts?: Array<{
    id: string;
    marketId: string;
    marketTitle: string;
    alertType: string;
    targetValue: number;
    currentValue: number;
    isTriggered: boolean;
    triggeredAt?: Date;
    createdAt: Date;
  }>;
  portfolio?: {
    totalValue: number;
    totalPnL: number;
    totalPositions: number;
    winRate: number;
    averagePositionSize: number;
    currency: string;
    generatedAt: Date;
    period: string;
  };
}

export interface ExportOptions {
  format: 'csv' | 'json';
  includeHeaders: boolean;
  dateFormat: 'iso' | 'readable';
  includeDecimals: boolean;
  compress?: boolean;
  filename?: string;
}

export class CSVExporter {
  private logger = Logger.getInstance();

  async exportWallets(
    userId: number,
    options: Partial<ExportOptions> = {}
  ): Promise<Buffer> {
    const exportOptions = this.getDefaultOptions('wallets', options);
    const data = await this.getUserWalletData(userId);

    if (exportOptions.format === 'json') {
      return this.exportToJSON(data, exportOptions);
    }

    return this.exportWalletsToCSV(data.wallets || [], exportOptions);
  }

  async exportTransactions(
    userId: number,
    startDate?: Date,
    endDate?: Date,
    options: Partial<ExportOptions> = {}
  ): Promise<Buffer> {
    const exportOptions = this.getDefaultOptions('transactions', options);
    const data = await this.getUserTransactionData(userId, startDate, endDate);

    if (exportOptions.format === 'json') {
      return this.exportToJSON(data, exportOptions);
    }

    return this.exportTransactionsToCSV(data.transactions || [], exportOptions);
  }

  async exportPositions(
    userId: number,
    includeClosed: boolean = false,
    options: Partial<ExportOptions> = {}
  ): Promise<Buffer> {
    const exportOptions = this.getDefaultOptions('positions', options);
    const data = await this.getUserPositionData(userId, includeClosed);

    if (exportOptions.format === 'json') {
      return this.exportToJSON(data, exportOptions);
    }

    return this.exportPositionsToCSV(data.positions || [], exportOptions);
  }

  async exportAlerts(
    userId: number,
    includeTriggered: boolean = true,
    options: Partial<ExportOptions> = {}
  ): Promise<Buffer> {
    const exportOptions = this.getDefaultOptions('alerts', options);
    const data = await this.getUserAlertData(userId, includeTriggered);

    if (exportOptions.format === 'json') {
      return this.exportToJSON(data, exportOptions);
    }

    return this.exportAlertsToCSV(data.alerts || [], exportOptions);
  }

  async exportPortfolioReport(
    userId: number,
    period: '7d' | '30d' | '90d' | '1y' = '30d',
    options: Partial<ExportOptions> = {}
  ): Promise<Buffer> {
    const exportOptions = this.getDefaultOptions('portfolio', options);
    const data = await this.getUserPortfolioData(userId, period);

    if (exportOptions.format === 'json') {
      return this.exportToJSON(data, exportOptions);
    }

    return this.exportPortfolioToCSV(data.portfolio, exportOptions);
  }

  async exportFullDataset(
    userId: number,
    options: Partial<ExportOptions> = {}
  ): Promise<Buffer> {
    const exportOptions = this.getDefaultOptions('full', options);

    const [
      wallets,
      transactions,
      positions,
      alerts,
      portfolio
    ] = await Promise.all([
      this.getUserWalletData(userId),
      this.getUserTransactionData(userId),
      this.getUserPositionData(userId, true),
      this.getUserAlertData(userId, true),
      this.getUserPortfolioData(userId, '30d')
    ]);

    const fullData = {
      wallets: wallets.wallets,
      transactions: transactions.transactions,
      positions: positions.positions,
      alerts: alerts.alerts,
      portfolio: portfolio.portfolio,
      exportedAt: new Date(),
      userId,
      exportType: 'full_dataset'
    };

    if (exportOptions.format === 'json') {
      return this.exportToJSON(fullData, exportOptions);
    }

    // For CSV, combine all data into multiple sheets
    return this.exportMultipleSheets(fullData, exportOptions);
  }

  private exportWalletsToCSV(
    wallets: ExportData['wallets'],
    options: ExportOptions
  ): Buffer {
    const headers = [
      'Wallet Address',
      'Alias',
      'Added At',
      'Last Activity',
      'Total Value',
      'Currency'
    ];

    const rows = wallets?.map(wallet => [
      wallet.address,
      wallet.alias || '',
      this.formatDate(wallet.addedAt, options.dateFormat),
      wallet.lastActivity ? this.formatDate(wallet.lastActivity, options.dateFormat) : '',
      this.formatNumber(wallet.totalValue, options.includeDecimals),
      wallet.currency
    ]) || [];

    return this.createCSV(headers, rows, options);
  }

  private exportTransactionsToCSV(
    transactions: ExportData['transactions'],
    options: ExportOptions
  ): Buffer {
    const headers = [
      'Transaction Hash',
      'Wallet Address',
      'Wallet Alias',
      'Amount',
      'Currency',
      'Type',
      'Timestamp',
      'Market ID',
      'Market Title'
    ];

    const rows = transactions?.map(tx => [
      tx.hash,
      tx.walletAddress,
      tx.walletAlias || '',
      this.formatNumber(tx.amount, options.includeDecimals),
      tx.currency,
      tx.type,
      this.formatDate(tx.timestamp, options.dateFormat),
      tx.marketId || '',
      tx.marketTitle || ''
    ]) || [];

    return this.createCSV(headers, rows, options);
  }

  private exportPositionsToCSV(
    positions: ExportData['positions'],
    options: ExportOptions
  ): Buffer {
    const headers = [
      'Wallet Address',
      'Wallet Alias',
      'Market ID',
      'Market Title',
      'Outcome',
      'Position Size',
      'Price',
      'Currency',
      'P/L',
      'Status',
      'Created At',
      'Closed At'
    ];

    const rows = positions?.map(position => [
      position.walletAddress,
      position.walletAlias || '',
      position.marketId,
      position.marketTitle,
      position.outcome,
      this.formatNumber(position.size, options.includeDecimals),
      this.formatNumber(position.price, options.includeDecimals),
      position.currency,
      position.pnl !== undefined ? this.formatNumber(position.pnl, options.includeDecimals) : '',
      position.status,
      this.formatDate(position.createdAt, options.dateFormat),
      position.closedAt ? this.formatDate(position.closedAt, options.dateFormat) : ''
    ]) || [];

    return this.createCSV(headers, rows, options);
  }

  private exportAlertsToCSV(
    alerts: ExportData['alerts'],
    options: ExportOptions
  ): Buffer {
    const headers = [
      'Alert ID',
      'Market ID',
      'Market Title',
      'Alert Type',
      'Target Value',
      'Current Value',
      'Is Triggered',
      'Triggered At',
      'Created At'
    ];

    const rows = alerts?.map(alert => [
      alert.id,
      alert.marketId,
      alert.marketTitle,
      alert.alertType,
      this.formatNumber(alert.targetValue, options.includeDecimals),
      this.formatNumber(alert.currentValue, options.includeDecimals),
      alert.isTriggered ? 'Yes' : 'No',
      alert.triggeredAt ? this.formatDate(alert.triggeredAt, options.dateFormat) : '',
      this.formatDate(alert.createdAt, options.dateFormat)
    ]) || [];

    return this.createCSV(headers, rows, options);
  }

  private exportPortfolioToCSV(
    portfolio: ExportData['portfolio'],
    options: ExportOptions
  ): Buffer {
    if (!portfolio) {
      return Buffer.from('No portfolio data available');
    }

    const headers = ['Metric', 'Value'];
    const rows = [
      ['Total Value', `${this.formatNumber(portfolio.totalValue, options.includeDecimals)} ${portfolio.currency}`],
      ['Total P/L', `${this.formatNumber(portfolio.totalPnL, options.includeDecimals)} ${portfolio.currency}`],
      ['Total Positions', portfolio.totalPositions.toString()],
      ['Win Rate', `${portfolio.winRate.toFixed(2)}%`],
      ['Average Position Size', `${this.formatNumber(portfolio.averagePositionSize, options.includeDecimals)} ${portfolio.currency}`],
      ['Currency', portfolio.currency],
      ['Period', portfolio.period],
      ['Generated At', this.formatDate(portfolio.generatedAt, options.dateFormat)]
    ];

    return this.createCSV(headers, rows, options);
  }

  private exportMultipleSheets(
    data: any,
    options: ExportOptions
  ): Buffer {
    // Create a multi-sheet CSV format with sections
    let csv = '';

    if (data.wallets && data.wallets.length > 0) {
      csv += '\n' + '='.repeat(50) + '\n';
      csv += 'WALLETS\n';
      csv += '='.repeat(50) + '\n';
      csv += this.exportWalletsToCSV(data.wallets, options).toString();
    }

    if (data.transactions && data.transactions.length > 0) {
      csv += '\n' + '='.repeat(50) + '\n';
      csv += 'TRANSACTIONS\n';
      csv += '='.repeat(50) + '\n';
      csv += this.exportTransactionsToCSV(data.transactions, options).toString();
    }

    if (data.positions && data.positions.length > 0) {
      csv += '\n' + '='.repeat(50) + '\n';
      csv += 'POSITIONS\n';
      csv += '='.repeat(50) + '\n';
      csv += this.exportPositionsToCSV(data.positions, options).toString();
    }

    if (data.alerts && data.alerts.length > 0) {
      csv += '\n' + '='.repeat(50) + '\n';
      csv += 'ALERTS\n';
      csv += '='.repeat(50) + '\n';
      csv += this.exportAlertsToCSV(data.alerts, options).toString();
    }

    if (data.portfolio) {
      csv += '\n' + '='.repeat(50) + '\n';
      csv += 'PORTFOLIO SUMMARY\n';
      csv += '='.repeat(50) + '\n';
      csv += this.exportPortfolioToCSV(data.portfolio, options).toString();
    }

    csv += '\n' + '='.repeat(50) + '\n';
    csv += 'EXPORT METADATA\n';
    csv += '='.repeat(50) + '\n';
    csv += `Exported At,${this.formatDate(new Date(), options.dateFormat)}\n`;
    csv += `User ID,${data.userId}\n`;
    csv += `Export Type,${data.exportType}\n`;

    return Buffer.from(csv);
  }

  private exportToJSON(data: any, options: ExportOptions): Buffer {
    const jsonStr = JSON.stringify(data, null, 2);
    return Buffer.from(jsonStr, 'utf-8');
  }

  private createCSV(headers: string[], rows: string[][], options: ExportOptions): Buffer {
    let csv = '';

    if (options.includeHeaders) {
      csv += headers.join(',') + '\n';
    }

    // Escape special characters in CSV
    const escapeField = (field: string): string => {
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };

    const escapedRows = rows.map(row => row.map(escapeField).join(','));
    csv += escapedRows.join('\n');

    return Buffer.from(csv, 'utf-8');
  }

  private formatDate(date: Date, format: 'iso' | 'readable'): string {
    if (format === 'iso') {
      return date.toISOString();
    } else {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }

  private formatNumber(num: number, includeDecimals: boolean): string {
    if (includeDecimals) {
      return num.toFixed(6);
    } else {
      return Math.round(num).toString();
    }
  }

  private getDefaultOptions(type: string, options: Partial<ExportOptions>): ExportOptions {
    const defaultOptions: ExportOptions = {
      format: 'csv',
      includeHeaders: true,
      dateFormat: 'readable',
      includeDecimals: true,
      compress: false
    };

    // Set default filename based on type
    const date = new Date().toISOString().split('T')[0];
    defaultOptions.filename = `${type}_export_${date}`;

    return { ...defaultOptions, ...options };
  }

  // Data retrieval methods (would integrate with existing services)
  private async getUserWalletData(userId: number): Promise<ExportData> {
    // Retrieve user's wallet data
    return { wallets: [] };
  }

  private async getUserTransactionData(
    userId: number,
    startDate?: Date,
    endDate?: Date
  ): Promise<ExportData> {
    // Retrieve user's transaction data with date filtering
    return { transactions: [] };
  }

  private async getUserPositionData(
    userId: number,
    includeClosed: boolean
  ): Promise<ExportData> {
    // Retrieve user's position data
    return { positions: [] };
  }

  private async getUserAlertData(
    userId: number,
    includeTriggered: boolean
  ): Promise<ExportData> {
    // Retrieve user's alert data
    return { alerts: [] };
  }

  private async getUserPortfolioData(
    userId: number,
    period: '7d' | '30d' | '90d' | '1y'
  ): Promise<ExportData> {
    // Retrieve user's portfolio data
    return {
      portfolio: {
        totalValue: 0,
        totalPnL: 0,
        totalPositions: 0,
        winRate: 0,
        averagePositionSize: 0,
        currency: 'USDC',
        generatedAt: new Date(),
        period
      }
    };
  }

  // Utility methods for file management
  async saveExportToFile(
    userId: number,
    data: Buffer,
    filename: string,
    format: 'csv' | 'json'
  ): Promise<{ filePath: string; size: number }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fullFilename = `${filename}_${timestamp}.${format}`;
    const filePath = `/tmp/exports/${userId}/${fullFilename}`;

    // Ensure directory exists
    const dir = `/tmp/exports/${userId}`;
    await this.ensureDirectoryExists(dir);

    // Save file
    await Bun.write(filePath, data);

    const size = data.length;
    this.logger.info('Export file saved', {
      userId,
      filename: fullFilename,
      size,
      format
    });

    return { filePath, size };
  }

  private async ensureDirectoryExists(dir: string): Promise<void> {
    // Implementation would create directory if it doesn't exist
  }

  async cleanupExpiredExports(userId: number, maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    // Clean up exports older than maxAge (default 7 days)
    // Return number of files deleted
    return 0;
  }

  // Statistics
  async getExportStatistics(userId: number): Promise<{
    totalExports: number;
    totalSize: number;
    recentExports: Array<{
      filename: string;
      size: number;
      createdAt: Date;
      format: string;
    }>;
  }> {
    return {
      totalExports: 0,
      totalSize: 0,
      recentExports: []
    };
  }

  // Validation
  validateExportRequest(
    userId: number,
    exportType: string,
    dateRange?: { start: Date; end: Date }
  ): { valid: boolean; error?: string } {
    // Validate export request parameters
    // Check user permissions, rate limits, etc.

    if (dateRange && dateRange.start > dateRange.end) {
      return { valid: false, error: 'Start date must be before end date' };
    }

    if (dateRange && (dateRange.end.getTime() - dateRange.start.getTime()) > 365 * 24 * 60 * 60 * 1000) {
      return { valid: false, error: 'Date range cannot exceed 1 year' };
    }

    const validTypes = ['wallets', 'transactions', 'positions', 'alerts', 'portfolio', 'full'];
    if (!validTypes.includes(exportType)) {
      return { valid: false, error: `Invalid export type: ${exportType}` };
    }

    return { valid: true };
  }
}