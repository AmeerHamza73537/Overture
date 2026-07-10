// Offline system check: boots the real app on an ephemeral port and exercises
// every route's validation path plus the pure filter/format helpers.
// Deliberately never calls Groq or Hunter, so it spends no credits and needs
// no network. For a live end-to-end key test, run `npm run smoke`.
//
// Run with: npm run check

import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import {
  emptyFilters,
  normaliseFilters,
  toDiscoverBody,
  toDomainSearchParams,
} from '../src/utils/filterSchema.js';
import { formatContact, formatCompany, rankContacts } from '../src/utils/formatLead.js';
import { encryptToken, decryptToken } from '../src/utils/tokenCrypto.js';
import { buildRawMessage, isLikelyValidEmail } from '../src/services/gmail.js';

let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

// ---- Pure unit checks -------------------------------------------------------

console.log('filter schema:');

await check('normaliseFilters fills defaults from garbage input', () => {
  assert.deepEqual(normaliseFilters(null), emptyFilters());
  assert.deepEqual(normaliseFilters('nope'), emptyFilters());
});

await check('normaliseFilters keeps only valid Hunter enums', () => {
  const f = normaliseFilters({
    search_type: 'organizations',
    departments: ['Marketing', 'astrology', 'SALES'],
    seniorities: ['executive', 'intern'],
    employee_ranges: ['11-50', '1,10', '7-9'],
    job_titles: ['CMO', 42],
  });
  assert.equal(f.search_type, 'organizations');
  assert.deepEqual(f.departments, ['marketing', 'sales']);
  assert.deepEqual(f.seniorities, ['executive']);
  assert.deepEqual(f.employee_ranges, ['11-50', '1-10']); // legacy "1,10" converted
  assert.deepEqual(f.job_titles, ['CMO']);
});

await check('toDiscoverBody folds all filters into the query text', () => {
  const f = normaliseFilters({
    industries: ['fintech'],
    organization_locations: ['Germany'],
    keywords: 'seed stage',
    employee_ranges: ['11-50'],
  });
  const body = toDiscoverBody(f);
  assert.deepEqual(body, {
    query: 'fintech companies in Germany with 11-50 employees seed stage',
  });
});

await check('toDiscoverBody falls back to person locations', () => {
  const f = normaliseFilters({ industries: ['SaaS'], person_locations: ['Canada'] });
  assert.equal(toDiscoverBody(f).query, 'SaaS companies in Canada');
});

await check('toDomainSearchParams sets department/seniority filters', () => {
  const f = normaliseFilters({ departments: ['marketing'], seniorities: ['executive'] });
  const params = toDomainSearchParams('acme.com', f, { limit: 10 });
  assert.equal(params.get('domain'), 'acme.com');
  assert.equal(params.get('department'), 'marketing');
  assert.equal(params.get('seniority'), 'executive');
  assert.equal(params.get('limit'), '10');
});

console.log('lead formatting:');

await check('formatContact maps a Hunter email record', () => {
  const lead = formatContact(
    {
      value: 'jane@acme.com',
      first_name: 'Jane',
      last_name: 'Doe',
      position: 'Chief Marketing Officer',
      seniority: 'executive',
      department: 'marketing',
      confidence: 97,
      linkedin: 'https://linkedin.com/in/janedoe',
      verification: { status: 'valid' },
    },
    { organization: 'Acme Inc', domain: 'acme.com', city: 'Toronto', country: 'CA' },
  );
  assert.equal(lead.name, 'Jane Doe');
  assert.equal(lead.email, 'jane@acme.com');
  assert.equal(lead.email_locked, false);
  assert.equal(lead.email_verification, 'valid');
  assert.equal(lead.company_website, 'https://acme.com');
  assert.equal(lead.location, 'Toronto, CA');
});

await check('formatCompany maps a Discover record', () => {
  const lead = formatCompany({
    organization: 'Acme',
    domain: 'acme.com',
    emails_count: { personal: 10, generic: 2, total: 12 },
  });
  assert.equal(lead.type, 'organization');
  assert.equal(lead.website, 'https://acme.com');
  assert.equal(lead.emails_available, 12);
});

await check('rankContacts puts title matches first, keeps the rest', () => {
  const contacts = [
    { title: 'Software Engineer', email_confidence: 99 },
    { title: 'VP of Marketing', email_confidence: 80 },
    { title: null, email_confidence: 50 },
  ];
  const ranked = rankContacts(contacts, ['Marketing Director']);
  assert.equal(ranked[0].title, 'VP of Marketing');
  assert.equal(ranked.length, 3); // nothing dropped
});

console.log('gmail helpers:');

await check('encryptToken/decryptToken round-trip; unique ciphertexts', () => {
  const secret = '1//refresh-token-example-value';
  const a = encryptToken(secret);
  const b = encryptToken(secret);
  assert.notEqual(a, b); // fresh IV per call
  assert.equal(decryptToken(a), secret);
  assert.equal(decryptToken(b), secret);
});

await check('decryptToken rejects tampered ciphertext', () => {
  const stored = encryptToken('secret');
  const parts = stored.split(':');
  parts[3] = Buffer.from('tampered!').toString('base64');
  assert.throws(() => decryptToken(parts.join(':')));
});

await check('buildRawMessage produces a valid RFC 2822 payload', () => {
  const raw = buildRawMessage({ to: 'jane@acme.com', subject: 'Hello 👋', body: 'Hi Jane,\r\nGreat product!' });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.ok(decoded.startsWith('To: jane@acme.com\r\n'));
  assert.ok(decoded.includes('Subject: =?UTF-8?B?')); // non-ASCII subject got encoded
  assert.ok(decoded.includes('\r\n\r\nHi Jane,')); // blank line before body
});

await check('isLikelyValidEmail catches broken addresses', () => {
  assert.equal(isLikelyValidEmail('jane@acme.com'), true);
  for (const bad of ['', 'not-an-email', 'a@b', 'has space@x.com', null, 'x@y.']) {
    assert.equal(isLikelyValidEmail(bad), false, `should reject ${bad}`);
  }
});

// ---- HTTP surface (no upstream calls) --------------------------------------

console.log('http routes:');

const app = createApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

await check('GET /health reports hunter provider', async () => {
  const res = await fetch(`${base}/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.lead_provider, 'hunter');
});

await check('POST /api/parse-query rejects a missing query', async () => {
  const res = await fetch(`${base}/api/parse-query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'invalid_query');
});

await check('POST /api/search-leads rejects missing filters', async () => {
  const res = await fetch(`${base}/api/search-leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'invalid_filters');
});

await check('unknown routes return the 404 envelope', async () => {
  const res = await fetch(`${base}/nope`);
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.error.code, 'not_found');
});

await check('GET /api/gmail/status reports configuration state', async () => {
  const res = await fetch(`${base}/api/gmail/status`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(typeof body.configured, 'boolean');
  assert.equal(typeof body.connected, 'boolean');
});

await check('POST /api/outreach/generate rejects a missing campaign purpose', async () => {
  const res = await fetch(`${base}/api/outreach/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leads: [{ id: 'x' }], campaign: {} }),
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'invalid_campaign');
});

await check('POST /api/outreach/revise rejects a missing instruction', async () => {
  const res = await fetch(`${base}/api/outreach/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: 's', body: 'b', campaign: { purpose: 'p' } }),
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'invalid_instruction');
});

await check('POST /api/outreach/send rejects an unsendable batch', async () => {
  const res = await fetch(`${base}/api/outreach/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails: [{ to: 'not-an-email', subject: '', body: '' }] }),
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'nothing_sendable');
});

await check('chat routes validate ids and bodies', async () => {
  const bad = await fetch(`${base}/api/chats/not-a-uuid`);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'invalid_chat_id');

  const noMessages = await fetch(`${base}/api/chats/11111111-2222-4333-8444-555555555555`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'x', messages: [] }),
  });
  assert.equal(noMessages.status, 400);
  assert.equal((await noMessages.json()).error.code, 'invalid_messages');
});

server.close();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll offline checks passed.');
