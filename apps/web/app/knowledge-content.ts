// Stored articles reference uploaded images as `kb-image:<id>` so the Markdown does not depend on the API origin.
const STORED_IMAGE = /kb-image:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function imageUrl(apiBase: string, id: string) { return `${apiBase}/v1/knowledge/images/${id}`; }

export function toEditorMarkdown(markdown: string, apiBase: string) {
  return markdown.replace(STORED_IMAGE, (_match, id: string) => imageUrl(apiBase, id));
}

export function toStoredMarkdown(markdown: string, apiBase: string) {
  const served = new RegExp(`${escapeRegExp(apiBase)}/v1/knowledge/images/([0-9a-f-]{36})`, "g");
  return markdown.replace(served, (_match, id: string) => `kb-image:${id}`);
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
