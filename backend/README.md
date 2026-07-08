# Outreach Backend

AI-powered lead discovery & outreach API. It takes a natural-language request
("seed-stage fintech investors in the US"), parses it into structured filters
with **Groq (Llama 3.3)**, and searches leads via **Hunter.io**. Results are
cached and searches are logged in **Supabase (Postgres)**.

All third-party API keys live here on the server — never in the mobile app.

---

## Stack

| Concern        | Choice                                    |
| -------------- | ----------------------------------------- |
| Runtime        | Node.js 18+ (ESM), Express                |
| LLM            | Groq API (OpenAI-compatible, JSON mode)   |
| Lead data      | Hunter.io Discover + Domain Search        |
| Cache + history| Supabase (Postgres) — in-memory fallback  |
| Rate limiting  | express-rate-limit (per-IP)               |

---

## How the Hunter search works

Hunter is **domain-centric** — it doesn't have a direct "search people by job
title" endpoint the way Apollo did. So the provider layer
([`src/services/hunter.js`](src/services/hunter.js)) runs searches in stages:

```
organizations search:
  Discover (POST /v2/discover) ──▶ companies matching industry/location/headcount

people search:
  Discover ──▶ page of matching companies
     └─▶ Domain Search (GET /v2/domain-search) per company domain, in parallel,
         filtered by department + seniority
            └─▶ contacts flattened, ranked by job-title relevance, trimmed to per_page
```

Because Hunter filters contacts by **department** and **seniority** (fixed
enums) rather than free-text titles, the filter schema carries both:
`departments`/`seniorities` drive the API filter, and `job_titles` drive a
local relevance ranking over the returned contacts.

**Quota control:** every Discover page and Domain Search costs Hunter credits.
The fan-out is bounded by `HUNTER_COMPANIES_PER_PAGE` (default 5 Domain
Searches per people-search page) and `HUNTER_EMAILS_PER_COMPANY` (default 10
contacts per company), and identical searches are served from cache.

> **Hunter plan note:** emails come back directly from Domain Search along with
> a `confidence` score (0–100) and, when available, a `verification` status —
> there is no separate "unlock" step. The Discover endpoint requires a plan
> that includes it; if Hunter returns 401/403 you'll get a clean
> `hunter_auth_failed` error explaining that.

---

## Setup

### 1. Install

```bash
cd backend
npm install
```

Requires **Node 18.17+** (uses the built-in global `fetch`). Check with `node -v`.

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in:

- `GROQ_API_KEY` — from <https://console.groq.com/keys>
- `HUNTER_API_KEY` — from <https://hunter.io/api-keys>
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` — **optional**. Leave blank to
  run with an in-memory cache and no history persistence.

> Use the Supabase **secret** key (`sb_secret_...`, server-side only). The
> legacy `SUPABASE_SERVICE_ROLE_KEY` name is also accepted. Never put it in
> the app.

### 3. (Optional) Set up Supabase

In the Supabase dashboard → **SQL editor**, run the contents of
[`supabase/schema.sql`](supabase/schema.sql). This creates the `query_cache`
and `search_history` tables with RLS enabled.

### 4. Run

```bash
npm run dev     # auto-restart on file changes (node --watch)
# or
npm start
```

You should see:

```
Outreach backend listening on http://localhost:3000
  lead provider:      hunter
  cache backend:      supabase        (or "memory")
  supabase enabled:   true
```

Check health: `GET http://localhost:3000/health`

### 5. Verify

```bash
npm run check   # offline: boots the app, tests routes + helpers. Free.
npm run smoke   # live: real Groq parse + real Hunter search. Spends credits.
```

---

## API

### `POST /api/parse-query`

Convert a natural-language query into structured filters.

**Request**

```json
{ "query": "marketing leaders at fintech startups in the US" }
```

**Response**

```json
{
  "filters": {
    "search_type": "people",
    "job_titles": ["Marketing Director", "Head of Marketing", "CMO", "VP of Marketing"],
    "departments": ["marketing", "executive"],
    "seniorities": ["senior", "executive"],
    "person_locations": ["United States"],
    "organization_locations": [],
    "industries": ["fintech"],
    "employee_ranges": ["1-10", "11-50"],
    "keywords": "",
    "needs_clarification": false,
    "assumptions": ["Interpreted 'startups' as companies with up to 50 employees"]
  },
  "needs_clarification": false,
  "assumptions": ["Interpreted 'startups' as companies with up to 50 employees"],
  "cached": false
}
```

Filter enums (anything else is dropped during normalisation):

- `departments`: `executive`, `it`, `finance`, `management`, `sales`, `legal`,
  `support`, `hr`, `marketing`, `communication`, `education`, `design`,
  `health`, `operations`
- `seniorities`: `junior`, `senior`, `executive`
- `employee_ranges`: `1-10`, `11-50`, `51-200`, `201-500`, `501-1000`,
  `1001-5000`, `5001-10000`, `10001+`

### `POST /api/search-leads`

Search Hunter using filters (typically the object returned above).

**Request**

```json
{
  "filters": { "search_type": "people", "departments": ["marketing"], "industries": ["fintech"] },
  "page": 1,
  "per_page": 25,
  "raw_query": "marketing leaders at fintech companies"
}
```

`raw_query` is optional; when present the search is logged to history.

**Response**

```json
{
  "provider": "hunter",
  "leads": [
    {
      "id": "jane@acme.com",
      "type": "person",
      "name": "Jane Doe",
      "title": "Chief Marketing Officer",
      "department": "marketing",
      "seniority": "executive",
      "company": "Acme Inc",
      "company_website": "https://acme.com",
      "location": "Toronto, Ontario, Canada",
      "email": "jane@acme.com",
      "email_locked": false,
      "email_confidence": 97,
      "email_verification": "valid",
      "linkedin_url": "https://www.linkedin.com/in/janedoe"
    }
  ],
  "pagination": { "page": 1, "per_page": 25, "total_entries": 100, "total_pages": 20, "total_matches": 3753 },
  "cached": false
}
```

Pagination advances over matching *companies*: Hunter plans cap Discover at
the first page of results (typically 100 companies), which the service fetches
once and slices locally. `total_entries`/`total_pages` are computed from the
companies actually reachable on the current plan — the app can page through
all of them without hitting guaranteed-empty pages — while `total_matches`
carries Hunter's full match count for display. For **people** searches each
page mines `HUNTER_COMPANIES_PER_PAGE` companies for contacts; for
**organizations** searches each page returns `per_page` companies.

### `GET /api/searches?limit=50`

Recent saved searches (from Supabase). Returns `{ "searches": [] }` when
Supabase isn't configured. Used by the saved-searches screen later.

### `GET /health`

Liveness + configuration snapshot.

---

## Error format

Every error returns a consistent envelope:

```json
{ "error": { "code": "hunter_rate_limited", "message": "Hunter rate limit ...", "details": {} } }
```

Common codes: `invalid_query`, `groq_rate_limited`, `groq_error`,
`hunter_rate_limited`, `hunter_auth_failed`, `hunter_invalid_filters`,
`upstream_timeout` (`groq_timeout` / `hunter_timeout`), `rate_limited`.

---

## How it fits together

```
App  ──POST /api/parse-query──▶  Groq (JSON mode)          ──▶  filters JSON
App  ──POST /api/search-leads─▶  Hunter Discover(+Domain)  ──▶  formatted leads
                                     │
                                     ├─ query_cache (Supabase / memory)  ← saves credits
                                     └─ search_history (Supabase)        ← saved-searches screen
```

- **Caching** — identical parse queries and identical (filters + page) searches
  are served from cache (`cached: true`), so repeats don't burn Groq/Hunter
  quota. TTL via `CACHE_TTL_SECONDS`.
- **Rate limiting** — per-IP, `RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS`.
- **Timeouts** — every upstream call is bounded by `REQUEST_TIMEOUT_MS`.
- **Bounded fan-out** — people searches make at most
  `1 + HUNTER_COMPANIES_PER_PAGE` Hunter calls per page, run in parallel with
  per-domain failures tolerated (one dead domain doesn't sink the page).

---

## Deploying (Railway / Render)

1. Push `backend/` to a repo.
2. Create a new service from the repo. Start command: `npm start`.
3. Set the same env vars from `.env` in the host's dashboard.
4. Point the Expo app's API base URL at the deployed URL and restrict
   `CORS_ORIGIN` to your app's origin (or your dev tunnel) instead of `*`.

---

## Scaling & extending later

- **Different lead provider** — everything provider-specific lives in
  `src/services/hunter.js` + the mapping helpers in `src/utils/filterSchema.js`
  and `src/utils/formatLead.js`. Routes only depend on the
  `searchLeads(filters, paging) -> { leads, pagination }` contract, so swapping
  or adding a provider doesn't touch routes, cache, or history.
- **Email verification** — Domain Search already returns per-email
  `confidence` + `verification`; for stricter checks add a Hunter
  `/email-verifier` pass behind a flag.
- **Auth / per-user history** — thread a `user_id` into `recordSearch()` and
  `listSearches()` once app auth exists.
- **Different cache/store** — swap the backend in `src/lib/cache.js` (e.g. Redis)
  without touching routes. The per-IP rate limiter's in-memory store should
  also move to a shared store when running multiple instances.
- **Pagination UI** — `pagination.total_pages` is already returned; pass `page`
  to `/api/search-leads` for subsequent pages.

## Project layout

```
backend/
├─ server.js                 # entry point
├─ scripts/                  # check.js (offline), smoke.js (live E2E)
├─ supabase/schema.sql       # DB tables (run once in Supabase)
└─ src/
   ├─ app.js                 # Express assembly
   ├─ config/env.js          # validated env access
   ├─ lib/                   # supabase client, cache, history
   ├─ services/              # groq.js (parse), hunter.js (search)
   ├─ routes/                # parse-query, search-leads, searches
   ├─ middleware/            # rate limiter, error handler, async wrapper
   └─ utils/                 # http (timeout), hashing, filter schema, formatting
```
