import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as usersService from './users.service';
import { authenticate, requireTier } from '../../middleware/auth.middleware';

const router = Router();

// All user routes require authentication
router.use(authenticate);

// Get own profile
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await usersService.getUserById(req.userId!);
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// Get hierarchy stats for current user
router.get('/me/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await usersService.getHierarchyStats(req.userId!);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

// Get direct children
router.get('/me/children', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const children = await usersService.getDirectChildren(req.userId!);
    res.json({ success: true, data: children });
  } catch (error) {
    next(error);
  }
});

// Get all descendants (with optional depth and tier filter)
router.get('/me/descendants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const depth = req.query.depth ? parseInt(req.query.depth as string, 10) : undefined;
    const tier = req.query.tier ? parseInt(req.query.tier as string, 10) : undefined;
    const descendants = await usersService.getDescendants(req.userId!, depth, tier);
    res.json({ success: true, data: descendants });
  } catch (error) {
    next(error);
  }
});

// Create child user (requires tier 4 or higher = broker+)
const createChildSchema = z.object({
  username: z.string().min(3).max(100),
  password: z.string().min(6).max(100),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  displayName: z.string().max(100).optional(),
  commissionRate: z.number().min(0).max(1).optional(),
});

router.post('/children', requireTier(4), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createChildSchema.parse(req.body);
    const child = await usersService.createChildUser(req.userId!, req.userTier!, data);
    res.status(201).json({ success: true, data: child });
  } catch (error) {
    next(error);
  }
});

// Get specific user by ID (must be descendant)
router.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetId = req.params.userId;
    // SuperAdmin can view anyone; others must be ancestors
    if (req.userTier !== 0) {
      const isAncestor = await usersService.isAncestorOf(req.userId!, targetId);
      if (!isAncestor && req.userId !== targetId) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot view this user' } });
        return;
      }
    }
    const user = await usersService.getUserById(targetId);
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// Update user
const updateUserSchema = z.object({
  displayName: z.string().max(100).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  avatarUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
  commissionRate: z.number().min(0).max(1).optional(),
});

router.patch('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetId = req.params.userId;
    // Can update self, or descendants if higher tier
    if (req.userId !== targetId && req.userTier !== 0) {
      const isAncestor = await usersService.isAncestorOf(req.userId!, targetId);
      if (!isAncestor) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot update this user' } });
        return;
      }
    }
    const data = updateUserSchema.parse(req.body);
    const updated = await usersService.updateUser(targetId, data);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
