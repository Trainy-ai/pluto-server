import { describe, expect, it } from "vitest";
import type { Run } from "../~queries/list-runs";
import {
  collectServerFilteredRunIds,
  computeInViewRunIds,
  dropPhantomSelectedRuns,
  mergeLoadedRuns,
  narrowUrlPrefetchedRuns,
  overlayVisibleRuns,
  parseUrlRunIds,
  resolveUrlRunIds,
} from "./run-list-model";

function run(id: string, extra: Partial<Run> = {}): Run {
  return { id, name: `run-${id}`, ...extra } as Run;
}

function runWithDisplayId(id: string, prefix: string, number: number): Run {
  return {
    id,
    name: `run-${id}`,
    number,
    project: { runPrefix: prefix },
  } as unknown as Run;
}

describe("parseUrlRunIds", () => {
  it("returns undefined for absent or empty params", () => {
    expect(parseUrlRunIds(undefined)).toBeUndefined();
    expect(parseUrlRunIds("")).toBeUndefined();
    expect(parseUrlRunIds(" , ,")).toBeUndefined();
  });

  it("splits, trims, and drops empty entries", () => {
    expect(parseUrlRunIds("a, b ,,c")).toEqual(["a", "b", "c"]);
  });
});

describe("resolveUrlRunIds", () => {
  it("passes raw ids through until the prefetch resolves", () => {
    expect(resolveUrlRunIds(["MMP-1"], undefined)).toEqual(["MMP-1"]);
    expect(resolveUrlRunIds(["MMP-1"], [])).toEqual(["MMP-1"]);
  });

  it("resolves display IDs to SQIDs and keeps SQIDs as-is", () => {
    const prefetched = [runWithDisplayId("sq1", "MMP", 1), run("sq2")];
    expect(resolveUrlRunIds(["MMP-1", "sq2"], prefetched)).toEqual(["sq1", "sq2"]);
  });

  it("returns undefined when nothing resolves", () => {
    expect(resolveUrlRunIds(["MMP-99"], [run("sq1")])).toBeUndefined();
    expect(resolveUrlRunIds(undefined, [run("sq1")])).toBeUndefined();
  });
});

describe("narrowUrlPrefetchedRuns", () => {
  it("returns [] when the ?runs= param is empty — stale prefetch rows must not survive a deselect-all (regression: search dropdown locked deselected runs as 'In table')", () => {
    const prefetched = [run("a"), run("b")];
    expect(narrowUrlPrefetchedRuns(prefetched, undefined)).toEqual([]);
    expect(narrowUrlPrefetchedRuns(prefetched, [])).toEqual([]);
  });

  it("drops prefetched runs that left the param, keeps the rest", () => {
    const prefetched = [run("a"), run("b"), run("c")];
    expect(narrowUrlPrefetchedRuns(prefetched, ["a", "c"]).map((r) => r.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("matches display-ID param entries against prefetched rows", () => {
    const prefetched = [runWithDisplayId("sq1", "MMP", 7), run("sq2")];
    expect(narrowUrlPrefetchedRuns(prefetched, ["MMP-7"]).map((r) => r.id)).toEqual([
      "sq1",
    ]);
  });
});

describe("mergeLoadedRuns", () => {
  it("returns [] when pages haven't landed", () => {
    expect(mergeLoadedRuns(undefined, [run("u1")])).toEqual([]);
  });

  it("flattens pages, dedupes by id, and appends URL-prefetched runs not on a page", () => {
    const pages = [
      { runs: [run("a"), run("b")] },
      null,
      { runs: [run("b"), run("c")] },
    ];
    const merged = mergeLoadedRuns(pages, [run("c"), run("u1")]);
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c", "u1"]);
    // Page row wins over the prefetched duplicate.
    expect(merged.find((r) => r.id === "c")).toBe(pages[2]!.runs![0 + 1]);
  });
});

describe("overlayVisibleRuns", () => {
  it("prefers selected-prefetch blobs over URL-prefetch blobs over page rows", () => {
    const pageRow = run("a", { name: "trimmed" });
    const urlRow = run("a", { name: "url-blob" });
    const selectedRow = run("a", { name: "selected-blob" });
    const out = overlayVisibleRuns([pageRow], [urlRow], [selectedRow]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("selected-blob");
  });

  it("preserves page order when overlays add no new runs", () => {
    const a = run("a");
    const b = run("b");
    const out = overlayVisibleRuns([a, b], [run("b", { name: "untrimmed-b" })], undefined);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out[1].name).toBe("untrimmed-b");
  });

  it("appends overlay-only runs", () => {
    const out = overlayVisibleRuns([run("a")], [], [run("s1")]);
    expect(out.map((r) => r.id)).toEqual(["a", "s1"]);
  });
});

describe("collectServerFilteredRunIds", () => {
  it("returns undefined (not an empty Set) before pages land — the distinction gates intersectWithServerFilter (see PR #524)", () => {
    expect(collectServerFilteredRunIds(undefined)).toBeUndefined();
  });

  it("returns an empty Set when the server matched nothing", () => {
    const out = collectServerFilteredRunIds([{ runs: [] }]);
    expect(out).toEqual(new Set());
  });

  it("collects ids across pages", () => {
    const out = collectServerFilteredRunIds([
      { runs: [run("a")] },
      undefined,
      { runs: [run("b")] },
    ]);
    expect(out).toEqual(new Set(["a", "b"]));
  });
});

describe("dropPhantomSelectedRuns", () => {
  const prefetched = [run("p1"), run("p2"), run("p3")];

  it("passes through when there is no selected-prefetch", () => {
    const runs = [run("a")];
    expect(dropPhantomSelectedRuns(runs, undefined, new Set(), new Set())).toBe(runs);
    expect(dropPhantomSelectedRuns(runs, [], new Set(), new Set())).toBe(runs);
  });

  it("keeps non-prefetched rows, selected rows, and rows on the current page; drops true phantoms", () => {
    const rows = [run("a"), run("p1"), run("p2"), run("p3")];
    const out = dropPhantomSelectedRuns(
      rows,
      prefetched,
      new Set(["p1"]), // p1 still selected
      new Set(["a", "p2"]), // p2 is a real row on the current page
    );
    // p3: prefetched, deselected, off-page → phantom, dropped.
    expect(out.map((r) => r.id)).toEqual(["a", "p1", "p2"]);
  });
});

describe("computeInViewRunIds", () => {
  const tableRuns = [run("t1"), run("t2")];

  it("flat mode: table rows plus selected", () => {
    const out = computeInViewRunIds({
      showOnlySelected: false,
      pinSelectedToTop: false,
      tableRuns,
      selectedRunIds: ["s1"],
    });
    expect(out).toEqual(new Set(["t1", "t2", "s1"]));
  });

  it("display-only-selected / pin-to-top: only the selected block counts as in view", () => {
    for (const gate of [
      { showOnlySelected: true, pinSelectedToTop: false },
      { showOnlySelected: false, pinSelectedToTop: true },
    ]) {
      const out = computeInViewRunIds({
        ...gate,
        tableRuns,
        selectedRunIds: ["s1"],
      });
      expect(out).toEqual(new Set(["s1"]));
    }
  });
});
