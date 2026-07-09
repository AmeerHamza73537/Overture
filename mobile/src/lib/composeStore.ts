// Handoff slot for the compose flow: the chat screen deposits the selected
// leads here, then /compose picks them up on mount. Same pattern as
// pendingQuery — avoids serialising lead objects through router params.

import type { PersonLead } from './types';

let leads: PersonLead[] = [];

export function setComposeLeads(selected: PersonLead[]) {
  leads = selected;
}

/** Returns the deposited leads and clears the slot. */
export function takeComposeLeads(): PersonLead[] {
  const value = leads;
  leads = [];
  return value;
}
