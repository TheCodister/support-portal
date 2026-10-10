export function requestOptions(init: RequestInit, csrfToken: string, organizationId?: string): RequestInit {
  // A mutation without a body still sends "{}". Behind the Amplify /api rewrite an empty DELETE reaches Fastify
  // looking like it has a body but no content type, and Fastify rejects it with 415.
  const body = !["GET", "HEAD"].includes(init.method ?? "GET") && init.body == null ? "{}" : init.body;
  const headers: Record<string, string> = {};
  if (typeof body === "string") headers["content-type"] = "application/json";
  if (organizationId) headers["x-organization-id"] = organizationId;
  if (!["GET", "HEAD"].includes(init.method ?? "GET")) headers["x-csrf-token"] = csrfToken;
  new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
  return { ...init, body, headers };
}
