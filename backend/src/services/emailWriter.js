// AI outreach-email writer (Groq, JSON mode).
//
// Two operations, both explicitly user-triggered from the app:
//   generateOutreachEmail — first draft from lead data + the user's campaign
//                           context (purpose, their company, offer, links…)
//   reviseOutreachEmail   — apply plain-language feedback ("make it shorter",
//                           "add my portfolio link") to an existing draft
//                           WITHOUT losing the original outreach intent.

import { env } from '../config/env.js';
import { fetchWithTimeout, safeJson } from '../utils/http.js';
import { HttpError } from '../utils/httpError.js';

/**
 * @typedef {Object} Campaign  What the user fills in once per batch.
 * @property {string} purpose        why they're reaching out / what they offer
 * @property {string} [sender_name]
 * @property {string} [sender_company]
 * @property {string} [details]      free-form custom data: offer, pricing,
 *                                   portfolio links, personal notes, etc.
 * @property {string} [tone]         e.g. "friendly", "formal", "casual"
 */

const GENERATE_SYSTEM_PROMPT = `You write short, personalized B2B cold-outreach emails.

Return ONLY a JSON object: { "subject": string, "body": string }

Hard rules:
- Use the LEAD data (name, role, company, location) to make it specifically about them; open with something that shows this isn't a mass email.
- Use the SENDER's context: their purpose, company, and any custom details they provided (offers, links, pricing, notes). If custom details are present you MUST weave them in naturally — do not ignore them and do not dump them as a list.
- Keep the body under 130 words, plain text, 2-3 short paragraphs, one clear call to action.
- Sign off with the sender's name (and company if given).
- Never invent facts about the lead or the sender. If a detail is missing, write around it — NEVER output placeholders like [Name] or [Company].
- No markdown, no HTML, no emoji spam. Subject under 60 characters, no clickbait.`;

const REVISE_SYSTEM_PROMPT = `You revise a B2B outreach email according to the user's feedback.

Return ONLY a JSON object: { "subject": string, "body": string }

Hard rules:
- Apply the requested change faithfully.
- PRESERVE the original outreach intent and context (who it's from, why they're reaching out, the call to action) unless the feedback explicitly changes it.
- Keep it plain text, concise, and free of placeholders like [Name].
- If the feedback doesn't mention the subject, keep the subject unless the change makes it inaccurate.`;

/** Compact, labelled context block shared by both prompts. */
function contextBlock(lead, campaign) {
  const lines = [
    'LEAD:',
    `  name: ${lead.name ?? 'unknown'}`,
    `  title: ${lead.title ?? 'unknown'}`,
    `  company: ${lead.company ?? 'unknown'}`,
    `  location: ${lead.location ?? 'unknown'}`,
    'SENDER:',
    `  purpose of outreach: ${campaign.purpose}`,
  ];
  if (campaign.sender_name) lines.push(`  name: ${campaign.sender_name}`);
  if (campaign.sender_company) lines.push(`  company: ${campaign.sender_company}`);
  if (campaign.tone) lines.push(`  desired tone: ${campaign.tone}`);
  if (campaign.details) lines.push(`  custom details to incorporate: ${campaign.details}`);
  return lines.join('\n');
}

/**
 * Draft one email for one lead.
 * @returns {Promise<{ subject: string, body: string }>}
 */
export function generateOutreachEmail({ lead, campaign }) {
  return complete(GENERATE_SYSTEM_PROMPT, contextBlock(lead, campaign), 0.6);
}

/**
 * Revise an existing draft per the user's plain-language instruction. The
 * original campaign context is re-sent so the model still knows WHY this
 * email exists while editing it.
 * @returns {Promise<{ subject: string, body: string }>}
 */
export function reviseOutreachEmail({ lead, campaign, subject, body, instruction }) {
  const user = [
    contextBlock(lead, campaign),
    'CURRENT EMAIL:',
    `  subject: ${subject}`,
    `  body:\n${body}`,
    'FEEDBACK TO APPLY:',
    `  ${instruction}`,
  ].join('\n');
  return complete(REVISE_SYSTEM_PROMPT, user, 0.4);
}

// ---- Shared Groq call -------------------------------------------------------

async function complete(systemPrompt, userContent, temperature) {
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
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });

  const payload = await safeJson(res);

  if (!res.ok) {
    if (res.status === 429) {
      throw new HttpError(429, 'groq_rate_limited', 'Groq rate limit hit, please retry shortly.');
    }
    const message = payload?.error?.message ?? `Groq returned status ${res.status}`;
    throw new HttpError(502, 'groq_error', message);
  }

  let parsed;
  try {
    parsed = JSON.parse(payload?.choices?.[0]?.message?.content ?? '');
  } catch {
    throw new HttpError(502, 'groq_invalid_json', 'The AI did not return a valid email.');
  }

  const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';
  const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
  if (!subject || !body) {
    throw new HttpError(502, 'groq_invalid_email', 'The AI returned an incomplete email.');
  }
  return { subject: subject.slice(0, 150), body: body.slice(0, 4000) };
}
