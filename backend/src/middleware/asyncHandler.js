// Wrap an async route handler so any rejected promise is forwarded to Express's
// error handler instead of crashing / hanging the request.

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
