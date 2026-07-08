// Turn Hunter's Domain Search / Discover records into the lean shape the
// mobile app renders and exports to CSV.

/**
 * Format one Hunter Domain Search email record into a person lead.
 * @param {any} email   one entry of data.emails[] from /domain-search
 * @param {any} domainData the surrounding data object (org name, location…)
 * @param {any} company the Discover record the domain came from (may be sparse)
 */
export function formatContact(email, domainData = {}, company = {}) {
  const name = [email.first_name, email.last_name].filter(Boolean).join(' ') || null;
  const companyName = domainData.organization ?? company.organization ?? company.name ?? null;
  const domain = domainData.domain ?? company.domain ?? null;
  const location =
    [domainData.city, domainData.state, domainData.country].filter(Boolean).join(', ') || null;

  return {
    id: email.value ?? email.linkedin ?? null,
    type: 'person',
    name,
    title: email.position ?? null,
    department: email.department ?? null,
    seniority: email.seniority ?? null,
    company: companyName,
    company_website: domain ? `https://${domain}` : null,
    location,
    email: email.value ?? null,
    email_locked: !email.value,
    // Hunter's own signals — 0-100 confidence plus verifier status when present.
    email_confidence: email.confidence ?? null,
    email_verification: email.verification?.status ?? null,
    linkedin_url: email.linkedin ?? null,
  };
}

/**
 * Format one Hunter Discover company record into an organization lead.
 * @param {any} company
 */
export function formatCompany(company) {
  const location =
    [company.city, company.state, company.country].filter(Boolean).join(', ') || null;

  // emails_count is an object ({ personal, generic, total }) on current API
  // responses; tolerate a plain number in case the shape varies by plan.
  const emailsCount =
    typeof company.emails_count === 'object' && company.emails_count !== null
      ? company.emails_count.total ?? company.emails_count.personal ?? null
      : company.emails_count ?? null;

  return {
    id: company.domain ?? null,
    type: 'organization',
    name: company.organization ?? company.name ?? null,
    industry: company.industry ?? null,
    employee_count: company.headcount ?? null,
    location,
    website: company.domain ? `https://${company.domain}` : null,
    emails_available: emailsCount,
    linkedin_url: company.linkedin ?? null,
  };
}

/**
 * Rank person leads by how well their position matches the requested job
 * titles. Hunter can't filter by free-text title, so this is our client-side
 * relevance pass: matching contacts first, then by Hunter email confidence.
 * The sort is stable and nothing is dropped — a weak match beats no lead.
 * @param {object[]} contacts formatted person leads
 * @param {string[]} jobTitles
 */
export function rankContacts(contacts, jobTitles = []) {
  const tokens = [...new Set(
    jobTitles
      .flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/))
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  )];

  const score = (lead) => {
    const title = (lead.title ?? '').toLowerCase();
    if (!title || tokens.length === 0) return 0;
    return tokens.reduce((acc, token) => acc + (title.includes(token) ? 1 : 0), 0);
  };

  return contacts
    .map((lead, index) => ({ lead, index, score: score(lead) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.lead.email_confidence ?? 0) - (a.lead.email_confidence ?? 0) ||
        a.index - b.index,
    )
    .map((entry) => entry.lead);
}

// Title words too generic to signal a match ("head of", "vp of"…).
const STOP_WORDS = new Set(['the', 'and', 'for', 'head']);
