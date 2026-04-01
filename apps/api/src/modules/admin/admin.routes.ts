import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireTier } from '../../middleware/auth.middleware';
import * as tablesService from '../tables/tables.service';
import * as chipsService from '../chips/chips.service';
import * as usersService from '../users/users.service';
import { UserTier } from '../../utils/permissions';

const router = Router();

router.use(authenticate);
router.use(requireTier(UserTier.ADMIN)); // Admin and SuperAdmin only

// Dashboard overview
router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await usersService.getHierarchyStats(req.userId!);
    const tables = await tablesService.listTables({ status: 'waiting', limit: 10 });
    const activeTables = tablesService.getActiveTableCount();

    res.json({
      success: true,
      data: {
        userStats: stats,
        activeTables,
        recentTables: tables.tables,
        totalTables: tables.total,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Reconciliation report (SuperAdmin only)
router.get('/reconciliation', requireTier(UserTier.SUPER_ADMIN), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await chipsService.runReconciliation();
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// List all users with hierarchy info (paginated)
router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const depth = req.query.depth ? parseInt(req.query.depth as string, 10) : undefined;
    const tier = req.query.tier ? parseInt(req.query.tier as string, 10) : undefined;
    const descendants = await usersService.getDescendants(req.userId!, depth, tier);
    res.json({ success: true, data: descendants });
  } catch (error) {
    next(error);
  }
});

// Get specific user details with wallet info
router.get('/users/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await usersService.getUserById(req.params.userId);
    const balance = await chipsService.getWalletBalance(req.params.userId);
    const history = await chipsService.getTransferHistory(req.params.userId, { limit: 20 });

    res.json({
      success: true,
      data: {
        user,
        walletBalance: balance,
        recentTransfers: history.transfers,
        totalTransfers: history.total,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Toggle user active status
router.post('/users/:userId/toggle-active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetUser = await usersService.getUserById(req.params.userId);
    const updated = await usersService.updateUser(req.params.userId, {
      isActive: !targetUser.is_active,
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
