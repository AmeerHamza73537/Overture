// Tiny handoff slot: the history screen deposits a query here, then the chat
// screen picks it up on focus and runs it. Avoids router-param re-trigger
// pitfalls for a one-shot action.

let pending: string | null = null;

export function setPendingQuery(query: string) {
  pending = query;
}

/** Returns the pending query (if any) and clears the slot. */
export function takePendingQuery(): string | null {
  const value = pending;
  pending = null;
  return value;
}
