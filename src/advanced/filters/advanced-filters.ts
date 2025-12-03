import { Logger } from '../../utils/logger';

export interface FilterCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'not_in';
  value: any;
  caseSensitive?: boolean;
}

export interface FilterGroup {
  operator: 'AND' | 'OR';
  conditions: FilterCondition[];
  groups?: FilterGroup[];
}

export interface FilterPreset {
  id: string;
  userId: number;
  name: string;
  description?: string;
  type: 'transactions' | 'positions' | 'alerts' | 'wallets';
  filter: FilterGroup;
  isPublic: boolean;
  createdAt: Date;
  usageCount: number;
  isActive: boolean;
}

export interface SmartFilterRule {
  id: string;
  name: string;
  description: string;
  filter: FilterGroup;
  category: 'value' | 'time' | 'frequency' | 'behavior' | 'risk';
  complexity: 'basic' | 'intermediate' | 'advanced';
  examples: string[];
}

export class AdvancedFilters {
  private logger = Logger.getInstance();
  private smartFilters: Map<string, SmartFilterRule> = new Map();

  constructor() {
    this.initializeSmartFilters();
  }

  async createFilter(
    userId: number,
    name: string,
    type: FilterPreset['type'],
    filter: FilterGroup,
    description?: string,
    isPublic: boolean = false
  ): Promise<FilterPreset> {
    try {
      const preset: FilterPreset = {
        id: this.generateFilterId(userId, name),
        userId,
        name,
        description,
        type,
        filter,
        isPublic,
        createdAt: new Date(),
        usageCount: 0,
        isActive: true
      };

      // Validate filter structure
      const validation = this.validateFilter(filter);
      if (!validation.valid) {
        throw new Error(`Invalid filter: ${validation.error}`);
      }

      await this.saveFilterPreset(preset);

      this.logger.info('Filter preset created', {
        userId,
        filterId: preset.id,
        name,
        type
      });

      return preset;

    } catch (error) {
      this.logger.error('Error creating filter preset', {
        userId,
        name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async applyFilter<T>(
    data: T[],
    filter: FilterGroup,
    type: FilterPreset['type']
  ): Promise<T[]> {
    try {
      const startTime = Date.now();

      const filteredData = data.filter(item => this.evaluateFilter(item, filter, type));

      const duration = Date.now() - startTime;
      this.logger.debug('Filter applied', {
        itemCount: data.length,
        filteredCount: filteredData.length,
        duration,
        type
      });

      return filteredData;

    } catch (error) {
      this.logger.error('Error applying filter', {
        itemCount: data.length,
        type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return data; // Return original data on error
    }
  }

  async applySmartFilter<T>(
    data: T[],
    ruleId: string,
    type: FilterPreset['type'],
    customizations?: Partial<FilterGroup>
  ): Promise<{ filteredData: T[]; rule: SmartFilterRule }> {
    const rule = this.smartFilters.get(ruleId);
    if (!rule) {
      throw new Error(`Smart filter rule not found: ${ruleId}`);
    }

    const filter = customizations
      ? this.mergeFilters(rule.filter, customizations)
      : rule.filter;

    const filteredData = await this.applyFilter(data, filter, type);

    // Increment usage count
    await this.incrementSmartFilterUsage(ruleId);

    return { filteredData, rule };
  }

  async getFilterPresets(
    userId: number,
    type?: FilterPreset['type'],
    includePublic: boolean = true
  ): Promise<FilterPreset[]> {
    try {
      const presets = await this.getUserFilterPresets(userId);
      let filtered = presets;

      if (type) {
        filtered = filtered.filter(preset => preset.type === type);
      }

      if (includePublic) {
        const publicPresets = await this.getPublicFilterPresets(type);
        filtered = [...filtered, ...publicPresets];
      }

      return filtered.sort((a, b) => b.usageCount - a.usageCount);

    } catch (error) {
      this.logger.error('Error getting filter presets', {
        userId,
        type,
        error
      });
      return [];
    }
  }

  async getSmartFilters(
    category?: SmartFilterRule['category'],
    complexity?: SmartFilterRule['complexity']
  ): Promise<SmartFilterRule[]> {
    let filters = Array.from(this.smartFilters.values());

    if (category) {
      filters = filters.filter(filter => filter.category === category);
    }

    if (complexity) {
      filters = filters.filter(filter => filter.complexity === complexity);
    }

    return filters.sort((a, b) => a.name.localeCompare(b.name));
  }

  async updateFilterPreset(
    userId: number,
    filterId: string,
    updates: Partial<FilterPreset>
  ): Promise<FilterPreset> {
    try {
      const existing = await this.getFilterPreset(filterId);
      if (!existing || existing.userId !== userId) {
        throw new Error('Filter not found or access denied');
      }

      const updated: FilterPreset = {
        ...existing,
        ...updates,
        id: filterId // Preserve ID
      };

      if (updates.filter) {
        const validation = this.validateFilter(updates.filter);
        if (!validation.valid) {
          throw new Error(`Invalid filter: ${validation.error}`);
        }
      }

      await this.saveFilterPreset(updated);

      this.logger.info('Filter preset updated', {
        userId,
        filterId,
        updates: Object.keys(updates)
      });

      return updated;

    } catch (error) {
      this.logger.error('Error updating filter preset', {
        userId,
        filterId,
        error
      });
      throw error;
    }
  }

  async deleteFilterPreset(userId: number, filterId: string): Promise<void> {
    try {
      const preset = await this.getFilterPreset(filterId);
      if (!preset || preset.userId !== userId) {
        throw new Error('Filter not found or access denied');
      }

      await this.removeFilterPreset(filterId);

      this.logger.info('Filter preset deleted', {
        userId,
        filterId,
        name: preset.name
      });

    } catch (error) {
      this.logger.error('Error deleting filter preset', {
        userId,
        filterId,
        error
      });
      throw error;
    }
  }

  private evaluateFilter<T>(item: T, filter: FilterGroup, type: FilterPreset['type']): boolean {
    if (filter.operator === 'AND') {
      return filter.conditions.every(condition => this.evaluateCondition(item, condition, type)) &&
             (!filter.groups || filter.groups.every(group => this.evaluateFilter(item, group, type)));
    } else {
      // OR
      const conditionResults = filter.conditions.map(condition => this.evaluateCondition(item, condition, type));
      const groupResults = filter.groups ? filter.groups.map(group => this.evaluateFilter(item, group, type)) : [];

      return [...conditionResults, ...groupResults].some(result => result);
    }
  }

  private evaluateCondition<T>(item: T, condition: FilterCondition, type: FilterPreset['type']): boolean {
    const fieldValue = this.getFieldValue(item, condition.field, type);
    const compareValue = condition.value;

    switch (condition.operator) {
      case 'eq':
        return this.compareValues(fieldValue, compareValue, condition.caseSensitive) === 0;
      case 'ne':
        return this.compareValues(fieldValue, compareValue, condition.caseSensitive) !== 0;
      case 'gt':
        return this.compareValues(fieldValue, compareValue, condition.caseSensitive) > 0;
      case 'gte':
        return this.compareValues(fieldValue, compareValue, condition.caseSensitive) >= 0;
      case 'lt':
        return this.compareValues(fieldValue, compareValue, condition.caseSensitive) < 0;
      case 'lte':
        return this.compareValues(fieldValue, compareValue, condition.caseSensitive) <= 0;
      case 'contains':
        const fieldStr = String(fieldValue || '');
        const valueStr = String(compareValue || '');
        return condition.caseSensitive
          ? fieldStr.includes(valueStr)
          : fieldStr.toLowerCase().includes(valueStr.toLowerCase());
      case 'in':
        if (!Array.isArray(compareValue)) return false;
        return compareValue.some(val => this.compareValues(fieldValue, val, condition.caseSensitive) === 0);
      case 'not_in':
        if (!Array.isArray(compareValue)) return true;
        return !compareValue.some(val => this.compareValues(fieldValue, val, condition.caseSensitive) === 0);
      default:
        return false;
    }
  }

  private getFieldValue<T>(item: T, field: string, type: FilterPreset['type']): any {
    // Handle nested field access (e.g., "wallet.address" or "market.title")
    const keys = field.split('.');
    let value: any = item;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private compareValues(a: any, b: any, caseSensitive: boolean = true): number {
    // Handle different data types
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime();
    }

    if (typeof a === 'string' && typeof b === 'string') {
      const strA = caseSensitive ? a : a.toLowerCase();
      const strB = caseSensitive ? b : b.toLowerCase();
      return strA.localeCompare(strB);
    }

    // Fallback to string comparison
    const strA = caseSensitive ? String(a || '') : String(a || '').toLowerCase();
    const strB = caseSensitive ? String(b || '') : String(b || '').toLowerCase();
    return strA.localeCompare(strB);
  }

  private validateFilter(filter: FilterGroup): { valid: boolean; error?: string } {
    if (!filter.conditions || filter.conditions.length === 0) {
      return { valid: false, error: 'Filter must have at least one condition' };
    }

    if (!['AND', 'OR'].includes(filter.operator)) {
      return { valid: false, error: 'Invalid filter operator' };
    }

    for (const condition of filter.conditions) {
      const validation = this.validateCondition(condition);
      if (!validation.valid) {
        return validation;
      }
    }

    if (filter.groups) {
      for (const group of filter.groups) {
        const validation = this.validateFilter(group);
        if (!validation.valid) {
          return validation;
        }
      }
    }

    return { valid: true };
  }

  private validateCondition(condition: FilterCondition): { valid: boolean; error?: string } {
    if (!condition.field || typeof condition.field !== 'string') {
      return { valid: false, error: 'Condition must have a valid field' };
    }

    const validOperators = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'not_in'];
    if (!validOperators.includes(condition.operator)) {
      return { valid: false, error: `Invalid operator: ${condition.operator}` };
    }

    if (condition.value === undefined || condition.value === null) {
      return { valid: false, error: 'Condition must have a value' };
    }

    if ((condition.operator === 'in' || condition.operator === 'not_in') && !Array.isArray(condition.value)) {
      return { valid: false, error: 'IN/NOT_IN operators require array values' };
    }

    return { valid: true };
  }

  private mergeFilters(baseFilter: FilterGroup, customizations: Partial<FilterGroup>): FilterGroup {
    return {
      operator: customizations.operator || baseFilter.operator,
      conditions: customizations.conditions || baseFilter.conditions,
      groups: customizations.groups || baseFilter.groups
    };
  }

  private generateFilterId(userId: number, name: string): string {
    const timestamp = Date.now();
    const nameHash = Buffer.from(name).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    return `filter_${userId}_${nameHash}_${timestamp}`;
  }

  private initializeSmartFilters(): void {
    // Value-based filters
    this.addSmartFilter({
      id: 'large_positions',
      name: 'Large Positions',
      description: 'Filter for positions larger than $1,000',
      category: 'value',
      complexity: 'basic',
      examples: ['Show me all positions > $1,000'],
      filter: {
        operator: 'AND',
        conditions: [{
          field: 'size',
          operator: 'gt',
          value: 1000
        }]
      }
    });

    this.addSmartFilter({
      id: 'high_volume_transactions',
      name: 'High Volume Transactions',
      description: 'Filter for transactions over $10,000',
      category: 'value',
      complexity: 'basic',
      examples: ['Show transactions > $10,000'],
      filter: {
        operator: 'AND',
        conditions: [{
          field: 'amount',
          operator: 'gt',
          value: 10000
        }]
      }
    });

    // Time-based filters
    this.addSmartFilter({
      id: 'recent_activity',
      name: 'Recent Activity',
      description: 'Activity from the last 7 days',
      category: 'time',
      complexity: 'basic',
      examples: ['Show me activity from last week'],
      filter: {
        operator: 'AND',
        conditions: [{
          field: 'timestamp',
          operator: 'gte',
          value: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }]
      }
    });

    // Behavior-based filters
    this.addSmartFilter({
      id: 'profitable_trades',
      name: 'Profitable Trades',
      description: 'Filter for positions with positive P/L',
      category: 'behavior',
      complexity: 'basic',
      examples: ['Show me my winning positions'],
      filter: {
        operator: 'AND',
        conditions: [{
          field: 'pnl',
          operator: 'gt',
          value: 0
        }]
      }
    });

    // Risk-based filters
    this.addSmartFilter({
      id: 'high_risk_positions',
      name: 'High Risk Positions',
      description: 'Positions larger than $5,000 with P/L < -$500',
      category: 'risk',
      complexity: 'intermediate',
      examples: ['Show high-risk positions'],
      filter: {
        operator: 'AND',
        conditions: [
          { field: 'size', operator: 'gt', value: 5000 },
          { field: 'pnl', operator: 'lt', value: -500 }
        ]
      }
    });

    // Advanced filters
    this.addSmartFilter({
      id: 'active_traders',
      name: 'Active Traders',
      description: 'Wallets with >10 transactions in the last 30 days',
      category: 'frequency',
      complexity: 'advanced',
      examples: ['Find active trading wallets'],
      filter: {
        operator: 'AND',
        conditions: [{
          field: 'transactionCount',
          operator: 'gt',
          value: 10
        }],
        groups: [{
          operator: 'AND',
          conditions: [{
            field: 'lastActivity',
            operator: 'gte',
            value: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }]
        }]
      }
    });
  }

  private addSmartFilter(filter: SmartFilterRule): void {
    this.smartFilters.set(filter.id, filter);
  }

  // Database operations (would integrate with existing database service)
  private async saveFilterPreset(preset: FilterPreset): Promise<void> {
    // Implementation would save to database
  }

  private async getUserFilterPresets(userId: number): Promise<FilterPreset[]> {
    // Implementation would retrieve user's filter presets
    return [];
  }

  private async getPublicFilterPresets(type?: FilterPreset['type']): Promise<FilterPreset[]> {
    // Implementation would retrieve public filter presets
    return [];
  }

  private async getFilterPreset(filterId: string): Promise<FilterPreset | null> {
    // Implementation would retrieve specific filter preset
    return null;
  }

  private async removeFilterPreset(filterId: string): Promise<void> {
    // Implementation would remove from database
  }

  private async incrementSmartFilterUsage(ruleId: string): Promise<void> {
    // Implementation would increment usage counter
  }

  // Utility methods
  createFilterFromQuery(query: string, type: FilterPreset['type']): FilterGroup {
    // Parse natural language query into filter structure
    // This would be a more sophisticated implementation
    const conditions: FilterCondition[] = [];

    if (query.includes('>') || query.includes('gt')) {
      const match = query.match(/(\w+)\s*[>]\s*(\d+)/);
      if (match) {
        conditions.push({
          field: match[1],
          operator: 'gt',
          value: parseFloat(match[2])
        });
      }
    }

    if (query.includes('<') || query.includes('lt')) {
      const match = query.match(/(\w+)\s*[<]\s*(\d+)/);
      if (match) {
        conditions.push({
          field: match[1],
          operator: 'lt',
          value: parseFloat(match[2])
        });
      }
    }

    if (query.includes('contains') || query.includes('includes')) {
      const match = query.match(/(\w+)\s*(?:contains|includes)\s*["']([^"']+)["']/);
      if (match) {
        conditions.push({
          field: match[1],
          operator: 'contains',
          value: match[2]
        });
      }
    }

    return {
      operator: 'AND',
      conditions
    };
  }

  generateFilterSummary(filter: FilterGroup): string {
    const conditionTexts = filter.conditions.map(condition => {
      const operatorSymbol = {
        'eq': '=',
        'ne': '!=',
        'gt': '>',
        'gte': '>=',
        'lt': '<',
        'lte': '<=',
        'contains': 'contains',
        'in': 'in',
        'not_in': 'not in'
      }[condition.operator];

      return `${condition.field} ${operatorSymbol} ${condition.value}`;
    });

    if (filter.groups && filter.groups.length > 0) {
      const groupTexts = filter.groups.map(group => `(${this.generateFilterSummary(group)})`);
      return `${conditionTexts.join(' ' + filter.operator + ' ')} ${filter.operator} ${groupTexts.join(' ' + filter.operator + ' ')}`;
    }

    return conditionTexts.join(' ' + filter.operator + ' ');
  }

  async getFilterUsageAnalytics(userId: number): Promise<{
    totalFilters: number;
    activeFilters: number;
    mostUsedFilter?: FilterPreset;
    filterUsageByType: Record<FilterPreset['type'], number>;
  }> {
    const presets = await this.getUserFilterPresets(userId);
    const activeFilters = presets.filter(preset => preset.isActive);
    const mostUsedFilter = presets.length > 0
      ? presets.reduce((most, current) => current.usageCount > most.usageCount ? current : most)
      : undefined;

    const filterUsageByType = presets.reduce((acc, preset) => {
      acc[preset.type] = (acc[preset.type] || 0) + preset.usageCount;
      return acc;
    }, {} as Record<FilterPreset['type'], number>);

    return {
      totalFilters: presets.length,
      activeFilters: activeFilters.length,
      mostUsedFilter,
      filterUsageByType
    };
  }
}