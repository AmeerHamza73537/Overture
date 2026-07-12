// GET /api/searches?limit=50
// Returns recent saved searches. Empty array when Supabase isn't configured.
// The saved-searches screen will consume this in the app phase.

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { listSearches } from '../lib/history.js';

export const historyRouter = Router();

historyRouter.get(
  '/searches',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const searches = await listSearches({ userId: req.user.id, limit });
    res.json({ searches });
  }),
);
