// Express app assembly: middleware, routes, error handling.
// Kept separate from server.js so it can be imported in tests without binding a port.

import express from 'express';
import cors from 'cors';

import { env } from './config/env.js';
import { cache } from './lib/cache.js';
import { apiRateLimiter, authRateLimiter } from './middleware/rateLimiter.js';
import { requireAuth } from './middleware/requireAuth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { parseQueryRouter } from './routes/parseQuery.js';
import { searchLeadsRouter } from './routes/searchLeads.js';
import { historyRouter } from './routes/history.js';
import { gmailRouter, gmailCallbackRouter } from './routes/gmail.js';
import { outreachRouter } from './routes/outreach.js';
import { chatsRouter } from './routes/chats.js';

export function createApp() {
  const app = express();

  // CORS: allow the configured origin(s). '*' is fine for local dev only.
  const origins = env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',').map((o) => o.trim());
  app.use(cors({ origin: origins }));

  // Parse JSON bodies. 1mb because a saved chat carries its full message
  // list (lead results included); still small enough to cap abuse.
  app.use(express.json({ limit: '1mb' }));

  // Health check — handy for Railway/Render probes.
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      lead_provider: 'hunter',
      cache_backend: cache.backend,
      supabase_enabled: env.supabase.enabled,
      auth_enabled: env.supabase.enabled,
    });
  });

  // Rate limiter FIRST and exactly once. Attaching it per-router would make
  // one request increment the counter at every mount it passes through on the
  // way to its route (6 mounts = 6 counts per request).
  app.use('/api', apiRateLimiter);

  // Auth endpoints: public by nature (they're how you GET a token) but behind
  // a much stricter limiter since they accept credentials.
  app.use('/api/auth', authRateLimiter, authRouter);

  // Google's OAuth callback is opened by the BROWSER mid-consent — it cannot
  // carry our Authorization header. Identity travels in the signed-out `state`
  // value instead (bound to the user when the flow started), so mounting it
  // before requireAuth is safe.
  app.use('/api', gmailCallbackRouter);

  // Everything below requires a signed-in user (req.user is set here).
  app.use('/api', requireAuth);
  app.use('/api', parseQueryRouter);
  app.use('/api', searchLeadsRouter);
  app.use('/api', historyRouter);
  app.use('/api', gmailRouter);
  app.use('/api', outreachRouter);
  app.use('/api', chatsRouter);

  // 404 + error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
