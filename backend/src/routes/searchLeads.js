// POST /api/search-leads
// Body: { filters: LeadFilters, page?, per_page?, raw_query? }
// Returns: { provider, leads, pagination, cached }
//
// - Caches identical (filters + page) searches to protect Hunter credits.
// - Records the search to history (best-effort) when a raw_query is supplied.

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { cacheKey } from '../utils/hash.js';
import { cache } from '../lib/cache.js';
import { normaliseFilters } from '../utils/filterSchema.js';
import { searchLeads } from '../services/hunter.js';
import { recordSearch } from '../lib/history.js';

export const searchLeadsRouter = Router();

searchLeadsRouter.post(
  '/search-leads',
  asyncHandler(async (req, res) => {
    const { filters: rawFilters, page, per_page: perPage, raw_query: rawQuery } = req.body ?? {};

    if (!rawFilters || typeof rawFilters !== 'object') {
      throw new HttpError(400, 'invalid_filters', 'Body must include a "filters" object.');
    }

    // Re-normalise: the client may send the object we produced, but never trust it.
    const filters = normaliseFilters(rawFilters);

    // Clamp paging to sane bounds (Hunter Discover caps limit at 100).
    const paging = {
      page: clampInt(page, 1, 500, 1),
      perPage: clampInt(perPage, 1, 100, 25),
    };

    const key = cacheKey('search', { filters, ...paging });

    // --- Cache hit? ---
    const cached = await cache.get(key);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    // --- Query Hunter ---
    const result = await searchLeads(filters, paging);

    await cache.set(key, result);

    // --- Record history (best-effort, non-blocking on the response). ---
    if (typeof rawQuery === 'string' && rawQuery.trim()) {
      recordSearch({
        rawQuery: rawQuery.trim(),
        filters,
        resultCount: result.leads.length,
      });
    }

    res.json({ ...result, cached: false });
  }),
);

/** Parse to int and clamp to [min, max], falling back to `fallback`. */
function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
