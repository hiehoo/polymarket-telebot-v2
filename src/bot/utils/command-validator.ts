import { Context } from 'telegraf';
import { logger } from '../../utils/logger';

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedData?: any;
}

export interface ValidationRule {
  field: string;
  required?: boolean;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'address';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  sanitize?: boolean;
}

export class CommandValidator {
  private static readonly ADDRESS_PATTERNS = {
    ethereum: /^0x[a-fA-F0-9]{40}$/,
    solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    polygon: /^0x[a-fA-F0-9]{40}$/,
    bsc: /^0x[a-fA-F0-9]{40}$/
  };

  public static validateWalletAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }

    const cleanAddress = address.trim().toLowerCase();

    return Object.values(this.ADDRESS_PATTERNS).some(pattern =>
      pattern.test(cleanAddress)
    );
  }

  public static sanitizeInput(input: string): string {
    if (!input || typeof input !== 'string') {
      return '';
    }

    return input
      .trim()
      .replace(/[<>]/g, '') // Remove HTML tags
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .slice(0, 1000); // Limit length
  }

  static validateCommand(ctx: Context, rules: ValidationRule[]): ValidationResult {
    const text = ctx.message?.text;
    if (!text) {
      return {
        isValid: false,
        error: '❌ No command text found'
      };
    }

    const parts = text.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase().replace('/', '');
    const args = parts.slice(1);

    const data: Record<string, any> = {
      command,
      args,
      argsCount: args.length
    };

    for (const rule of rules) {
      const result = this.validateField(rule, data);
      if (!result.isValid) {
        return result;
      }

      if (result.sanitizedData) {
        Object.assign(data, result.sanitizedData);
      }
    }

    return {
      isValid: true,
      sanitizedData: data
    };
  }

  static validateField(rule: ValidationRule, data: Record<string, any>): ValidationResult {
    const value = data[rule.field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      return {
        isValid: false,
        error: `❌ ${rule.field} is required`
      };
    }

    if (value === undefined || value === null || value === '') {
      return { isValid: true };
    }

    switch (rule.type) {
      case 'string':
        return this.validateString(rule, value as string);
      case 'number':
        return this.validateNumber(rule, value);
      case 'boolean':
        return this.validateBoolean(rule, value);
      case 'array':
        return this.validateArray(rule, value);
      case 'address':
        return this.validateAddress(rule, value as string);
      case 'object':
        return this.validateObject(rule, value);
      default:
        return {
          isValid: false,
          error: `❌ Unknown validation type: ${rule.type}`
        };
    }
  }

  private static validateString(rule: ValidationRule, value: string): ValidationResult {
    if (typeof value !== 'string') {
      return {
        isValid: false,
        error: `❌ ${rule.field} must be a string`
      };
    }

    const trimmedValue = rule.sanitize ? value.trim() : value;

    if (rule.minLength && trimmedValue.length < rule.minLength) {
      return {
        isValid: false,
        error: `❌ ${rule.field} must be at least ${rule.minLength} characters long`
      };
    }

    if (rule.maxLength && trimmedValue.length > rule.maxLength) {
      return {
        isValid: false,
        error: `❌ ${rule.field} must be no more than ${rule.maxLength} characters long`
      };
    }

    if (rule.pattern && !rule.pattern.test(trimmedValue)) {
      return {
        isValid: false,
        error: `❌ ${rule.field} has invalid format`
      };
    }

    return {
      isValid: true,
      sanitizedData: { [rule.field]: trimmedValue }
    };
  }

  private static validateNumber(rule: ValidationRule, value: any): ValidationResult {
    const numValue = Number(value);

    if (isNaN(numValue)) {
      return {
        isValid: false,
        error: `❌ ${rule.field} must be a valid number`
      };
    }

    if (rule.min !== undefined && numValue < rule.min) {
      return {
        isValid: false,
        error: `❌ ${rule.field} must be at least ${rule.min}`
      };
    }

    if (rule.max !== undefined && numValue > rule.max) {
      return {
        isValid: false,
        error: `❌ ${rule.field} must be no more than ${rule.max}`
      };
    }

    return {
      isValid: true,
      sanitizedData: { [rule.field]: numValue }
    };
  }

  private static validateBoolean(rule: ValidationRule, value: any): ValidationResult {
    let boolValue: boolean;

    if (typeof value === 'boolean') {
      boolValue = value;
    } else if (typeof value === 'string') {
      const lower = value.toLowerCase();
      boolValue = lower === 'true' || lower === 'yes' || lower === '1' || lower === 'on';
    } else {
      return {
        isValid: false,
        error: `❌ ${rule.field} must be true or false`
      };
    }

    return {
      isValid: true,
      sanitizedData: { [rule.field]: boolValue }
    };
  }

  private static validateArray(rule: ValidationRule, value: any): ValidationResult {
    if (!Array.isArray(value)) {
      return {
        isValid: false,
        error: `❌ ${rule.field} must be an array`
      };
    }

    if (rule.minLength && value.length < rule.minLength) {
      return {
        isValid: false,
        error: `❌ ${rule.field} must have at least ${rule.minLength} items`
      };
    }

    if (rule.maxLength && value.length > rule.maxLength) {
      return {
        isValid: false,
        error: `❌ ${rule.field} must have no more than ${rule.maxLength} items`
      };
    }

    return {
      isValid: true,
      sanitizedData: { [rule.field]: value }
    };
  }

  private static validateAddress(rule: ValidationRule, address: string): ValidationResult {
    if (!address || typeof address !== 'string') {
      return {
        isValid: false,
        error: `❌ ${rule.field} must be a valid wallet address`
      };
    }

    const cleanAddress = address.trim();

    const isValidNetwork = Object.values(this.ADDRESS_PATTERNS).some(pattern =>
      pattern.test(cleanAddress)
    );

    if (!isValidNetwork) {
      return {
        isValid: false,
        error: `❌ Invalid wallet address format. Supported: Ethereum, Solana, Polygon, BSC`
      };
    }

    const network = this.detectNetwork(cleanAddress);

    return {
      isValid: true,
      sanitizedData: {
        [rule.field]: cleanAddress,
        [`${rule.field}Network`]: network
      }
    };
  }

  private static validateObject(rule: ValidationRule, value: any): ValidationResult {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {
        isValid: false,
        error: `❌ ${rule.field} must be an object`
      };
    }

    return {
      isValid: true,
      sanitizedData: { [rule.field]: value }
    };
  }

  static detectNetwork(address: string): string {
    for (const [network, pattern] of Object.entries(this.ADDRESS_PATTERNS)) {
      if (pattern.test(address)) {
        return network;
      }
    }
    return 'unknown';
  }

  static sanitizeInput(input: string): string {
    return input
      .trim()
      .replace(/[<>]/g, '') // Remove HTML tags
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .slice(0, 1000); // Limit length
  }

  static validateWalletAlias(alias: string): ValidationResult {
    const rules: ValidationRule[] = [
      {
        field: 'alias',
        required: true,
        type: 'string',
        minLength: 1,
        maxLength: 50,
        pattern: /^[a-zA-Z0-9\s\-_]+$/,
        sanitize: true
      }
    ];

    const data = { alias };
    return this.validateField(rules[0], data);
  }

  static validateTransactionAmount(amount: string): ValidationResult {
    const rules: ValidationRule[] = [
      {
        field: 'amount',
        required: true,
        type: 'number',
        min: 0,
        max: Number.MAX_SAFE_INTEGER
      }
    ];

    const data = { amount };
    return this.validateField(rules[0], data);
  }

  static validatePaginationParams(page?: string, limit?: string): ValidationResult {
    const rules: ValidationRule[] = [
      {
        field: 'page',
        required: false,
        type: 'number',
        min: 1,
        max: 1000
      },
      {
        field: 'limit',
        required: false,
        type: 'number',
        min: 1,
        max: 100
      }
    ];

    let data: Record<string, any> = {};

    if (page) data.page = page;
    if (limit) data.limit = limit;

    const result = { isValid: true, sanitizedData: {} as any };

    for (const rule of rules) {
      if (data[rule.field] !== undefined) {
        const fieldResult = this.validateField(rule, data);
        if (!fieldResult.isValid) {
          return fieldResult;
        }
        if (fieldResult.sanitizedData) {
          Object.assign(result.sanitizedData, fieldResult.sanitizedData);
        }
      }
    }

    return result;
  }
}