/** The run total the inline LEAF paginator should page over.
 *
 *  Both client-paginate modes (Pin-to-Top / Display-Only-Selected) load at most
 *  200 runs of a bucket (`limit: 200, offset: 0`) and reorder them client-side,
 *  so the paginator MUST cap at what's actually loaded (`orderedRuns.length`).
 *  Otherwise Pin renders phantom pages past the 200th run — `totalRuns` (the
 *  full `runs.count` for the bucket) can exceed the loaded window, and slicing
 *  `orderedRuns` beyond its length yields empty pages (the B8 bug). DOS already
 *  capped; this makes Pin behave the same (show the first 200; turn Pin off to
 *  page the whole bucket via normal server pagination).
 *
 *  When not client-paginating (`orderedRuns == null`), the server already
 *  sliced the page, so the real `totalRuns` is the correct paginator total. */
export function effectiveLeafRunTotal(
  orderedRuns: readonly unknown[] | null,
  totalRuns: number,
): number {
  return orderedRuns ? orderedRuns.length : totalRuns;
}
