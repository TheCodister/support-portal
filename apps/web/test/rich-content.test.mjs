import assert from "node:assert/strict";
import test from "node:test";
import { isUploadedImage, looksLikeMarkdown, markdownExcerpt, toEditorMarkdown, toStoredMarkdown } from "../app/rich-content.ts";

const id = "0f8b6a52-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

test("stored image references round-trip through the editor URL", () => {
  const stored = `# Setup\n\n![Router](kb-image:${id})`;
  const editor = toEditorMarkdown(stored, "/api");
  assert.equal(editor, `# Setup\n\n![Router](/api/v1/knowledge/images/${id})`);
  assert.equal(toStoredMarkdown(editor, "/api"), stored);
  assert.equal(toStoredMarkdown(toEditorMarkdown(stored, "http://localhost:4000"), "http://localhost:4000"), stored);
});

test("external image URLs are left untouched", () => {
  const markdown = "![Logo](https://example.com/logo.png)";
  assert.equal(toStoredMarkdown(markdown, "/api"), markdown);
});

test("detects pasted Markdown but not ordinary prose", () => {
  assert.equal(looksLikeMarkdown("# Title\n\nBody"), true);
  assert.equal(looksLikeMarkdown("See [the docs](https://example.com)."), true);
  assert.equal(looksLikeMarkdown("- first\n- second"), true);
  assert.equal(looksLikeMarkdown("Restart the router, then try again."), false);
  assert.equal(looksLikeMarkdown("Ticket #42 is fixed"), false);
});

test("excerpts strip Markdown syntax", () => {
  assert.equal(markdownExcerpt(`## Reset\n\nOpen **Settings** and read [the guide](https://example.com).\n\n![x](kb-image:${id})`), "Reset Open Settings and read the guide.");
});

test("ticket image references round-trip alongside knowledge images", () => {
  const stored = `![a](ticket-image:${id})\n\n![b](kb-image:${id})`;
  const editor = toEditorMarkdown(stored, "/api");
  assert.equal(editor, `![a](/api/v1/ticket-images/${id})\n\n![b](/api/v1/knowledge/images/${id})`);
  assert.equal(toStoredMarkdown(editor, "/api"), stored);
});

test("only uploads served by this API count as uploaded images", () => {
  assert.equal(isUploadedImage(`/api/v1/ticket-images/${id}`, "/api", "ticket-image"), true);
  assert.equal(isUploadedImage(`/api/v1/knowledge/images/${id}`, "/api", "ticket-image"), false);
  assert.equal(isUploadedImage("https://tracker.example/pixel.png", "/api", "ticket-image"), false);
  assert.equal(isUploadedImage(`https://evil.example/api/v1/ticket-images/${id}`, "/api", "ticket-image"), false);
});
