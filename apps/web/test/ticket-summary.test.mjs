import assert from "node:assert/strict";
import test from "node:test";
import { statusBreakdown, ticketNoun } from "../app/ticket-summary.ts";

test("the breakdown lists statuses in workflow order and skips empty ones", () => {
  assert.deepEqual(statusBreakdown({ total: 14, byStatus: { open: 3, in_progress: 0, waiting: 9, closed: 2 } }), ["3 open", "9 waiting", "2 closed"]);
  assert.deepEqual(statusBreakdown({ total: 0, byStatus: { open: 0, in_progress: 0, waiting: 0, closed: 0 } }), []);
});

test("the noun agrees with the count and says whose tickets they are", () => {
  assert.equal(ticketNoun(1, false), "ticket");
  assert.equal(ticketNoun(14, false), "tickets");
  assert.equal(ticketNoun(14, true), "your tickets");
});
