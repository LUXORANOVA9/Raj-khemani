import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from './auth.service';
import { UserTier } from '../../utils/permissions';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(3).max(100),
  password: z.string().min(6),
});

const registerSchema = z.object({
  username: z.string().min(3).max(100),
  password: z.string().min(6).max(100),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  displayName: z.string().max(100).optional(),
  parentId: z.string().uuid().optional(),
  tier: z.nativeEnum(UserTier).default(UserTier.PLAYER),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const tokens = await authService.login(username, password);
    res.json({ success: true, data: tokens });
  } catch (error) {
    next(error);
  }
});

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = registerSchema.parse(req.body);
    const result = await authService.register(data);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const tokens = await authService.refreshAccessToken(refreshToken);
    res.json({ success: true, data: tokens });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as Request & { userId?: string }).userId;
    if (userId) {
      await authService.logout(userId);
    }
    res.json({ success: true, message: 'Logged out' });
  } catch (error) {
    next(error);
  }
});

export default router;
