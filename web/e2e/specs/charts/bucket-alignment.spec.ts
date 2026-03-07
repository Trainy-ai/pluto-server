import { test, expect } from "@playwright/test";
import { navigateToFirstProject, waitForCharts } from "../../utils/test-helpers";

/**
 * E2E Tests for Bucket Alignment Across Runs
 *
 * Verifies that graphBatchBucketed responses use globally-aligned bucket
 * boundaries — all runs report the same step values for the same buckets.
 * This prevents tooltip flickering caused by null-padded series.
 */

const orgSlug = "smoke-test-org";

test.describe("Bucket alignment across runs", () => {
  test("batch bucketed responses have identical step values across runs", async ({
    page,
  }) => {
    const projectHref = await navigateToFirstProject(page, orgSlug);
    if (!projectHref) {
      test.skip();
      return;
    }

    // Collect graphBatchBucketed responses
    const batchResponses: Array<Record<string, Array<{ step: number }>>> = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (!url.includes("graphBatchBucketed") || response.status() !== 200) {
        return;
      }
      try {
        const body = await response.json();
        // tRPC batch response format: [{ result: { data: { json: ... } } }]
        // or direct result: { result: { data: { json: ... } } }
        const results = Array.isArray(body) ? body : [body];
        for (const entry of results) {
          const data = entry?.result?.data?.json;
          if (data && typeof data === "object" && !Array.isArray(data)) {
            batchResponses.push(data as Record<string, Array<{ step: number }>>);
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    await waitForCharts(page);

    // Wait a bit for batch queries to complete
    await page.waitForTimeout(3000);

    // We need at least one batch response with 2+ runs to verify alignment
    const multiRunResponses = batchResponses.filter((resp) => {
      const runIds = Object.keys(resp);
      return runIds.length >= 2;
    });

    if (multiRunResponses.length === 0) {
      // If no multi-run responses yet, select additional runs
      // Click "select all" checkbox in runs table
      const selectAll = page.locator('[aria-label="Toggle select all"]');
      if (await selectAll.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Clear existing responses
        batchResponses.length = 0;
        await selectAll.click();
        await waitForCharts(page, 15000);
        await page.waitForTimeout(3000);
      }
    }

    // Re-filter after possible selection
    const alignedResponses = batchResponses.filter((resp) => {
      const runIds = Object.keys(resp);
      return runIds.length >= 2;
    });

    // Skip if we can't get multi-run data (e.g. only 1 run in test data)
    if (alignedResponses.length === 0) {
      test.skip();
      return;
    }

    // For each batch response, verify step alignment
    for (const resp of alignedResponses) {
      const runIds = Object.keys(resp);
      const stepSets = runIds
        .map((id) => resp[id].map((pt) => pt.step))
        .filter((steps) => steps.length > 0);

      if (stepSets.length < 2) continue;

      // Find the overlapping step range across runs
      // Shorter runs may have fewer buckets but should share step values
      // within their range
      const allSteps = new Set(stepSets.flatMap((s) => s));

      for (const steps of stepSets) {
        for (const step of steps) {
          expect(allSteps.has(step)).toBe(true);
        }
      }

      // Stronger check: for runs that overlap, the step values at the same
      // bucket index should be identical
      const minLen = Math.min(...stepSets.map((s) => s.length));
      if (minLen > 1) {
        const referenceSteps = stepSets[0].slice(0, minLen);
        for (let i = 1; i < stepSets.length; i++) {
          const otherSteps = stepSets[i].slice(0, minLen);
          // Steps at the same bucket index should match (globally aligned)
          for (let j = 0; j < minLen; j++) {
            expect(
              referenceSteps[j],
              `Bucket ${j}: run ${runIds[0]} step=${referenceSteps[j]} vs run ${runIds[i]} step=${otherSteps[j]}`
            ).toBe(otherSteps[j]);
          }
        }
      }
    }
  });
});
