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

In the Supabase dashboard → **SQL editor**, run these in order:

1. [`supabase/schema.sql`](supabase/schema.sql) — cache, history, chats and
   Gmail tables (RLS enabled).
2. [`supabase/add-auth.sql`](supabase/add-auth.sql) — the `profiles` table +
   trigger for app authentication (see the "Authentication" section below).

Supabase also unlocks **sign in / sign up** — without it the API runs open as
a single shared user (fine for local dev only).

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

## Authentication (sign up / sign in / password reset)

Auth is backed by **Supabase Auth** and proxied through this backend — the
app never talks to Supabase directly. Users (email + hashed password) live in
Supabase's `auth.users` table, with an app-facing `public.profiles` row kept
in sync by a trigger (`supabase/add-auth.sql`). Every API route except
`/api/auth/*` and `/api/gmail/callback` requires a
`Authorization: Bearer <access_token>` header once Supabase is configured,
and chats, search history and the Gmail connection are all scoped to the
signed-in user.

Setup (one time, ~2 minutes):

1. Run [`supabase/add-auth.sql`](supabase/add-auth.sql) in the SQL editor.
2. In the Supabase dashboard → **Authentication → URL Configuration →
   Redirect URLs**, add the deep links the password-reset email may land on:
   - `overture://reset-password` (standalone app builds)
   - `exp://*/--/reset-password` (Expo Go during development)
3. (Optional) Customise the reset email under **Authentication → Emails**.
   Supabase's built-in mailer works out of the box but is rate-limited
   (a few emails per hour) — plug in your own SMTP for production.

How the **forgot password** flow works end to end:

1. App calls `POST /api/auth/forgot-password { email, redirect_to }` —
   `redirect_to` is the app's own deep link (it differs between Expo Go and a
   standalone build; the backend falls back to `AUTH_RESET_REDIRECT_URL`).
2. Supabase emails the user a verification link.
3. The user taps it; Supabase verifies the token and redirects the browser to
   the deep link, which opens the app's **reset password** screen with the
   recovery session's tokens in the URL fragment.
4. The app collects a new password and calls
   `POST /api/auth/reset-password { access_token, password }`; the backend
   verifies the recovery token, updates the password via the admin API and
   revokes all existing sessions.

Note: sign-up creates the account pre-confirmed (no "verify your email" step)
so the flow works with zero dashboard configuration; mailbox ownership is
still proven by the password-reset flow. To require verified signups, switch
`routes/auth.js` from `auth.admin.createUser` to `auth.signUp` and enable
"Confirm email" in the dashboard.

### Auth endpoints

| Route | Body | Returns |
| ----- | ---- | ------- |
| `POST /api/auth/signup` | `{ email, password, full_name? }` | `{ user, session }` (201) |
| `POST /api/auth/signin` | `{ email, password }` | `{ user, session }` |
| `POST /api/auth/refresh` | `{ refresh_token }` | `{ user, session }` |
| `POST /api/auth/signout` | — (Bearer) | `{ signed_out }` |
| `GET /api/auth/me` | — (Bearer) | `{ user }` |
| `POST /api/auth/forgot-password` | `{ email, redirect_to? }` | `{ sent }` (always — no account enumeration) |
| `POST /api/auth/reset-password` | `{ access_token, password }` | `{ reset }` |

`session` is `{ access_token, refresh_token, expires_at }` (`expires_at` in
epoch **seconds**). Auth routes sit behind a stricter rate limit (20 requests
/ 15 min / IP). Auth error codes: `auth_required`, `invalid_token`,
`invalid_credentials`, `email_in_use`, `weak_password`, `refresh_failed`,
`reset_rate_limited`, `auth_not_configured`.

---

## Gmail setup (send outreach from your own Gmail)

The app can send the emails you approve **from your own Gmail account**. That
requires a (free) Google Cloud OAuth client. One-time setup, ~5 minutes:

1. Go to <https://console.cloud.google.com> and create a project (any name,
   e.g. "Outreach").
2. **Enable the Gmail API**: menu → *APIs & Services* → *Library* → search
   "Gmail API" → *Enable*.
3. **Consent screen**: *APIs & Services* → *OAuth consent screen* →
   - User type: **External**, fill in the app name + your email.
   - You do NOT need Google verification: under **Test users**, add your own
     Gmail address. Only test users can connect while the app is unverified,
     which is exactly right for personal use.
4. **Create the OAuth client**: *APIs & Services* → *Credentials* → *Create
   credentials* → *OAuth client ID* →
   - Application type: **Web application**
   - Authorized redirect URIs: add exactly
     `http://localhost:3000/api/gmail/callback`
     (add your deployed URL later, e.g. `https://api.example.com/api/gmail/callback`)
5. Copy the **Client ID** and **Client secret** into `backend/.env`:
   `GOOGLE_CLIENT_ID=...` and `GOOGLE_CLIENT_SECRET=...`, then restart the backend.
6. Run [`supabase/add-gmail-accounts.sql`](supabase/add-gmail-accounts.sql) in
   the Supabase SQL editor (skip if you ran the current `schema.sql`).
7. In the app: chat header → mail icon → **Connect Gmail**. In development the
   consent page must be completed in a browser **on this PC** (the redirect
   goes to `localhost:3000`). Once the backend is deployed with a public URL,
   the flow works from the phone browser too.

**What gets stored:** only your email address and the refresh token, encrypted
with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` from `.env`. Access tokens stay
in memory and are never logged. The only Gmail permission requested is
`gmail.send` — the app cannot read your inbox.

**Disconnecting:** the app's disconnect button revokes the grant at Google and
deletes the stored token. You can also revoke anytime at
<https://myaccount.google.com/permissions>; the app will then ask you to
reconnect the next time it tries to send.

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

### Gmail + outreach endpoints

| Route | What it does |
| ----- | ------------ |
| `GET /api/gmail/status` | `{ configured, connected, email }` |
| `GET /api/gmail/connect-url` | `{ url, state }` — Google consent URL bound to the signed-in user |
| `GET /api/gmail/connect?state=` | Browser page: redirects to Google consent (state from `/connect-url`) |
| `GET /api/gmail/callback` | Google redirects here; stores encrypted tokens (public — identity travels in `state`) |
| `DELETE /api/gmail/account` | Revokes the grant and forgets the connection |
| `POST /api/outreach/generate` | `{ leads, campaign }` → AI drafts per lead |
| `POST /api/outreach/revise` | `{ lead, campaign, subject, body, instruction }` → revised draft |
| `POST /api/outreach/send` | `{ emails }` → sends via Gmail, per-email results |

`campaign` is filled once per batch: `{ purpose, sender_name, sender_company,
details, tone }` — `details` is free-form custom data (offer, links, pricing,
notes) that the AI must weave into every draft.

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
   ├─ lib/                   # supabase client, cache, history, gmail account store
   ├─ services/              # groq (parse), hunter (search), googleAuth (OAuth),
   │                         #   gmail (send), emailWriter (AI drafts/revisions)
   ├─ routes/                # parse-query, search-leads, searches, gmail, outreach
   ├─ middleware/            # rate limiter, error handler, async wrapper
   └─ utils/                 # http (timeout), hashing, filters, formatting, tokenCrypto
```
