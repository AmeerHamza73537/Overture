// Standalone smoke test: verifies your real Groq + Hunter keys work end-to-end,
// independently of the HTTP server. Reuses the same service functions the API
// uses, so a pass here means the endpoints will work too.
//
// NOTE: this spends real Hunter credits (1 Discover call + up to
// HUNTER_COMPANIES_PER_PAGE Domain Searches for a people query). For a free,
// offline verification of the whole codebase, run `npm run check` instead.
//
// Usage (from backend/):
//   node scripts/smoke.js
//   node scripts/smoke.js "marketing agency owners in Canada with 10-50 employees"
//
// Requires a populated .env (GROQ_API_KEY, HUNTER_API_KEY).

import { parseQuery } from '../src/services/groq.js';
import { searchLeads } from '../src/services/hunter.js';
import { env } from '../src/config/env.js';

// Simple ANSI helpers (no dependency).
const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const query =
  process.argv.slice(2).join(' ').trim() ||
  'marketing leaders at fintech companies in the United States';

function heading(title) {
  console.log(`\n${c.bold(title)}`);
}

/** Print a friendly hint based on the error code from our services. */
function explain(err) {
  const code = err.code ?? 'unknown';
  const hints = {
    groq_auth_failed: 'Check GROQ_API_KEY in .env (https://console.groq.com/keys).',
    groq_rate_limited: 'Groq is rate limiting — wait a moment and retry.',
    groq_timeout: 'Groq timed out — check your network or raise REQUEST_TIMEOUT_MS.',
    hunter_auth_failed:
      'Hunter rejected the key OR your plan lacks access to this endpoint (Discover\n' +
      '   needs a plan that includes it). Verify at https://hunter.io/api-keys.',
    hunter_rate_limited: 'Hunter rate limit or credit cap reached — retry later.',
    hunter_invalid_filters: 'Hunter rejected the search parameters — see details above.',
    hunter_timeout: 'Hunter timed out — check network or raise REQUEST_TIMEOUT_MS.',
  };
  return hints[code] ?? 'Unexpected error — see message above.';
}

async function main() {
  console.log(c.dim(`Groq model: ${env.groq.model}`));
  console.log(c.dim(`Query:      "${query}"`));

  // --- Step 1: Groq parse ---
  heading('1. Groq — parse query → filters');
  let filters;
  try {
    filters = await parseQuery(query);
    console.log(c.green('   OK'));
    console.log(JSON.stringify(filters, null, 2).replace(/^/gm, '   '));
    if (filters.needs_clarification) {
      console.log(c.yellow('   Note: Groq flagged this query as needing clarification.'));
    }
  } catch (err) {
    console.log(c.red(`   FAILED [${err.code ?? 'error'}]: ${err.message}`));
    console.log(c.yellow(`   → ${explain(err)}`));
    process.exitCode = 1;
    return;
  }

  // --- Step 2: Hunter search ---
  heading('2. Hunter — search leads');
  try {
    const { leads, pagination } = await searchLeads(filters, { page: 1, perPage: 5 });
    console.log(c.green('   OK'));
    console.log(
      `   ${leads.length} leads on this page; ${pagination.total_entries} matching ` +
        `${filters.search_type === 'people' ? 'companies' : 'organizations'} ` +
        `(${pagination.total_pages} pages).`,
    );

    if (leads.length > 0) {
      console.log(c.dim('   First result:'));
      console.log(JSON.stringify(leads[0], null, 2).replace(/^/gm, '   '));
    } else {
      console.log(c.yellow('   No leads returned — try a broader query to confirm search works.'));
    }
  } catch (err) {
    console.log(c.red(`   FAILED [${err.code ?? 'error'}]: ${err.message}`));
    if (err.details) console.log(c.dim(`   details: ${JSON.stringify(err.details)}`));
    console.log(c.yellow(`   → ${explain(err)}`));
    process.exitCode = 1;
    return;
  }

  heading(c.green('All checks passed ✔  Your keys work — ready to build the app screens.'));
}

main().catch((err) => {
  console.error(c.red(`\nUnexpected failure: ${err.stack ?? err.message}`));
  process.exitCode = 1;
});
