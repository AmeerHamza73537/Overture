// Express app assembly: middleware, routes, error handling.
// Kept separate from server.js so it can be imported in tests without binding a port.

import express from 'express';
import cors from 'cors';

import { env } from './config/env.js';
import { cache } from './lib/cache.js';
import { apiRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { parseQueryRouter } from './routes/parseQuery.js';
import { searchLeadsRouter } from './routes/searchLeads.js';
import { historyRouter } from './routes/history.js';
import { gmailRouter } from './routes/gmail.js';
import { outreachRouter } from './routes/outreach.js';

export function createApp() {
  const app = express();

  // CORS: allow the configured origin(s). '*' is fine for local dev only.
  const origins = env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',').map((o) => o.trim());
  app.use(cors({ origin: origins }));

  // Parse JSON bodies (cap size to avoid abuse).
  app.use(express.json({ limit: '100kb' }));

  // Health check — handy for Railway/Render probes.
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      lead_provider: 'hunter',
      cache_backend: cache.backend,
      supabase_enabled: env.supabase.enabled,
    });
  });

  // API routes (rate-limited).
  app.use('/api', apiRateLimiter, parseQueryRouter);
  app.use('/api', apiRateLimiter, searchLeadsRouter);
  app.use('/api', apiRateLimiter, historyRouter);
  app.use('/api', apiRateLimiter, gmailRouter);
  app.use('/api', apiRateLimiter, outreachRouter);

  // 404 + error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
