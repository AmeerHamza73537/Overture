// Per-IP rate limiter for the API routes. Uses express-rate-limit's default
// in-memory store (fine for a single instance). If you scale to multiple
// instances, back it with a shared store (e.g. Redis) later.

import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const rateLimitedHandler = (req, res) => {
  res.status(429).json({
    error: {
      code: 'rate_limited',
      message: 'Too many requests. Please slow down and try again shortly.',
    },
  });
};

export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true, // return RateLimit-* headers
  legacyHeaders: false,
  // Consistent error shape with the rest of the API.
  handler: rateLimitedHandler,
});

// Much stricter limiter for the auth endpoints: these accept credentials, so
// the budget is sized for a human retyping a password, not for a script
// guessing them. 20 attempts per 15 minutes per IP.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitedHandler,
});
