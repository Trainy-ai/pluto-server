/** Distinct dash patterns per metric index (metric 0 = solid). */
// Base dash patterns for multi-metric charts. Values are horizontal pixel
// distances (on, off, ...). For dense data, series-config.ts uses a custom
// paths builder that renders these as horizontal-distance dashes with
// subsampled points for noise reduction.
//
// Shared by the per-run multi-metric chart (line-chart-multi) and the grouped
// multi-metric chart (grouped-line-chart) so a metric gets the SAME pattern
// whether grouping is on or off — color distinguishes runs/groups, dash
// distinguishes metrics.
export const METRIC_DASH_PATTERNS: (number[] | undefined)[] = [
  undefined, // metric 0: solid           ━━━━━━━━━
  [16, 10], // metric 1: dashed          ━  ━  ━  ━
  [4, 10], // metric 2: dotted          · · · · · ·
  [16, 6, 4, 6], // metric 3: dash-dot        ━ · ━ · ━ ·
  [24, 8, 4, 8], // metric 4: long dash-dot   ━━ · ━━ · ━━
  [16, 6, 4, 6, 4, 6], // metric 5: dash-dot-dot    ━ · · ━ · ·
  [30, 14], // metric 6: long dash       ━━━  ━━━  ━━━
  [10, 10], // metric 7: short dash      ━ ━ ━ ━ ━ ━
  [30, 8, 10, 8], // metric 8: long-short      ━━━ ━ ━━━ ━
  [4, 10, 4, 10, 16, 10], // metric 9: dot-dot-dash    · · ━ · · ━
];

export function getDashPattern(metricIndex: number): number[] | undefined {
  if (metricIndex < METRIC_DASH_PATTERNS.length) {
    return METRIC_DASH_PATTERNS[metricIndex];
  }
  // For 10+ metrics, cycle through patterns 1-9 (skip solid)
  return METRIC_DASH_PATTERNS[((metricIndex - 1) % 9) + 1];
}
