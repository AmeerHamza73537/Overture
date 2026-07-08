// Central error handler. Turns thrown HttpErrors (and any unexpected error)
// into a consistent JSON envelope: { error: { code, message, details? } }.

import { HttpError } from '../utils/httpError.js';

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature.
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  // Unknown error: log server-side, return a generic 500 to the client.
  console.error('[unhandled]', err);
  return res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong.' },
  });
}

/** 404 fallback for unknown routes. */
export function notFound(req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
  });
}
