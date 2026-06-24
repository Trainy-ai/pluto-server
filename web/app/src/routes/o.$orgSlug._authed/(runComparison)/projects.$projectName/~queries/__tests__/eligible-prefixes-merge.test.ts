import { describe, it, expect } from "vitest";
import {
  mergeEligiblePrefixes,
  type EligiblePrefixEntry,
} from "../eligible-prefixes-merge";

// The N+1 fan-out merge: one call per selected run + one project-wide.
// `mergeEligiblePrefixes` collapses the responses into a single sorted,
// ancestor-suppressed list for the Add-Widget dropdown.
//
// What this test pins down (and why it matters):
//
//  - max-not-sum: a prefix appearing in run-A (12 suffixes) and
//    project-wide (15 suffixes) should show "15 children", not 27.
//    Sum would lie about how many bins the user is about to see.
//  - max-not-first-wins: per-run could be smaller than project-wide
//    or vice versa; we want the highest-coverage number.
//  - ancestor suppression survives the merge: a prefix that's an
//    ancestor of another in the merged set must be dropped. The
//    per-proc suppression already runs server-side, but a per-run
//    response could contain `layers/` while project-wide returns
//    `layers/layer_0/` — only after merging can we drop the ancestor.
//  - sort: suffixCount desc, then prefix asc.

describe("mergeEligiblePrefixes", () => {
  it("U7a: takes the MAX suffixCount across sources (not sum, not first-wins)", () => {
    const perRun: EligiblePrefixEntry[][] = [
      [{ prefix: "training/dataset/", suffixCount: 12 }],
    ];
    const project: EligiblePrefixEntry[] = [
      { prefix: "training/dataset/", suffixCount: 15 },
    ];
    const out = mergeEligiblePrefixes(perRun, project);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ prefix: "training/dataset/", suffixCount: 15 });
  });

  it("U7b: takes MAX when per-run is the larger source", () => {
    const perRun: EligiblePrefixEntry[][] = [
      [{ prefix: "sys/", suffixCount: 20 }],
    ];
    const project: EligiblePrefixEntry[] = [
      { prefix: "sys/", suffixCount: 8 },
    ];
    const out = mergeEligiblePrefixes(perRun, project);
    expect(out[0]).toEqual({ prefix: "sys/", suffixCount: 20 });
  });

  it("U7c: unions disjoint prefixes from per-run and project-wide sources", () => {
    const perRun: EligiblePrefixEntry[][] = [
      [{ prefix: "training/dataset/", suffixCount: 12 }],
    ];
    const project: EligiblePrefixEntry[] = [
      { prefix: "sys/", suffixCount: 8 },
    ];
    const out = mergeEligiblePrefixes(perRun, project);
    expect(out.map((e) => e.prefix)).toEqual(["training/dataset/", "sys/"]);
  });

  it("U7d: drops ancestor prefixes when a deeper one survives the merge", () => {
    // Per-run had only `layers/` (12 sibling scalars at the top level).
    // Project-wide had `layers/layer_0/` (40 children of layer_0).
    // After merging both make it into the set; ancestor suppression
    // must drop the shallower `layers/`.
    const perRun: EligiblePrefixEntry[][] = [
      [{ prefix: "layers/", suffixCount: 12 }],
    ];
    const project: EligiblePrefixEntry[] = [
      { prefix: "layers/layer_0/", suffixCount: 40 },
    ];
    const out = mergeEligiblePrefixes(perRun, project);
    expect(out.map((e) => e.prefix)).toEqual(["layers/layer_0/"]);
  });

  it("U7e: sorts by suffixCount descending, then prefix ascending for ties", () => {
    const perRun: EligiblePrefixEntry[][] = [];
    const project: EligiblePrefixEntry[] = [
      { prefix: "z/", suffixCount: 5 },
      { prefix: "a/", suffixCount: 10 },
      { prefix: "b/", suffixCount: 10 },
      { prefix: "c/", suffixCount: 5 },
    ];
    const out = mergeEligiblePrefixes(perRun, project);
    expect(out.map((e) => e.prefix)).toEqual(["a/", "b/", "c/", "z/"]);
  });

  it("U7f: project-wide alone (no runs selected) still produces a valid result", () => {
    // Empty per-run array models the "user hasn't selected any runs"
    // initial state — project-wide must be the only source.
    const out = mergeEligiblePrefixes(
      [],
      [
        { prefix: "training/dataset/", suffixCount: 15 },
        { prefix: "sys/", suffixCount: 8 },
      ],
    );
    expect(out.map((e) => e.prefix)).toEqual(["training/dataset/", "sys/"]);
  });

  it("U7g: undefined entries in the per-run array are skipped (loading sources don't drop merged data)", () => {
    // A useQueries-driven hook surfaces in-flight calls as `data: undefined`.
    // The merge must treat those as "no data yet" rather than failing.
    const perRun: Array<EligiblePrefixEntry[] | undefined> = [
      undefined,
      [{ prefix: "training/dataset/", suffixCount: 12 }],
      undefined,
    ];
    const out = mergeEligiblePrefixes(perRun, [
      { prefix: "sys/", suffixCount: 8 },
    ]);
    expect(out.map((e) => e.prefix)).toEqual(["training/dataset/", "sys/"]);
  });
});
