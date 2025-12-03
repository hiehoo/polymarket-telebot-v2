import { Context } from 'telegraf';
import { logger } from '../../utils/logger';

export class CommandSanitizer {
  private static readonly XSS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /onload=/gi,
    /onerror=/gi,
    /onclick=/gi,
    /onmouseover=/gi
  ];

  private static readonly MALICIOUS_PATTERNS = [
    /\$[a-zA-Z_]/g, // Shell variables
    /`[^`]*`/g, // Backticks
    /\|\s*[a-zA-Z]+/g, // Command pipes
    /[;&|]\s*[a-zA-Z]+/g, // Command separators
  ];

  static sanitizeCommandText(text?: string): string {
    if (!text) return '';

    let sanitized = text.trim();

    // Remove XSS patterns
    for (const pattern of this.XSS_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Remove malicious command patterns
    for (const pattern of this.MALICIOUS_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Remove excessive whitespace
    sanitized = sanitized.replace(/\s+/g, ' ');

    // Limit length
    sanitized = sanitized.slice(0, 4000);

    return sanitized;
  }

  static sanitizeCallbackData(data?: string): string {
    if (!data) return '';

    let sanitized = data.trim();

    // Only allow alphanumeric, underscore, hyphen, and colon
    sanitized = sanitized.replace(/[^a-zA-Z0-9_\-:]/g, '');

    // Limit length
    sanitized = sanitized.slice(0, 64);

    return sanitized;
  }

  static sanitizeUserInput(input: string, maxLength: number = 500): string {
    let sanitized = input.trim();

    // Remove potential script injections
    for (const pattern of this.XSS_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Remove control characters except newlines and tabs
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Limit length
    sanitized = sanitized.slice(0, maxLength);

    return sanitized;
  }

  static sanitizeWalletAddress(address: string): string {
    const sanitized = address.trim().toLowerCase();

    // Remove any whitespace
    const noSpaces = sanitized.replace(/\s+/g, '');

    // Basic validation for common address patterns
    const ethPattern = /^0x[a-f0-9]{40}$/;
    const solPattern = /^[1-9a-hj-np-z]{32,44}$/;

    if (ethPattern.test(noSpaces)) {
      return noSpaces.toLowerCase();
    }

    if (solPattern.test(noSpaces)) {
      return noSpaces;
    }

    return noSpaces;
  }

  static sanitizeAmount(amount: string): string {
    const sanitized = amount.trim();

    // Remove non-numeric characters except decimal point and comma
    const numeric = sanitized.replace(/[^0-9.,]/g, '');

    // Handle comma as decimal separator
    const normalized = numeric.replace(/,/g, '.');

    // Ensure only one decimal point
    const decimal = normalized.replace(/\.(?=.*\.)/g, '');

    return decimal;
  }

  static sanitizeAlias(alias: string): string {
    let sanitized = alias.trim();

    // Remove HTML tags
    sanitized = sanitized.replace(/<[^>]*>/g, '');

    // Allow only alphanumeric, spaces, hyphens, and underscores
    sanitized = sanitized.replace(/[^a-zA-Z0-9\s\-_]/g, '');

    // Remove excessive whitespace
    sanitized = sanitized.replace(/\s+/g, ' ');

    // Limit length
    sanitized = sanitized.slice(0, 50);

    return sanitized;
  }

  static extractCommandArguments(text: string): string[] {
    const sanitized = this.sanitizeCommandText(text);
    const parts = sanitized.split(/\s+/);

    // Remove the command part (first element)
    return parts.slice(1);
  }

  static validateAndSanitizeMarkdown(text: string): { isValid: boolean; sanitized: string; error?: string } {
    let sanitized = text.trim();

    // Remove dangerous markdown patterns
    const dangerousPatterns = [
      /\[.*\]\(javascript:.*\)/gi,
      /\[.*\]\(data:.*\)/gi,
      /\[.*\]\(vbscript:.*\)/gi,
      /```[\s\S]*?```/g, // Remove code blocks (could contain malicious code)
      /`[^`]*`/g // Remove inline code
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, '');
      }
    }

    // Limit markdown length
    if (sanitized.length > 4000) {
      return {
        isValid: false,
        sanitized: sanitized.slice(0, 4000),
        error: 'Message too long'
      };
    }

    // Check for balanced markdown formatting
    const openBold = (sanitized.match(/\*/g) || []).length;
    const openItalic = (sanitized.match(/_/g) || []).length;
    const openCode = (sanitized.match(/`/g) || []).length;
    const openStrike = (sanitized.match(/~/g) || []).length;

    if (openBold % 2 !== 0 || openItalic % 2 !== 0 ||
        openCode % 2 !== 0 || openStrike % 2 !== 0) {
      return {
        isValid: false,
        sanitized,
        error: 'Unbalanced markdown formatting'
      };
    }

    return {
      isValid: true,
      sanitized
    };
  }

  static sanitizeErrorMessage(error: string): string {
    let sanitized = error.trim();

    // Remove potential sensitive information
    sanitized = sanitized.replace(/password[=:][^\s]*/gi, 'password=***');
    sanitized = sanitized.replace(/token[=:][^\s]*/gi, 'token=***');
    sanitized = sanitized.replace(/key[=:][^\s]*/gi, 'key=***');
    sanitized = sanitized.replace(/secret[=:][^\s]*/gi, 'secret=***');

    // Remove file paths
    sanitized = sanitized.replace(/\/[a-zA-Z0-9_\-\/\.]+/g, '[path]');

    // Limit error message length
    sanitized = sanitized.slice(0, 500);

    return sanitized;
  }

  static createSafeReplyMessage(originalMessage: string): string {
    const sanitized = this.sanitizeUserInput(originalMessage, 1000);

    // Add safety footer if message contains user input
    const hasUserInput = /[<>`]/.test(sanitized);
    if (hasUserInput) {
      return `${sanitized}\n\n*📝 Note: Some content was filtered for security*`;
    }

    return sanitized;
  }

  static checkRateLimitUser(userId: number, windowMs: number = 60000, maxRequests: number = 30): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
  } {
    // This would integrate with Redis in a real implementation
    // For now, return a mock response
    return {
      allowed: true,
      remaining: 25,
      resetTime: Date.now() + windowMs
    };
  }
}