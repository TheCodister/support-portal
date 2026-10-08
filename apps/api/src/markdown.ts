const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const INLINE_IMAGE = /!\[[^\]]*\]\(\s*<?([^\s)>]+)/g;
const TICKET_IMAGE = new RegExp(`^ticket-image:(${UUID})$`, "i");

/**
 * Ticket descriptions may only embed images uploaded for the ticket, so a requester cannot make agents' browsers
 * load an outside URL. Returns the referenced upload IDs, or null when any other image source is present.
 */
export function ticketImageIds(markdown: string): string[] | null {
  if (/<img[\s>]/i.test(markdown) || /!\[[^\]]*\]\[/.test(markdown)) return null;
  const ids = new Set<string>();
  for (const [, source] of markdown.matchAll(INLINE_IMAGE)) {
    const id = TICKET_IMAGE.exec(source ?? "")?.[1];
    if (!id) return null;
    ids.add(id.toLowerCase());
  }
  return [...ids];
}
