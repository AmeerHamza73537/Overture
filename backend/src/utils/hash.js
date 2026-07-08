// Deterministic cache keys. We stable-stringify objects (sorted keys) so that
// two logically-identical filter objects produce the same key regardless of
// property order, then hash to keep keys short.

import { createHash } from 'node:crypto';

/** Recursively sort object keys so JSON.stringify is order-independent. */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

/** Stable JSON string for any serialisable value. */
export function stableStringify(value) {
  return JSON.stringify(sortDeep(value));
}

/**
 * Build a namespaced cache key from any input.
 * @param {string} namespace e.g. 'parse' or 'search'
 * @param {unknown} input
 */
export function cacheKey(namespace, input) {
  const basis = typeof input === 'string' ? input.trim().toLowerCase() : stableStringify(input);
  const digest = createHash('sha256').update(basis).digest('hex').slice(0, 32);
  return `${namespace}:${digest}`;
}
