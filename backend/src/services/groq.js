// Groq service: turn one chat turn into an INTENT + structured LeadFilters.
//
// A chat turn is not always a fresh search. "generate me more", "only in
// Germany", "what's the weather" all arrive at the same endpoint, so the
// parser must first CLASSIFY the message against the conversation so far:
//
//   new_search    a brand-new set of people/companies    -> fresh filters, page 1
//   refine        adjust the previous search              -> merged filters, page 1
//   more_results  more of the same results                -> reuse filters, next page
//   off_topic     not about finding leads                 -> a friendly reply, no search
//
// Without this, "more" gave the model an impossible, context-free task and it
// hallucinated filters (or gave up). The previous search's filters are passed
// in as context so the model can refine them and recognise "more".

import { env } from '../config/env.js';
import { fetchWithTimeout, safeJson } from '../utils/http.js';
import { HttpError } from '../utils/httpError.js';
import { normaliseFilters, emptyFilters } from '../utils/filterSchema.js';

export const INTENTS = ['new_search', 'refine', 'more_results', 'off_topic'];

const DEFAULT_OFFTOPIC_REPLY =
  "I'm here to help you find leads. Describe the people or companies you'd like to " +
  'reach — for example "marketing leaders at fintech companies in the US".';

const SYSTEM_PROMPT = `You are the parser for a B2B lead-search chat (Hunter.io). Each turn you classify the user's message against the conversation, then return filters.

Return ONLY a JSON object with EXACTLY these keys:
{
  "intent": "new_search" | "refine" | "more_results" | "off_topic",
  "reply": string,
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

INTENT — decide first:
- "new_search": the user describes a NEW set of people/companies unrelated to the previous search. Fill all filter fields fresh.
- "refine": the user is ADJUSTING the previous search (e.g. "only in Germany", "just CEOs", "make it bigger companies", "also include designers"). You are given PREVIOUS_FILTERS — start from those and apply ONLY the requested change, returning the COMPLETE updated filter set.
- "more_results": the user wants MORE of the same results (e.g. "more", "show me more", "next", "give me more people"). Echo PREVIOUS_FILTERS unchanged.
- "off_topic": the message is not a lead-search request (greetings, questions about you, chit-chat, anything unrelated). Put a short, friendly reply in "reply" that steers them back to describing who they want to reach. Leave all filter fields at their defaults.
- If there are NO PREVIOUS_FILTERS, you may ONLY use "new_search" or "off_topic".
- "reply" MUST be "" unless intent is "off_topic".

FILTER FIELD RULES (for new_search and refine):
- "search_type": "people" for individuals (founders, investors, VPs, owners, decision-makers); "organizations" for companies/accounts themselves.
- "job_titles": specific role titles, expanded to common variants (e.g. "marketing lead" -> ["Marketing Director","Head of Marketing","CMO","VP of Marketing"]). Empty for pure organization searches.
- "departments": from this set ONLY: "executive", "it", "finance", "management", "sales", "legal", "support", "hr", "marketing", "communication", "education", "design", "health", "operations". E.g. a CMO -> ["marketing","executive"]. Empty when no role is implied.
- "seniorities": from this set ONLY: "junior", "senior", "executive". C-level/founders -> ["executive"], managers/leads -> ["senior"]. Empty when not implied.
- "person_locations": geographic locations for the PEOPLE (country/state/city as plain text, e.g. "United States", "California").
- "organization_locations": HQ locations for the COMPANIES.
- "industries": plain-text industries or sectors (e.g. "fintech", "SaaS").
- "employee_ranges": company headcount from this set ONLY: "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+". Map intent to the closest ranges.
- "keywords": remaining useful free-text signal (funding stage, technology, niche).
- "needs_clarification": true ONLY when a new_search request is too vague to search meaningfully. Still fill your best guess.
- "assumptions": short notes on interpretations you made.

Do not include comments, markdown, or any text outside the JSON object.`;

// Obvious "more" phrases we can classify WITHOUT calling the model — instant
// and free. Kept to exact whole-message matches so "more senior people" still
// goes to the model as a refinement.
const MORE_PHRASES = new Set([
  'more',
  'more please',
  'show more',
  'show me more',
  'see more',
  'load more',
  'more results',
  'more leads',
  'more people',
  'more contacts',
  'more companies',
  'give me more',
  'generate more',
  'generate me more',
  'next',
  'next page',
  'keep going',
]);

/** Normalise a message for fast-path matching (lowercase, trim, drop trailing . !). */
function fastIntent(query) {
  const q = query.trim().toLowerCase().replace(/[.!\s]+$/g, '');
  return MORE_PHRASES.has(q) ? 'more_results' : null;
}

/**
 * Parse one chat turn.
 * @param {string} query the user's message
 * @param {{ filters: import('../utils/filterSchema.js').LeadFilters }|null} [context]
 *        the previous search's (already-normalised) filters, or null for the
 *        first turn / no prior search.
 * @returns {Promise<{ intent: string, reply: string, filters: object, needs_clarification: boolean, assumptions: string[] }>}
 */
export async function parseQuery(query, context = null) {
  const contextFilters = context?.filters ? normaliseFilters(context.filters) : null;
  const hasContext = Boolean(contextFilters);

  // --- Fast path: obvious "more" needs no model call ---
  if (fastIntent(query) === 'more_results') {
    if (hasContext) {
      return { intent: 'more_results', reply: '', ...blankExtras(contextFilters) };
    }
    // "more" with nothing to continue — guide them, don't hallucinate.
    return {
      intent: 'off_topic',
      reply: DEFAULT_OFFTOPIC_REPLY,
      ...blankExtras(emptyFilters()),
    };
  }

  // --- Model path ---
  const userContent = hasContext
    ? `PREVIOUS_FILTERS: ${JSON.stringify(contextFilters)}\n\nUSER MESSAGE: ${query}`
    : `USER MESSAGE: ${query}`;

  const res = await fetchWithTimeout(`${env.groq.baseUrl}/chat/completions`, {
    method: 'POST',
    label: 'groq',
    headers: {
      Authorization: `Bearer ${env.groq.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.groq.model,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });

  const payload = await safeJson(res);

  if (!res.ok) {
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
    throw new HttpError(502, 'groq_invalid_json', 'Groq did not return valid JSON.');
  }

  return normaliseTurn(parsed, { hasContext, contextFilters });
}

/** Coerce the model's turn output into a safe, typed result. */
function normaliseTurn(parsed, { hasContext, contextFilters }) {
  let intent = INTENTS.includes(parsed?.intent) ? parsed.intent : 'new_search';

  // Guard: refine/more_results are meaningless without a prior search.
  if (!hasContext && (intent === 'refine' || intent === 'more_results')) {
    intent = 'new_search';
  }

  if (intent === 'more_results') {
    return { intent, reply: '', ...blankExtras(contextFilters) };
  }

  if (intent === 'off_topic') {
    const reply =
      typeof parsed?.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.trim().slice(0, 500)
        : DEFAULT_OFFTOPIC_REPLY;
    return { intent, reply, ...blankExtras(emptyFilters()) };
  }

  // new_search | refine: trust the model's full filter set (for refine it was
  // told to start from PREVIOUS_FILTERS and return the complete merged result).
  const filters = normaliseFilters(parsed);
  return {
    intent,
    reply: '',
    filters,
    needs_clarification: filters.needs_clarification,
    assumptions: filters.assumptions,
  };
}

/** Shared shape for intents that don't produce fresh assumptions. */
function blankExtras(filters) {
  return { filters, needs_clarification: false, assumptions: [] };
}
