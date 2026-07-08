// Per-IP rate limiter for the API routes. Uses express-rate-limit's default
// in-memory store (fine for a single instance). If you scale to multiple
// instances, back it with a shared store (e.g. Redis) later.

import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true, // return RateLimit-* headers
  legacyHeaders: false,
  // Consistent error shape with the rest of the API.
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'rate_limited',
        message: 'Too many requests. Please slow down and try again shortly.',
      },
    });
  },
});
