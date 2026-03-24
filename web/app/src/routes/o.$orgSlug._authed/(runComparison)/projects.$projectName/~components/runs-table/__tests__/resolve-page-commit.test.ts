import { describe, it, expect } from "vitest";
import { resolvePageCommit } from "../components/table-pagination";

const defaults = {
  totalPages: 50,
  currentPage: 1,
  pageBase: 0,
  runsLength: 40, // 2 pages loaded (pageSize 20)
  pageSize: 20,
  hasJumpSupport: true,
};

describe("resolvePageCommit", () => {
  // ── noop cases ──────────────────────────────────────────────────────

  it("returns noop for non-numeric input", () => {
    expect(resolvePageCommit({ ...defaults, inputValue: "abc" })).toEqual({
      type: "noop",
    });
  });

  it("returns noop for empty input", () => {
    expect(resolvePageCommit({ ...defaults, inputValue: "" })).toEqual({
      type: "noop",
    });
  });

  // ── navigate within loaded data ─────────────────────────────────────

  it("navigates to page 1 (already loaded)", () => {
    const result = resolvePageCommit({ ...defaults, inputValue: "1" });
    expect(result).toEqual({ type: "navigate", relativeIndex: 0 });
  });

  it("navigates to page 2 (within loaded data)", () => {
    const result = resolvePageCommit({ ...defaults, inputValue: "2" });
    expect(result).toEqual({ type: "navigate", relativeIndex: 1 });
  });

  it("navigates within loaded data after a jump (pageBase > 0)", () => {
    // Jumped to page 10 (pageBase=9), 40 runs loaded = 2 pages (10 and 11)
    const result = resolvePageCommit({
      ...defaults,
      pageBase: 9,
      currentPage: 10,
      inputValue: "11",
    });
    // relativeIndex = 10 - 9 = 1 (second loaded page)
    expect(result).toEqual({ type: "navigate", relativeIndex: 1 });
  });

  // ── jump to distant page ────────────────────────────────────────────

  it("jumps to page far beyond loaded data", () => {
    const result = resolvePageCommit({ ...defaults, inputValue: "25" });
    // absoluteIndex = 24
    expect(result).toEqual({ type: "jump", absoluteIndex: 24 });
  });

  it("jumps to page just 1 beyond loaded data (the old bug)", () => {
    // With 40 runs loaded (2 pages), typing "3" targets relativeIndex=2
    // which is outside loaded data. The OLD code called onFetchNextPage()
    // without navigating. The fix should produce a "jump" action.
    const result = resolvePageCommit({ ...defaults, inputValue: "3" });
    expect(result).toEqual({ type: "jump", absoluteIndex: 2 });
  });

  it("jumps to page 2 beyond loaded data", () => {
    const result = resolvePageCommit({ ...defaults, inputValue: "4" });
    expect(result).toEqual({ type: "jump", absoluteIndex: 3 });
  });

  it("jumps backward when target is before pageBase", () => {
    // Currently at pageBase=10, user types "5"
    const result = resolvePageCommit({
      ...defaults,
      pageBase: 10,
      currentPage: 11,
      inputValue: "5",
    });
    // relativeIndex = 4 - 10 = -6, which is < 0, so jump
    expect(result).toEqual({ type: "jump", absoluteIndex: 4 });
  });

  // ── clamping ────────────────────────────────────────────────────────

  it("clamps input below 1 to page 1", () => {
    const result = resolvePageCommit({ ...defaults, inputValue: "0" });
    expect(result).toEqual({ type: "navigate", relativeIndex: 0 });
  });

  it("clamps input above totalPages to last page", () => {
    const result = resolvePageCommit({ ...defaults, inputValue: "999" });
    // Clamped to page 50, absoluteIndex = 49
    expect(result).toEqual({ type: "jump", absoluteIndex: 49 });
  });

  it("clamps negative input to page 1", () => {
    const result = resolvePageCommit({ ...defaults, inputValue: "-5" });
    expect(result).toEqual({ type: "navigate", relativeIndex: 0 });
  });

  // ── fallback (no jump support) ──────────────────────────────────────

  it("falls back to last loaded page when jump not supported", () => {
    const result = resolvePageCommit({
      ...defaults,
      hasJumpSupport: false,
      inputValue: "25",
    });
    // loadedTablePages = ceil(40/20) = 2, fallback to index 1
    expect(result).toEqual({ type: "fallback", relativeIndex: 1 });
  });

  // ── edge cases ──────────────────────────────────────────────────────

  it("handles single page total", () => {
    const result = resolvePageCommit({
      ...defaults,
      totalPages: 1,
      runsLength: 5,
      inputValue: "1",
    });
    expect(result).toEqual({ type: "navigate", relativeIndex: 0 });
  });

  it("handles typing current page (no-op navigate)", () => {
    const result = resolvePageCommit({
      ...defaults,
      currentPage: 1,
      inputValue: "1",
    });
    expect(result).toEqual({ type: "navigate", relativeIndex: 0 });
  });

  it("handles non-standard page size", () => {
    // pageSize=50, 100 runs loaded = 2 pages
    const result = resolvePageCommit({
      ...defaults,
      pageSize: 50,
      runsLength: 100,
      totalPages: 20,
      inputValue: "3",
    });
    // relativeIndex = 2, loadedTablePages = ceil(100/50) = 2, so 2 >= 2 → jump
    expect(result).toEqual({ type: "jump", absoluteIndex: 2 });
  });

  it("handles partial last page in loaded data", () => {
    // 30 runs loaded with pageSize 20 → ceil(30/20) = 2 loaded pages
    // Page 2 only has 10 rows but still counts as loaded
    const result = resolvePageCommit({
      ...defaults,
      runsLength: 30,
      inputValue: "2",
    });
    expect(result).toEqual({ type: "navigate", relativeIndex: 1 });
  });
});
