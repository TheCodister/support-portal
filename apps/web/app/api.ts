import { requestOptions } from "./request-headers";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

let csrfToken = "";
export async function request<T>(path: string, init: RequestInit = {}, organizationId?: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...requestOptions(init, csrfToken, organizationId), credentials: "include" });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message ?? `Request failed (${response.status})`); }
  if (response.status === 204) { if (path === "/v1/auth/logout") csrfToken = ""; return undefined as T; }
  const body = await response.json();
  if ((path === "/v1/auth/login" || path === "/v1/auth/me") && typeof body.csrfToken === "string") csrfToken = body.csrfToken;
  return body as T;
}
