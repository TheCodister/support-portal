export function requestOptions(init: RequestInit, csrfToken: string, organizationId?: string): RequestInit {
  const body = init.method === "POST" && init.body == null ? "{}" : init.body;
  const headers: Record<string, string> = {};
  if (typeof body === "string") headers["content-type"] = "application/json";
  if (organizationId) headers["x-organization-id"] = organizationId;
  if (!["GET", "HEAD"].includes(init.method ?? "GET")) headers["x-csrf-token"] = csrfToken;
  new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
  return { ...init, body, headers };
}
