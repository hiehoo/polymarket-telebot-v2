import { Context, MiddlewareFn } from 'telegraf';
import { getUserSession } from '../handlers/session-handler';
import { logger } from '../../utils/logger';

export interface AuthContext extends Context {
  user?: {
    id: number;
    username?: string;
    firstName: string;
    isPremium?: boolean;
  };
  session?: any;
}

export const authMiddleware = (): MiddlewareFn<AuthContext> => {
  return async (ctx: AuthContext, next: () => Promise<void>) => {
    try {
      if (!ctx.from) {
        logger.warn('No user information found in context');
        return;
      }

      const user = {
        id: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        isPremium: ctx.from.is_premium
      };

      ctx.user = user;
      ctx.session = await getUserSession(user.id);

      await next();
    } catch (error) {
      logger.error('Authentication middleware error:', error);
      await ctx.reply('❌ Authentication error. Please try again.');
    }
  };
};