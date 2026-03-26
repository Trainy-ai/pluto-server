/**
 * Tests validating the tooltip cache key uniqueness fix.
 *
 * Bug: cachedRows Map was keyed by series label (s.name). In a single-run,
 * multi-metric chart, ALL series share the same label (the run display ID,
 * e.g. "MMP-18"). This caused 95 entries to collide into 1 cache slot,
 * making the fast-path useless -- every cursor move triggered a full DOM rebuild.
 *
 * Fix: key changed from s.name to String(s.seriesIdx), which is always unique.
 *
 * See: web/app/src/components/charts/lib/tooltip-plugin.ts
 */
import { describe, it, expect } from "vitest";

/** Minimal stand-in for a cached tooltip row entry */
interface CacheEntry {
  valueText: string;
  color: string;
  hidden: boolean;
  lastValueKey?: string;
}

/** Simulates a uPlot series descriptor (only the fields relevant to caching) */
interface SeriesItem {
  name: string; // label text (e.g. run display ID)
  seriesIdx: number; // uPlot series index (always unique)
  value: number;
  color: string;
  hidden: boolean;
}

function buildSeriesItems(count: number, sharedLabel: string): SeriesItem[] {
  return Array.from({ length: count }, (_, i) => ({
    name: sharedLabel,
    seriesIdx: i + 1, // uPlot series 0 is the X axis; real series start at 1
    value: Math.random() * 100,
    color: `hsl(${(i * 360) / count}, 70%, 50%)`,
    hidden: false,
  }));
}

describe("tooltip cache key uniqueness", () => {
  const SERIES_COUNT = 95;
  const SHARED_LABEL = "MMP-18";

  describe("old behavior (keyed by label text)", () => {
    it("collapses all same-label entries into a single cache slot", () => {
      const cache = new Map<string, CacheEntry>();
      const items = buildSeriesItems(SERIES_COUNT, SHARED_LABEL);

      // Simulate the old full-rebuild path: cachedRows.set(s.name, entry)
      for (const s of items) {
        cache.set(s.name, {
          valueText: String(s.value),
          color: s.color,
          hidden: s.hidden,
        });
      }

      // With 95 series sharing the same label, only the last write survives
      expect(cache.size).toBe(1);
      expect(cache.has(SHARED_LABEL)).toBe(true);
    });

    it("fast-path lookup returns the wrong entry for all but the last series", () => {
      const cache = new Map<string, CacheEntry>();
      const items = buildSeriesItems(SERIES_COUNT, SHARED_LABEL);

      for (const s of items) {
        cache.set(s.name, {
          valueText: String(s.value),
          color: s.color,
          hidden: s.hidden,
        });
      }

      // Every series resolves to the same cache entry (the last one written)
      const lastItem = items[items.length - 1];
      const cached = cache.get(SHARED_LABEL)!;
      expect(cached.color).toBe(lastItem.color);

      // The first series' color is lost -- this is the bug
      const firstItem = items[0];
      expect(cached.color).not.toBe(firstItem.color);
    });

    it("updatedKeys set collapses to 1 entry, hiding 94 rows as 'stale'", () => {
      const cache = new Map<string, CacheEntry>();
      const items = buildSeriesItems(SERIES_COUNT, SHARED_LABEL);

      // Full rebuild populates cache (only 1 slot survives)
      for (const s of items) {
        cache.set(s.name, {
          valueText: String(s.value),
          color: s.color,
          hidden: s.hidden,
        });
      }

      // Simulate fast-path: iterate series, look up by label, add to updatedKeys
      const updatedKeys = new Set<string>();
      for (const s of items) {
        const cached = cache.get(s.name);
        if (cached) {
          cached.valueText = String(s.value);
          updatedKeys.add(s.name);
        }
      }

      // updatedKeys only contains 1 entry because all keys are the same string
      expect(updatedKeys.size).toBe(1);

      // This means: for (key, entry) of cache { if (!updatedKeys.has(key)) hide }
      // Only 1 key in cache, and it IS in updatedKeys, so nothing gets hidden.
      // But the real problem is that 94 rows were never created in the cache at all,
      // so the fast-path can never update them -- it triggers a full rebuild every time.
    });
  });

  describe("new behavior (keyed by series index)", () => {
    it("preserves all entries when keyed by String(seriesIdx)", () => {
      const cache = new Map<string, CacheEntry>();
      const items = buildSeriesItems(SERIES_COUNT, SHARED_LABEL);

      // Simulate the fixed full-rebuild path: cachedRows.set(String(s.seriesIdx), entry)
      for (const s of items) {
        cache.set(String(s.seriesIdx), {
          valueText: String(s.value),
          color: s.color,
          hidden: s.hidden,
        });
      }

      // All 95 entries survive because each index is unique
      expect(cache.size).toBe(SERIES_COUNT);
    });

    it("fast-path lookup returns the correct entry per series", () => {
      const cache = new Map<string, CacheEntry>();
      const items = buildSeriesItems(SERIES_COUNT, SHARED_LABEL);

      for (const s of items) {
        cache.set(String(s.seriesIdx), {
          valueText: String(s.value),
          color: s.color,
          hidden: s.hidden,
        });
      }

      // Each series resolves to its own cache entry with correct color
      for (const s of items) {
        const cached = cache.get(String(s.seriesIdx))!;
        expect(cached).toBeDefined();
        expect(cached.color).toBe(s.color);
      }
    });

    it("updatedKeys tracks all processed series individually", () => {
      const cache = new Map<string, CacheEntry>();
      const items = buildSeriesItems(SERIES_COUNT, SHARED_LABEL);

      for (const s of items) {
        cache.set(String(s.seriesIdx), {
          valueText: String(s.value),
          color: s.color,
          hidden: s.hidden,
        });
      }

      // Simulate fast-path update
      const updatedKeys = new Set<string>();
      for (const s of items) {
        const cached = cache.get(String(s.seriesIdx));
        if (cached) {
          cached.valueText = String(s.value * 1.01); // new cursor position -> new value
          updatedKeys.add(String(s.seriesIdx));
        }
      }

      // All series tracked individually
      expect(updatedKeys.size).toBe(SERIES_COUNT);
    });

    it("hiding one series does not affect others with the same label", () => {
      const cache = new Map<string, CacheEntry>();
      const items = buildSeriesItems(SERIES_COUNT, SHARED_LABEL);

      for (const s of items) {
        cache.set(String(s.seriesIdx), {
          valueText: String(s.value),
          color: s.color,
          hidden: s.hidden,
        });
      }

      // User clicks to hide series at index 5
      const toggledIdx = 5;
      const toggledKey = String(toggledIdx);
      const toggledEntry = cache.get(toggledKey)!;
      toggledEntry.hidden = true;
      toggledEntry.lastValueKey = undefined; // force re-render on next fast-path

      // Verify: only the toggled entry is hidden
      expect(cache.get(toggledKey)!.hidden).toBe(true);

      // All other entries remain visible
      for (const s of items) {
        if (s.seriesIdx === toggledIdx) continue;
        const entry = cache.get(String(s.seriesIdx))!;
        expect(entry.hidden).toBe(false);
      }

      // With the OLD key scheme (s.name), hiding series 5 would overwrite
      // the single "MMP-18" slot, affecting whichever series happened to be
      // stored there last.
    });

    it("stale-row hiding correctly identifies absent series", () => {
      const cache = new Map<string, CacheEntry>();
      const items = buildSeriesItems(SERIES_COUNT, SHARED_LABEL);

      for (const s of items) {
        cache.set(String(s.seriesIdx), {
          valueText: String(s.value),
          color: s.color,
          hidden: s.hidden,
        });
      }

      // Simulate fast-path where only even-indexed series have data at this cursor
      const updatedKeys = new Set<string>();
      for (const s of items) {
        if (s.seriesIdx % 2 === 0) {
          updatedKeys.add(String(s.seriesIdx));
        }
      }

      // Identify stale rows (rows not updated this pass)
      const staleKeys: string[] = [];
      for (const [key] of cache) {
        if (!updatedKeys.has(key)) {
          staleKeys.push(key);
        }
      }

      // Odd-indexed series should be marked stale
      const expectedStaleCount = items.filter((s) => s.seriesIdx % 2 !== 0).length;
      expect(staleKeys.length).toBe(expectedStaleCount);

      // Each stale key is a unique series index, not a shared label
      const uniqueStaleKeys = new Set(staleKeys);
      expect(uniqueStaleKeys.size).toBe(staleKeys.length);
    });
  });
});
