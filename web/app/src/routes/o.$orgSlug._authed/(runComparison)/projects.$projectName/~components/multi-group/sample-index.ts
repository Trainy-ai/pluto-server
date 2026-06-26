/**
 * Pick which "chosen" index feeds {@link resolveSampleIndex} for a given run,
 * depending on whether the widget's sample steppers are linked.
 *
 *  - linked   → the single shared index (all runs lock-step to it)
 *  - unlinked → this run's own per-run index
 *
 * Either value may be `null` ("untouched"), which lets resolveSampleIndex fall
 * back to the pinned default.
 */
export function selectChosenIndex(
  linked: boolean,
  sharedIndex: number | null,
  perRunIndex: number | null,
): number | null {
  return linked ? sharedIndex : perRunIndex;
}

/**
 * Resolve which sample (image-array index) a comparison cell should display.
 *
 * Multi-sample-per-step logging (wandb-style `log({k: [img, img, ...]})`) gives
 * each (run, step) a list of images. The chosen index (shared when linked, or
 * per-run when unlinked) is sticky across step changes (no reset when you
 * scrub steps).
 *
 * Precedence:
 *   1. `chosenIndex` — this run's chosen index (null until they touch the arrows).
 *   2. `pinnedIndex` — a pin's remembered sample index for this widget, used as
 *      the pre-interaction default so cross-tab pin restore keeps working.
 *   3. `0` — first sample.
 *
 * The result is always clamped to `[0, sampleCount - 1]` (a run may expose fewer
 * samples at the current step than the shared index points at), and `0` when the
 * cell has no samples.
 */
export function resolveSampleIndex(
  chosenIndex: number | null,
  pinnedIndex: number | null,
  sampleCount: number,
): number {
  if (sampleCount <= 0) {
    return 0;
  }
  const raw = chosenIndex ?? pinnedIndex ?? 0;
  if (raw < 0) {
    return 0;
  }
  return Math.min(raw, sampleCount - 1);
}
