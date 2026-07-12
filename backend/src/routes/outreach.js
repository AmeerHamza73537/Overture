// Outreach routes: AI drafting, AI revision, and batch sending.
//
//   POST /api/outreach/generate  { leads: [...], campaign: {...} }
//   POST /api/outreach/revise    { lead, campaign, subject, body, instruction }
//   POST /api/outreach/send      { emails: [{ lead_id, to, subject, body }] }
//
// Generation/revision are strictly user-triggered (the app calls these when
// the user taps the button — nothing here runs automatically), and sending
// only happens with the exact subject/body the user approved in review.

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { env } from '../config/env.js';
import { generateOutreachEmail, reviseOutreachEmail } from '../services/emailWriter.js';
import { sendBatch, isLikelyValidEmail } from '../services/gmail.js';
import { getGmailAccount } from '../lib/gmailAccount.js';

export const outreachRouter = Router();

const MAX_GENERATE = 20;

/** Normalise/validate the campaign object the user fills once per batch. */
function readCampaign(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.purpose !== 'string' || !raw.purpose.trim()) {
    throw new HttpError(
      400,
      'invalid_campaign',
      'campaign.purpose is required — a sentence about why you are reaching out.',
    );
  }
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 2000) : '');
  return {
    purpose: str(raw.purpose),
    sender_name: str(raw.sender_name),
    sender_company: str(raw.sender_company),
    details: str(raw.details),
    tone: str(raw.tone).slice(0, 60),
  };
}

/** Keep only the lead fields the prompt uses; never trust client blobs. */
function readLead(raw) {
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 300) : null);
  return {
    id: str(raw?.id),
    name: str(raw?.name),
    title: str(raw?.title),
    company: str(raw?.company),
    location: str(raw?.location),
    email: str(raw?.email),
  };
}

outreachRouter.post(
  '/outreach/generate',
  asyncHandler(async (req, res) => {
    const { leads: rawLeads, campaign: rawCampaign } = req.body ?? {};
    if (!Array.isArray(rawLeads) || rawLeads.length === 0) {
      throw new HttpError(400, 'invalid_leads', 'Body must include a non-empty "leads" array.');
    }
    if (rawLeads.length > MAX_GENERATE) {
      throw new HttpError(400, 'too_many_leads', `At most ${MAX_GENERATE} leads per batch.`);
    }
    const campaign = readCampaign(rawCampaign);

    // Sequential on purpose: stays inside Groq's rate limits and keeps
    // failures isolated per lead — one bad generation doesn't kill the batch.
    const drafts = [];
    for (const rawLead of rawLeads) {
      const lead = readLead(rawLead);
      try {
        const { subject, body } = await generateOutreachEmail({ lead, campaign });
        drafts.push({ lead_id: lead.id, to: lead.email, subject, body, status: 'ok' });
      } catch (err) {
        drafts.push({
          lead_id: lead.id,
          to: lead.email,
          subject: '',
          body: '',
          status: 'failed',
          error: err.message,
        });
      }
    }

    res.json({ drafts });
  }),
);

outreachRouter.post(
  '/outreach/revise',
  asyncHandler(async (req, res) => {
    const { lead: rawLead, campaign: rawCampaign, subject, body, instruction } = req.body ?? {};
    if (typeof instruction !== 'string' || !instruction.trim()) {
      throw new HttpError(400, 'invalid_instruction', 'Body must include a non-empty "instruction".');
    }
    if (typeof subject !== 'string' || typeof body !== 'string' || !body.trim()) {
      throw new HttpError(400, 'invalid_email', 'Body must include the current "subject" and "body".');
    }

    const revised = await reviseOutreachEmail({
      lead: readLead(rawLead),
      campaign: readCampaign(rawCampaign),
      subject: subject.slice(0, 200),
      body: body.slice(0, 5000),
      instruction: instruction.trim().slice(0, 1000),
    });

    res.json(revised);
  }),
);

outreachRouter.post(
  '/outreach/send',
  asyncHandler(async (req, res) => {
    const { emails: rawEmails } = req.body ?? {};
    if (!Array.isArray(rawEmails) || rawEmails.length === 0) {
      throw new HttpError(400, 'invalid_emails', 'Body must include a non-empty "emails" array.');
    }
    if (rawEmails.length > env.outreach.maxBatchSize) {
      throw new HttpError(
        400,
        'batch_too_large',
        `At most ${env.outreach.maxBatchSize} emails per send.`,
      );
    }

    const emails = rawEmails.map((raw) => ({
      lead_id: typeof raw?.lead_id === 'string' ? raw.lead_id : null,
      to: typeof raw?.to === 'string' ? raw.to.trim() : '',
      subject: typeof raw?.subject === 'string' ? raw.subject.trim().slice(0, 200) : '',
      body: typeof raw?.body === 'string' ? raw.body.slice(0, 10_000) : '',
    }));

    // Reject the request outright if nothing in it could possibly send —
    // otherwise let sendBatch flag the bad ones individually.
    if (!emails.some((e) => isLikelyValidEmail(e.to) && e.subject && e.body.trim())) {
      throw new HttpError(400, 'nothing_sendable', 'No email in the batch has a valid address, subject and body.');
    }

    // Fail fast with ONE clear error when Gmail was never connected, instead
    // of a batch where every row failed with the same message.
    if (!(await getGmailAccount(req.user.id))) {
      throw new HttpError(400, 'gmail_not_connected', 'Connect a Gmail account before sending.');
    }

    const { results, needs_reconnect } = await sendBatch(req.user.id, emails);

    res.json({
      results,
      needs_reconnect,
      summary: {
        sent: results.filter((r) => r.status === 'sent').length,
        failed: results.filter((r) => r.status === 'failed').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
      },
    });
  }),
);
