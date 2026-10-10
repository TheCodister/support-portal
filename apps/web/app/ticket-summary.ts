export type TicketSummary = { total: number; byStatus: Record<"open" | "in_progress" | "waiting" | "closed", number> };

const statusLabels = [["open", "open"], ["in_progress", "in progress"], ["waiting", "waiting"], ["closed", "closed"]] as const;

// "3 open · 9 waiting · 2 closed". Statuses with no tickets are left out.
export function statusBreakdown(summary: TicketSummary) {
  return statusLabels.filter(([status]) => summary.byStatus[status] > 0).map(([status, label]) => `${summary.byStatus[status]} ${label}`);
}

export function ticketNoun(total: number, own: boolean) { return `${own ? "your " : ""}${total === 1 ? "ticket" : "tickets"}`; }
