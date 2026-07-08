// fetch wrapper that enforces a timeout via AbortController and surfaces a
// consistent error. Node 18+ provides a global `fetch`, so no extra dependency.

import { env } from '../config/env.js';
import { HttpError } from './httpError.js';

/**
 * Perform a fetch with a hard timeout.
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number, label?: string }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = env.requestTimeoutMs, label = 'upstream', ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // AbortError => we timed out. Anything else is a network-level failure.
    if (err.name === 'AbortError') {
      throw new HttpError(504, `${label}_timeout`, `${label} request timed out after ${timeoutMs}ms`);
    }
    throw new HttpError(502, `${label}_unreachable`, `Could not reach ${label}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a Response body as JSON, tolerating empty/non-JSON bodies.
 * @param {Response} res
 */
export async function safeJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}
