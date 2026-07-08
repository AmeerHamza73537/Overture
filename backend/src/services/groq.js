// Groq service: turn a natural-language request into structured LeadFilters.
// Uses Groq's OpenAI-compatible chat completions API with JSON mode so the
// model is forced to return a single JSON object (no prose).

import { env } from '../config/env.js';
import { fetchWithTimeout, safeJson } from '../utils/http.js';
import { HttpError } from '../utils/httpError.js';
import { normaliseFilters } from '../utils/filterSchema.js';

// The system prompt fully specifies the JSON contract. Keep it strict.
const SYSTEM_PROMPT = `You convert a user's natural-language description of who they want to reach out to into a strict JSON filter object for a B2B lead-search API (Hunter.io).

Return ONLY a JSON object with EXACTLY these keys:
{
  "search_type": "people" | "organizations",
  "job_titles": string[],
  "departments": string[],
  "seniorities": string[],
  "person_locations": string[],
  "organization_locations": string[],
  "industries": string[],
  "employee_ranges": string[],
  "keywords": string,
  "needs_clarification": boolean,
  "assumptions": string[]
}

Rules:
- "search_type": use "people" when the user wants individuals (founders, investors, VPs, owners, decision-makers). Use "organizations" when they want companies/accounts themselves.
- "job_titles": specific role titles, expanded to common variants (e.g. "marketing lead" -> ["Marketing Director","Head of Marketing","CMO","VP of Marketing"]). Empty for pure organization searches.
- "departments": the departments those roles belong to, from this set ONLY: "executive", "it", "finance", "management", "sales", "legal", "support", "hr", "marketing", "communication", "education", "design", "health", "operations". E.g. a CMO -> ["marketing","executive"]. Empty when no role is implied.
- "seniorities": from this set ONLY: "junior", "senior", "executive". Decision-makers/founders/C-level -> ["executive"], managers/leads -> ["senior"]. Empty when seniority isn't implied.
- "person_locations": geographic locations for the PEOPLE (country, state, or city names as plain text, e.g. "United States", "Canada", "California").
- "organization_locations": HQ locations for the COMPANIES.
- "industries": plain-text industries or sectors (e.g. "fintech", "marketing agency", "SaaS").
- "employee_ranges": company headcount as Hunter range strings from this set ONLY: "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+". Map the user's intent to the closest ranges (e.g. "10-50 employees" -> ["1-10","11-50"]).
- "keywords": any remaining useful free-text signal (funding stage, technology, niche) that doesn't fit the fields above.
- "needs_clarification": true ONLY when the request is too vague to search meaningfully (e.g. "find cool people"). Still fill your best-guess filters.
- "assumptions": short human-readable notes on any interpretation you made (e.g. "Assumed US-based", "Interpreted 'seed investors' as angel/VC titles").

Do not include comments, markdown, or any text outside the JSON object.`;

/**
 * Parse a raw natural-language query into normalised LeadFilters.
 * @param {string} query
 * @returns {Promise<import('../utils/filterSchema.js').LeadFilters>}
 */
export async function parseQuery(query) {
  const res = await fetchWithTimeout(`${env.groq.baseUrl}/chat/completions`, {
    method: 'POST',
    label: 'groq',
    headers: {
      Authorization: `Bearer ${env.groq.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.groq.model,
      // JSON mode: guarantees the assistant message content is valid JSON.
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
    }),
  });

  const payload = await safeJson(res);

  if (!res.ok) {
    // Map Groq's failure modes to clean client errors.
    if (res.status === 429) {
      throw new HttpError(429, 'groq_rate_limited', 'Groq rate limit hit, please retry shortly.');
    }
    if (res.status === 401) {
      throw new HttpError(500, 'groq_auth_failed', 'Groq API key is invalid or missing.');
    }
    const message = payload?.error?.message ?? `Groq returned status ${res.status}`;
    throw new HttpError(502, 'groq_error', message);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new HttpError(502, 'groq_empty_response', 'Groq returned no content.');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Should not happen in JSON mode, but never trust the model blindly.
    throw new HttpError(502, 'groq_invalid_json', 'Groq did not return valid JSON.');
  }

  return normaliseFilters(parsed);
}
