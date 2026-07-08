import { describe, it, expect } from "vitest";
import { effectiveLeafRunTotal } from "../leaf-run-total";

describe("effectiveLeafRunTotal", () => {
  it("caps at the loaded window when client-paginating (Pin / DOS)", () => {
    // A 250-run bucket only loads+reorders 200 client-side. The paginator must
    // page over 200, not 250 — otherwise Pin shows blank pages 21-25 (B8).
    expect(effectiveLeafRunTotal(new Array(200), 250)).toBe(200);
  });

  it("uses the real bucket total when NOT client-paginating (server-sliced)", () => {
    // Normal browsing: the server already returned this page, totalRuns is real.
    expect(effectiveLeafRunTotal(null, 250)).toBe(250);
  });

  it("small pinned bucket paginates the whole bucket", () => {
    expect(effectiveLeafRunTotal(new Array(7), 7)).toBe(7);
  });

  it("empty loaded set → 0 pages (no phantom pages)", () => {
    expect(effectiveLeafRunTotal([], 250)).toBe(0);
  });
});
