// POST /api/parse-query
// Body: { query: string, context?: { filters: LeadFilters } }
// Returns: { intent, reply, filters, needs_clarification, assumptions, cached }
//
// `context` carries the previous search's filters so the parser can tell a
// new search from a refinement or a "show me more". Caching keys on the query
// AND the context, so "more" after search A can't return a cached result from
// after search B.

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { cacheKey } from '../utils/hash.js';
import { cache } from '../lib/cache.js';
import { parseQuery } from '../services/groq.js';
import { normaliseFilters } from '../utils/filterSchema.js';

export const parseQueryRouter = Router();

parseQueryRouter.post(
  '/parse-query',
  asyncHandler(async (req, res) => {
    const { query, context } = req.body ?? {};

    // --- Validate input ---
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new HttpError(400, 'invalid_query', 'Body must include a non-empty "query" string.');
    }
    if (query.length > 500) {
      throw new HttpError(400, 'query_too_long', 'Query must be 500 characters or fewer.');
    }

    // Normalise the context up front so both the cache key and the parser see
    // the exact same trusted filter shape (never the raw client blob).
    const contextFilters =
      context && typeof context === 'object' && context.filters
        ? normaliseFilters(context.filters)
        : null;

    const key = cacheKey('parse', {
      q: query.trim().toLowerCase(),
      ctx: contextFilters,
    });

    // --- Cache hit? ---
    const cached = await cache.get(key);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    // --- Parse with Groq (or fast-path) ---
    const parsed = await parseQuery(query.trim(), contextFilters ? { filters: contextFilters } : null);

    const result = {
      intent: parsed.intent,
      reply: parsed.reply,
      filters: parsed.filters,
      needs_clarification: parsed.needs_clarification,
      assumptions: parsed.assumptions,
    };

    await cache.set(key, result);

    res.json({ ...result, cached: false });
  }),
);
