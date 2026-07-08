// A small typed error we throw from services so the central error handler can
// translate it into a clean HTTP response (status + machine-readable code).

export class HttpError extends Error {
  /**
   * @param {number} status  HTTP status code to send to the client.
   * @param {string} code    Short machine-readable code, e.g. 'hunter_rate_limited'.
   * @param {string} message Human-readable message.
   * @param {object} [details] Optional extra context (safe to expose).
   */
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
