import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as chipsService from './chips.service';
import { authenticate, requireTier } from '../../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

// Get wallet balance
router.get('/balance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const balance = await chipsService.getWalletBalance(req.userId!);
    res.json({ success: true, data: { balance } });
  } catch (error) {
    next(error);
  }
});

// Get transfer history
router.get('/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const type = req.query.type as string | undefined;
    const result = await chipsService.getTransferHistory(req.userId!, { limit, offset, type });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// Get ledger entries
router.get('/ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const entries = await chipsService.getLedgerEntries(req.userId!, { limit, offset });
    res.json({ success: true, data: entries });
  } catch (error) {
    next(error);
  }
});

// Distribute chips to a downstream user (tier 4+ = broker and above)
const distributeSchema = z.object({
  toUserId: z.string().uuid(),
  amount: z.number().positive(),
});

router.post('/distribute', requireTier(4), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { toUserId, amount } = distributeSchema.parse(req.body);
    const transfer = await chipsService.distributeChips(req.userId!, toUserId, amount, req.userId!);
    res.status(201).json({ success: true, data: transfer });
  } catch (error) {
    next(error);
  }
});

// Collect chips from a downstream user
const collectSchema = z.object({
  fromUserId: z.string().uuid(),
  amount: z.number().positive(),
});

router.post('/collect', requireTier(4), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fromUserId, amount } = collectSchema.parse(req.body);
    const transfer = await chipsService.collectChips(fromUserId, req.userId!, amount, req.userId!);
    res.status(201).json({ success: true, data: transfer });
  } catch (error) {
    next(error);
  }
});

// Mint chips (SuperAdmin only, tier 0)
const mintSchema = z.object({
  amount: z.number().positive(),
});

router.post('/mint', requireTier(0), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount } = mintSchema.parse(req.body);
    const transfer = await chipsService.mintChips(req.userId!, amount);
    res.status(201).json({ success: true, data: transfer });
  } catch (error) {
    next(error);
  }
});

// Run reconciliation (SuperAdmin only)
router.get('/reconciliation', requireTier(0), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await chipsService.runReconciliation();
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
