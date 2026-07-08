// The canonical "filter" shape that flows between the two endpoints.
//
// Groq is asked to emit exactly this shape. The app sends the same shape back
// to /api/search-leads. This module (a) documents the schema, (b) normalises /
// sanitises whatever Groq returns, and (c) maps it to Hunter.io API params.
//
// Hunter is domain-centric, so a "people" search runs in two stages:
//   1. Discover      (POST /v2/discover)      -> companies matching org filters
//   2. Domain Search (GET  /v2/domain-search) -> contacts per company domain
// Hunter can't filter contacts by free-text job title — it filters by
// department + seniority — so the schema carries both: departments/seniorities
// drive the API filter, job_titles drive local relevance ranking.

/** Hunter Discover headcount buckets (the only values Hunter accepts). */
export const HUNTER_HEADCOUNT_RANGES = [
  '1-10', '11-50', '51-200', '201-500', '501-1000',
  '1001-5000', '5001-10000', '10001+',
];

/** Hunter Domain Search department filter values. */
export const HUNTER_DEPARTMENTS = [
  'executive', 'it', 'finance', 'management', 'sales', 'legal', 'support',
  'hr', 'marketing', 'communication', 'education', 'design', 'health',
  'operations',
];

/** Hunter Domain Search seniority filter values. */
export const HUNTER_SENIORITIES = ['junior', 'senior', 'executive'];

/**
 * @typedef {Object} LeadFilters
 * @property {'people'|'organizations'} search_type
 * @property {string[]} job_titles          e.g. ["VP of Marketing", "CMO"] — used for local ranking
 * @property {string[]} departments         Hunter departments, subset of HUNTER_DEPARTMENTS
 * @property {string[]} seniorities         Hunter seniorities, subset of HUNTER_SENIORITIES
 * @property {string[]} person_locations    e.g. ["United States", "California"]
 * @property {string[]} organization_locations HQ locations for companies
 * @property {string[]} industries          free-text industries/keywords
 * @property {string[]} employee_ranges     Hunter buckets from HUNTER_HEADCOUNT_RANGES
 * @property {string}   keywords            extra free-text keywords
 * @property {boolean}  needs_clarification true when the query was too vague
 * @property {string[]} assumptions         human-readable assumptions Groq made
 */

/** A blank, valid filter object. */
export function emptyFilters() {
  return {
    search_type: 'people',
    job_titles: [],
    departments: [],
    seniorities: [],
    person_locations: [],
    organization_locations: [],
    industries: [],
    employee_ranges: [],
    keywords: '',
    needs_clarification: false,
    assumptions: [],
  };
}

const asStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 25); // guard against runaway arrays
};

/** Keep only values present in `allowed` (case-insensitive), deduplicated. */
const asEnumArray = (value, allowed) => {
  const set = new Set();
  for (const v of asStringArray(value)) {
    const match = allowed.find((a) => a === v.toLowerCase());
    if (match) set.add(match);
  }
  return [...set];
};

/** Normalise a headcount value, tolerating legacy Apollo "1,10" comma style. */
const asHeadcountArray = (value) => {
  const set = new Set();
  for (const v of asStringArray(value)) {
    const candidate = v.replace(/\s/g, '').replace(',', '-');
    if (HUNTER_HEADCOUNT_RANGES.includes(candidate)) set.add(candidate);
  }
  return [...set];
};

/**
 * Coerce arbitrary JSON (from Groq or the client) into a valid LeadFilters.
 * Unknown fields are dropped; missing fields get safe defaults.
 * @param {any} raw
 * @returns {LeadFilters}
 */
export function normaliseFilters(raw) {
  const base = emptyFilters();
  if (!raw || typeof raw !== 'object') return base;

  return {
    search_type: raw.search_type === 'organizations' ? 'organizations' : 'people',
    job_titles: asStringArray(raw.job_titles),
    departments: asEnumArray(raw.departments, HUNTER_DEPARTMENTS),
    seniorities: asEnumArray(raw.seniorities, HUNTER_SENIORITIES),
    person_locations: asStringArray(raw.person_locations),
    organization_locations: asStringArray(raw.organization_locations),
    industries: asStringArray(raw.industries),
    employee_ranges: asHeadcountArray(raw.employee_ranges),
    keywords: typeof raw.keywords === 'string' ? raw.keywords.trim() : '',
    needs_clarification: Boolean(raw.needs_clarification),
    assumptions: asStringArray(raw.assumptions),
  };
}

/**
 * Build the Hunter Discover request body from normalised filters.
 * Everything goes into the natural-language `query`: Discover's AI parser
 * turns it into structured filters (location, industry, headcount, keywords)
 * server-side — verified against the live API, which echoes the parsed
 * filters back in meta.filters. Structured body params like `headcount` are
 * silently ignored on some plans, and `offset`/`limit` are rejected outright
 * on plans capped at the first 100 results, so we send neither and let the
 * service paginate locally over the returned page.
 * @param {LeadFilters} filters
 */
export function toDiscoverBody(filters) {
  const parts = [];
  if (filters.industries.length) parts.push(filters.industries.join(', '));
  parts.push('companies');

  const locations = filters.organization_locations.length
    ? filters.organization_locations
    // For people searches without explicit HQ locations, assume companies are
    // where the people are — Hunter has no per-contact location filter.
    : filters.person_locations;
  if (locations.length) parts.push(`in ${locations.join(' or ')}`);

  if (filters.employee_ranges.length) {
    parts.push(`with ${filters.employee_ranges.join(' or ')} employees`);
  }

  if (filters.keywords) parts.push(filters.keywords);

  return { query: parts.join(' ') };
}

/**
 * Build the Hunter Domain Search query params for one company domain.
 * @param {string} domain
 * @param {LeadFilters} filters
 * @param {{ limit?: number }} [opts]
 * @returns {URLSearchParams}
 */
export function toDomainSearchParams(domain, filters, { limit = 10 } = {}) {
  const params = new URLSearchParams({ domain, limit: String(limit) });
  if (filters.departments.length) params.set('department', filters.departments.join(','));
  if (filters.seniorities.length) params.set('seniority', filters.seniorities.join(','));
  return params;
}
