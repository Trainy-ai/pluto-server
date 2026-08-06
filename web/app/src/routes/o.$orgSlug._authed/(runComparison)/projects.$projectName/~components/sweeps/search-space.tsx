import { cn } from "@/lib/utils";

interface SearchSpaceProps {
  parameters?: Record<string, unknown>;
  /** Keys actually seen varying in the runs, when nothing was declared. */
  sweptKeys: string[];
  className?: string;
}

/**
 * The space the sweep was told to search.
 *
 * Without this the page shows what *was* tried but never what was *asked for* —
 * so you cannot tell a grid that finished from one that stopped a third of the
 * way through, or spot that a knob you meant to sweep was never in the config.
 *
 * Falls back to listing the observed keys when no space was declared, which is
 * the case for native runs logged before the SDK started stamping it.
 */
export function SearchSpace({ parameters, sweptKeys, className }: SearchSpaceProps) {
  const declared = parameters && Object.keys(parameters).length > 0;

  return (
    <div
      className={cn("overflow-hidden rounded-lg border", className)}
      data-testid="sweep-search-space"
    >
      <div className="border-b bg-muted/40 px-4 py-2">
        <h2 className="text-xs font-medium">Search space</h2>
      </div>

      {declared ? (
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(parameters).map(([key, spec]) => (
              <tr key={key} className="border-t first:border-t-0">
                <td className="w-1/3 px-4 py-2 font-mono text-xs">{key}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {describe(spec)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          This sweep did not record a search space. Varying parameters observed
          in its runs:{" "}
          <span className="font-mono text-foreground">
            {sweptKeys.length > 0 ? sweptKeys.join(", ") : "none"}
          </span>
        </div>
      )}
    </div>
  );
}

/** Render one parameter's spec the way it was declared. */
function describe(spec: unknown): string {
  if (!spec || typeof spec !== "object") {
    return String(spec);
  }
  const record = spec as Record<string, unknown>;

  if (Array.isArray(record.values)) {
    return record.values.map((v) => String(v)).join(", ");
  }
  if (record.min !== undefined || record.max !== undefined) {
    const distribution = typeof record.distribution === "string" ? ` (${record.distribution})` : "";
    return `${record.min ?? "?"} … ${record.max ?? "?"}${distribution}`;
  }
  if (record.value !== undefined) {
    // A pinned constant — wandb allows this to fix a parameter across the sweep.
    return `${String(record.value)} (fixed)`;
  }
  return JSON.stringify(record);
}
