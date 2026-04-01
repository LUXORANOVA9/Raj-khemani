import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as tablesService from './tables.service';
import { authenticate, requireTier } from '../../middleware/auth.middleware';
import { getAvailableVariants } from '../game/variants';

const router = Router();

router.use(authenticate);

// List available game variants
router.get('/variants', (_req: Request, res: Response) => {
  res.json({ success: true, data: getAvailableVariants() });
});

// List tables
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const variant = req.query.variant as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const result = await tablesService.listTables({ status, variant, limit, offset });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// Get single table
router.get('/:tableId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const table = await tablesService.getTable(req.params.tableId);
    res.json({ success: true, data: table });
  } catch (error) {
    next(error);
  }
});

// Create table (tier 2+ = SubAdmin and above can create tables)
const createTableSchema = z.object({
  name: z.string().min(1).max(100),
  variant: z.string().default('classic'),
  minBuyIn: z.number().positive(),
  maxBuyIn: z.number().positive(),
  minBet: z.number().positive(),
  maxBet: z.number().positive().optional(),
  maxPlayers: z.number().int().min(2).max(9).optional(),
  isPrivate: z.boolean().optional(),
  commissionRate: z.number().min(0).max(0.5).optional(),
});

router.post('/', requireTier(2), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createTableSchema.parse(req.body);
    const table = await tablesService.createTable({
      ...data,
      createdBy: req.userId!,
    });
    res.status(201).json({ success: true, data: table });
  } catch (error) {
    next(error);
  }
});

// Close table
router.post('/:tableId/close', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await tablesService.closeTable(req.params.tableId, req.userId!);
    res.json({ success: true, message: 'Table closed' });
  } catch (error) {
    next(error);
  }
});

// Get game state for a table (player view)
router.get('/:tableId/game', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const view = tablesService.getPlayerGameView(req.params.tableId, req.userId!);
    if (!view) {
      res.json({ success: true, data: null, message: 'No active game' });
      return;
    }
    res.json({ success: true, data: view });
  } catch (error) {
    next(error);
  }
});

export default router;
