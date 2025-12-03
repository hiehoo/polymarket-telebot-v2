import { Logger } from '../../utils/logger';

export interface WalletGroup {
  id: string;
  name: string;
  description?: string;
  userId: number;
  walletAddresses: string[];
  color?: string;
  icon?: string;
  tags: string[];
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
  settings: {
    notifications: boolean;
    alerts: boolean;
    analytics: boolean;
    export: boolean;
  };
  metadata: {
    totalValue: number;
    lastActivity: Date;
    currency: string;
  };
}

export interface WalletGroupTemplate {
  id: string;
  name: string;
  description: string;
  category: 'trading' | 'investment' | 'monitoring' | 'analysis';
  suggestedTags: string[];
  defaultSettings: WalletGroup['settings'];
  isPublic: boolean;
}

export interface GroupAnalytics {
  groupId: string;
  totalValue: number;
  totalPnL: number;
  winRate: number;
  transactionCount: number;
  activePositions: number;
  topPerformers: Array<{
    walletAddress: string;
    value: number;
    performance: number;
  }>;
  riskMetrics: {
    volatility: number;
    concentration: number;
    maxDrawdown: number;
  };
  lastUpdated: Date;
}

export class WalletGroups {
  private logger = Logger.getInstance();
  private templates: Map<string, WalletGroupTemplate> = new Map();

  constructor() {
    this.initializeTemplates();
  }

  async createGroup(
    userId: number,
    name: string,
    walletAddresses: string[],
    options: Partial<WalletGroup> = {}
  ): Promise<WalletGroup> {
    try {
      const group: WalletGroup = {
        id: this.generateGroupId(userId, name),
        name,
        description: options.description,
        userId,
        walletAddresses: [...new Set(walletAddresses)], // Remove duplicates
        color: options.color || this.generateRandomColor(),
        icon: options.icon || '📊',
        tags: options.tags || [],
        isPublic: options.isPublic || false,
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: {
          notifications: options.settings?.notifications ?? true,
          alerts: options.settings?.alerts ?? true,
          analytics: options.settings?.analytics ?? true,
          export: options.settings?.export ?? true
        },
        metadata: {
          totalValue: 0,
          lastActivity: new Date(),
          currency: 'USDC'
        }
      };

      // Validate wallet addresses
      const validation = this.validateWalletAddresses(group.walletAddresses);
      if (!validation.valid) {
        throw new Error(`Invalid wallet addresses: ${validation.error}`);
      }

      // Update metadata
      await this.updateGroupMetadata(group);

      await this.saveGroup(group);

      this.logger.info('Wallet group created', {
        userId,
        groupId: group.id,
        name,
        walletCount: group.walletAddresses.length
      });

      return group;

    } catch (error) {
      this.logger.error('Error creating wallet group', {
        userId,
        name,
        walletCount: walletAddresses.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async updateGroup(
    userId: number,
    groupId: string,
    updates: Partial<WalletGroup>
  ): Promise<WalletGroup> {
    try {
      const existing = await this.getGroup(groupId);
      if (!existing || existing.userId !== userId) {
        throw new Error('Group not found or access denied');
      }

      const updated: WalletGroup = {
        ...existing,
        ...updates,
        id: groupId,
        updatedAt: new Date()
      };

      if (updates.walletAddresses) {
        const validation = this.validateWalletAddresses(updates.walletAddresses);
        if (!validation.valid) {
          throw new Error(`Invalid wallet addresses: ${validation.error}`);
        }
        updated.walletAddresses = [...new Set(updates.walletAddresses)];
      }

      // Update metadata if wallets or settings changed
      if (updates.walletAddresses || updates.settings) {
        await this.updateGroupMetadata(updated);
      }

      await this.saveGroup(updated);

      this.logger.info('Wallet group updated', {
        userId,
        groupId,
        updates: Object.keys(updates)
      });

      return updated;

    } catch (error) {
      this.logger.error('Error updating wallet group', {
        userId,
        groupId,
        error
      });
      throw error;
    }
  }

  async addWalletsToGroup(
    userId: number,
    groupId: string,
    walletAddresses: string[]
  ): Promise<WalletGroup> {
    const group = await this.getGroup(groupId);
    if (!group || group.userId !== userId) {
      throw new Error('Group not found or access denied');
    }

    const validation = this.validateWalletAddresses(walletAddresses);
    if (!validation.valid) {
      throw new Error(`Invalid wallet addresses: ${validation.error}`);
    }

    const newWallets = walletAddresses.filter(wallet => !group.walletAddresses.includes(wallet));
    const duplicateWallets = walletAddresses.filter(wallet => group.walletAddresses.includes(wallet));

    group.walletAddresses.push(...newWallets);
    group.updatedAt = new Date();

    await this.updateGroupMetadata(group);
    await this.saveGroup(group);

    this.logger.info('Wallets added to group', {
      userId,
      groupId,
      addedCount: newWallets.length,
      duplicateCount: duplicateWallets.length
    });

    return group;
  }

  async removeWalletsFromGroup(
    userId: number,
    groupId: string,
    walletAddresses: string[]
  ): Promise<WalletGroup> {
    const group = await this.getGroup(groupId);
    if (!group || group.userId !== userId) {
      throw new Error('Group not found or access denied');
    }

    const removedWallets = walletAddresses.filter(wallet => group.walletAddresses.includes(wallet));
    group.walletAddresses = group.walletAddresses.filter(wallet => !walletAddresses.includes(wallet));
    group.updatedAt = new Date();

    await this.updateGroupMetadata(group);
    await this.saveGroup(group);

    this.logger.info('Wallets removed from group', {
      userId,
      groupId,
      removedCount: removedWallets.length
    });

    return group;
  }

  async deleteGroup(userId: number, groupId: string): Promise<void> {
    try {
      const group = await this.getGroup(groupId);
      if (!group || group.userId !== userId) {
        throw new Error('Group not found or access denied');
      }

      await this.removeGroup(groupId);

      this.logger.info('Wallet group deleted', {
        userId,
        groupId,
        name: group.name,
        walletCount: group.walletAddresses.length
      });

    } catch (error) {
      this.logger.error('Error deleting wallet group', {
        userId,
        groupId,
        error
      });
      throw error;
    }
  }

  async getUserGroups(userId: number): Promise<WalletGroup[]> {
    try {
      return await this.getGroupsByUser(userId);
    } catch (error) {
      this.logger.error('Error getting user groups', {
        userId,
        error
      });
      return [];
    }
  }

  async getGroupAnalytics(groupId: string): Promise<GroupAnalytics | null> {
    try {
      const group = await this.getGroup(groupId);
      if (!group) {
        return null;
      }

      const analytics = await this.calculateGroupAnalytics(group);

      this.logger.debug('Group analytics calculated', {
        groupId,
        totalValue: analytics.totalValue,
        walletCount: group.walletAddresses.length
      });

      return analytics;

    } catch (error) {
      this.logger.error('Error calculating group analytics', {
        groupId,
        error
      });
      return null;
    }
  }

  async getGroupsByTag(userId: number, tag: string): Promise<WalletGroup[]> {
    const groups = await this.getUserGroups(userId);
    return groups.filter(group => group.tags.includes(tag));
  }

  async searchGroups(
    userId: number,
    query: string,
    filters?: {
      tags?: string[];
      minWallets?: number;
      maxWallets?: number;
      hasAnalytics?: boolean;
    }
  ): Promise<WalletGroup[]> {
    const groups = await this.getUserGroups(userId);
    let filtered = groups;

    // Text search
    if (query) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(group =>
        group.name.toLowerCase().includes(lowerQuery) ||
        (group.description && group.description.toLowerCase().includes(lowerQuery)) ||
        group.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      );
    }

    // Tag filter
    if (filters?.tags && filters.tags.length > 0) {
      filtered = filtered.filter(group =>
        filters.tags!.some(tag => group.tags.includes(tag))
      );
    }

    // Wallet count filters
    if (filters?.minWallets) {
      filtered = filtered.filter(group => group.walletAddresses.length >= filters.minWallets!);
    }

    if (filters?.maxWallets) {
      filtered = filtered.filter(group => group.walletAddresses.length <= filters.maxWallets!);
    }

    // Analytics filter
    if (filters?.hasAnalytics) {
      filtered = filtered.filter(group => group.settings.analytics);
    }

    return filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async getTemplate(templateId: string): Promise<WalletGroupTemplate | null> {
    return this.templates.get(templateId) || null;
  }

  async getTemplates(category?: WalletGroupTemplate['category']): Promise<WalletGroupTemplate[]> {
    let templates = Array.from(this.templates.values());

    if (category) {
      templates = templates.filter(template => template.category === category);
    }

    return templates.filter(template => template.isPublic);
  }

  async createGroupFromTemplate(
    userId: number,
    templateId: string,
    name: string,
    walletAddresses: string[],
    customizations?: Partial<WalletGroup>
  ): Promise<WalletGroup> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const group = await this.createGroup(userId, name, walletAddresses, {
      description: template.description,
      tags: template.suggestedTags,
      settings: template.defaultSettings,
      ...customizations
    });

    this.logger.info('Group created from template', {
      userId,
      templateId,
      groupId: group.id,
      templateName: template.name
    });

    return group;
  }

  private async calculateGroupAnalytics(group: WalletGroup): Promise<GroupAnalytics> {
    // This would integrate with existing services to get real data
    const startTime = Date.now();

    try {
      const [totalValue, totalPnL, transactionCount, activePositions] = await Promise.all([
        this.calculateGroupTotalValue(group.walletAddresses),
        this.calculateGroupTotalPnL(group.walletAddresses),
        this.calculateGroupTransactionCount(group.walletAddresses),
        this.calculateGroupActivePositions(group.walletAddresses)
      ]);

      const topPerformers = await this.getGroupTopPerformers(group.walletAddresses);
      const riskMetrics = await this.calculateGroupRiskMetrics(group.walletAddresses);

      const winRate = totalValue > 0 ? Math.max(0, totalPnL) / totalValue * 100 : 0;

      return {
        groupId: group.id,
        totalValue,
        totalPnL,
        winRate,
        transactionCount,
        activePositions,
        topPerformers,
        riskMetrics,
        lastUpdated: new Date()
      };

    } catch (error) {
      this.logger.error('Error calculating group analytics', {
        groupId: group.id,
        error
      });

      // Return default analytics on error
      return {
        groupId: group.id,
        totalValue: 0,
        totalPnL: 0,
        winRate: 0,
        transactionCount: 0,
        activePositions: 0,
        topPerformers: [],
        riskMetrics: {
          volatility: 0,
          concentration: 0,
          maxDrawdown: 0
        },
        lastUpdated: new Date()
      };
    } finally {
      const duration = Date.now() - startTime;
      this.logger.debug('Group analytics calculation completed', {
        groupId: group.id,
        duration,
        walletCount: group.walletAddresses.length
      });
    }
  }

  private async updateGroupMetadata(group: WalletGroup): Promise<void> {
    try {
      const [totalValue, lastActivity] = await Promise.all([
        this.calculateGroupTotalValue(group.walletAddresses),
        this.getGroupLastActivity(group.walletAddresses)
      ]);

      group.metadata.totalValue = totalValue;
      group.metadata.lastActivity = lastActivity;

    } catch (error) {
      this.logger.error('Error updating group metadata', {
        groupId: group.id,
        error
      });
    }
  }

  private validateWalletAddresses(walletAddresses: string[]): { valid: boolean; error?: string } {
    if (walletAddresses.length === 0) {
      return { valid: false, error: 'At least one wallet address is required' };
    }

    if (walletAddresses.length > 100) {
      return { valid: false, error: 'Maximum 100 wallet addresses allowed per group' };
    }

    const invalidAddresses = walletAddresses.filter(address =>
      !/^0x[a-fA-F0-9]{40}$/.test(address)
    );

    if (invalidAddresses.length > 0) {
      return { valid: false, error: `Invalid addresses: ${invalidAddresses.join(', ')}` };
    }

    return { valid: true };
  }

  private generateGroupId(userId: number, name: string): string {
    const timestamp = Date.now();
    const nameHash = Buffer.from(name).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6);
    return `group_${userId}_${nameHash}_${timestamp}`;
  }

  private generateRandomColor(): string {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  private initializeTemplates(): void {
    // Trading templates
    this.addTemplate({
      id: 'day_trading',
      name: 'Day Trading',
      description: 'Group for active day trading wallets',
      category: 'trading',
      suggestedTags: ['trading', 'short-term', 'active'],
      defaultSettings: {
        notifications: true,
        alerts: true,
        analytics: true,
        export: true
      },
      isPublic: true
    });

    this.addTemplate({
      id: 'swing_trading',
      name: 'Swing Trading',
      description: 'Group for medium-term trading positions',
      category: 'trading',
      suggestedTags: ['trading', 'medium-term', 'swing'],
      defaultSettings: {
        notifications: true,
        alerts: true,
        analytics: true,
        export: false
      },
      isPublic: true
    });

    // Investment templates
    this.addTemplate({
      id: 'long_term_investment',
      name: 'Long-term Investment',
      description: 'Group for long-term investment wallets',
      category: 'investment',
      suggestedTags: ['investment', 'long-term', 'hodl'],
      defaultSettings: {
        notifications: false,
        alerts: false,
        analytics: true,
        export: true
      },
      isPublic: true
    });

    // Monitoring templates
    this.addTemplate({
      id: 'whale_watching',
      name: 'Whale Watching',
      description: 'Group for monitoring large wallet activity',
      category: 'monitoring',
      suggestedTags: ['whales', 'monitoring', 'large-positions'],
      defaultSettings: {
        notifications: true,
        alerts: true,
        analytics: true,
        export: true
      },
      isPublic: true
    });

    // Analysis templates
    this.addTemplate({
      id: 'research_analysis',
      name: 'Research & Analysis',
      description: 'Group for analytical research and data collection',
      category: 'analysis',
      suggestedTags: ['research', 'analysis', 'data'],
      defaultSettings: {
        notifications: false,
        alerts: false,
        analytics: true,
        export: true
      },
      isPublic: true
    });
  }

  private addTemplate(template: WalletGroupTemplate): void {
    this.templates.set(template.id, template);
  }

  // Data calculation methods (would integrate with existing services)
  private async calculateGroupTotalValue(walletAddresses: string[]): Promise<number> {
    // Calculate total value of all positions across wallets
    return 0;
  }

  private async calculateGroupTotalPnL(walletAddresses: string[]): Promise<number> {
    // Calculate total P/L across all wallets
    return 0;
  }

  private async calculateGroupTransactionCount(walletAddresses: string[]): Promise<number> {
    // Count total transactions across all wallets
    return 0;
  }

  private async calculateGroupActivePositions(walletAddresses: string[]): Promise<number> {
    // Count active positions across all wallets
    return 0;
  }

  private async getGroupTopPerformers(walletAddresses: string[]): Promise<Array<{
    walletAddress: string;
    value: number;
    performance: number;
  }>> {
    // Get top performing wallets in the group
    return [];
  }

  private async calculateGroupRiskMetrics(walletAddresses: string[]): Promise<{
    volatility: number;
    concentration: number;
    maxDrawdown: number;
  }> {
    // Calculate risk metrics for the group
    return {
      volatility: 0,
      concentration: 0,
      maxDrawdown: 0
    };
  }

  private async getGroupLastActivity(walletAddresses: string[]): Promise<Date> {
    // Get the most recent activity across all wallets
    return new Date();
  }

  // Database operations (would integrate with existing database service)
  private async saveGroup(group: WalletGroup): Promise<void> {
    // Implementation would save to database
  }

  private async getGroup(groupId: string): Promise<WalletGroup | null> {
    // Implementation would retrieve from database
    return null;
  }

  private async getGroupsByUser(userId: number): Promise<WalletGroup[]> {
    // Implementation would retrieve user's groups
    return [];
  }

  private async removeGroup(groupId: string): Promise<void> {
    // Implementation would remove from database
  }

  // Analytics and reporting
  async getUserGroupAnalytics(userId: number): Promise<{
    totalGroups: number;
    totalWallets: number;
    totalValue: number;
    averageGroupSize: number;
    topPerformingGroups: Array<{
      groupId: string;
      name: string;
      totalValue: number;
      performance: number;
    }>;
  }> {
    try {
      const groups = await this.getUserGroups(userId);
      const totalGroups = groups.length;
      const totalWallets = groups.reduce((sum, group) => sum + group.walletAddresses.length, 0);
      const averageGroupSize = totalGroups > 0 ? totalWallets / totalGroups : 0;

      const groupAnalytics = await Promise.all(
        groups.map(group => this.getGroupAnalytics(group.id))
      );

      const validAnalytics = groupAnalytics.filter((analytics): analytics is GroupAnalytics => analytics !== null);
      const totalValue = validAnalytics.reduce((sum, analytics) => sum + analytics.totalValue, 0);

      const topPerformingGroups = validAnalytics
        .sort((a, b) => (b.totalValue + b.totalPnL) - (a.totalValue + a.totalPnL))
        .slice(0, 5)
        .map(analytics => {
          const group = groups.find(g => g.id === analytics.groupId)!;
          return {
            groupId: analytics.groupId,
            name: group.name,
            totalValue: analytics.totalValue,
            performance: analytics.totalPnL
          };
        });

      return {
        totalGroups,
        totalWallets,
        totalValue,
        averageGroupSize,
        topPerformingGroups
      };

    } catch (error) {
      this.logger.error('Error getting user group analytics', {
        userId,
        error
      });
      return {
        totalGroups: 0,
        totalWallets: 0,
        totalValue: 0,
        averageGroupSize: 0,
        topPerformingGroups: []
      };
    }
  }

  generateGroupSummary(group: WalletGroup, analytics?: GroupAnalytics): string {
    let summary = `📊 *${group.name}*\n\n`;

    if (group.description) {
      summary += `${group.description}\n\n`;
    }

    summary += `👛 *Wallets*: ${group.walletAddresses.length}\n`;

    if (analytics) {
      summary += `💰 *Total Value*: ${analytics.totalValue.toFixed(2)} ${group.metadata.currency}\n`;
      summary += `📈 *P/L*: ${analytics.totalPnL >= 0 ? '+' : ''}${analytics.totalPnL.toFixed(2)} ${group.metadata.currency}\n`;
      summary += `🎯 *Win Rate*: ${analytics.winRate.toFixed(1)}%\n`;
      summary += `🔄 *Transactions*: ${analytics.transactionCount}\n`;
      summary += `📊 *Active Positions*: ${analytics.activePositions}\n`;
    } else {
      summary += `💰 *Total Value*: ${group.metadata.totalValue.toFixed(2)} ${group.metadata.currency}\n`;
      summary += `🕒 *Last Activity*: ${group.metadata.lastActivity.toLocaleDateString()}\n`;
    }

    if (group.tags.length > 0) {
      summary += `\n🏷️ *Tags*: ${group.tags.map(tag => `#${tag}`).join(' ')}\n`;
    }

    summary += `\n📅 *Created*: ${group.createdAt.toLocaleDateString()}`;
    summary += `\n🔄 *Updated*: ${group.updatedAt.toLocaleDateString()}`;

    return summary;
  }
}