// POST /api/parse-query
// Body: { query: string }
// Returns: { filters: LeadFilters, needs_clarification, assumptions, cached }
//
// Caching: identical (normalised) queries return the cached parse result so we
// don't re-hit Groq unnecessarily.

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { cacheKey } from '../utils/hash.js';
import { cache } from '../lib/cache.js';
import { parseQuery } from '../services/groq.js';

export const parseQueryRouter = Router();

parseQueryRouter.post(
  '/parse-query',
  asyncHandler(async (req, res) => {
    const { query } = req.body ?? {};

    // --- Validate input ---
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new HttpError(400, 'invalid_query', 'Body must include a non-empty "query" string.');
    }
    if (query.length > 500) {
      throw new HttpError(400, 'query_too_long', 'Query must be 500 characters or fewer.');
    }

    const key = cacheKey('parse', query);

    // --- Cache hit? ---
    const cached = await cache.get(key);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    // --- Parse with Groq ---
    const filters = await parseQuery(query.trim());

    const result = {
      filters,
      needs_clarification: filters.needs_clarification,
      assumptions: filters.assumptions,
    };

    await cache.set(key, result);

    res.json({ ...result, cached: false });
  }),
);
