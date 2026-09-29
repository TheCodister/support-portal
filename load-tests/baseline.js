import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const apiLatency = new Trend("supportdesk_api_latency", true);
const rejected = new Rate("supportdesk_rejected");
export const options = {
  scenarios: { baseline: { executor: "constant-arrival-rate", rate: Number(__ENV.RATE || 1), timeUnit: "1s", duration: __ENV.DURATION || "2m", preAllocatedVUs: 10, maxVUs: 100 } },
  thresholds: { http_req_failed: ["rate<0.005"], "http_req_duration{operation:read}": ["p(95)<300"], supportdesk_rejected: ["rate<0.01"] }
};
export function setup() {
  const response = http.post(`${__ENV.API_URL}/v1/auth/login`, JSON.stringify({ email: __ENV.EMAIL || "agent@acme.test", password: __ENV.PASSWORD || "supportdesk-demo" }), { headers: { "Content-Type": "application/json" } });
  check(response, { "login succeeds": (r) => r.status === 200 });
  return { orgId: response.json().memberships[0].organization_id, session: response.cookies.supportdesk_session[0].value };
}
export default function (data) {
  const response = http.get(`${__ENV.API_URL}/v1/tickets?limit=25`, { headers: { "x-organization-id": data.orgId }, cookies: { supportdesk_session: data.session }, tags: { operation: "read" } });
  apiLatency.add(response.timings.duration); rejected.add(response.status === 429); check(response, { "tickets returned": (r) => r.status === 200 }); sleep(0.2);
}
