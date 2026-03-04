import type { DisplayLogName } from "@/routes/o.$orgSlug._authed/(run)/projects.$projectName.$runId/~components/use-line-settings";

/** Map widget config xAxis string to DisplayLogName for MultiLineChart.
 *
 * Built-in values:
 *   "step"           → "Step"
 *   "time"           → "Absolute Time"  (legacy alias)
 *   "absolute-time"  → "Absolute Time"
 *   "relative-time"  → "Relative Time"
 *
 * Any other string is treated as a custom metric name (parametric curve).
 */
export function mapXAxisToDisplayLogName(xAxis: string): DisplayLogName {
  switch (xAxis) {
    case "step":
      return "Step";
    case "time":
    case "absolute-time":
      return "Absolute Time";
    case "relative-time":
      return "Relative Time";
    default:
      // Any other string is a custom metric name (parametric curve)
      return xAxis;
  }
}
