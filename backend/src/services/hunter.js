// Hunter.io service: run a people/organization search from normalised filters.
//
// Hunter is domain-centric, so the two search types map differently:
//   organizations -> one Discover call (companies matching the filters)
//   people        -> Discover (a page of companies) + one Domain Search per
//                    company domain, fanned out in parallel, then flattened
//                    into contacts and ranked by job-title relevance.
//
// Quota notes: every Discover page and every Domain Search consumes Hunter
// credits. env.hunter.companiesPerPage / emailsPerCompany bound the fan-out,
// and the route-level cache prevents identical searches from re-spending.

import { env } from '../config/env.js';
import { fetchWithTimeout, safeJson } from '../utils/http.js';
import { HttpError } from '../utils/httpError.js';
import { toDiscoverBody, toDomainSearchParams } from '../utils/filterSchema.js';
import { formatCompany, formatContact, rankContacts } from '../utils/formatLead.js';

/**
 * Search Hunter for leads matching the given filters.
 * @param {import('../utils/filterSchema.js').LeadFilters} filters
 * @param {{ page?: number, perPage?: number }} [paging]
 */
export async function searchLeads(filters, paging = {}) {
  const { page = 1, perPage = 25 } = paging;

  if (filters.search_type === 'organizations') {
    return searchOrganizations(filters, { page, perPage });
  }
  return searchPeople(filters, { page, perPage });
}

// ---- Organizations: single Discover call ----------------------------------

async function searchOrganizations(filters, { page, perPage }) {
  const { companies, totalMatches } = await discoverCompanies(filters);
  const pageCompanies = pageSlice(companies, page, perPage);

  return {
    provider: 'hunter',
    leads: pageCompanies.map(formatCompany),
    pagination: buildPagination({
      page,
      perPage,
      reachable: companies.length,
      totalMatches,
    }),
  };
}

// ---- People: Discover companies, then Domain Search each ------------------

async function searchPeople(filters, { page, perPage }) {
  const companiesPerPage = Math.max(1, env.hunter.companiesPerPage);
  const emailsPerCompany = Math.min(
    Math.max(1, env.hunter.emailsPerCompany),
    Math.max(1, perPage), // never pull more per company than the page asks for
  );

  const { companies, totalMatches } = await discoverCompanies(filters);
  const pageCompanies = pageSlice(companies, page, companiesPerPage);

  // Fan out one Domain Search per company. allSettled so one bad domain
  // doesn't sink the page; if every call failed, surface the first real error.
  const settled = await Promise.allSettled(
    pageCompanies.map((company) => domainSearch(company, filters, emailsPerCompany)),
  );

  const fulfilled = settled.filter((s) => s.status === 'fulfilled');
  if (pageCompanies.length > 0 && fulfilled.length === 0) {
    throw settled[0].reason;
  }

  const contacts = fulfilled.flatMap((s) => s.value);
  const leads = rankContacts(contacts, filters.job_titles).slice(0, perPage);

  return {
    provider: 'hunter',
    leads,
    // Pagination advances over companies (Discover), since contacts per
    // company vary: each page mines `companiesPerPage` companies for contacts.
    pagination: buildPagination({
      page,
      perPage,
      reachable: companies.length,
      totalMatches,
      pageSize: companiesPerPage,
    }),
  };
}

/**
 * Run Discover and return the reachable companies plus the true match count.
 * Hunter plans cap Discover at the first page of results (typically 100) and
 * reject offset/limit params below that cap, so we fetch the whole page once
 * and paginate locally. The route-level cache keeps repeat pages cheap.
 */
async function discoverCompanies(filters) {
  const payload = await hunterRequest('/discover', {
    method: 'POST',
    body: JSON.stringify(toDiscoverBody(filters)),
    headers: { 'Content-Type': 'application/json' },
  });

  const companies = (payload?.data ?? []).filter((c) => c?.domain);
  return {
    companies,
    totalMatches: payload?.meta?.results ?? companies.length,
  };
}

function pageSlice(items, page, pageSize) {
  return items.slice((page - 1) * pageSize, page * pageSize);
}

/**
 * total_entries/total_pages are computed from the companies we can actually
 * reach on this plan, so the app never pages into guaranteed-empty pages.
 * `total_matches` carries Hunter's full match count for display.
 */
function buildPagination({ page, perPage, reachable, totalMatches, pageSize = perPage }) {
  return {
    page,
    per_page: perPage,
    total_entries: reachable,
    total_pages: Math.max(1, Math.ceil(reachable / pageSize)),
    total_matches: totalMatches,
  };
}

/**
 * Domain Search for one company; returns formatted person leads.
 * @returns {Promise<object[]>}
 */
async function domainSearch(company, filters, limit) {
  const params = toDomainSearchParams(company.domain, filters, { limit });
  const payload = await hunterRequest(`/domain-search?${params}`);

  const data = payload?.data ?? {};
  const emails = data.emails ?? [];
  return emails.map((email) => formatContact(email, data, company));
}

// ---- Shared request/error handling -----------------------------------------

/**
 * Perform an authenticated Hunter API request and map failures to HttpErrors.
 * @param {string} path e.g. '/discover' or '/domain-search?domain=x'
 * @param {RequestInit} [init]
 */
async function hunterRequest(path, init = {}) {
  const res = await fetchWithTimeout(`${env.hunter.baseUrl}${path}`, {
    ...init,
    label: 'hunter',
    headers: {
      Accept: 'application/json',
      'X-API-KEY': env.hunter.apiKey,
      ...(init.headers ?? {}),
    },
  });

  const payload = await safeJson(res);

  if (!res.ok) {
    // Hunter error envelope: { errors: [{ id, code, details }] }
    const detail = payload?.errors?.[0]?.details;

    if (res.status === 429) {
      throw new HttpError(
        429,
        'hunter_rate_limited',
        detail ?? 'Hunter rate limit or credit cap reached, please retry later.',
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(
        502,
        'hunter_auth_failed',
        detail ?? 'Hunter rejected the API key or the plan lacks access to this endpoint.',
      );
    }
    if (res.status === 400 || res.status === 422) {
      throw new HttpError(
        400,
        'hunter_invalid_filters',
        detail ?? 'Hunter rejected the search parameters.',
        payload,
      );
    }
    throw new HttpError(502, 'hunter_error', detail ?? `Hunter returned status ${res.status}`);
  }

  return payload;
}
