import { describe, it, expect } from "vitest";
import { splitMonotonicLegs } from "@/lib/chart-data-utils";

describe("splitMonotonicLegs", () => {
  it("leaves a monotonic curve as one leg (the common case)", () => {
    const x = Array.from({ length: 100 }, (_, i) => i * 1000);
    const y = x.map((v) => 1 / (1 + v));
    const legs = splitMonotonicLegs(x, y);
    expect(legs).toHaveLength(1);
    expect(legs[0].direction).toBe(1);
    expect(legs[0].x).toHaveLength(100);
  });

  it("does NOT split on noise in a rising x", () => {
    // throughput that wobbles by ~0.1% while climbing
    const x = Array.from({ length: 200 }, (_, i) => i * 100 + (i % 2 ? 5 : -5));
    const y = x.map(() => 1);
    expect(splitMonotonicLegs(x, y)).toHaveLength(1);
  });

  it("splits a warmup-then-decay learning rate into two legs", () => {
    // LR 0 -> 3e-4 over 50 points, then back down to 0 over 50
    const up = Array.from({ length: 50 }, (_, i) => (i / 49) * 3e-4);
    const down = Array.from({ length: 50 }, (_, i) => 3e-4 - (i / 49) * 3e-4);
    const x = [...up, ...down];
    // loss is high during warmup, low during decay -- averaging would hide this
    const y = [...up.map(() => 2.4), ...down.map(() => 0.4)];
    const legs = splitMonotonicLegs(x, y);
    expect(legs).toHaveLength(2);
    expect(legs[0].direction).toBe(1);
    expect(legs[1].direction).toBe(-1);
    // The legs meet AT the turning point, so the descending leg's first sample
    // is the shared apex. What matters is that both branches survive intact and
    // nothing reports their 1.4 average -- the value that never occurred, and
    // the whole reason this function exists.
    expect(legs[0].y.every((v) => v === 2.4)).toBe(true);
    expect(legs[1].y.filter((v) => v !== 2.4).every((v) => v === 0.4)).toBe(true);
    for (const leg of legs) {
      expect(leg.y.some((v) => v > 0.5 && v < 2.3)).toBe(false);
    }
  });

  it("returns every leg ascending in x, as uPlot requires", () => {
    const x = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4];
    const y = x.map((v, i) => i);
    for (const leg of splitMonotonicLegs(x, y)) {
      for (let i = 1; i < leg.x.length; i++) {
        expect(leg.x[i]).toBeGreaterThanOrEqual(leg.x[i - 1]);
      }
    }
  });

  it("keeps y paired with its own x through the reversal", () => {
    const x = [0, 10, 20, 10, 0];
    const y = [1, 2, 3, 4, 5];
    const legs = splitMonotonicLegs(x, y);
    expect(legs).toHaveLength(2);
    expect(legs[0].x).toEqual([0, 10, 20]);
    expect(legs[0].y).toEqual([1, 2, 3]);
    // descending leg reversed for rendering, pairing preserved
    expect(legs[1].x).toEqual([0, 10, 20]);
    expect(legs[1].y).toEqual([5, 4, 3]);
  });

  it("orders a 2-point descending window (uPlot needs ascending x)", () => {
    // A narrow zoom onto a decay branch can return only two points; too few to
    // detect a turn, but still descending.
    const legs = splitMonotonicLegs([100, 50], [1, 2]);
    expect(legs).toHaveLength(1);
    expect(legs[0].x).toEqual([50, 100]);
    expect(legs[0].y).toEqual([2, 1]);
    expect(legs[0].direction).toBe(-1);
  });

  it("leaves a 2-point ascending window alone", () => {
    const legs = splitMonotonicLegs([50, 100], [1, 2]);
    expect(legs[0].x).toEqual([50, 100]);
    expect(legs[0].y).toEqual([1, 2]);
    expect(legs[0].direction).toBe(1);
  });

  it("handles degenerate input", () => {
    expect(splitMonotonicLegs([], [])).toEqual([]);
    expect(splitMonotonicLegs([1], [2])).toHaveLength(1);
    expect(splitMonotonicLegs([5, 5, 5, 5], [1, 2, 3, 4])).toHaveLength(1);
  });

  // `indices` is what lets a caller carry companion arrays — the bucket
  // min/max the tooltip's MIN and MAX columns read — through the split. If it
  // drifts out of step with x, the envelope silently describes a neighbouring
  // bucket and the tooltip reports a spread that belongs to a different point.
  describe("indices", () => {
    it("indexes back into the original arrays for a single leg", () => {
      const x = [0, 10, 20, 30, 40];
      const y = [5, 4, 3, 2, 1];
      const [leg] = splitMonotonicLegs(x, y);
      expect(leg.indices).toEqual([0, 1, 2, 3, 4]);
      expect(leg.indices.map((i) => x[i])).toEqual(leg.x);
      expect(leg.indices.map((i) => y[i])).toEqual(leg.y);
    });

    it("follows the reversal on a descending leg", () => {
      // up to 1000 then back down — the second leg is emitted reversed so
      // uPlot gets ascending x, and indices must be reversed with it.
      const x = [...Array.from({ length: 11 }, (_, i) => i * 100),
                 ...Array.from({ length: 10 }, (_, i) => 900 - i * 100)];
      const y = x.map((_, i) => i);
      const legs = splitMonotonicLegs(x, y);
      expect(legs.length).toBeGreaterThan(1);
      for (const leg of legs) {
        expect(leg.indices).toHaveLength(leg.x.length);
        expect(leg.indices.map((i) => x[i])).toEqual(leg.x);
        expect(leg.indices.map((i) => y[i])).toEqual(leg.y);
      }
      const descending = legs.find((l) => l.direction === -1);
      expect(descending).toBeDefined();
      // reversed on the way out, so the indices run backwards
      expect(descending!.indices[0]).toBeGreaterThan(descending!.indices[1]);
    });

    it("carries a companion array onto the right points", () => {
      // A stand-in for the bucket min/max: value i is tagged "c<i>", so any
      // misalignment shows up as the wrong tag rather than a subtle offset.
      const x = [0, 100, 200, 300, 200, 100, 0];
      const y = [1, 2, 3, 4, 5, 6, 7];
      const companion = x.map((_, i) => `c${i}`);
      for (const leg of splitMonotonicLegs(x, y)) {
        const carried = leg.indices.map((i) => companion[i]);
        expect(carried).toEqual(leg.y.map((v) => `c${y.indexOf(v)}`));
      }
    });

    it("is present on every degenerate path", () => {
      expect(splitMonotonicLegs([1], [2])[0].indices).toEqual([0]);
      // flat x: no range to retrace, so one leg straight through
      expect(splitMonotonicLegs([5, 5, 5, 5], [1, 2, 3, 4])[0].indices)
        .toEqual([0, 1, 2, 3]);
      // 2-point descending window gets reversed
      expect(splitMonotonicLegs([10, 0], [1, 2])[0].indices).toEqual([1, 0]);
      expect(splitMonotonicLegs([0, 10], [1, 2])[0].indices).toEqual([0, 1]);
    });
  });
});
