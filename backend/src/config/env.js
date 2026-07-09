// Centralised, validated access to environment variables.
// Import `env` anywhere instead of reading process.env directly, so we have a
// single place that documents and normalises configuration.

import dotenv from 'dotenv';

dotenv.config();

/**
 * Read a variable, falling back to a default. Throws if required and missing.
 * @param {string} name
 * @param {{ required?: boolean, fallback?: string }} [opts]
 */
function read(name, { required = false, fallback = undefined } = {}) {
  const value = process.env[name] ?? fallback;
  if (required && (value === undefined || value === '')) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const port = toInt(read('PORT', { fallback: '3000' }), 3000);

export const env = {
  port,
  corsOrigin: read('CORS_ORIGIN', { fallback: '*' }),

  groq: {
    apiKey: read('GROQ_API_KEY', { required: true }),
    model: read('GROQ_MODEL', { fallback: 'llama-3.3-70b-versatile' }),
    baseUrl: 'https://api.groq.com/openai/v1',
  },

  hunter: {
    // HUNTER_API_KEY is the canonical name; APOLLO_API_KEY is accepted as a
    // legacy fallback so older deployments don't crash before being updated.
    apiKey: read('HUNTER_API_KEY', {
      required: true,
      fallback: process.env.APOLLO_API_KEY,
    }),
    baseUrl: 'https://api.hunter.io/v2',
    // People searches fan out: 1 Discover call + N Domain Search calls per
    // page. These knobs bound N and the contacts pulled per company so a
    // single request can't burn through the Hunter quota.
    companiesPerPage: toInt(read('HUNTER_COMPANIES_PER_PAGE', { fallback: '5' }), 5),
    emailsPerCompany: toInt(read('HUNTER_EMAILS_PER_COMPANY', { fallback: '10' }), 10),
  },

  google: {
    // OAuth client for the Gmail connection. Created in Google Cloud Console —
    // see backend/README.md ("Gmail setup"). Empty until the user fills them in;
    // the Gmail routes return a clear "not configured" error in that state.
    clientId: read('GOOGLE_CLIENT_ID', { fallback: '' }),
    clientSecret: read('GOOGLE_CLIENT_SECRET', { fallback: '' }),
    // Where Google redirects the browser after consent. Must EXACTLY match an
    // "Authorized redirect URI" on the OAuth client. localhost works for dev;
    // change to your deployed https URL in production.
    redirectUri: read('GOOGLE_REDIRECT_URI', {
      fallback: `http://localhost:${port}/api/gmail/callback`,
    }),
    get configured() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  // 64 hex chars (32 bytes) used to AES-256-GCM encrypt the Gmail refresh
  // token at rest. Generate with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  tokenEncryptionKey: read('TOKEN_ENCRYPTION_KEY', { fallback: '' }),

  outreach: {
    // Pause between individual Gmail sends (± jitter) so a batch doesn't look
    // like spam or trip Gmail's rate limits.
    sendDelayMs: toInt(read('SEND_DELAY_MS', { fallback: '7000' }), 7000),
    // Hard cap on emails per /send request; keeps one request from running for
    // many minutes and bounds the blast radius of a mistake.
    maxBatchSize: toInt(read('SEND_MAX_BATCH', { fallback: '20' }), 20),
  },

  supabase: {
    url: read('SUPABASE_URL', { fallback: '' }),
    // Supabase renamed "service role" keys to "secret" keys; accept both.
    secretKey: read('SUPABASE_SECRET_KEY', {
      fallback: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    }),
    // Convenience flag: is Supabase configured at all?
    get enabled() {
      return Boolean(this.url && this.secretKey);
    },
  },

  cacheTtlSeconds: toInt(read('CACHE_TTL_SECONDS', { fallback: '86400' }), 86400),
  rateLimit: {
    windowMs: toInt(read('RATE_LIMIT_WINDOW_MS', { fallback: '60000' }), 60000),
    max: toInt(read('RATE_LIMIT_MAX', { fallback: '30' }), 30),
  },
  requestTimeoutMs: toInt(read('REQUEST_TIMEOUT_MS', { fallback: '20000' }), 20000),
};
