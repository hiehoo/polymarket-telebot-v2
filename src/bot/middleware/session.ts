import { Context, MiddlewareFn } from 'telegraf';
import { redisClient } from '../../services/redis/redis-client';
import { logger } from '../../utils/logger';

export interface BotSession {
  userId: number;
  state?: {
    command?: string;
    step?: number;
    data?: Record<string, any>;
    tempData?: Record<string, any>;
  };
  preferences?: {
    language?: string;
    timezone?: string;
    notifications?: boolean;
  };
  lastActivity?: number;
  createdAt?: number;
}

export interface SessionContext extends Context {
  session?: BotSession;
}

const SESSION_TTL = 24 * 60 * 60; // 24 hours

export const sessionMiddleware = (): MiddlewareFn<SessionContext> => {
  return async (ctx: SessionContext, next: () => Promise<void>) => {
    try {
      if (!ctx.from) {
        return next();
      }

      const sessionKey = `session:${ctx.from.id}`;
      const sessionData = await redisClient.get(sessionKey);

      let session: BotSession;

      if (sessionData) {
        session = JSON.parse(sessionData);
        session.lastActivity = Date.now();
      } else {
        session = {
          userId: ctx.from.id,
          lastActivity: Date.now(),
          createdAt: Date.now(),
          preferences: {
            language: ctx.from.language_code || 'en',
            timezone: 'UTC',
            notifications: true
          }
        };
      }

      ctx.session = session;

      await next();

      await redisClient.setex(
        sessionKey,
        SESSION_TTL,
        JSON.stringify(session)
      );
    } catch (error) {
      logger.error('Session middleware error:', error);
      await next();
    }
  };
};

export const sessionCleanupMiddleware = (): MiddlewareFn<SessionContext> => {
  return async (ctx: SessionContext, next: () => Promise<void>) => {
    try {
      await next();

      if (ctx.session?.state?.command && !ctx.session.state.step) {
        delete ctx.session.state.command;
        delete ctx.session.state.data;
        delete ctx.session.state.tempData;
      }
    } catch (error) {
      logger.error('Session cleanup middleware error:', error);
    }
  };
};