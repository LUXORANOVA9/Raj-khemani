import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../modules/auth/auth.service';
import { hasPermission } from '../utils/permissions';
import { AuthError, ForbiddenError } from '../utils/errors';

// Extend Express Request to include user context
declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    username?: string;
    userTier?: number;
    userPermissions?: bigint;
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthError('No token provided', 'NO_TOKEN');
    }

    const token = authHeader.split(' ')[1];
    const payload: JwtPayload = verifyAccessToken(token);

    req.userId = payload.userId;
    req.username = payload.username;
    req.userTier = payload.tier;
    req.userPermissions = BigInt(payload.permissions);

    next();
  } catch (error) {
    next(error);
  }
}

export function requirePermission(permission: bigint) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.userPermissions) {
      next(new AuthError('Not authenticated', 'NOT_AUTHENTICATED'));
      return;
    }

    if (!hasPermission(req.userPermissions, permission)) {
      next(new ForbiddenError());
      return;
    }

    next();
  };
}

export function requireTier(maxTier: number) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.userTier === undefined || req.userTier > maxTier) {
      next(new ForbiddenError(`Requires tier ${maxTier} or higher`));
      return;
    }

    next();
  };
}
