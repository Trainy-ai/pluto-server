/**
 * Skeleton shown while a chart's data is fetching for the first time.
 * The "light gray panel + metric title + colored series pills + center
 * spinner" pattern used by <MultiLineChart>; <GroupedLineChart> renders
 * the same shape (no pills when the group set isn't known yet) so the
 * two chart variants don't visually diverge on first load.
 *
 * Refetches under TanStack's `keepPreviousData` keep the previous chart
 * visible and don't render this skeleton — it's purely the cold-load
 * placeholder.
 */
interface SeriesPill {
  /** Stable key for the pill (run id, group pathKey, etc.). */
  id: string;
  /** Display text (run name, group label). */
  label: string;
  /** Swatch color. */
  color?: string;
}

interface ChartLoadingSkeletonProps {
  /** Chart title shown at the top of the placeholder. */
  title?: string;
  /** Optional series pills (run / group names with color swatches).
   *  First 10 are shown; the rest collapse into a "+N more" tag. Omit
   *  for the grouped-chart cold-load case where the group set isn't
   *  resolved yet. */
  pills?: SeriesPill[];
}

export function ChartLoadingSkeleton({ title, pills }: ChartLoadingSkeletonProps) {
  return (
    <div className="relative flex h-full w-full flex-grow flex-col bg-accent/50">
      {title ? (
        <div className="p-3 text-center">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        </div>
      ) : null}
      {pills && pills.length > 0 ? (
        <div className="flex-1 overflow-hidden px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            {pills.slice(0, 10).map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span className="max-w-[120px] truncate text-muted-foreground">
                  {p.label}
                </span>
              </div>
            ))}
            {pills.length > 10 ? (
              <div className="rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                +{pills.length - 10} more
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
      </div>
    </div>
  );
}
