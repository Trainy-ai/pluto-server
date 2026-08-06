/**
 * Identify the rich media types that arrive as plain `.json`.
 *
 * wandb writes three things Pluto has to tell apart, and the filename can't
 * help: a migrated file is stored under a UUID, so wandb's own `.plotly.json` /
 * `.pts.json` suffixes are gone by the time we see it. Every one of them is
 * `fileType: "json"`. So we sniff the shape instead, which has the side benefit
 * of working for natively-logged files too, where no suffix convention exists.
 *
 * - **Plotly figures** — `{ data: [...], layout: {...} }`
 * - **matplotlib figures** — the *same* shape. wandb converts an mpl figure to
 *   a Plotly figure on log, so one viewer covers both. This is why mpl never
 *   rendered as an image: it isn't one.
 * - **3D point clouds** (`wandb.Object3D`) — a bare array of `[x, y, z]`
 *   triples, or width 4 (xyz + category) / 6 (xyz + rgb).
 */

export type MediaJsonKind = "plotly" | "point-cloud" | null;

/** A Plotly figure: an array of traces plus a layout. */
export interface PlotlyFigure {
  data: unknown[];
  layout?: Record<string, unknown>;
}

/**
 * Classify already-parsed JSON. Returns null for anything unrecognised, so the
 * caller keeps its existing raw-JSON rendering rather than guessing.
 */
export function detectMediaJson(parsed: unknown): MediaJsonKind {
  if (!parsed) return null;

  // Plotly: `data` must be an array of trace objects. A bare `{data: [...]}`
  // of numbers is not a figure, so require the first entry to be an object.
  if (
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as PlotlyFigure).data)
  ) {
    const first = (parsed as PlotlyFigure).data[0];
    if (first && typeof first === "object" && !Array.isArray(first)) return "plotly";
  }

  // Point cloud: [[x,y,z], ...]. wandb documents exactly three widths —
  // 3 (xyz), 4 (xyz + category), 6 (xyz + rgb) — so reject 5-column rows that
  // used to match a loose 3–6 range and open ordinary numeric matrices in the
  // cloud viewer. Sample beyond [0]: a jagged / mixed-type array whose first
  // row alone looked like a cloud must not classify as one.
  if (Array.isArray(parsed) && parsed.length > 0 && isPointCloudRows(parsed)) {
    return "point-cloud";
  }

  return null;
}

/** wandb Object3D point-row widths: xyz, xyz+category, xyz+rgb. */
const POINT_CLOUD_WIDTHS = new Set([3, 4, 6]);

function isPointCloudRows(rows: unknown[]): boolean {
  const first = rows[0];
  if (!Array.isArray(first) || !POINT_CLOUD_WIDTHS.has(first.length)) {
    return false;
  }
  const width = first.length;
  // Cap the scan: a million-point cloud should not cost a full pass just to
  // classify. First 32 + the last row catch both "looks fine at [0]" jagged
  // tails and truncated / mixed payloads.
  const sampleIdx = new Set<number>();
  const head = Math.min(rows.length, 32);
  for (let i = 0; i < head; i++) {
    sampleIdx.add(i);
  }
  sampleIdx.add(rows.length - 1);

  for (const i of sampleIdx) {
    const row = rows[i];
    if (
      !Array.isArray(row) ||
      row.length !== width ||
      !row.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Ceiling on text handed to `detectMediaJsonText`.
 *
 * Detection has to `JSON.parse` the whole document to see its shape, and that
 * is a synchronous, un-interruptible parse on the main thread — a large enough
 * artifact freezes the tab just for *guessing* whether it might be a chart. A
 * migrated wandb project ships dozens of multi-MB `.table.json` dumps whose
 * only outcome here is "not a figure", so the cap is what keeps them from
 * being parsed at all.
 *
 * Lives beside the function it bounds because both viewers guard the same call
 * and they used to disagree: the Files tab allowed 8MB and the metrics widget
 * 4MB, so a 6MB Plotly figure rendered as a chart on one page and as a wall of
 * raw text on the other. 8MB is the value that was already running in
 * production on the Files tab, so unifying upward keeps that working rather
 * than regressing it.
 *
 * Nothing this viewer renders is close: a Plotly/matplotlib figure is a few
 * hundred KB, and a point cloud past ~200k points is decimated by
 * PointCloudView anyway. Deliberately unrelated to the callers' own
 * MAX_DISPLAY_SIZE, which governs how much *text* is shown — a separate
 * question from whether the file is a figure.
 */
export const MAX_MEDIA_JSON_SIZE = 8 * 1024 * 1024;

/** Parse-and-classify in one step. Returns null when the text isn't JSON. */
export function detectMediaJsonText(text: string): { kind: MediaJsonKind; parsed: unknown } {
  try {
    const parsed = JSON.parse(text);
    return { kind: detectMediaJson(parsed), parsed };
  } catch {
    return { kind: null, parsed: null };
  }
}
