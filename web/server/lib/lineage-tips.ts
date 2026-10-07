/** Experiments mode lists one row per experiment: the TIP of each fork/merge
 *  lineage, i.e. a run that no other run in the same project continues.
 *  Ancestors are reached through the tip (charts and media stitch them in via
 *  `includeLineage`), so listing them as rows would double-count the
 *  experiment and let pagination split a lineage across pages.
 *
 *  Raw-SQL form for the listing paths that build `conditions` by hand; the
 *  outer query must alias the runs table as `r`. Backed by the
 *  `forkedFromRunId` index. */
export const LINEAGE_TIP_CONDITION = `NOT EXISTS (SELECT 1 FROM "runs" lc WHERE lc."forkedFromRunId" = r.id AND lc."projectId" = r."projectId")`;

export function buildLineageTipCondition(
  conditions: string[],
  lineageTipsOnly?: boolean,
): void {
  if (lineageTipsOnly) conditions.push(LINEAGE_TIP_CONDITION);
}
