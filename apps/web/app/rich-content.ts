// Stored Markdown references uploaded images as `<scheme>:<id>` so it does not depend on the API origin.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IMAGE_ROUTES = { "kb-image": "/v1/knowledge/images/", "ticket-image": "/v1/ticket-images/" } as const;
export type ImageScheme = keyof typeof IMAGE_ROUTES;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function imageUrl(apiBase: string, id: string, scheme: ImageScheme = "kb-image") { return `${apiBase}${IMAGE_ROUTES[scheme]}${id}`; }

export function toEditorMarkdown(markdown: string, apiBase: string) {
  return markdown.replace(new RegExp(`(kb-image|ticket-image):(${UUID})`, "g"), (_match, scheme: ImageScheme, id: string) => imageUrl(apiBase, id, scheme));
}

export function toStoredMarkdown(markdown: string, apiBase: string) {
  let stored = markdown;
  for (const [scheme, route] of Object.entries(IMAGE_ROUTES)) stored = stored.replace(new RegExp(`${escapeRegExp(apiBase + route)}(${UUID})`, "g"), (_match, id: string) => `${scheme}:${id}`);
  return stored;
}

/** True when an image source points at an upload served by this API under the given scheme. */
export function isUploadedImage(src: string, apiBase: string, scheme: ImageScheme) {
  return new RegExp(`^${escapeRegExp(apiBase + IMAGE_ROUTES[scheme])}${UUID}$`).test(src);
}

const MARKDOWN_SIGNALS = [/^#{1,6}\s+\S/m, /^\s*[-*+]\s+\S/m, /^\s*\d+\.\s+\S/m, /!?\[[^\]\n]*\]\([^)\s]+\)/, /\*\*[^*\n]+\*\*/, /^>\s/m, /^```/m];

export function looksLikeMarkdown(text: string) { return MARKDOWN_SIGNALS.some((pattern) => pattern.test(text)); }

export function markdownExcerpt(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
