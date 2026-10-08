import { describe, expect, it } from "vitest";
import { ticketImageIds } from "../src/markdown.js";

const id = "0f8b6a52-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

describe("ticketImageIds", () => {
  it("returns no IDs for text without images", () => {
    expect(ticketImageIds("# Printer\n\nIt jams on page 2. See [the manual](https://example.com).")).toEqual([]);
  });
  it("returns each uploaded image once", () => {
    expect(ticketImageIds(`![a](ticket-image:${id})\n\n![b](ticket-image:${id.toUpperCase()})`)).toEqual([id]);
  });
  it.each([
    ["an external image", "![x](https://tracker.example/pixel.png)"],
    ["a knowledge image", `![x](kb-image:${id})`],
    ["an HTML image", "<img src=\"https://tracker.example/pixel.png\">"],
    ["a reference-style image", "![x][pixel]\n\n[pixel]: https://tracker.example/pixel.png"],
    ["a mix of uploaded and external images", `![a](ticket-image:${id}) ![b](https://example.com/b.png)`]
  ])("rejects %s", (_label, markdown) => {
    expect(ticketImageIds(markdown)).toBeNull();
  });
});
