/**
 * Run createdAt/updatedAt backfill tests.
 *
 * Migration tooling (pluto migrate) replays runs recorded on another
 * platform and passes the ORIGINAL creation time as `createdAt` on
 * POST /api/runs/create. The request schema always accepted the field,
 * but it was only applied to the project upsert — the run row silently
 * got `now()` from the Prisma default. These tests pin that the run row
 * itself honors client-supplied timestamps, and that runs created
 * without them still default to server time.
 *
 * Live-server tests (smoke conventions): need TEST_BASE_URL +
 * TEST_API_KEY, skipped otherwise. Run with: pnpm test:smoke
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const TEST_API_KEY = process.env.TEST_API_KEY || '';
const TEST_PROJECT_NAME = process.env.TEST_PROJECT_NAME || 'smoke-test-project';

const hasApiKey = TEST_API_KEY.length > 0;

// A fixed historical moment: 2020-09-13T12:26:40.000Z
const HISTORIC_CREATED_MS = 1600000000000;
const HISTORIC_UPDATED_MS = HISTORIC_CREATED_MS + 7_200_000; // +2h

async function createRun(body: Record<string, unknown>) {
  const response = await fetch(`${BASE_URL}/api/runs/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_API_KEY}`,
    },
    body: JSON.stringify({
      projectName: TEST_PROJECT_NAME,
      config: JSON.stringify({}),
      ...body,
    }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function getRunDetails(runId: number) {
  const response = await fetch(`${BASE_URL}/api/runs/details/${runId}`, {
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
  expect(response.status).toBe(200);
  return response.json();
}

describe.skipIf(!hasApiKey)('Run createdAt/updatedAt backfill', () => {
  it('honors client-supplied createdAt/updatedAt on the run row', async () => {
    const { runId } = await createRun({
      runName: `backfill-created-at-${Date.now()}`,
      createdAt: HISTORIC_CREATED_MS,
      updatedAt: HISTORIC_UPDATED_MS,
    });

    const details = await getRunDetails(runId);
    expect(new Date(details.createdAt).getTime()).toBe(HISTORIC_CREATED_MS);
    // updatedAt is @updatedAt in the schema: later writes bump it, but at
    // creation it must reflect the supplied value, never `now()`.
    expect(new Date(details.updatedAt).getTime()).toBe(HISTORIC_UPDATED_MS);
  });

  it('accepts createdAt without updatedAt', async () => {
    const before = Date.now();
    const { runId } = await createRun({
      runName: `backfill-created-only-${Date.now()}`,
      createdAt: HISTORIC_CREATED_MS,
    });

    const details = await getRunDetails(runId);
    expect(new Date(details.createdAt).getTime()).toBe(HISTORIC_CREATED_MS);
    // updatedAt falls back to server time
    expect(new Date(details.updatedAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('defaults to server time when no timestamps are supplied', async () => {
    const before = Date.now() - 1000; // small clock-skew allowance
    const { runId } = await createRun({
      runName: `backfill-default-time-${Date.now()}`,
    });

    const details = await getRunDetails(runId);
    const createdMs = new Date(details.createdAt).getTime();
    expect(createdMs).toBeGreaterThanOrEqual(before);
    expect(createdMs).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('stamps the implicit creation status event with the backfilled createdAt', async () => {
    const { runId } = await createRun({
      runName: `backfill-status-event-${Date.now()}`,
      createdAt: HISTORIC_CREATED_MS,
    });

    const response = await fetch(`${BASE_URL}/api/runs/status/history?runId=${runId}`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(response.status).toBe(200);
    const { events } = await response.json();
    const creationEvent = events.find(
      (e: { fromStatus: string | null }) => e.fromStatus === null,
    );
    expect(creationEvent).toBeDefined();
    expect(new Date(creationEvent.createdAt).getTime()).toBe(HISTORIC_CREATED_MS);
  });

  it('accepts epoch 0 as a createdAt timestamp', async () => {
    const { runId } = await createRun({
      runName: `backfill-epoch-zero-${Date.now()}`,
      createdAt: 0,
    });

    const details = await getRunDetails(runId);
    expect(new Date(details.createdAt).getTime()).toBe(0);
  });

  it('rejects out-of-range timestamps with a validation error, not a 500', async () => {
    const response = await fetch(`${BASE_URL}/api/runs/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({
        projectName: TEST_PROJECT_NAME,
        runName: `backfill-invalid-ts-${Date.now()}`,
        config: JSON.stringify({}),
        createdAt: 8.64e15 + 1, // beyond the max representable Date
      }),
    });
    expect(response.status).toBe(400);
  });

  it('resuming via externalId does not rewrite the original createdAt', async () => {
    const externalId = `backfill-ext-${Date.now()}`;
    const { runId } = await createRun({
      runName: `backfill-resume-${Date.now()}`,
      externalId,
      createdAt: HISTORIC_CREATED_MS,
    });

    // Same externalId -> resume path returns the existing run
    const resumed = await createRun({
      runName: 'ignored-on-resume',
      externalId,
      createdAt: HISTORIC_CREATED_MS + 999_999,
    });
    expect(resumed.runId).toBe(runId);

    const details = await getRunDetails(runId);
    expect(new Date(details.createdAt).getTime()).toBe(HISTORIC_CREATED_MS);
  });
});
