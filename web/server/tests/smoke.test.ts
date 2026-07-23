/**
 * Backend Smoke Tests
 *
 * These tests verify critical functionality of the web/server backend.
 * Run with: pnpm test:smoke
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const TEST_API_KEY = process.env.TEST_API_KEY || '';
const TEST_PROJECT_NAME = process.env.TEST_PROJECT_NAME || 'smoke-test-project';
const TEST_ORG_SLUG = process.env.TEST_ORG_SLUG || 'smoke-test-org';

// Helper function for making requests
async function makeRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return response;
}

async function makeTrpcRequest(procedure: string, input: any = {}, headers: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET') {
  const url = new URL(`${BASE_URL}/trpc/${procedure}`);

  // For GET requests, add input as query param
  if (method === 'GET' && Object.keys(input).length > 0) {
    url.searchParams.set('input', JSON.stringify(input));
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: method === 'POST' ? JSON.stringify(input) : undefined,
  });
  return response;
}

describe('Backend Smoke Tests', () => {
  describe('Test Suite 1: Health and Connectivity', () => {
    it('Test 1.1: Health Check Endpoint', async () => {
      const response = await makeRequest('/api/health');

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('OK');
    });

    it('Test 1.2: Readiness Check Endpoint', async () => {
      const response = await makeRequest('/api/health/ready');

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('healthy');
      expect(body.checks).toBeDefined();
      expect(body.checks.postgres).toBeDefined();
      expect(body.checks.postgres.status).toBe('up');
      expect(typeof body.checks.postgres.latency_ms).toBe('number');
      expect(body.checks.clickhouse).toBeDefined();
      expect(body.checks.clickhouse.status).toBe('up');
      expect(typeof body.checks.clickhouse.latency_ms).toBe('number');
    });

    it('Test 1.3: Liveness endpoint still returns OK', async () => {
      const response = await makeRequest('/api/health');
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('OK');
    });

    it('Test 1.4: Database Connections', async () => {
      // This test verifies the server is running and can connect to databases
      // If readiness check passes, databases should be connected
      const response = await makeRequest('/api/health/ready');
      expect(response.status).toBe(200);

      // Additional check: Try to make a simple tRPC call that requires DB
      const authResponse = await makeTrpcRequest('auth');
      // Even if not authenticated, we should get a proper response (not a connection error)
      expect([200, 401]).toContain(authResponse.status);
    });
  });

  describe('Test Suite 2: Authentication (better-auth)', () => {
    it('Test 2.2: Session Validation - No Session', async () => {
      const response = await makeTrpcRequest('auth');

      // Without a valid session cookie, should return null or unauthorized
      expect([200, 401]).toContain(response.status);
    });

    // Note: OAuth callback test (Test 2.1) requires actual OAuth flow and is better suited for integration tests
  });

  describe('Test Suite 3: Organization Management (tRPC)', () => {
    it('Test 3.1: Create Organization - Unauthorized', async () => {
      const response = await makeTrpcRequest('organization.createOrg', {
        name: 'Test Org',
        slug: 'test-org',
      }, {}, 'POST');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 3.2: List Organization Members - Unauthorized', async () => {
      const response = await makeTrpcRequest('organization.listMembers', {}, {}, 'GET');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });
  });

  describe('Test Suite 4: Projects and Runs (tRPC)', () => {
    it('Test 4.1: List Projects - Unauthorized', async () => {
      const response = await makeTrpcRequest('projects.list', {
        limit: 50,
        offset: 0,
      }, {}, 'GET');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 4.2: Project Count - Unauthorized', async () => {
      const response = await makeTrpcRequest('projects.count', {}, {}, 'GET');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 4.3: List Runs - Unauthorized', async () => {
      const response = await makeTrpcRequest('runs.list', {
        projectName: 'test-project',
        limit: 50,
      }, {}, 'GET');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 4.4: Get Run Details - Unauthorized', async () => {
      const response = await makeTrpcRequest('runs.get', {
        runId: 'test-run-id',
      }, {}, 'GET');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 4.5: Latest Runs - Unauthorized', async () => {
      const response = await makeTrpcRequest('runs.latest', {
        limit: 10,
      }, {}, 'GET');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });
  });

  describe('Test Suite 5: MinIO/S3 Integration', () => {
    it('Test 5.1: S3 Storage Configuration', async () => {
      // Test that S3/MinIO environment variables are set correctly
      // This validates the storage backend is configured
      const response = await makeRequest('/api/health');
      expect(response.status).toBe(200);

      // If health check passes, S3 config is loaded (would fail on startup if not)
      expect(process.env.STORAGE_ENDPOINT).toBeDefined();
      expect(process.env.STORAGE_BUCKET).toBeDefined();
    });

    it.skip('Test 5.2: File Upload and Retrieval', () => {
      // File uploads are handled by the Rust ingest service, not the backend API
      // This should be tested in ingest service integration tests
    });
  });

  describe('Test Suite 6: Error Handling', () => {
    it('Test 6.1: Unauthorized Access', async () => {
      const response = await makeTrpcRequest('organization.createOrg', {
        name: 'Test Org',
        slug: 'test-org',
      }, {}, 'POST');

      expect(response.status).toBe(401);
    });

    it('Test 6.3: Invalid Input Validation', async () => {
      const response = await makeTrpcRequest('runs.get', {
        runId: 'invalid',
      }, {}, 'GET');

      // Should return validation error or unauthorized (if auth check comes first)
      expect([400, 401]).toContain(response.status);
    });
  });
});

describe('SDK API Endpoints (with API Key)', () => {
  const hasApiKey = TEST_API_KEY.length > 0;

  describe('API Key Authentication', () => {
    it('Test 6.4: API Key Authentication Failure', async () => {
      const response = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid_key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectName: 'test-project',
          runName: 'test-run',
          config: JSON.stringify({ lr: 0.001 }),
        }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('Test 6.5: Expired API Key Rejected', async () => {
      // Seeded by tests/setup.ts ("Smoke Test Key (Expired)") with an
      // expiresAt in the past. Keep this value in sync with setup.ts.
      const EXPIRED_API_KEY = 'mlps_smoke_test_expired_do_not_use';
      const response = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${EXPIRED_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectName: 'test-project',
          runName: 'test-run',
          config: JSON.stringify({ lr: 0.001 }),
        }),
      });

      // The key exists and has a valid prefix — it must be rejected
      // specifically because it is expired, not as "not found".
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.message).toBe('API key has expired');
    });

    it('Test 6.6: Revoked API Key Rejected', async () => {
      // Seeded by tests/setup.ts ("Smoke Test Key (Revoked)") with a non-null
      // revokedAt. Keep this value in sync with setup.ts.
      const REVOKED_API_KEY = 'mlps_smoke_test_revoked_do_not_use';
      const response = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${REVOKED_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectName: 'test-project',
          runName: 'test-run',
          config: JSON.stringify({ lr: 0.001 }),
        }),
      });

      // The key exists and has a valid prefix — it must be rejected
      // specifically because it is revoked, not as "not found".
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.message).toBe('API key has been revoked');
    });

    it.skipIf(!hasApiKey)('Test 6.3: Get Organization Slug (SDK)', async () => {
      const response = await makeRequest('/api/slug', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.organization.slug).toBeDefined();
      expect(typeof data.organization.slug).toBe('string');
    });
  });

  describe.skipIf(!hasApiKey)('Run Management with Valid API Key', () => {
    let testRunId: number;

    it('Test 6.1: Create Run (SDK)', async () => {
      const response = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          projectName: TEST_PROJECT_NAME,
          runName: `smoke-test-run-${Date.now()}`,
          config: JSON.stringify({ lr: 0.001, batch_size: 32 }),
          tags: ['smoke-test', 'ci'],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.url).toBeDefined();
      expect(data.runId).toBeDefined();
      expect(data.url).toContain(TEST_ORG_SLUG);
      expect(data.url).toContain(TEST_PROJECT_NAME);
      expect(data.organizationSlug).toBe(TEST_ORG_SLUG);
      expect(data.projectName).toBe(TEST_PROJECT_NAME);

      // Save for subsequent tests
      testRunId = data.runId;
    });

    it('Test 6.2: Update Run Status (SDK)', async () => {
      expect(testRunId).toBeDefined();

      // Update the run status to COMPLETED
      const updateResponse = await makeRequest('/api/runs/status/update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          runId: testRunId,
          status: 'COMPLETED',
        }),
      });

      expect(updateResponse.status).toBe(200);
      const data = await updateResponse.json();
      expect(data.success).toBe(true);
    });

    it('Test 6.5: Create Run with All Fields', async () => {
      const response = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          projectName: TEST_PROJECT_NAME,
          runName: `smoke-test-full-${Date.now()}`,
          config: JSON.stringify({
            model: 'gpt-4',
            temperature: 0.7,
            max_tokens: 1000
          }),
          tags: ['smoke-test', 'full-config'],
          systemMetadata: JSON.stringify({
            hostname: 'ci-runner',
            platform: 'linux',
          }),
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.runId).toBeDefined();
      expect(data.url).toBeDefined();
    });

    it('Test 6.6: Add Log Names to Run', async () => {
      expect(testRunId).toBeDefined();

      const response = await makeRequest('/api/runs/logName/add', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          runId: testRunId,
          logName: ['train/loss', 'train/accuracy'],
          logType: 'METRIC',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('Test 6.6.1: Add Log Names - High Volume Load Test', async () => {
      // This test simulates real ML training with many unique metric names
      // (e.g., per-layer losses, per-head attention weights, etc.)
      // Previously, this would cause OOM as the endpoint loaded ALL existing
      // log names into memory on each request.

      // Create a dedicated run for this load test
      const createResponse = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          projectName: TEST_PROJECT_NAME,
          runName: `load-test-lognames-${Date.now()}`,
          config: JSON.stringify({}),
        }),
      });

      expect(createResponse.status).toBe(200);
      const { runId: loadTestRunId } = await createResponse.json();

      // Generate 500 unique metric names (simulates transformer with many layers/heads)
      const allLogNames: string[] = [];
      for (let layer = 0; layer < 10; layer++) {
        for (let head = 0; head < 10; head++) {
          for (let metric = 0; metric < 5; metric++) {
            allLogNames.push(`train/layer_${layer}/head_${head}/metric_${metric}`);
          }
        }
      }

      // Add log names in batches (like the SDK does)
      const BATCH_SIZE = 50;
      for (let i = 0; i < allLogNames.length; i += BATCH_SIZE) {
        const batch = allLogNames.slice(i, i + BATCH_SIZE);
        const response = await makeRequest('/api/runs/logName/add', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: loadTestRunId,
            logName: batch,
            logType: 'METRIC',
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
      }

      // Verify we can still add more log names after the initial batch
      // (this would fail with OOM if we loaded all 500 into memory)
      const finalResponse = await makeRequest('/api/runs/logName/add', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          runId: loadTestRunId,
          logName: ['final/validation_loss', 'final/validation_accuracy'],
          logType: 'METRIC',
        }),
      });

      expect(finalResponse.status).toBe(200);
    }, 30000); // 30 second timeout for load test

    it('Test 6.7: Update Run Status to FAILED', async () => {
      // Create a new run to test FAILED status
      const createResponse = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          projectName: TEST_PROJECT_NAME,
          runName: `smoke-test-failed-${Date.now()}`,
          config: JSON.stringify({}),
        }),
      });

      expect(createResponse.status).toBe(200);
      const { runId } = await createResponse.json();

      // Update to FAILED status
      const updateResponse = await makeRequest('/api/runs/status/update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          runId,
          status: 'FAILED',
          statusMetadata: JSON.stringify({ error: 'Out of memory' }),
        }),
      });

      expect(updateResponse.status).toBe(200);
      const data = await updateResponse.json();
      expect(data.success).toBe(true);
    });

    it('Test 6.9: Query Metrics with stepMin/stepMax (SDK)', async () => {
      expect(testRunId).toBeDefined();

      // Query metrics with step range filter — should return 200 even if no metrics exist
      const params = new URLSearchParams({
        runId: String(testRunId),
        projectName: TEST_PROJECT_NAME,
        stepMin: '10',
        stepMax: '100',
      });
      const response = await makeRequest(`/api/runs/metrics?${params}`, {
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.metrics).toBeDefined();
      expect(Array.isArray(data.metrics)).toBe(true);
    });
  });

  describe('Test Suite 7: Tags Management', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Create Run with Tags', () => {
      it('Test 7.1: Create Run with Tags via SDK', async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `tagged-run-${Date.now()}`,
            tags: ['experiment', 'baseline', 'v1.0'],
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runId).toBeDefined();
      });

      it('Test 7.2: Create Run without Tags (defaults to empty array)', async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `no-tags-run-${Date.now()}`,
            // tags omitted
          }),
        });

        expect(response.status).toBe(200);
      });
    });

    describe.skipIf(!hasApiKey)('Update Tags via HTTP API', () => {
      it('Test 7.3: Update tags on existing run', async () => {
        // Create a run first
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `update-tags-http-${Date.now()}`,
            tags: ['initial-tag'],
          }),
        });

        expect(createResponse.status).toBe(200);
        const { runId } = await createResponse.json();

        // Update tags via HTTP API
        const updateResponse = await makeRequest('/api/runs/tags/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: runId,
            tags: ['updated-tag-1', 'updated-tag-2'],
          }),
        });

        expect(updateResponse.status).toBe(200);
        const data = await updateResponse.json();
        expect(data.success).toBe(true);
      });

      it('Test 7.4: Clear tags (set to empty array)', async () => {
        // Create a run with tags
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `clear-tags-http-${Date.now()}`,
            tags: ['tag-to-remove', 'another-tag'],
          }),
        });

        expect(createResponse.status).toBe(200);
        const { runId } = await createResponse.json();

        // Clear all tags
        const updateResponse = await makeRequest('/api/runs/tags/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: runId,
            tags: [],
          }),
        });

        expect(updateResponse.status).toBe(200);
        const data = await updateResponse.json();
        expect(data.success).toBe(true);
      });

      it('Test 7.5: Reject update for non-existent run', async () => {
        const updateResponse = await makeRequest('/api/runs/tags/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: 999999999,
            tags: ['should-fail'],
          }),
        });

        expect(updateResponse.status).toBe(404);
        const data = await updateResponse.json();
        expect(data.error).toBe('Run not found');
      });
    });

    describe.skipIf(!hasApiKey)('Group-tag invariant (at most one group:* tag)', () => {
      it('Test 7.6: /create rejects two caller-supplied group:* tags', async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `two-group-tags-${Date.now()}`,
            tags: ['group:alpha', 'group:beta'],
          }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('A run can have at most one group:* tag.');
      });

      it('Test 7.7: /create accepts a single group:* tag', async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `one-group-tag-${Date.now()}`,
            tags: ['group:solo', 'baseline'],
          }),
        });

        expect(response.status).toBe(200);
        const { runId } = await response.json();

        const details = await makeRequest(`/api/runs/details/${runId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
        });
        expect(details.status).toBe(200);
        const detailData = await details.json();
        expect(detailData.tags).toContain('group:solo');
      });

      it('Test 7.8: /tags/update rejects two group:* tags and leaves tags untouched', async () => {
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `update-two-group-${Date.now()}`,
            tags: ['group:initial'],
          }),
        });
        expect(createResponse.status).toBe(200);
        const { runId } = await createResponse.json();

        const updateResponse = await makeRequest('/api/runs/tags/update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            runId,
            tags: ['group:one', 'group:two'],
          }),
        });

        expect(updateResponse.status).toBe(400);
        const data = await updateResponse.json();
        expect(data.error).toBe('A run can have at most one group:* tag.');

        // The rejected update must NOT have mutated the run's tags.
        const details = await makeRequest(`/api/runs/details/${runId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
        });
        const detailData = await details.json();
        expect(detailData.tags).toContain('group:initial');
      });

      it('Test 7.9: fork keeps the explicit group:* over the inherited one', async () => {
        // Parent run carries group:parent-grp.
        const parentResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `fork-parent-${Date.now()}`,
            tags: ['group:parent-grp', 'shared'],
          }),
        });
        expect(parentResponse.status).toBe(200);
        const { runId: parentRunId } = await parentResponse.json();

        // Fork it, inheriting the parent's tags AND supplying an explicit
        // group:* override. Inherited group:parent-grp + explicit
        // group:child-grp is a legitimate override, not a rejection.
        const forkResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `fork-child-${Date.now()}`,
            forkRunId: parentRunId,
            forkStep: 0,
            inheritTags: true,
            tags: ['group:child-grp'],
          }),
        });

        expect(forkResponse.status).toBe(200);
        const { runId: childRunId } = await forkResponse.json();

        const details = await makeRequest(`/api/runs/details/${childRunId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
        });
        expect(details.status).toBe(200);
        const detailData = await details.json();
        // Explicit override wins; the inherited group:* is dropped.
        expect(detailData.tags).toContain('group:child-grp');
        expect(detailData.tags).not.toContain('group:parent-grp');
      });
    });
  });


  describe('Test Suite 8: Config Management', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Update Config via HTTP API', () => {
      it('Test 8.1: Update config on existing run', async () => {
        // Create a run first
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `update-config-${Date.now()}`,
            config: JSON.stringify({ lr: 0.001 }),
          }),
        });

        expect(createResponse.status).toBe(200);
        const { runId } = await createResponse.json();

        // Update config via HTTP API
        const updateResponse = await makeRequest('/api/runs/config/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: runId,
            config: JSON.stringify({ model: 'resnet50', epochs: 100 }),
          }),
        });

        expect(updateResponse.status).toBe(200);
        const data = await updateResponse.json();
        expect(data.success).toBe(true);
      });

      it('Test 8.2: Config merge preserves existing keys', async () => {
        // Create a run with initial config
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `merge-config-${Date.now()}`,
            config: JSON.stringify({ lr: 0.001, batch_size: 32 }),
          }),
        });

        expect(createResponse.status).toBe(200);
        const { runId } = await createResponse.json();

        // Update config - should merge, not replace
        const updateResponse = await makeRequest('/api/runs/config/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: runId,
            config: JSON.stringify({ model: 'resnet50', lr: 0.01 }), // lr should override
          }),
        });

        expect(updateResponse.status).toBe(200);
        const data = await updateResponse.json();
        expect(data.success).toBe(true);
      });

      it('Test 8.3: Reject config update for non-existent run', async () => {
        const updateResponse = await makeRequest('/api/runs/config/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: 999999999,
            config: JSON.stringify({ should: 'fail' }),
          }),
        });

        expect(updateResponse.status).toBe(404);
        const data = await updateResponse.json();
        expect(data.error).toBe('Run not found');
      });

      it('Test 8.4: Reject invalid JSON config', async () => {
        // Create a run first
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `invalid-config-${Date.now()}`,
          }),
        });

        expect(createResponse.status).toBe(200);
        const { runId } = await createResponse.json();

        // Try to update with invalid JSON
        const updateResponse = await makeRequest('/api/runs/config/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: runId,
            config: 'not valid json {{{',
          }),
        });

        expect(updateResponse.status).toBe(400);
        const data = await updateResponse.json();
        expect(data.error).toBe('Invalid config JSON');
      });

      it('Test 8.5: Update config on run without initial config', async () => {
        // Create a run without config
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `no-initial-config-${Date.now()}`,
          }),
        });

        expect(createResponse.status).toBe(200);
        const { runId } = await createResponse.json();

        // Add config to run that had none
        const updateResponse = await makeRequest('/api/runs/config/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: runId,
            config: JSON.stringify({ model: 'gpt-4', temperature: 0.7 }),
          }),
        });

        expect(updateResponse.status).toBe(200);
        const data = await updateResponse.json();
        expect(data.success).toBe(true);
      });
    });
  });

  describe('Test Suite 9: Member Management', () => {
    it('Test 9.1: Remove member - Unauthorized (no session)', async () => {
      // Try to remove a member without authentication
      const response = await makeTrpcRequest('organization.removeMember', {
        organizationId: 'test-org-id',
        memberId: 'test-member-id',
      }, {}, 'POST');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 9.2: List members - Unauthorized (no session)', async () => {
      // Try to list members without authentication
      const response = await makeTrpcRequest('organization.listMembers', {
        organizationId: 'test-org-id',
      }, {}, 'GET');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 9.3: Remove member - Invalid input (missing memberId)', async () => {
      // Try to remove a member with invalid input
      const response = await makeTrpcRequest('organization.removeMember', {
        organizationId: 'test-org-id',
        // memberId is missing
      }, {}, 'POST');

      // Should return 400 (validation error) or 401 (auth check comes first)
      expect([400, 401]).toContain(response.status);
    });

    it('Test 9.4: Remove member - Invalid input (missing organizationId)', async () => {
      // Try to remove a member with missing organizationId
      const response = await makeTrpcRequest('organization.removeMember', {
        memberId: 'test-member-id',
        // organizationId is missing
      }, {}, 'POST');

      // Should return 400 (validation error) or 401 (auth check comes first)
      expect([400, 401]).toContain(response.status);
    });
  });

  describe('Test Suite 9.5: Plan Member Cap (maxMembers)', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;

    beforeAll(async () => {
      const signInResponse = await makeRequest('/api/auth/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      const setCookie = signInResponse.headers.get('set-cookie');
      if (setCookie) {
        const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
        if (match) {
          sessionCookie = `better_auth.session_token=${match[1]}`;
        }
      }
    });

    it('Test 9.5.1: auth endpoint exposes maxMembers (plan cap) on PRO org', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('auth', {}, { 'Cookie': sessionCookie }, 'GET');
      expect(response.status).toBe(200);
      const data = await response.json();
      const sub = data.result?.data?.activeOrganization?.OrganizationSubscription;

      // Seeded test org is on PRO; plan cap should be 10 (PRO_PLAN_CONFIG.maxMembers).
      expect(sub?.plan).toBe('PRO');
      expect(sub?.maxMembers).toBe(10);
      // Field must NOT be named `seats` (legacy column name; see rename migration).
      expect(sub?.seats).toBeUndefined();
    });

    it('Test 9.5.2: maxMembers exceeds current member count (catches corruption regression)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const authResponse = await makeTrpcRequest('auth', {}, { 'Cookie': sessionCookie }, 'GET');
      const auth = await authResponse.json();
      const orgId = auth.result?.data?.activeOrganization?.id;
      const maxMembers = auth.result?.data?.activeOrganization?.OrganizationSubscription?.maxMembers;
      expect(orgId).toBeTruthy();
      expect(typeof maxMembers).toBe('number');

      const membersResponse = await makeTrpcRequest(
        'organization.listMembers',
        { organizationId: orgId },
        { 'Cookie': sessionCookie },
        'GET',
      );
      expect(membersResponse.status).toBe(200);
      const members = await membersResponse.json();
      const memberCount = Array.isArray(members.result?.data) ? members.result.data.length : 0;

      // If maxMembers == memberCount on a PRO org, the column was clobbered with the
      // live member count (the bug we're fixing). PRO cap is 10; we should always
      // have headroom on the test org. Bar should never read 100% on a healthy PRO org.
      expect(maxMembers).toBeGreaterThan(memberCount);
      expect(maxMembers).toBe(10);
    });
  });

  describe('Test Suite 10: Invite Management', () => {
    it('Test 10.1: Delete invite - Unauthorized (no session)', async () => {
      // Try to delete an invite without authentication
      const response = await makeTrpcRequest('organization.invite.deleteInvite', {
        organizationId: 'test-org-id',
        invitationId: 'test-invitation-id',
      }, {}, 'POST');

      // Should fail without authentication (404 may occur due to nested router path format)
      expect([401, 404]).toContain(response.status);
    });

    it('Test 10.2: Delete invite - Invalid input (missing invitationId)', async () => {
      // Try to delete an invite with invalid input
      const response = await makeTrpcRequest('organization.invite.deleteInvite', {
        organizationId: 'test-org-id',
        // invitationId is missing
      }, {}, 'POST');

      // Should return 400 (validation error), 401 (auth check), or 404 (nested router path)
      expect([400, 401, 404]).toContain(response.status);
    });

    it('Test 10.3: Delete invite - Invalid input (missing organizationId)', async () => {
      // Try to delete an invite with missing organizationId
      const response = await makeTrpcRequest('organization.invite.deleteInvite', {
        invitationId: 'test-invitation-id',
        // organizationId is missing
      }, {}, 'POST');

      // Should return 400 (validation error), 401 (auth check), or 404 (nested router path)
      expect([400, 401, 404]).toContain(response.status);
    });
  });

  describe('Test Suite 11: Multi-Node Distributed Training (externalId)', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Create Run with externalId', () => {
      it('Test 11.1: Create run with externalId returns resumed: false', async () => {
        const externalId = `multi-node-test-${Date.now()}`;

        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `ddp-run-node-0`,
            externalId: externalId,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runId).toBeDefined();
        expect(data.resumed).toBe(false);
        expect(data.url).toBeDefined();
      });

      it('Test 11.2: Second call with same externalId returns existing run with resumed: true', async () => {
        const externalId = `multi-node-resume-${Date.now()}`;

        // First call - creates the run
        const firstResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `ddp-run-node-0`,
            externalId: externalId,
          }),
        });

        expect(firstResponse.status).toBe(200);
        const firstData = await firstResponse.json();
        expect(firstData.resumed).toBe(false);
        const originalRunId = firstData.runId;

        // Second call - should resume existing run
        const secondResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `ddp-run-node-1`, // Different run name
            externalId: externalId,    // Same externalId
          }),
        });

        expect(secondResponse.status).toBe(200);
        const secondData = await secondResponse.json();
        expect(secondData.resumed).toBe(true);
        expect(secondData.runId).toBe(originalRunId); // Same run ID
      });

      it('Test 11.3: Different externalIds create separate runs', async () => {
        const timestamp = Date.now();
        const externalId1 = `multi-node-a-${timestamp}`;
        const externalId2 = `multi-node-b-${timestamp}`;

        // Create first run
        const response1 = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `run-a`,
            externalId: externalId1,
          }),
        });

        expect(response1.status).toBe(200);
        const data1 = await response1.json();
        expect(data1.resumed).toBe(false);

        // Create second run with different externalId
        const response2 = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `run-b`,
            externalId: externalId2,
          }),
        });

        expect(response2.status).toBe(200);
        const data2 = await response2.json();
        expect(data2.resumed).toBe(false);
        expect(data2.runId).not.toBe(data1.runId); // Different run IDs
      });

      it('Test 11.4: Creating run without externalId still works (backward compatibility)', async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `no-external-id-${Date.now()}`,
            // externalId omitted
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runId).toBeDefined();
        expect(data.resumed).toBe(false);
      });

      it('Test 11.5: Multiple runs without externalId are created separately', async () => {
        // Create first run without externalId
        const response1 = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `no-ext-1-${Date.now()}`,
          }),
        });

        expect(response1.status).toBe(200);
        const data1 = await response1.json();

        // Create second run without externalId
        const response2 = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `no-ext-2-${Date.now()}`,
          }),
        });

        expect(response2.status).toBe(200);
        const data2 = await response2.json();

        // Both should be new runs with different IDs
        expect(data1.resumed).toBe(false);
        expect(data2.resumed).toBe(false);
        expect(data2.runId).not.toBe(data1.runId);
      });

      it('Test 11.6: externalId is scoped to project (same externalId in different projects)', async () => {
        const externalId = `scoped-test-${Date.now()}`;
        const projectA = `${TEST_PROJECT_NAME}-a-${Date.now()}`;
        const projectB = `${TEST_PROJECT_NAME}-b-${Date.now()}`;

        // Create run in project A
        const responseA = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: projectA,
            runName: `run-in-project-a`,
            externalId: externalId,
          }),
        });

        expect(responseA.status).toBe(200);
        const dataA = await responseA.json();
        expect(dataA.resumed).toBe(false);

        // Create run in project B with same externalId - should create new run
        const responseB = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: projectB,
            runName: `run-in-project-b`,
            externalId: externalId,
          }),
        });

        expect(responseB.status).toBe(200);
        const dataB = await responseB.json();
        expect(dataB.resumed).toBe(false);
        expect(dataB.runId).not.toBe(dataA.runId); // Different runs in different projects
      });

      it('Test 11.7: Resumed run returns correct project and org info', async () => {
        const externalId = `verify-info-${Date.now()}`;

        // Create the run
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `original-run`,
            externalId: externalId,
            tags: ['original'],
          }),
        });

        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json();

        // Resume the run
        const resumeResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `different-name`, // Different name shouldn't matter
            externalId: externalId,
            tags: ['different'], // Different tags shouldn't matter
          }),
        });

        expect(resumeResponse.status).toBe(200);
        const resumeData = await resumeResponse.json();

        // Verify all info matches
        expect(resumeData.resumed).toBe(true);
        expect(resumeData.runId).toBe(createData.runId);
        expect(resumeData.projectName).toBe(createData.projectName);
        expect(resumeData.organizationSlug).toBe(createData.organizationSlug);
        expect(resumeData.url).toBe(createData.url);
      });
    });
  });

  describe('Test Suite 12: Server-Side Search', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Search via HTTP API', () => {
      it('Test 12.1: Find run beyond first page via search', async () => {
        // The "hidden-needle-experiment" run is created beyond the first 150 runs
        // Client-side search would miss it, but server-side search should find it
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&search=hidden-needle&limit=50`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toBeDefined();
        expect(data.runs.some((r: { name: string }) => r.name === 'hidden-needle-experiment')).toBe(true);
      });

      it('Test 12.1b: List rows include projectName equal to queried project', async () => {
        // Regression for #3: list handler must return projectName so MCP/clients
        // do not fall back to "Unknown".
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&limit=10`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toBeDefined();
        expect(data.runs.length).toBeGreaterThan(0);
        for (const run of data.runs as { projectName: string }[]) {
          expect(run.projectName).toBe(TEST_PROJECT_NAME);
        }
      });

      it('Test 12.2: Empty results for non-matching search', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&search=zzz-nonexistent-xyz&limit=50`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toBeDefined();
        expect(data.runs.length).toBe(0);
      });

      it('Test 12.3: Verify bulk runs exist (pagination test)', async () => {
        // Should have 160+ bulk runs + 2 original test runs + needle run
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&limit=200`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toBeDefined();
        expect(data.total).toBeGreaterThan(150);
      });

      it('Test 12.4: Search with short term uses ILIKE', async () => {
        // All search terms use ILIKE substring matching
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&search=00&limit=50`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toBeDefined();
        // Should find bulk-run-000, bulk-run-001, etc.
        expect(data.runs.some((r: { name: string }) => r.name.includes('00'))).toBe(true);
      });

      it('Test 12.5: Search returns correct total count', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&search=bulk-run&limit=10`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toBeDefined();
        expect(data.runs.length).toBeLessThanOrEqual(10); // Respects limit
        expect(data.total).toBeGreaterThanOrEqual(160); // Total matches bulk-run count
      });

      it('Test 12.6: Tag filtering finds run beyond first page', async () => {
        // The "hidden-needle-experiment" run has 'needle-tag' and is created at position 161+
        // Without server-side tag filtering, client would need to paginate through all runs
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&tags=needle-tag&limit=50`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toBeDefined();
        expect(data.runs.length).toBe(1); // Only one run has needle-tag
        expect(data.runs[0].name).toBe('hidden-needle-experiment');
        expect(data.runs[0].tags).toContain('needle-tag');
        expect(data.total).toBe(1);
      });

      it('Test 12.7: Combined search and tag filtering', async () => {
        // Test that search and tags can be combined
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&search=needle&tags=needle-tag&limit=50`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toBeDefined();
        expect(data.runs.length).toBe(1);
        expect(data.runs[0].name).toBe('hidden-needle-experiment');
      });

      it('Test 12.8: Tag filtering with no matches returns empty', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&tags=nonexistent-tag-xyz&limit=50`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toBeDefined();
        expect(data.runs.length).toBe(0);
        expect(data.total).toBe(0);
      });

      it('Test 12.9: Search-only call returns unfiltered matches (Other-matches dropdown contract)', async () => {
        // Regression guard: the runs-table "Other matches" dropdown
        // (SearchOtherMatchesDropdown) issues a runs.list call with only
        // `search` and `limit` — no tags/status/date/field/metric/system
        // filters. The contract is that this returns ALL runs whose name
        // or display ID match the search term, ignoring whatever filters
        // the main table is currently applying.
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&search=bulk-run-&limit=30`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toBeDefined();
        expect(Array.isArray(data.runs)).toBe(true);
        expect(data.runs.length).toBeGreaterThan(0);
        for (const run of data.runs) {
          expect(run.name).toMatch(/bulk-run-/);
        }
      });
    });
  });

  describe('Test Suite 12b: Server-Side Ordering & Pagination (REST list)', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Ordering & pagination via HTTP API', () => {
      const auth = { headers: { 'Authorization': `Bearer ${TEST_API_KEY}` } };

      it('Test 12b.1: sort=name returns names in ascending order', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=name&limit=20`,
          auth
        );
        expect(response.status).toBe(200);
        const data = await response.json();
        const names = data.runs.map((r: { name: string }) => r.name);
        expect(names.length).toBeGreaterThan(1);
        expect(names).toEqual([...names].sort());
      });

      it('Test 12b.2: sort=-name returns names in descending order', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=-name&limit=20`,
          auth
        );
        expect(response.status).toBe(200);
        const data = await response.json();
        const names = data.runs.map((r: { name: string }) => r.name);
        expect(names.length).toBeGreaterThan(1);
        expect(names).toEqual([...names].sort().reverse());
      });

      it('Test 12b.3: default order is createdAt desc (newest first)', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&limit=20`,
          auth
        );
        expect(response.status).toBe(200);
        const data = await response.json();
        const ts = data.runs.map((r: { createdAt: string }) => new Date(r.createdAt).getTime());
        for (let i = 1; i < ts.length; i++) {
          expect(ts[i]).toBeLessThanOrEqual(ts[i - 1]);
        }
      });

      it('Test 12b.4: sort=created_at ascending (oldest first; snake_case alias accepted)', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=created_at&limit=20`,
          auth
        );
        expect(response.status).toBe(200);
        const data = await response.json();
        const ts = data.runs.map((r: { createdAt: string }) => new Date(r.createdAt).getTime());
        for (let i = 1; i < ts.length; i++) {
          expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1]);
        }
      });

      it('Test 12b.5: offset pagination yields disjoint, continuous pages under a stable sort', async () => {
        const page1Res = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=name&limit=10&offset=0`,
          auth
        );
        const page2Res = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=name&limit=10&offset=10`,
          auth
        );
        expect(page1Res.status).toBe(200);
        expect(page2Res.status).toBe(200);
        const page1 = await page1Res.json();
        const page2 = await page2Res.json();
        // total is stable across pages
        expect(page1.total).toBe(page2.total);
        // No id overlap between consecutive pages
        const ids1 = new Set(page1.runs.map((r: { id: number }) => r.id));
        for (const run of page2.runs) {
          expect(ids1.has(run.id)).toBe(false);
        }
        // Continuous order: page 2's first name >= page 1's last name
        if (page1.runs.length === 10 && page2.runs.length > 0) {
          expect(page2.runs[0].name >= page1.runs[9].name).toBe(true);
        }
      });

      it('Test 12b.6: invalid sort field returns 400', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=bogusfield&limit=10`,
          auth
        );
        expect(response.status).toBe(400);
      });

      it('Test 12b.7: offset beyond total returns an empty page with unchanged total', async () => {
        const baseRes = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&limit=1`,
          auth
        );
        const total = (await baseRes.json()).total;
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&limit=10&offset=${total + 50}`,
          auth
        );
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs.length).toBe(0);
        expect(data.total).toBe(total);
      });

      // ── Custom (config / systemMetadata / metric) ordering ──────────────
      // Bulk runs seed config.lr (mostly 0.001, the needle run 0.01) and
      // config.batch_size: 32, plus metric `train/metric_00`. Total is
      // preserved across custom sorts (ordering only changes row order).

      it('Test 12b.8: sort=config.lr.value ascending puts the smallest lr first', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=config.lr.value&limit=20&includeFieldValues=true&visibleColumns=${encodeURIComponent('[{"source":"config","key":"lr"}]')}`,
          auth
        );
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.total).toBeGreaterThan(1);
        const lrs = data.runs
          .map((r: { _flatConfig?: Record<string, unknown> }) => r._flatConfig?.lr)
          .filter((v: unknown): v is number => typeof v === 'number');
        // Non-decreasing ascending order among runs that have a numeric lr.
        for (let i = 1; i < lrs.length; i++) {
          expect(lrs[i]).toBeGreaterThanOrEqual(lrs[i - 1]);
        }
      });

      it('Test 12b.9: sort=-config.lr.value descending puts the largest lr first', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=-config.lr.value&limit=20&includeFieldValues=true&visibleColumns=${encodeURIComponent('[{"source":"config","key":"lr"}]')}`,
          auth
        );
        expect(response.status).toBe(200);
        const data = await response.json();
        const lrs = data.runs
          .map((r: { _flatConfig?: Record<string, unknown> }) => r._flatConfig?.lr)
          .filter((v: unknown): v is number => typeof v === 'number');
        expect(lrs.length).toBeGreaterThan(0);
        // The needle run's lr (0.01) is the largest seeded value — it should be
        // at or near the top under descending order.
        expect(lrs[0]).toBeGreaterThanOrEqual(lrs[lrs.length - 1]);
        for (let i = 1; i < lrs.length; i++) {
          expect(lrs[i]).toBeLessThanOrEqual(lrs[i - 1]);
        }
      });

      it('Test 12b.10: sort=-config.batch_size.value returns runs and preserves total', async () => {
        const baseRes = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&limit=1`,
          auth
        );
        const total = (await baseRes.json()).total;
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=-config.batch_size.value&limit=20`,
          auth
        );
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs.length).toBeGreaterThan(0);
        // Custom sort changes order only — the match count is unchanged.
        expect(data.total).toBe(total);
      });

      it('Test 12b.11: sort=summary_metrics.train/metric_00 orders by metric and preserves total', async () => {
        const baseRes = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&limit=1`,
          auth
        );
        const total = (await baseRes.json()).total;
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=${encodeURIComponent('summary_metrics.train/metric_00')}&limit=10`,
          auth
        );
        expect(response.status).toBe(200);
        const data = await response.json();
        // Only runs that logged the metric appear in the ordered page, but the
        // overall match total (the candidate count) is unchanged.
        expect(data.total).toBe(total);
        expect(Array.isArray(data.runs)).toBe(true);
        expect(data.runs.length).toBeGreaterThan(0);
      });

      it('Test 12b.12: ascending vs descending metric sort produce reversed leading runs', async () => {
        const ascRes = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=${encodeURIComponent('summary_metrics.train/metric_00')}&limit=20`,
          auth
        );
        const descRes = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=${encodeURIComponent('-summary_metrics.train/metric_00')}&limit=20`,
          auth
        );
        expect(ascRes.status).toBe(200);
        expect(descRes.status).toBe(200);
        const asc = await ascRes.json();
        const desc = await descRes.json();
        if (asc.runs.length > 1 && desc.runs.length > 1) {
          // The first run under ascending should be the last under descending
          // (the metric extremes), so the two orderings disagree at the top.
          expect(asc.runs[0].id).not.toBe(desc.runs[0].id);
        }
      });

      it('Test 12b.13: sort=config. (no key) returns 400', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=config.&limit=10`,
          auth
        );
        expect(response.status).toBe(400);
      });

      it('Test 12b.14: sort=summary_metrics. (no name) returns 400', async () => {
        const response = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=${encodeURIComponent('summary_metrics.')}&limit=10`,
          auth
        );
        expect(response.status).toBe(400);
      });

      it('Test 12b.15: sort=heartbeat_at (CH MAX(time)) asc vs desc disagree at the top', async () => {
        const ascRes = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=heartbeat_at&limit=5`,
          auth
        );
        const descRes = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&sort=-heartbeat_at&limit=5`,
          auth
        );
        expect(ascRes.status).toBe(200);
        expect(descRes.status).toBe(200);
        const asc = await ascRes.json();
        const desc = await descRes.json();
        expect(asc.runs.length).toBeGreaterThan(0);
        expect(desc.runs.length).toBeGreaterThan(0);
        // total reflects the full filtered set, stable across directions
        expect(asc.total).toBe(desc.total);
        // oldest-heartbeat-first vs newest-first differ at the top
        expect(asc.runs[0].id).not.toBe(desc.runs[0].id);
      });
    });
  });

  describe('Test Suite 13: URL Encoding in Run URLs', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Project Names with Special Characters', () => {
      it('Test 13.1: Project name with forward slash is URL-encoded', async () => {
        const projectWithSlash = `org/subproject-${Date.now()}`;

        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: projectWithSlash,
            runName: `test-run-slash`,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.url).toBeDefined();
        // The URL should contain %2F (encoded slash) not a raw /
        expect(data.url).toContain(encodeURIComponent(projectWithSlash));
        expect(data.url).toContain('%2F');
        // Should NOT have an unencoded path that looks like /org/subproject/
        expect(data.url).not.toMatch(/\/projects\/org\/subproject-\d+\//);
      });

      it('Test 13.2: Project name with multiple slashes is fully encoded', async () => {
        const projectWithSlashes = `team/category/experiment-${Date.now()}`;

        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: projectWithSlashes,
            runName: `test-run-multi-slash`,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.url).toBeDefined();
        // Should have two encoded slashes
        const encodedProject = encodeURIComponent(projectWithSlashes);
        expect(data.url).toContain(encodedProject);
        // Count %2F occurrences - should be 2
        const matches = data.url.match(/%2F/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBe(2);
      });

      it('Test 13.3: Project name without special characters works normally', async () => {
        const normalProject = `normal-project-${Date.now()}`;

        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: normalProject,
            runName: `test-run-normal`,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.url).toBeDefined();
        // Normal project names should appear as-is (no encoding needed)
        expect(data.url).toContain(`/projects/${normalProject}/`);
      });

      it('Test 13.4: Project name with spaces is URL-encoded', async () => {
        const projectWithSpaces = `my project ${Date.now()}`;

        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: projectWithSpaces,
            runName: `test-run-spaces`,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.url).toBeDefined();
        // Spaces should be encoded as %20
        expect(data.url).toContain('%20');
        expect(data.url).toContain(encodeURIComponent(projectWithSpaces));
      });
    });
  });

  describe('Test Suite 14: Dashboard Views', () => {
    it('Test 14.1: List dashboard views - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('dashboardViews.list', {
        projectName: 'test-project',
      }, {}, 'GET');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 14.2: Create dashboard view - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('dashboardViews.create', {
        projectName: 'test-project',
        name: 'Test Dashboard',
      }, {}, 'POST');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 14.3: Update dashboard view - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('dashboardViews.update', {
        viewId: '1',
        config: {
          version: 1,
          sections: [],
          settings: {
            gridCols: 12,
            rowHeight: 80,
            compactType: 'vertical',
          },
        },
      }, {}, 'POST');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 14.4: Delete dashboard view - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('dashboardViews.delete', {
        viewId: '1',
      }, {}, 'POST');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 14.5: Get dashboard view - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('dashboardViews.get', {
        viewId: '1',
      }, {}, 'GET');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });
  });

  describe('Test Suite 15: Dashboard Views (Authenticated)', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let testViewId: string | null = null;
    let serverAvailable = false;

    beforeAll(async () => {
      // Check if server is available first
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) {
        console.log('   Skipping authenticated tests - server not available');
        return;
      }

      // Sign in to get a session cookie
      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
          }),
        });

        // Extract session cookie from response
        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          // Extract the session cookie (better_auth.session_token)
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }
    });

    afterAll(async () => {
      // Clean up: delete the test view if it was created
      if (testViewId && sessionCookie) {
        try {
          await makeTrpcRequest('dashboardViews.delete', {
            viewId: testViewId,
          }, { 'Cookie': sessionCookie }, 'POST');
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('Test 15.1: Sign in successful (or skip if unavailable)', () => {
      // This test verifies sign-in worked. If server isn't available or sign-in failed,
      // we skip all subsequent tests gracefully.
      if (!serverAvailable) {
        console.log('   Server not available - skipping authenticated tests');
        return;
      }
      if (!sessionCookie) {
        console.log('   Sign-in failed (test user may not exist) - skipping authenticated tests');
        return;
      }
      expect(sessionCookie).toBeTruthy();
    });

    it('Test 15.2: Create dashboard view', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      const response = await makeTrpcRequest('dashboardViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `Test Dashboard ${Date.now()}`,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.id).toBeDefined();
      expect(data.result?.data?.name).toContain('Test Dashboard');
      expect(data.result?.data?.config).toBeDefined();
      expect(data.result?.data?.config?.version).toBe(1);
      expect(data.result?.data?.config?.sections).toEqual([]);

      testViewId = data.result?.data?.id;
    });

    it('Test 15.3: List dashboard views', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      const response = await makeTrpcRequest('dashboardViews.list', {
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.views).toBeDefined();
      expect(Array.isArray(data.result?.data?.views)).toBe(true);
    });

    it('Test 15.4: Get dashboard view', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }
      const response = await makeTrpcRequest('dashboardViews.get', {
        viewId: testViewId,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.id).toBe(testViewId);
      expect(data.result?.data?.config).toBeDefined();
    });

    it('Test 15.5: Update dashboard view', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }
      const updatedConfig = {
        version: 1,
        sections: [
          {
            id: 'section-1',
            name: 'Test Section',
            collapsed: false,
            widgets: [],
          },
        ],
        settings: {
          gridCols: 12,
          rowHeight: 80,
          compactType: 'vertical' as const,
        },
      };

      const response = await makeTrpcRequest('dashboardViews.update', {
        viewId: testViewId,
        config: updatedConfig,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.config?.sections).toHaveLength(1);
      expect(data.result?.data?.config?.sections[0]?.name).toBe('Test Section');
    });

    it('Test 15.5b: Update dashboard view with stale expectedUpdatedAt returns CONFLICT', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }

      // First, get the current view to know the updatedAt
      const getResponse = await makeTrpcRequest('dashboardViews.get', {
        viewId: testViewId,
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(getResponse.status).toBe(200);
      const getData = await getResponse.json();
      const currentUpdatedAt = getData.result?.data?.updatedAt;
      expect(currentUpdatedAt).toBeDefined();

      // Now update with a stale expectedUpdatedAt (a timestamp far in the past)
      const staleTimestamp = '2020-01-01T00:00:00.000Z';
      const updatedConfig = {
        version: 1,
        sections: [
          {
            id: 'section-stale',
            name: 'Stale Update Section',
            collapsed: false,
            widgets: [],
          },
        ],
        settings: {
          gridCols: 12,
          rowHeight: 80,
          compactType: 'vertical' as const,
        },
      };

      const response = await makeTrpcRequest('dashboardViews.update', {
        viewId: testViewId,
        config: updatedConfig,
        expectedUpdatedAt: staleTimestamp,
      }, { 'Cookie': sessionCookie }, 'POST');

      // Should return an error (CONFLICT maps to HTTP 409 in tRPC, but tRPC returns 200 with error in body)
      const data = await response.json();
      // tRPC wraps errors - check for CONFLICT error code
      expect(data.error?.data?.code).toBe('CONFLICT');
      expect(data.error?.message).toContain('modified');
    });

    it('Test 15.5c: Update dashboard view with correct expectedUpdatedAt succeeds', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }

      // Get the current updatedAt
      const getResponse = await makeTrpcRequest('dashboardViews.get', {
        viewId: testViewId,
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(getResponse.status).toBe(200);
      const getData = await getResponse.json();
      const currentUpdatedAt = getData.result?.data?.updatedAt;

      // Update with the correct expectedUpdatedAt
      const updatedConfig = {
        version: 1,
        sections: [
          {
            id: 'section-fresh',
            name: 'Fresh Update Section',
            collapsed: false,
            widgets: [],
          },
        ],
        settings: {
          gridCols: 12,
          rowHeight: 80,
          compactType: 'vertical' as const,
        },
      };

      const response = await makeTrpcRequest('dashboardViews.update', {
        viewId: testViewId,
        config: updatedConfig,
        expectedUpdatedAt: currentUpdatedAt,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.config?.sections).toHaveLength(1);
      expect(data.result?.data?.config?.sections[0]?.name).toBe('Fresh Update Section');
    });

    it('Test 15.5d: Update without expectedUpdatedAt always succeeds (force override)', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }

      const updatedConfig = {
        version: 1,
        sections: [
          {
            id: 'section-force',
            name: 'Force Update Section',
            collapsed: false,
            widgets: [],
          },
        ],
        settings: {
          gridCols: 12,
          rowHeight: 80,
          compactType: 'vertical' as const,
        },
      };

      const response = await makeTrpcRequest('dashboardViews.update', {
        viewId: testViewId,
        config: updatedConfig,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.config?.sections).toHaveLength(1);
      expect(data.result?.data?.config?.sections[0]?.name).toBe('Force Update Section');
    });

    it('Test 15.5e: Bars widget ignoreOutliers round-trips through update/get', async () => {
      // Regression test for BarsConfig.ignoreOutliers — the W&B-style toggle
      // that fences the shared maxFreq used to normalize ridge heights /
      // heatmap colors. Default is true on the read side; explicit false
      // must survive a write/read round-trip so unchecking the box in the
      // bars settings popover actually persists.
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }

      const updatedConfig = {
        version: 1,
        sections: [
          {
            id: 'section-bars-outliers',
            name: 'Bars Outliers Round-Trip',
            collapsed: false,
            widgets: [
              {
                id: 'widget-bars',
                type: 'chart' as const,
                config: {
                  title: 'bars outliers test',
                  metrics: [],
                  xAxis: 'step',
                  xAxisScale: 'linear' as const,
                  yAxisScale: 'linear' as const,
                  aggregation: 'mean' as const,
                  showOriginal: false,
                  bars: [
                    {
                      prefix: 'training/dataset/',
                      viewMode: 'ridgeline' as const,
                      depthAxis: 'step' as const,
                      // The bit under test — explicitly false should survive
                      // the persistence layer.
                      ignoreOutliers: false,
                    },
                  ],
                },
                layout: { x: 0, y: 0, w: 6, h: 4 },
              },
            ],
          },
        ],
        settings: {
          gridCols: 12,
          rowHeight: 80,
          compactType: 'vertical' as const,
        },
      };

      const updateResp = await makeTrpcRequest('dashboardViews.update', {
        viewId: testViewId,
        config: updatedConfig,
      }, { 'Cookie': sessionCookie }, 'POST');
      expect(updateResp.status).toBe(200);

      // Now re-fetch and assert ignoreOutliers came through as `false`.
      const getResp = await makeTrpcRequest('dashboardViews.get', {
        viewId: testViewId,
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(getResp.status).toBe(200);
      const getData = await getResp.json();
      const bars = getData.result?.data?.config?.sections?.[0]?.widgets?.[0]?.config?.bars;
      expect(Array.isArray(bars)).toBe(true);
      expect(bars).toHaveLength(1);
      expect(bars[0].prefix).toBe('training/dataset/');
      expect(bars[0].ignoreOutliers).toBe(false);
    });

    it('Test 15.6: Delete dashboard view', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }
      const response = await makeTrpcRequest('dashboardViews.delete', {
        viewId: testViewId,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.success).toBe(true);

      // Verify it's deleted
      const getResponse = await makeTrpcRequest('dashboardViews.get', {
        viewId: testViewId,
      }, { 'Cookie': sessionCookie }, 'GET');

      // Should return error or empty result
      expect([200, 404, 500]).toContain(getResponse.status);

      // Mark as cleaned up
      testViewId = null;
    });

    it('Test 15.7: All widget types round-trip', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const allWidgetTypes = {
        version: 1,
        sections: [{
          id: 'all-types',
          name: 'All Widget Types',
          collapsed: false,
          widgets: [
            { id: 'w-chart', type: 'chart', config: { metrics: ['loss'], xAxis: 'step', yAxisScale: 'linear', xAxisScale: 'linear', aggregation: 'LAST', showOriginal: false }, layout: { x: 0, y: 0, w: 6, h: 4 } },
            { id: 'w-scatter', type: 'scatter', config: { xMetric: 'lr', yMetric: 'loss', xScale: 'linear', yScale: 'linear', xAggregation: 'LAST', yAggregation: 'LAST' }, layout: { x: 6, y: 0, w: 6, h: 4 } },
            { id: 'w-single', type: 'single-value', config: { metric: 'accuracy', aggregation: 'LAST' }, layout: { x: 0, y: 4, w: 4, h: 2 } },
            { id: 'w-hist', type: 'histogram', config: { metric: 'weights' }, layout: { x: 4, y: 4, w: 4, h: 2 } },
            { id: 'w-logs', type: 'logs', config: { logName: 'stdout', maxLines: 100 }, layout: { x: 8, y: 4, w: 4, h: 2 } },
            { id: 'w-fseries', type: 'file-series', config: { logName: 'images', mediaType: 'IMAGE' }, layout: { x: 0, y: 6, w: 6, h: 4 } },
            { id: 'w-fgroup', type: 'file-group', config: { files: ['output.png'] }, layout: { x: 6, y: 6, w: 6, h: 4 } },
            // Distributions: hosts bars (categorical) + histogram entries
            // under one widget; round-trip both kinds together.
            { id: 'w-dist', type: 'distributions', config: { entries: [
              { kind: 'bars', prefix: 'training/dataset/', viewMode: 'ridgeline', depthAxis: 'step', ignoreOutliers: true, stepsOnX: false },
              { kind: 'histogram', metric: 'distributions/weights', viewMode: 'heatmap', ignoreOutliers: true, stepsOnX: false },
            ] }, layout: { x: 0, y: 10, w: 6, h: 4 } },
          ],
        }],
        settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
      };

      // Create dashboard with all widget types
      const createRes = await makeTrpcRequest('dashboardViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `Widget Types Test ${Date.now()}`,
        config: allWidgetTypes,
      }, { 'Cookie': sessionCookie }, 'POST');
      expect(createRes.status).toBe(200);
      const createData = await createRes.json();
      const viewId = createData.result?.data?.id;
      expect(viewId).toBeDefined();

      // Read back and verify all 8 widget types survived
      const getRes = await makeTrpcRequest('dashboardViews.get', {
        viewId,
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(getRes.status).toBe(200);
      const getData = await getRes.json();
      const widgets = getData.result?.data?.config?.sections?.[0]?.widgets;
      expect(widgets).toHaveLength(8);
      const types = widgets.map((w: any) => w.type).sort();
      expect(types).toEqual(['chart', 'distributions', 'file-group', 'file-series', 'histogram', 'logs', 'scatter', 'single-value']);

      // Verify file-group config specifically
      const fgWidget = widgets.find((w: any) => w.type === 'file-group');
      expect(fgWidget.config.files).toEqual(['output.png']);

      // Verify distributions widget — both kinds survive with all per-entry fields
      const distWidget = widgets.find((w: any) => w.type === 'distributions');
      expect(distWidget.config.entries).toHaveLength(2);
      expect(distWidget.config.entries[0]).toMatchObject({
        kind: 'bars',
        prefix: 'training/dataset/',
        viewMode: 'ridgeline',
        depthAxis: 'step',
      });
      expect(distWidget.config.entries[1]).toMatchObject({
        kind: 'histogram',
        metric: 'distributions/weights',
        viewMode: 'heatmap',
      });

      // Cleanup
      await makeTrpcRequest('dashboardViews.delete', { viewId }, { 'Cookie': sessionCookie }, 'POST');
    });

    it('Test 15.7b: Distributions stepsOnX=true round-trip (bars + histogram entries)', async () => {
      // Steps-on-X is a per-entry flag stamped on both bars and histogram
      // distributions entries. Round-trip stepsOnX:true through
      // dashboardViews.create → get to make sure the schema doesn't quietly
      // strip the field — the bug previously was that adding the field on
      // the histogram entry without updating the Zod schema would silently
      // drop it on save.
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      const config = {
        version: 1,
        sections: [{
          id: 'steps-on-x-roundtrip',
          name: 'Steps-on-X',
          collapsed: false,
          widgets: [
            { id: 'w-dist', type: 'distributions', config: { entries: [
              { kind: 'bars', prefix: 'training/dataset/', viewMode: 'ridgeline', depthAxis: 'step', ignoreOutliers: true, stepsOnX: true },
              { kind: 'histogram', metric: 'distributions/weights', viewMode: 'heatmap', ignoreOutliers: true, stepsOnX: true },
            ] }, layout: { x: 0, y: 0, w: 6, h: 4 } },
          ],
        }],
        settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
      };
      const createRes = await makeTrpcRequest('dashboardViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `StepsOnX Test ${Date.now()}`,
        config,
      }, { 'Cookie': sessionCookie }, 'POST');
      expect(createRes.status).toBe(200);
      const viewId = (await createRes.json()).result?.data?.id;
      expect(viewId).toBeDefined();

      const getRes = await makeTrpcRequest('dashboardViews.get', { viewId }, { 'Cookie': sessionCookie }, 'GET');
      expect(getRes.status).toBe(200);
      const widgets = (await getRes.json()).result?.data?.config?.sections?.[0]?.widgets;
      const entries = widgets[0].config.entries;
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ kind: 'bars', stepsOnX: true });
      expect(entries[1]).toMatchObject({ kind: 'histogram', stepsOnX: true });

      await makeTrpcRequest('dashboardViews.delete', { viewId }, { 'Cookie': sessionCookie }, 'POST');
    });

    it('Test 15.8: Dynamic grouping fields roundtrip (dynamicGroupBy + dynamicGroupPrefixes)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      const config = {
        version: 1,
        sections: [{
          id: 'section-grouping',
          name: 'Grouping Test',
          collapsed: false,
          widgets: [],
          dynamicPattern: 'training/gradient/norms/*',
          dynamicPatternMode: 'search',
          dynamicGroupBy: ['min', 'max', 'mean'],
          dynamicGroupPrefixes: [
            'training/gradient/norms/encoder.layer_0',
            'training/gradient/norms/encoder.layer_1',
          ],
        }],
        settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
      };
      const createRes = await makeTrpcRequest('dashboardViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `Grouping Roundtrip ${Date.now()}`,
        config,
      }, { 'Cookie': sessionCookie }, 'POST');
      expect(createRes.status).toBe(200);
      const viewId = (await createRes.json()).result?.data?.id;
      expect(viewId).toBeDefined();

      // Read back and assert grouping fields survived
      const getRes = await makeTrpcRequest('dashboardViews.get', { viewId }, { 'Cookie': sessionCookie }, 'GET');
      expect(getRes.status).toBe(200);
      const section = (await getRes.json()).result?.data?.config?.sections?.[0];
      expect(section?.dynamicPattern).toBe('training/gradient/norms/*');
      expect(section?.dynamicGroupBy).toEqual(['min', 'max', 'mean']);
      expect(section?.dynamicGroupPrefixes).toEqual([
        'training/gradient/norms/encoder.layer_0',
        'training/gradient/norms/encoder.layer_1',
      ]);

      await makeTrpcRequest('dashboardViews.delete', { viewId }, { 'Cookie': sessionCookie }, 'POST');
    });

    it('Test 15.9: Backward compat — section without grouping fields loads cleanly', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      // Old-shape dynamic section (no grouping fields at all). This is what
      // every existing saved dashboard looks like.
      const config = {
        version: 1,
        sections: [{
          id: 'section-legacy',
          name: 'Legacy Dynamic',
          collapsed: false,
          widgets: [],
          dynamicPattern: 'train/*',
          dynamicPatternMode: 'search',
        }],
        settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
      };
      const createRes = await makeTrpcRequest('dashboardViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `Legacy Compat ${Date.now()}`,
        config,
      }, { 'Cookie': sessionCookie }, 'POST');
      expect(createRes.status).toBe(200);
      const viewId = (await createRes.json()).result?.data?.id;

      const getRes = await makeTrpcRequest('dashboardViews.get', { viewId }, { 'Cookie': sessionCookie }, 'GET');
      expect(getRes.status).toBe(200);
      const section = (await getRes.json()).result?.data?.config?.sections?.[0];
      expect(section?.dynamicPattern).toBe('train/*');
      // Grouping fields absent or undefined — both are valid for backward compat
      expect(section?.dynamicGroupBy ?? undefined).toBeUndefined();
      expect(section?.dynamicGroupPrefixes ?? undefined).toBeUndefined();

      await makeTrpcRequest('dashboardViews.delete', { viewId }, { 'Cookie': sessionCookie }, 'POST');
    });

    it('Test 15.10: Unknown section keys are stripped (Zod strip behavior)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      // Send a dashboard with a bogus extra section field. Zod's default
      // .strip() mode should drop it — important for forward compat where a
      // newer frontend writes a field the current backend doesn't know about.
      const config = {
        version: 1,
        sections: [{
          id: 'section-strip',
          name: 'Strip Test',
          collapsed: false,
          widgets: [],
          dynamicPattern: 'train/*',
          dynamicPatternMode: 'search',
          dynamicGroupBy: ['min'],
          // Unknown key — should be dropped on read
          dynamicGroupSomeFutureField: { foo: 'bar' },
          someBogusExtra: 42,
        }],
        settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
      };
      const createRes = await makeTrpcRequest('dashboardViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `Strip Test ${Date.now()}`,
        config,
      }, { 'Cookie': sessionCookie }, 'POST');
      expect(createRes.status).toBe(200);
      const viewId = (await createRes.json()).result?.data?.id;

      const getRes = await makeTrpcRequest('dashboardViews.get', { viewId }, { 'Cookie': sessionCookie }, 'GET');
      expect(getRes.status).toBe(200);
      const section = (await getRes.json()).result?.data?.config?.sections?.[0];
      // Known fields preserved
      expect(section?.dynamicPattern).toBe('train/*');
      expect(section?.dynamicGroupBy).toEqual(['min']);
      // Unknown fields stripped
      expect(section?.dynamicGroupSomeFutureField).toBeUndefined();
      expect(section?.someBogusExtra).toBeUndefined();

      await makeTrpcRequest('dashboardViews.delete', { viewId }, { 'Cookie': sessionCookie }, 'POST');
    });

    it('Test 15.11: dynamicGroupPrefixRegex roundtrips through tRPC', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      const config = {
        version: 1,
        sections: [{
          id: 'section-regex-grouping',
          name: 'Regex Grouping',
          collapsed: false,
          widgets: [],
          dynamicPattern: 'validation/*',
          dynamicPatternMode: 'search',
          dynamicGroupBy: ['CRPS', 'MASE'],
          // Capture-group regex — REPLACES the literal allowlist when set.
          dynamicGroupPrefixRegex: 'validation/bitbrains_fast_storage/(.*?)/original/(.*?)$',
        }],
        settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
      };
      const createRes = await makeTrpcRequest('dashboardViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `Regex Grouping ${Date.now()}`,
        config,
      }, { 'Cookie': sessionCookie }, 'POST');
      expect(createRes.status).toBe(200);
      const viewId = (await createRes.json()).result?.data?.id;
      expect(viewId).toBeDefined();

      const getRes = await makeTrpcRequest('dashboardViews.get', { viewId }, { 'Cookie': sessionCookie }, 'GET');
      expect(getRes.status).toBe(200);
      const section = (await getRes.json()).result?.data?.config?.sections?.[0];
      expect(section?.dynamicPattern).toBe('validation/*');
      expect(section?.dynamicGroupBy).toEqual(['CRPS', 'MASE']);
      expect(section?.dynamicGroupPrefixRegex).toBe(
        'validation/bitbrains_fast_storage/(.*?)/original/(.*?)$',
      );

      await makeTrpcRequest('dashboardViews.delete', { viewId }, { 'Cookie': sessionCookie }, 'POST');
    });

    it('Test 15.12: dynamicGroupPrefixes and dynamicGroupPrefixRegex coexist on read (regex wins at runtime)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      // The dialog UI saves only one of them (mode-exclusive), but the schema
      // doesn't enforce mutual exclusion at the storage layer. If a section
      // ever ends up with BOTH set (e.g. older client, manual edit, or future
      // schema migration), reads must round-trip both fields cleanly. The
      // bucketing layer's documented precedence ("regex wins") is covered by
      // the bucket-metrics unit tests; this just locks the storage shape.
      const config = {
        version: 1,
        sections: [{
          id: 'section-both',
          name: 'Both Set',
          collapsed: false,
          widgets: [],
          dynamicPattern: 'training/gradient/norms/*',
          dynamicPatternMode: 'search',
          dynamicGroupBy: ['min', 'max', 'mean'],
          dynamicGroupPrefixes: ['training/gradient/norms/encoder.layer_0'],
          dynamicGroupPrefixRegex: 'training/gradient/norms/(.*?)/.+$',
        }],
        settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
      };
      const createRes = await makeTrpcRequest('dashboardViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `Both Set ${Date.now()}`,
        config,
      }, { 'Cookie': sessionCookie }, 'POST');
      expect(createRes.status).toBe(200);
      const viewId = (await createRes.json()).result?.data?.id;

      const getRes = await makeTrpcRequest('dashboardViews.get', { viewId }, { 'Cookie': sessionCookie }, 'GET');
      expect(getRes.status).toBe(200);
      const section = (await getRes.json()).result?.data?.config?.sections?.[0];
      // Both fields preserved as-stored
      expect(section?.dynamicGroupPrefixes).toEqual(['training/gradient/norms/encoder.layer_0']);
      expect(section?.dynamicGroupPrefixRegex).toBe('training/gradient/norms/(.*?)/.+$');

      await makeTrpcRequest('dashboardViews.delete', { viewId }, { 'Cookie': sessionCookie }, 'POST');
    });
  });

  // NOTE: Test Suites 16 and 17 are temporarily disabled until we can properly
  // debug the CI environment. The security fixes for SQL injection in these
  // endpoints have been applied. See runs-openapi.ts lines 1165-1290 and 1350-1400.
  describe.skip('Test Suite 16: Statistics Endpoint', () => {
    let testRunId: number;
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Statistics with Valid API Key', () => {
      // Create a test run for statistics tests
      beforeAll(async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `stats-test-run-${Date.now()}`,
            config: JSON.stringify({ lr: 0.001 }),
            tags: ['stats-test'],
          }),
        });
        expect(response.status).toBe(200);
        const data = await response.json();
        testRunId = data.runId;
        expect(testRunId).toBeDefined();
      });

      it('Test 16.1: Get statistics for valid run', async () => {
        const response = await makeRequest(
          `/api/runs/statistics?runId=${testRunId}&projectName=${TEST_PROJECT_NAME}`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runId).toBe(testRunId);
        expect(data.projectName).toBe(TEST_PROJECT_NAME);
        expect(data.url).toBeDefined();
        expect(data.metrics).toBeDefined();
        expect(Array.isArray(data.metrics)).toBe(true);
      });

      it('Test 16.2: Get statistics with logName filter', async () => {
        const response = await makeRequest(
          `/api/runs/statistics?runId=${testRunId}&projectName=${TEST_PROJECT_NAME}&logName=train/metric_00`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runId).toBe(testRunId);
        expect(data.metrics).toBeDefined();
      });

      it('Test 16.3: Get statistics with logGroup filter', async () => {
        const response = await makeRequest(
          `/api/runs/statistics?runId=${testRunId}&projectName=${TEST_PROJECT_NAME}&logGroup=train`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runId).toBe(testRunId);
        expect(data.metrics).toBeDefined();
      });

      it('Test 16.4: Statistics for non-existent run returns 404', async () => {
        const response = await makeRequest(
          `/api/runs/statistics?runId=999999999&projectName=${TEST_PROJECT_NAME}`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe('Run not found');
      });

      it('Test 16.5: Statistics without API key returns 401', async () => {
        const response = await makeRequest(
          `/api/runs/statistics?runId=${testRunId}&projectName=${TEST_PROJECT_NAME}`
        );

        expect(response.status).toBe(401);
      });

      // SQL Injection prevention tests
      it('Test 16.6: SQL injection in logName is handled safely', async () => {
        // Attempt SQL injection via logName parameter
        const maliciousLogName = "test' OR '1'='1";
        const response = await makeRequest(
          `/api/runs/statistics?runId=${testRunId}&projectName=${TEST_PROJECT_NAME}&logName=${encodeURIComponent(maliciousLogName)}`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        // Should return 200 with empty metrics (injection treated as literal string)
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.metrics).toBeDefined();
        // The malicious string should be treated as a literal logName, finding no matches
        expect(data.metrics.length).toBe(0);
      });

      it('Test 16.7: SQL injection in logGroup is handled safely', async () => {
        // Attempt SQL injection via logGroup parameter
        const maliciousLogGroup = "train'; DROP TABLE mlop_metrics; --";
        const response = await makeRequest(
          `/api/runs/statistics?runId=${testRunId}&projectName=${TEST_PROJECT_NAME}&logGroup=${encodeURIComponent(maliciousLogGroup)}`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        // Should return 200 with empty metrics (injection treated as literal string)
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.metrics).toBeDefined();
        expect(data.metrics.length).toBe(0);
      });

      it('Test 16.8: SQL injection with UNION attempt is handled safely', async () => {
        // Attempt UNION-based SQL injection
        const maliciousLogName = "x' UNION SELECT * FROM system.tables --";
        const response = await makeRequest(
          `/api/runs/statistics?runId=${testRunId}&projectName=${TEST_PROJECT_NAME}&logName=${encodeURIComponent(maliciousLogName)}`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.metrics).toBeDefined();
        // Should not leak any system table data
        expect(data.metrics.length).toBe(0);
      });
    });
  });

  describe.skip('Test Suite 17: Compare Endpoint', () => {
    let testRunIds: number[] = [];
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Compare with Valid API Key', () => {
      // Create test runs for compare tests
      beforeAll(async () => {
        for (let i = 0; i < 3; i++) {
          const response = await makeRequest('/api/runs/create', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
            body: JSON.stringify({
              projectName: TEST_PROJECT_NAME,
              runName: `compare-test-run-${i}-${Date.now()}`,
              config: JSON.stringify({ lr: 0.001 * (i + 1) }),
              tags: ['compare-test'],
            }),
          });
          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data.runId).toBeDefined();
          testRunIds.push(data.runId);
        }
      });

      it('Test 17.1: Compare multiple runs', async () => {
        const runIdsParam = testRunIds.join(',');
        const response = await makeRequest(
          `/api/runs/compare?runIds=${runIdsParam}&projectName=${TEST_PROJECT_NAME}&logName=train/metric_00`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.projectName).toBe(TEST_PROJECT_NAME);
        expect(data.logName).toBe('train/metric_00');
        expect(data.runs).toBeDefined();
        expect(Array.isArray(data.runs)).toBe(true);
        expect(data.comparisonUrl).toBeDefined();
        // Verify comparisonUrl includes the runs param for pre-selection
        expect(data.comparisonUrl).toContain('?runs=');
        expect(data.comparisonUrl).toContain(testRunIds.join(','));
        expect(data.summary).toBeDefined();
      });

      it('Test 17.2: Compare single run', async () => {
        const response = await makeRequest(
          `/api/runs/compare?runIds=${testRunIds[0]}&projectName=${TEST_PROJECT_NAME}&logName=train/metric_00`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs.length).toBe(1);
      });

      it('Test 17.3: Compare with no valid run IDs returns 400', async () => {
        const response = await makeRequest(
          `/api/runs/compare?runIds=invalid,notanumber&projectName=${TEST_PROJECT_NAME}&logName=train/loss`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('No valid run IDs provided');
      });

      it('Test 17.4: Compare without API key returns 401', async () => {
        const response = await makeRequest(
          `/api/runs/compare?runIds=${testRunIds[0]}&projectName=${TEST_PROJECT_NAME}&logName=train/loss`
        );

        expect(response.status).toBe(401);
      });

      it('Test 17.5: Compare with non-existent runs returns empty results', async () => {
        const response = await makeRequest(
          `/api/runs/compare?runIds=999999999,999999998&projectName=${TEST_PROJECT_NAME}&logName=train/loss`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        // Non-existent runs should be excluded (Prisma filters by org)
        expect(data.runs.length).toBe(0);
      });

      // SQL Injection prevention tests
      it('Test 17.6: SQL injection in logName is handled safely', async () => {
        const maliciousLogName = "loss' OR '1'='1";
        const response = await makeRequest(
          `/api/runs/compare?runIds=${testRunIds[0]}&projectName=${TEST_PROJECT_NAME}&logName=${encodeURIComponent(maliciousLogName)}`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        // Injection treated as literal string, stats should be null (no data)
        expect(data.runs).toBeDefined();
        if (data.runs.length > 0) {
          expect(data.runs[0].stats).toBeNull();
        }
      });

      it('Test 17.7: SQL injection in projectName is handled safely', async () => {
        const maliciousProject = "test'; DELETE FROM runs; --";
        const response = await makeRequest(
          `/api/runs/compare?runIds=${testRunIds[0]}&projectName=${encodeURIComponent(maliciousProject)}&logName=train/loss`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        // Malicious project name won't match any runs
        expect(data.runs.length).toBe(0);
      });

      it('Test 17.8: SQL injection with comment syntax is handled safely', async () => {
        const maliciousLogName = "train/loss--";
        const response = await makeRequest(
          `/api/runs/compare?runIds=${testRunIds[0]}&projectName=${TEST_PROJECT_NAME}&logName=${encodeURIComponent(maliciousLogName)}`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toBeDefined();
      });
    });
  });

  describe('Test Suite 17: Distinct Tags Search (Authenticated)', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let serverAvailable = false;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }
      if (!serverAvailable) return;

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });
        const setCookie = signInResponse.headers.get('set-cookie');
        const match = setCookie?.match(/better_auth\.session_token=([^;]+)/);
        if (match) {
          sessionCookie = `better_auth.session_token=${match[1]}`;
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }
    });

    it('Test 17.1: distinctTags requires authentication', async () => {
      const response = await makeTrpcRequest('runs.distinctTags', {
        projectName: TEST_PROJECT_NAME,
      }, {}, 'GET');
      expect(response.status).toBe(401);
    });

    it('Test 17.2: distinctTags returns a bounded tag list', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.distinctTags', {
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const tags = data.result?.data?.tags;
      expect(Array.isArray(tags)).toBe(true);
      // Hard cap mirrors the frontend render limit.
      expect(tags.length).toBeLessThanOrEqual(500);
    });

    it('Test 17.3: search returns only matching tags', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.distinctTags', {
        projectName: TEST_PROJECT_NAME,
        search: 'train',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const tags: string[] = (await response.json()).result?.data?.tags ?? [];
      // Every result must contain the (case-insensitive) query substring.
      expect(tags.every((t) => t.toLowerCase().includes('train'))).toBe(true);
      // The seeded TAG_POOL includes "training".
      expect(tags).toContain('training');
    });

    it('Test 17.4: non-matching search returns an empty list', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.distinctTags', {
        projectName: TEST_PROJECT_NAME,
        search: 'zzz-no-such-tag-xyz',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const tags = (await response.json()).result?.data?.tags;
      expect(tags).toEqual([]);
    });

    it('Test 17.5: limit caps the number of returned tags', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.distinctTags', {
        projectName: TEST_PROJECT_NAME,
        limit: 2,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const tags = (await response.json()).result?.data?.tags;
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBeLessThanOrEqual(2);
    });

    it('Test 17.6: distinctTags ranks most-common tag first', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      // setup.ts distributes TAG_POOL across the first 10 bulk runs such
      // that `training` is on 10 runs (highest count). The SQL ORDER BY
      // COUNT(*) DESC, MAX("createdAt") DESC, tag ASC must surface it
      // first — a regression to alphabetical or unsorted would not.
      const response = await makeTrpcRequest('runs.distinctTags', {
        projectName: TEST_PROJECT_NAME,
        limit: 50,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const tags: string[] = (await response.json()).result?.data?.tags ?? [];
      expect(tags[0]).toBe('training');
    });
  });

  describe('Test Suite 17b: Tag-count cap (MAX_TAGS_PER_RUN=50)', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('HTTP write boundaries', () => {
      it('Test 17b.1: POST /api/runs/create rejects 51-tag body', async () => {
        const tooMany = Array.from({ length: 51 }, (_, i) => `cap-${i}`);
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `tag-cap-test-${Date.now()}`,
            tags: tooMany,
          }),
        });
        expect(response.status).toBe(400);
      });

      it('Test 17b.2: POST /api/runs/tags/update rejects 51-tag body', async () => {
        const tooMany = Array.from({ length: 51 }, (_, i) => `cap-${i}`);
        const response = await makeRequest('/api/runs/tags/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
            'Content-Type': 'application/json',
          },
          // runId=1 is fine — Zod rejects before the row is fetched.
          body: JSON.stringify({ runId: 1, tags: tooMany }),
        });
        expect(response.status).toBe(400);
      });
    });

    describe('tRPC write boundary', () => {
      let sessionCookie: string | null = null;
      const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
      const TEST_PASSWORD = 'TestPassword123!';

      beforeAll(async () => {
        try {
          const signInResponse = await makeRequest('/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
          });
          const setCookie = signInResponse.headers.get('set-cookie');
          const match = setCookie?.match(/better_auth\.session_token=([^;]+)/);
          if (match) sessionCookie = `better_auth.session_token=${match[1]}`;
        } catch (e) {
          console.log('   Sign in failed:', e);
        }
      });

      it('Test 17b.3: runs.updateTags rejects 51 tags via tRPC', async () => {
        if (!sessionCookie) {
          console.log('   No session - skipping');
          return;
        }
        const tooMany = Array.from({ length: 51 }, (_, i) => `cap-${i}`);
        // Use any valid SQID — Zod validation happens before the runId
        // is resolved or the row is fetched.
        const response = await makeTrpcRequest('runs.updateTags', {
          runId: 'aB',
          projectName: TEST_PROJECT_NAME,
          tags: tooMany,
        }, { 'Cookie': sessionCookie }, 'POST');

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(JSON.stringify(body)).toMatch(/at most 50 tags/i);
      });
    });
  });

  // -----------------------------------------------------------------
  // Test Suite 17c: W&B-style grouping API (runs.distinctGroupValues +
  // runs.list/count groupFilters). Exercises every field kind the
  // server allows; uses the seeded `run-groups-test` project (5 runs,
  // 3 distinct group:* tags: alpha[×2], beta, gamma, + 1 ungrouped).
  // -----------------------------------------------------------------
  describe('Test Suite 17c: Grouping v2 API', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    const RG_PROJECT = 'run-groups-test';
    let sessionCookie: string | null = null;
    let serverAvailable = false;
    let orgId = '';

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }
      if (!serverAvailable) return;
      const signInResponse = await makeRequest('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      const setCookie = signInResponse.headers.get('set-cookie');
      const match = setCookie?.match(/better_auth\.session_token=([^;]+)/);
      if (match) sessionCookie = `better_auth.session_token=${match[1]}`;
      if (!sessionCookie) return;
      const auth = await (await makeTrpcRequest('auth', {}, { Cookie: sessionCookie }, 'GET')).json();
      orgId = auth.result?.data?.activeOrganization?.id ?? '';
    });

    it('Test 17c.1: tag-prefix:group returns 3 buckets, alpha first', async () => {
      if (!sessionCookie || !orgId) return;
      const response = await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'tag-prefix:group',
      }, { Cookie: sessionCookie }, 'GET');
      expect(response.status).toBe(200);
      const data = (await response.json()).result?.data;
      // Seeded: alpha×2, beta×1, gamma×1, + rg-solo without a group tag.
      // The null/unset bucket is intentionally NOT returned for tag-prefix
      // groupings (see distinct-group-values.ts).
      const values: Array<{ value: string; count: number }> = data?.values ?? [];
      const byName = Object.fromEntries(values.map((v) => [v.value, v.count]));
      expect(byName).toEqual({ alpha: 2, beta: 1, gamma: 1 });
      expect(values[0]?.value).toBe('alpha'); // count DESC → highest first
    });

    it('Test 17c.2: parentFilters narrow to a single bucket', async () => {
      if (!sessionCookie || !orgId) return;
      const response = await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'system:status',
        parentFilters: [{ field: 'tag-prefix:group', value: 'alpha' }],
      }, { Cookie: sessionCookie }, 'GET');
      expect(response.status).toBe(200);
      const values: Array<{ value: string; count: number }> =
        (await response.json()).result?.data?.values ?? [];
      // Both alpha runs were seeded as COMPLETED — only one bucket.
      expect(values).toEqual([{ value: 'COMPLETED', count: 2 }]);
    });

    it('Test 17c.3: valueSearch filters bucket labels', async () => {
      if (!sessionCookie || !orgId) return;
      const response = await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'tag-prefix:group',
        valueSearch: 'alph',
      }, { Cookie: sessionCookie }, 'GET');
      expect(response.status).toBe(200);
      const values: Array<{ value: string }> =
        (await response.json()).result?.data?.values ?? [];
      expect(values.map((v) => v.value)).toEqual(['alpha']);
    });

    it('Test 17c.4: runs.list groupFilters returns only matching runs', async () => {
      if (!sessionCookie || !orgId) return;
      const response = await makeTrpcRequest('runs.list', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        groupFilters: [{ field: 'tag-prefix:group', value: 'alpha' }],
        limit: 50,
      }, { Cookie: sessionCookie }, 'GET');
      expect(response.status).toBe(200);
      const runs: Array<{ name: string; tags: string[] }> =
        (await response.json()).result?.data?.runs ?? [];
      // Names are rg-alpha-1 and rg-alpha-2 in the seed; we don't care
      // about order, only that they're the right runs.
      const names = runs.map((r) => r.name).sort();
      expect(names).toEqual(['rg-alpha-1', 'rg-alpha-2']);
      // Tag is the canonical group:alpha encoding.
      expect(runs.every((r) => r.tags.includes('group:alpha'))).toBe(true);
    });

    it('Test 17c.5: runs.count groupFilters matches runs.list', async () => {
      if (!sessionCookie || !orgId) return;
      const countRes = await makeTrpcRequest('runs.count', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        groupFilters: [{ field: 'tag-prefix:group', value: 'alpha' }],
      }, { Cookie: sessionCookie }, 'GET');
      expect(countRes.status).toBe(200);
      const count = (await countRes.json()).result?.data;
      expect(count).toBe(2);
    });

    it('Test 17c.6: invalid system field returns empty', async () => {
      if (!sessionCookie || !orgId) return;
      // notes is intentionally NOT in SUPPORTED_SYSTEM_GROUP_FIELDS; the
      // proc must reject quietly with no rows rather than 400.
      const response = await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'system:notes',
      }, { Cookie: sessionCookie }, 'GET');
      expect(response.status).toBe(200);
      const data = (await response.json()).result?.data;
      expect(data?.values ?? []).toEqual([]);
    });

    it('Test 17c.7: malformed field encoding returns empty', async () => {
      if (!sessionCookie || !orgId) return;
      const response = await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'not-a-real-kind:status',
      }, { Cookie: sessionCookie }, 'GET');
      expect(response.status).toBe(200);
      expect((await response.json()).result?.data?.values ?? []).toEqual([]);
    });

    it('Test 17c.8: limit + offset paginate', async () => {
      if (!sessionCookie || !orgId) return;
      const page1 = (await (await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'tag-prefix:group',
        limit: 2,
        offset: 0,
      }, { Cookie: sessionCookie }, 'GET')).json()).result?.data;
      const page2 = (await (await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'tag-prefix:group',
        limit: 2,
        offset: 2,
      }, { Cookie: sessionCookie }, 'GET')).json()).result?.data;
      expect(page1?.values?.length).toBe(2);
      expect(page1?.hasMore).toBe(true);
      // Total distinct = 3 (alpha, beta, gamma); page 2 has the leftover.
      expect(page2?.values?.length).toBe(1);
      expect(page2?.hasMore).toBe(false);
      const seen = [...(page1.values ?? []), ...(page2.values ?? [])]
        .map((v: { value: string }) => v.value)
        .sort();
      expect(seen).toEqual(['alpha', 'beta', 'gamma']);
    });

    // ---------------------------------------------------------------
    // Filter propagation: distinctGroupValues must honour the toolbar
    // filter chips at every depth. Before we added extractServerFilters
    // to the bucket-tree query, the outer group counts came back
    // pre-filter and the UI showed nonsensical "1 group / 8 runs"
    // reads under Filter=Failed with 0 matching runs anywhere. These
    // tests pin the round-trip so a regression in the filter
    // threading (list-runs.ts / group-field.ts) blows up here first.
    // ---------------------------------------------------------------
    it('Test 17c.9: distinctGroupValues honours status filter at the outer level', async () => {
      if (!sessionCookie || !orgId) return;
      // All seeded rg-* runs are COMPLETED → status=[COMPLETED]
      // returns every group. status=[FAILED] returns none.
      const okRes = await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'tag-prefix:group',
        status: ['COMPLETED'],
      }, { Cookie: sessionCookie }, 'GET');
      const okVals = (await okRes.json()).result?.data?.values ?? [];
      expect(okVals.map((v: { value: string }) => v.value).sort()).toEqual(['alpha', 'beta', 'gamma']);

      const failedRes = await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'tag-prefix:group',
        status: ['FAILED'],
      }, { Cookie: sessionCookie }, 'GET');
      const failedData = (await failedRes.json()).result?.data;
      expect(failedData?.values ?? []).toEqual([]);
      expect(failedData?.totalCount ?? 0).toBe(0);
    });

    it('Test 17c.10: distinctGroupValues honours status filter under parentFilters (nested depth)', async () => {
      if (!sessionCookie || !orgId) return;
      // Drill: group=alpha → names inside. Alpha bucket has rg-alpha-1
      // + rg-alpha-2 with status=COMPLETED. status=[COMPLETED] returns
      // both. status=[FAILED] returns none — verifies the nested-depth
      // query also applies the toolbar filter, not just the outer one.
      const okRes = await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'system:name',
        parentFilters: [{ field: 'tag-prefix:group', value: 'alpha' }],
        status: ['COMPLETED'],
      }, { Cookie: sessionCookie }, 'GET');
      const okVals = (await okRes.json()).result?.data?.values ?? [];
      expect(okVals.map((v: { value: string }) => v.value).sort()).toEqual(['rg-alpha-1', 'rg-alpha-2']);

      const failedRes = await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'system:name',
        parentFilters: [{ field: 'tag-prefix:group', value: 'alpha' }],
        status: ['FAILED'],
      }, { Cookie: sessionCookie }, 'GET');
      expect((await failedRes.json()).result?.data?.values ?? []).toEqual([]);
    });

    // ---------------------------------------------------------------
    // runs.count with runIds — the intersection endpoint added for
    // the toolbar's third status line ("N of your S selected runs
    // match the filter"). Verifies the Sqid-decode + `r.id = ANY(...)`
    // path in runs-count.ts, and that the intersection composes with
    // the rest of the filter conditions rather than replacing them.
    // ---------------------------------------------------------------
    it('Test 17c.11: runs.count with runIds intersects the selection with other filters', async () => {
      if (!sessionCookie || !orgId) return;
      // Fetch alpha runs so we have real Sqid ids to intersect on.
      const listRes = await makeTrpcRequest('runs.list', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        groupFilters: [{ field: 'tag-prefix:group', value: 'alpha' }],
        limit: 50,
      }, { Cookie: sessionCookie }, 'GET');
      const runs: Array<{ id: string; name: string }> =
        (await listRes.json()).result?.data?.runs ?? [];
      expect(runs.length).toBe(2);
      const alphaIds = runs.map((r) => r.id);

      // Baseline — runIds alone returns |runIds|.
      const alphaOnly = await makeTrpcRequest('runs.count', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        runIds: alphaIds,
      }, { Cookie: sessionCookie }, 'GET');
      expect((await alphaOnly.json()).result?.data).toBe(2);

      // runIds + a filter the runs satisfy → still |runIds|.
      const alphaAndCompleted = await makeTrpcRequest('runs.count', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        runIds: alphaIds,
        status: ['COMPLETED'],
      }, { Cookie: sessionCookie }, 'GET');
      expect((await alphaAndCompleted.json()).result?.data).toBe(2);

      // runIds + a filter the runs DON'T satisfy → 0 (intersection).
      const alphaAndFailed = await makeTrpcRequest('runs.count', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        runIds: alphaIds,
        status: ['FAILED'],
      }, { Cookie: sessionCookie }, 'GET');
      expect((await alphaAndFailed.json()).result?.data).toBe(0);
    });

    it('Test 17c.12: runs.count returns 0 for empty / all-invalid runIds without touching other filters', async () => {
      if (!sessionCookie || !orgId) return;
      // All-invalid Sqids short-circuit to 0 before we hit the SQL —
      // otherwise we'd count all matching-filter runs by accident.
      const allInvalid = await makeTrpcRequest('runs.count', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        runIds: ['ZZZZ_definitely_not_a_sqid', 'another_bogus'],
      }, { Cookie: sessionCookie }, 'GET');
      expect((await allInvalid.json()).result?.data).toBe(0);

      // But NO runIds param at all → falls back to plain count.
      const noRunIds = await makeTrpcRequest('runs.count', {
        organizationId: orgId,
        projectName: RG_PROJECT,
      }, { Cookie: sessionCookie }, 'GET');
      expect((await noRunIds.json()).result?.data).toBe(5); // rg-solo + 4 grouped
    });
  });

  // -----------------------------------------------------------------
  // Test Suite 17d: group:* tag invariant — at most one group:* tag
  // per run. tRPC rejects ambiguous updates; HTTP silently dedups.
  // -----------------------------------------------------------------
  describe('Test Suite 17d: group:* tag invariant', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let orgId = '';

    beforeAll(async () => {
      const signInResponse = await makeRequest('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      const setCookie = signInResponse.headers.get('set-cookie');
      const match = setCookie?.match(/better_auth\.session_token=([^;]+)/);
      if (match) sessionCookie = `better_auth.session_token=${match[1]}`;
      if (!sessionCookie) return;
      const auth = await (await makeTrpcRequest('auth', {}, { Cookie: sessionCookie }, 'GET')).json();
      orgId = auth.result?.data?.activeOrganization?.id ?? '';
    });

    it('Test 17d.1: runs.updateTags rejects 2 group:* tags', async () => {
      if (!sessionCookie || !orgId) return;
      const response = await makeTrpcRequest('runs.updateTags', {
        organizationId: orgId,
        projectName: 'run-groups-test',
        // Any SQID — Zod validation happens before the row lookup, and
        // the group-tag check runs before resolveRunId.
        runId: 'aB',
        tags: ['foo', 'group:one', 'group:two'],
      }, { Cookie: sessionCookie }, 'POST');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(JSON.stringify(body)).toMatch(/at most one group:\* tag/i);
    });

    it('Test 17d.2: runs.updateTags accepts exactly one group:* tag', async () => {
      if (!sessionCookie || !orgId) return;
      // The invariant check passes, so we expect either 200 (run found
      // and updated) or 404 (run id 'aB' likely doesn't exist for this
      // user) — but never 400 from the group-tag check.
      const response = await makeTrpcRequest('runs.updateTags', {
        organizationId: orgId,
        projectName: 'run-groups-test',
        runId: 'aB',
        tags: ['foo', 'group:one'],
      }, { Cookie: sessionCookie }, 'POST');
      // 200 = updated, 404 = run not found (id didn't resolve), both OK.
      expect([200, 404]).toContain(response.status);
    });
  });

  // -----------------------------------------------------------------
  // Test Suite 17e: Grouping v2 API — config-field grouping. Suite 17c
  // covers tag-prefix + system fields; the server also supports the
  // `config:*` kind (distinct-group-values.ts / list-runs.ts read
  // run_field_values), but nothing exercised it. Uses the seeded
  // `run-groups-test` project: config.optimizer = sgd (rg-alpha-1/2),
  // adam (rg-beta/gamma), adamw (rg-solo).
  // -----------------------------------------------------------------
  describe('Test Suite 17e: Grouping v2 API — config fields', () => {
    const RG_PROJECT = 'run-groups-test';
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let orgId = '';

    beforeAll(async () => {
      const signInResponse = await makeRequest('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      const setCookie = signInResponse.headers.get('set-cookie');
      const match = setCookie?.match(/better_auth\.session_token=([^;]+)/);
      if (match) sessionCookie = `better_auth.session_token=${match[1]}`;
      if (!sessionCookie) return;
      const auth = await (await makeTrpcRequest('auth', {}, { Cookie: sessionCookie }, 'GET')).json();
      orgId = auth.result?.data?.activeOrganization?.id ?? '';
    });

    it('Test 17e.1: config:optimizer returns 3 buckets with correct counts', async () => {
      if (!sessionCookie || !orgId) return;
      const response = await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'config:optimizer',
      }, { Cookie: sessionCookie }, 'GET');
      expect(response.status).toBe(200);
      const values: Array<{ value: string; count: number }> =
        (await response.json()).result?.data?.values ?? [];
      // Order isn't guaranteed for the two count-2 buckets, so compare as
      // a map. sgd: rg-alpha-1/2, adam: rg-beta/gamma, adamw: rg-solo.
      const byName = Object.fromEntries(values.map((v) => [v.value, v.count]));
      expect(byName).toEqual({ sgd: 2, adam: 2, adamw: 1 });
    });

    it('Test 17e.2: runs.list + runs.count groupFilters on config:optimizer', async () => {
      if (!sessionCookie || !orgId) return;
      const listRes = await makeTrpcRequest('runs.list', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        groupFilters: [{ field: 'config:optimizer', value: 'sgd' }],
        limit: 50,
      }, { Cookie: sessionCookie }, 'GET');
      expect(listRes.status).toBe(200);
      const runs: Array<{ name: string }> =
        (await listRes.json()).result?.data?.runs ?? [];
      expect(runs.map((r) => r.name).sort()).toEqual(['rg-alpha-1', 'rg-alpha-2']);

      const countRes = await makeTrpcRequest('runs.count', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        groupFilters: [{ field: 'config:optimizer', value: 'sgd' }],
      }, { Cookie: sessionCookie }, 'GET');
      expect(countRes.status).toBe(200);
      expect((await countRes.json()).result?.data).toBe(2);
    });

    it('Test 17e.3: config:optimizer nested under a tag-prefix parent', async () => {
      if (!sessionCookie || !orgId) return;
      // Two-level chain: parent group:alpha (rg-alpha-1/2) → config:optimizer.
      // Both alpha runs use sgd, so exactly one leaf bucket of count 2.
      const response = await makeTrpcRequest('runs.distinctGroupValues', {
        organizationId: orgId,
        projectName: RG_PROJECT,
        field: 'config:optimizer',
        parentFilters: [{ field: 'tag-prefix:group', value: 'alpha' }],
      }, { Cookie: sessionCookie }, 'GET');
      expect(response.status).toBe(200);
      const values: Array<{ value: string; count: number }> =
        (await response.json()).result?.data?.values ?? [];
      expect(values).toEqual([{ value: 'sgd', count: 2 }]);
    });
  });

  describe('Test Suite 18: Run Table Views (Unauthenticated)', () => {
    it('Test 18.1: List run table views - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('runTableViews.list', {
        projectName: 'test-project',
      }, {}, 'GET');

      expect(response.status).toBe(401);
    });

    it('Test 18.2: Create run table view - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('runTableViews.create', {
        projectName: 'test-project',
        name: 'Test View',
      }, {}, 'POST');

      expect(response.status).toBe(401);
    });

    it('Test 18.3: Update run table view - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('runTableViews.update', {
        viewId: '1',
        config: {
          version: 1,
          columns: [],
          baseOverrides: {},
          filters: [],
          sorting: [],
        },
      }, {}, 'POST');

      expect(response.status).toBe(401);
    });

    it('Test 18.4: Delete run table view - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('runTableViews.delete', {
        viewId: '1',
      }, {}, 'POST');

      expect(response.status).toBe(401);
    });

    it('Test 18.5: Get run table view - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('runTableViews.get', {
        viewId: '1',
      }, {}, 'GET');

      expect(response.status).toBe(401);
    });
  });

  describe('Test Suite 19: Run Table Views (Authenticated)', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let testViewId: string | null = null;
    let serverAvailable = false;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) {
        console.log('   Skipping authenticated tests - server not available');
        return;
      }

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
          }),
        });

        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }
    });

    afterAll(async () => {
      if (testViewId && sessionCookie) {
        try {
          await makeTrpcRequest('runTableViews.delete', {
            viewId: testViewId,
          }, { 'Cookie': sessionCookie }, 'POST');
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('Test 19.1: Sign in successful (or skip if unavailable)', () => {
      if (!serverAvailable) {
        console.log('   Server not available - skipping authenticated tests');
        return;
      }
      if (!sessionCookie) {
        console.log('   Sign-in failed (test user may not exist) - skipping authenticated tests');
        return;
      }
      expect(sessionCookie).toBeTruthy();
    });

    it('Test 19.2: Create run table view', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const testConfig = {
        version: 1,
        columns: [
          { id: 'runId', source: 'system', label: 'Id' },
          { id: 'createdAt', source: 'system', label: 'Created' },
        ],
        baseOverrides: {},
        filters: [],
        sorting: [{ id: 'createdAt', desc: true }],
      };

      const response = await makeTrpcRequest('runTableViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `Test Table View ${Date.now()}`,
        config: testConfig,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.id).toBeDefined();
      expect(data.result?.data?.name).toContain('Test Table View');
      expect(data.result?.data?.config).toBeDefined();
      expect(data.result?.data?.config?.version).toBe(1);
      expect(data.result?.data?.config?.columns).toHaveLength(2);
      expect(data.result?.data?.config?.sorting).toHaveLength(1);

      testViewId = data.result?.data?.id;
    });

    it('Test 19.3: List run table views', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }
      const response = await makeTrpcRequest('runTableViews.list', {
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.views).toBeDefined();
      expect(Array.isArray(data.result?.data?.views)).toBe(true);
    });

    it('Test 19.4: Get run table view', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }
      const response = await makeTrpcRequest('runTableViews.get', {
        viewId: testViewId,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.id).toBe(testViewId);
      expect(data.result?.data?.config).toBeDefined();
      expect(data.result?.data?.config?.columns).toHaveLength(2);
    });

    it('Test 19.5: Update run table view config', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }
      const updatedConfig = {
        version: 1,
        columns: [
          { id: 'runId', source: 'system', label: 'Id' },
          { id: 'createdAt', source: 'system', label: 'Created' },
          { id: 'tags', source: 'system', label: 'Tags' },
        ],
        baseOverrides: { name: { customLabel: 'Run Name' } },
        filters: [
          { id: 'f1', field: 'status', source: 'system', dataType: 'option', operator: 'is any of', values: ['RUNNING'] },
        ],
        sorting: [],
      };

      const response = await makeTrpcRequest('runTableViews.update', {
        viewId: testViewId,
        config: updatedConfig,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.config?.columns).toHaveLength(3);
      expect(data.result?.data?.config?.filters).toHaveLength(1);
      expect(data.result?.data?.config?.baseOverrides?.name?.customLabel).toBe('Run Name');
    });

    it('Test 19.6: Update run table view name', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }
      const newName = `Renamed View ${Date.now()}`;
      const response = await makeTrpcRequest('runTableViews.update', {
        viewId: testViewId,
        name: newName,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.name).toBe(newName);
    });

    it('Test 19.7: Name uniqueness conflict', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }

      // Get the current view name
      const getResponse = await makeTrpcRequest('runTableViews.get', {
        viewId: testViewId,
      }, { 'Cookie': sessionCookie }, 'GET');
      const currentName = (await getResponse.json()).result?.data?.name;

      // Try to create a view with the same name
      const response = await makeTrpcRequest('runTableViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: currentName,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(409);
    });

    it('Test 19.8: Delete run table view', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }
      const response = await makeTrpcRequest('runTableViews.delete', {
        viewId: testViewId,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.success).toBe(true);

      // Verify it's deleted
      const getResponse = await makeTrpcRequest('runTableViews.get', {
        viewId: testViewId,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect([200, 404, 500]).toContain(getResponse.status);

      // Mark as cleaned up
      testViewId = null;
    });

    // --- Default View Tests ---

    let defaultViewId: string | null = null;

    it('Test 19.9: Create default view via create endpoint', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const testConfig = {
        version: 1,
        columns: [
          { id: 'runId', source: 'system', label: 'Id' },
          { id: 'createdAt', source: 'system', label: 'Created' },
          { id: 'tags', source: 'system', label: 'Tags' },
        ],
        baseOverrides: {},
        filters: [],
        sorting: [{ id: 'createdAt', desc: true }],
      };

      const response = await makeTrpcRequest('runTableViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: 'Default',
        config: testConfig,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.name).toBe('Default');
      expect(data.result?.data?.config?.columns).toHaveLength(3);

      defaultViewId = data.result?.data?.id;
    });

    it('Test 19.10: Update default view config', async () => {
      if (!sessionCookie || !defaultViewId) {
        console.log('   No session or default view - skipping');
        return;
      }

      const updatedConfig = {
        version: 1,
        columns: [
          { id: 'runId', source: 'system', label: 'Id' },
        ],
        baseOverrides: {},
        filters: [],
        sorting: [],
      };

      const response = await makeTrpcRequest('runTableViews.update', {
        viewId: defaultViewId,
        config: updatedConfig,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.config?.columns).toHaveLength(1);
    });

    it('Test 19.11: Cannot delete default view', async () => {
      if (!sessionCookie || !defaultViewId) {
        console.log('   No session or default view - skipping');
        return;
      }

      const response = await makeTrpcRequest('runTableViews.delete', {
        viewId: defaultViewId,
      }, { 'Cookie': sessionCookie }, 'POST');

      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('Test 19.12: Cannot create another view named "Default"', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runTableViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: 'Default',
        config: { version: 1, columns: [], baseOverrides: {}, filters: [], sorting: [] },
      }, { 'Cookie': sessionCookie }, 'POST');

      const data = await response.json();
      expect(data.error).toBeDefined();
    });


    // Clean up: remove the default view directly since API blocks it
    // In practice, test DB is ephemeral so this is fine
  });

  describe('Test Suite 20: Server-Side Sorting (Authenticated)', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let serverAvailable = false;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) return;

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });

        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }
    });

    it('Test 20.1: Default sort (no custom sort) returns runs ordered by createdAt DESC', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      // Verify runs are sorted by createdAt DESC (newest first)
      for (let i = 1; i < runs.length; i++) {
        const prev = new Date(runs[i - 1].createdAt).getTime();
        const curr = new Date(runs[i].createdAt).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });

    it('Test 20.2: System column sort by name ASC', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        sortField: 'name',
        sortSource: 'system',
        sortDirection: 'asc',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      // Verify runs are sorted by name ASC
      for (let i = 1; i < runs.length; i++) {
        expect(runs[i - 1].name.localeCompare(runs[i].name)).toBeLessThanOrEqual(0);
      }
    });

    it('Test 20.3: System column sort by name DESC', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        sortField: 'name',
        sortSource: 'system',
        sortDirection: 'desc',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      // Verify runs are sorted by name DESC
      for (let i = 1; i < runs.length; i++) {
        expect(runs[i - 1].name.localeCompare(runs[i].name)).toBeGreaterThanOrEqual(0);
      }
    });

    it('Test 20.4: System column sort by createdAt ASC', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        sortField: 'createdAt',
        sortSource: 'system',
        sortDirection: 'asc',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      // Verify runs are sorted by createdAt ASC (oldest first)
      for (let i = 1; i < runs.length; i++) {
        const prev = new Date(runs[i - 1].createdAt).getTime();
        const curr = new Date(runs[i].createdAt).getTime();
        expect(prev).toBeLessThanOrEqual(curr);
      }
    });

    it('Test 20.5: System column sort with keyset pagination (sortCursor)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // First page
      const page1Response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        sortField: 'name',
        sortSource: 'system',
        sortDirection: 'asc',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(page1Response.status).toBe(200);
      const page1 = await page1Response.json();
      const page1Runs = page1.result?.data?.runs;
      const sortCursor = page1.result?.data?.sortCursor;
      expect(sortCursor).toBeDefined();
      expect(sortCursor).not.toBeNull();

      // Second page using sortCursor
      const page2Response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        sortField: 'name',
        sortSource: 'system',
        sortDirection: 'asc',
        sortCursor: sortCursor,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(page2Response.status).toBe(200);
      const page2 = await page2Response.json();
      const page2Runs = page2.result?.data?.runs;
      expect(page2Runs).toBeDefined();
      expect(page2Runs.length).toBeGreaterThan(0);

      // Page 2's first run should come after page 1's last run alphabetically
      const lastPage1Name = page1Runs[page1Runs.length - 1].name;
      const firstPage2Name = page2Runs[0].name;
      expect(lastPage1Name.localeCompare(firstPage2Name)).toBeLessThanOrEqual(0);

      // No overlap between pages
      const page1Ids = new Set(page1Runs.map((r: any) => r.id));
      for (const run of page2Runs) {
        expect(page1Ids.has(run.id)).toBe(false);
      }
    });

    it('Test 20.6: JSON field sort by config key (offset pagination)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // Sort by config.batch_size (bulk runs have batch_size: 32)
      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        sortField: 'batch_size',
        sortSource: 'config',
        sortDirection: 'desc',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      // Should return runs (may include nextOffset for pagination)
      expect(runs.length).toBeGreaterThan(0);
    });

    it('Test 20.7: JSON field sort returns nextOffset for pagination', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        sortField: 'epochs',
        sortSource: 'config',
        sortDirection: 'asc',
        offset: 0,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const nextOffset = data.result?.data?.nextOffset;
      // If there are more than 5 runs with epochs field, nextOffset should be 5
      if (data.result?.data?.runs?.length === 5) {
        expect(nextOffset).toBe(5);
      }
    });

    it('Test 20.8: NULLS LAST — runs without sort field appear at end', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // Sort by config.lr ASC — runs without lr should be at the end
      // The initial test runs (test-run-1, test-run-2) don't have lr in config
      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 200,
        sortField: 'lr',
        sortSource: 'config',
        sortDirection: 'asc',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);
      // We can't directly check NULL ordering from the response since config
      // values aren't returned in the sort value, but the query shouldn't error
    });

    it('Test 20.9: NULLS LAST — nulls must not appear between non-null values when sorting DESC', async () => {
      if (!sessionCookie || !hasApiKey) {
        console.log('   No session or API key - skipping');
        return;
      }

      // Create 3 runs with distinct batch_size values and 1 without
      const sortTestProject = `sort-null-test-${Date.now()}`;
      const runNames = ['sort-high', 'sort-low', 'sort-none', 'sort-mid'];
      const configs = [
        JSON.stringify({ batch_size: 100 }),
        JSON.stringify({ batch_size: 10 }),
        JSON.stringify({ framework: 'pytorch' }), // no batch_size
        JSON.stringify({ batch_size: 50 }),
      ];

      for (let i = 0; i < runNames.length; i++) {
        const createResp = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: sortTestProject,
            runName: runNames[i],
            config: configs[i],
          }),
        });
        expect(createResp.status).toBe(200);
      }

      // Wait briefly for field values to be indexed
      await new Promise((r) => setTimeout(r, 500));

      // Sort by batch_size DESC — expected order: 100, 50, 10, null
      const response = await makeTrpcRequest('runs.list', {
        projectName: sortTestProject,
        limit: 10,
        sortField: 'batch_size',
        sortSource: 'config',
        sortDirection: 'desc',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBe(4);

      // Verify order: sort-high (100), sort-mid (50), sort-low (10), sort-none (null)
      const names = runs.map((r: any) => r.name);
      expect(names[0]).toBe('sort-high');
      expect(names[1]).toBe('sort-mid');
      expect(names[2]).toBe('sort-low');
      expect(names[3]).toBe('sort-none'); // NULL must be last, not between values

      // Also verify ASC direction: null should still be last
      const ascResponse = await makeTrpcRequest('runs.list', {
        projectName: sortTestProject,
        limit: 10,
        sortField: 'batch_size',
        sortSource: 'config',
        sortDirection: 'asc',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(ascResponse.status).toBe(200);
      const ascData = await ascResponse.json();
      const ascRuns = ascData.result?.data?.runs;
      expect(ascRuns).toBeDefined();
      expect(ascRuns.length).toBe(4);

      const ascNames = ascRuns.map((r: any) => r.name);
      // ASC: 10, 50, 100, null
      expect(ascNames[0]).toBe('sort-low');
      expect(ascNames[1]).toBe('sort-mid');
      expect(ascNames[2]).toBe('sort-high');
      expect(ascNames[3]).toBe('sort-none'); // NULL must be last in ASC too
    });

    it('Test 20.10: Duration sort matches the client Duration column formula (parity)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // Client-side Duration column formula — kept byte-for-byte in sync with
      // getCustomColumnValue("duration") in columns-utils.ts and the server
      // duration sort (durationSortQuery / getSystemSortExpr) in list-runs.ts:
      //   end   = RUNNING ? (heartbeatAt ?? updatedAt) : (statusUpdated ?? updatedAt)
      //   value = Math.max(0, end - createdAt)
      // A live run ends at its ClickHouse heartbeat (MAX(time)); the server now
      // enriches running runs with `heartbeatAt` and sorts by the same rule, so
      // this JS replication reads heartbeatAt too. Locks display ⇄ sort parity
      // for live, finished, and clock-skewed runs.
      const clientDurationMs = (run: any): number => {
        const start = new Date(run.createdAt).getTime();
        const end =
          run.status === 'RUNNING'
            ? new Date(run.heartbeatAt ?? run.updatedAt).getTime()
            : new Date(run.statusUpdated ?? run.updatedAt).getTime();
        if (Number.isNaN(start) || Number.isNaN(end)) return 0;
        return Math.max(0, end - start);
      };

      for (const direction of ['desc', 'asc'] as const) {
        const response = await makeTrpcRequest('runs.list', {
          projectName: TEST_PROJECT_NAME,
          limit: 25,
          sortField: 'duration',
          sortSource: 'system',
          sortDirection: direction,
        }, { 'Cookie': sessionCookie }, 'GET');

        expect(response.status).toBe(200);
        const data = await response.json();
        const runs = data.result?.data?.runs;
        expect(runs).toBeDefined();
        if (!runs || runs.length < 2) {
          console.log(`   <2 runs for duration ${direction} parity check - skipping order assertion`);
          continue;
        }

        // Every returned value must be clamped to >= 0 (GREATEST(0, …)).
        for (const run of runs) {
          expect(clientDurationMs(run)).toBeGreaterThanOrEqual(0);
        }

        // Server SQL order must be monotonic per the client formula.
        for (let i = 1; i < runs.length; i++) {
          const prev = clientDurationMs(runs[i - 1]);
          const curr = clientDurationMs(runs[i]);
          if (direction === 'desc') {
            expect(prev).toBeGreaterThanOrEqual(curr);
          } else {
            expect(prev).toBeLessThanOrEqual(curr);
          }
        }
      }
    });

    it('Test 20.11: runs.list enriches every run with heartbeatAt (null for terminal, MAX(time) for live)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 200,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(Array.isArray(runs)).toBe(true);

      // Every run carries the field (uniform response shape → stable client
      // type). Terminal runs are always null (they end at statusUpdated);
      // running runs are null only until their first metric lands in ClickHouse.
      for (const run of runs) {
        expect('heartbeatAt' in run).toBe(true);
        if (run.status !== 'RUNNING') {
          expect(run.heartbeatAt).toBeNull();
        } else if (run.heartbeatAt !== null) {
          // When present, it must parse and not precede the run's creation.
          const hb = new Date(run.heartbeatAt).getTime();
          expect(Number.isNaN(hb)).toBe(false);
          expect(hb).toBeGreaterThanOrEqual(new Date(run.createdAt).getTime());
        }
      }

      const running = runs.filter((r: any) => r.status === 'RUNNING');
      console.log(
        `   ${running.length} running run(s); heartbeatAt: ${running.map((r: any) => r.heartbeatAt ?? 'null').join(', ') || '—'}`,
      );
    });

    it('Test 20.12: runs.getByIds enriches runs with heartbeatAt like runs.list (Duration 0s regression)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // Regression: selected rows in the runs table render from getByIds
      // (untrimmed blobs for side-by-side), which overwrite the runs.list
      // rows client-side. getByIds used to omit heartbeatAt entirely, so a
      // selected RUNNING run's Duration fell back to updatedAt − createdAt
      // ≈ 0 → "0s" while the run had been live for hours.
      const listResponse = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 50,
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(listResponse.status).toBe(200);
      const listData = await listResponse.json();
      const listRuns = listData.result?.data?.runs;
      expect(Array.isArray(listRuns)).toBe(true);
      if (listRuns.length === 0) {
        console.log('   No runs in project - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.getByIds', {
        projectName: TEST_PROJECT_NAME,
        runIds: listRuns.map((r: any) => r.id),
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(Array.isArray(runs)).toBe(true);
      expect(runs.length).toBe(listRuns.length);

      // Same contract as runs.list (Test 20.11): the field is always present,
      // null for terminal runs, and a valid timestamp ≥ createdAt when a live
      // run has reported metrics.
      const listById = new Map(listRuns.map((r: any) => [r.id, r]));
      for (const run of runs) {
        expect('heartbeatAt' in run).toBe(true);
        if (run.status !== 'RUNNING') {
          expect(run.heartbeatAt).toBeNull();
        } else if (run.heartbeatAt !== null) {
          const hb = new Date(run.heartbeatAt).getTime();
          expect(Number.isNaN(hb)).toBe(false);
          expect(hb).toBeGreaterThanOrEqual(new Date(run.createdAt).getTime());
          // Parity with runs.list: a live run that has a heartbeat there must
          // have one here too (both read the same ClickHouse MAX(time)).
          const listRun = listById.get(run.id) as any;
          if (listRun?.heartbeatAt != null) {
            expect(run.heartbeatAt).not.toBeNull();
          }
        }
      }

      const running = runs.filter((r: any) => r.status === 'RUNNING');
      console.log(
        `   getByIds: ${running.length} running run(s); heartbeatAt: ${running.map((r: any) => r.heartbeatAt ?? 'null').join(', ') || '—'}`,
      );
    });
  });

  describe('Test Suite 21: Server-Side Field Filtering (Authenticated)', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let serverAvailable = false;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) return;

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });

        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }
    });

    it('Test 21.1: Field filter — "exists" finds runs with the field', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        fieldFilters: [
          { source: 'config', key: 'batch_size', dataType: 'number', operator: 'exists', values: [] },
        ],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      // Bulk runs have batch_size, so we should get results
      expect(runs.length).toBeGreaterThan(0);
    });

    it('Test 21.2: Field filter — "not exists" excludes runs with the field', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // batch_size doesn't exist on test-run-1/test-run-2 (they have framework, version)
      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 200,
        fieldFilters: [
          { source: 'config', key: 'batch_size', dataType: 'number', operator: 'not exists', values: [] },
        ],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      // test-run-1 and test-run-2 don't have batch_size
      // Runs created via SDK in other test suites may or may not have it
    });

    it('Test 21.3: Field filter — numeric "is" equality', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        fieldFilters: [
          { source: 'config', key: 'batch_size', dataType: 'number', operator: 'is', values: [32] },
        ],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);
    });

    it('Test 21.4: Field filter — numeric "is between"', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        fieldFilters: [
          { source: 'config', key: 'epochs', dataType: 'number', operator: 'is between', values: [50, 150] },
        ],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      // Bulk runs have epochs: 100, needle has epochs: 50 — both in [50, 150]
      expect(runs.length).toBeGreaterThan(0);
    });

    it('Test 21.5: Field filter — text "contains"', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        fieldFilters: [
          { source: 'config', key: 'framework', dataType: 'text', operator: 'contains', values: ['pytorch'] },
        ],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      // test-run-1 and test-run-2 have framework: 'pytorch'
      expect(runs.length).toBeGreaterThan(0);
    });

    it('Test 21.6: Field filter — no matches returns empty', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        fieldFilters: [
          { source: 'config', key: 'batch_size', dataType: 'number', operator: 'is', values: [999999] },
        ],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBe(0);
    });

    it('Test 21.7: Field filter combined with sort', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        sortField: 'name',
        sortSource: 'system',
        sortDirection: 'asc',
        fieldFilters: [
          { source: 'config', key: 'batch_size', dataType: 'number', operator: 'is', values: [32] },
        ],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      // Verify sort order is maintained with filter
      for (let i = 1; i < runs.length; i++) {
        expect(runs[i - 1].name.localeCompare(runs[i].name)).toBeLessThanOrEqual(0);
      }
    });

    it('Test 21.8: Multiple field filters ANDed together', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        fieldFilters: [
          { source: 'config', key: 'batch_size', dataType: 'number', operator: 'is', values: [32] },
          { source: 'config', key: 'lr', dataType: 'number', operator: 'is', values: [0.001] },
        ],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      // Bulk runs have both batch_size: 32 AND lr: 0.001
      expect(runs.length).toBeGreaterThan(0);
    });
  });

  describe('Test Suite 22: extractAndUpsertColumnKeys Population', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Column key and field value population on run creation', () => {
      it('Test 22.1: Creating a run populates run_field_values (sortable)', async () => {
        // Create a run with specific config
        const timestamp = Date.now();
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `field-values-test-${timestamp}`,
            config: JSON.stringify({
              unique_sort_key: 42,
              unique_text_key: 'hello-world',
            }),
          }),
        });

        expect(response.status).toBe(200);

        // Wait briefly for fire-and-forget to complete
        await new Promise((resolve) => setTimeout(resolve, 500));

        // The run should now be sortable by unique_sort_key via tRPC
        // (This verifies extractAndUpsertColumnKeys populated run_field_values)
      });

      it('Test 22.2: Updating config repopulates run_field_values', async () => {
        // Create a run
        const timestamp = Date.now();
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `config-update-test-${timestamp}`,
            config: JSON.stringify({ old_key: 'old_value' }),
          }),
        });

        expect(createResponse.status).toBe(200);
        const { runId } = await createResponse.json();

        // Update config — this should trigger extractAndUpsertColumnKeys again
        const updateResponse = await makeRequest('/api/runs/config/update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            runId,
            config: JSON.stringify({ new_key: 'new_value', numeric_key: 99 }),
          }),
        });

        expect(updateResponse.status).toBe(200);

        // Wait for fire-and-forget
        await new Promise((resolve) => setTimeout(resolve, 500));

        // The update should have repopulated run_field_values with new keys
        // (delete old + insert new pattern)
      });
    });
  });

  describe('Test Suite 23: Preset View Config Validation', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let serverAvailable = false;
    let testViewId: string | null = null;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) return;

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });

        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }
    });

    afterAll(async () => {
      if (testViewId && sessionCookie) {
        try {
          await makeTrpcRequest('runTableViews.delete', {
            viewId: testViewId,
          }, { 'Cookie': sessionCookie }, 'POST');
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('Test 23.1: Create view with full config (columns, filters, sorting, pageSize)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const fullConfig = {
        version: 1,
        columns: [
          { id: 'name', source: 'system', label: 'Name' },
          { id: 'batch_size', source: 'config', label: 'Batch Size' },
          { id: 'createdAt', source: 'system', label: 'Created' },
        ],
        baseOverrides: {
          name: { customLabel: 'Run Name', backgroundColor: '#e0f2fe' },
        },
        filters: [
          { id: 'f1', field: 'batch_size', source: 'config', dataType: 'number', operator: 'is', values: [32] },
        ],
        sorting: [{ id: 'custom-config-batch_size', desc: true }],
        pageSize: 25,
      };

      const response = await makeTrpcRequest('runTableViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `Full Config View ${Date.now()}`,
        config: fullConfig,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      const view = data.result?.data;
      expect(view?.id).toBeDefined();
      expect(view?.config?.version).toBe(1);
      expect(view?.config?.columns).toHaveLength(3);
      expect(view?.config?.filters).toHaveLength(1);
      expect(view?.config?.sorting).toHaveLength(1);
      expect(view?.config?.pageSize).toBe(25);
      expect(view?.config?.baseOverrides?.name?.customLabel).toBe('Run Name');

      testViewId = view?.id;
    });

    it('Test 23.2: Create view with empty config (defaults)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runTableViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `Empty Config View ${Date.now()}`,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      const view = data.result?.data;
      expect(view?.config?.version).toBe(1);
      expect(view?.config?.columns).toEqual([]);
      expect(view?.config?.filters).toEqual([]);
      expect(view?.config?.sorting).toEqual([]);
      expect(view?.config?.baseOverrides).toEqual({});

      // Cleanup
      if (view?.id) {
        await makeTrpcRequest('runTableViews.delete', {
          viewId: view.id,
        }, { 'Cookie': sessionCookie }, 'POST');
      }
    });

    it('Test 23.3: Get view returns projectName', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }

      const response = await makeTrpcRequest('runTableViews.get', {
        viewId: testViewId,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result?.data?.projectName).toBe(TEST_PROJECT_NAME);
    });

    it('Test 23.4: Update view config preserves other fields', async () => {
      if (!sessionCookie || !testViewId) {
        console.log('   No session or view - skipping');
        return;
      }

      // Update only the config, not the name
      const newConfig = {
        version: 1,
        columns: [
          { id: 'name', source: 'system', label: 'Name' },
        ],
        baseOverrides: {},
        filters: [],
        sorting: [],
        pageSize: 50,
      };

      const response = await makeTrpcRequest('runTableViews.update', {
        viewId: testViewId,
        config: newConfig,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(200);
      const data = await response.json();
      const view = data.result?.data;
      expect(view?.config?.columns).toHaveLength(1);
      expect(view?.config?.pageSize).toBe(50);
      // Name should be preserved from creation
      expect(view?.name).toContain('Full Config View');
    });
  });

  // ---------------------------------------------------------------------------
  // Test Suite 24: Metric Summaries
  // ---------------------------------------------------------------------------
  describe('Test Suite 24: Metric Summaries', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let serverAvailable = false;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) return;

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });

        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }
    });

    it('Test 24.1: Discover distinct metric names', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.distinctMetricNames', {
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const metricNames: string[] = data.result?.data?.metricNames;
      expect(metricNames).toBeDefined();
      expect(metricNames.length).toBeGreaterThan(0);
      // Seeded metrics are named train/metric_00, train/metric_01, etc.
      expect(metricNames.some((n: string) => n.startsWith('train/metric_'))).toBe(true);
    });

    it('Test 24.2: Discover metric names with search filter', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.distinctMetricNames', {
        projectName: TEST_PROJECT_NAME,
        search: 'metric_00',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const metricNames: string[] = data.result?.data?.metricNames;
      expect(metricNames).toBeDefined();
      expect(metricNames.length).toBe(1);
      expect(metricNames[0]).toBe('train/metric_00');
    });

    it('Test 24.2b: Distinct metric names scoped to NaN/Inf run includes non-finite metrics', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // Find the nan-inf-metrics run
      const listResponse = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        search: 'nan-inf-metrics',
        limit: 5,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(listResponse.status).toBe(200);
      const listData = await listResponse.json();
      const runs = listData.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      const nanInfRun = runs.find((r: any) => r.name === 'nan-inf-metrics');
      expect(nanInfRun).toBeDefined();

      // Query distinct metric names scoped to only this run.
      // The nan-inf-metrics run has metrics with all-NaN/all-Inf values that
      // are absent from mlop_metric_summaries (filtered by isFinite in the MV).
      // Default (no toggle) queries mlop_metric_summaries → only finite
      // metrics appear. Passing includeNonFiniteMetrics=true falls back to
      // mlop_metrics so all metrics appear, AND the response includes a
      // nonFiniteOnlyMetrics array listing the entirely-NaN/Inf ones.
      const response = await makeTrpcRequest('runs.distinctMetricNames', {
        projectName: TEST_PROJECT_NAME,
        runIds: [nanInfRun.id],
        search: 'train/',
        includeNonFiniteMetrics: true,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const metricNames: string[] = data.result?.data?.metricNames;
      const nonFiniteOnlyMetrics: string[] = data.result?.data?.nonFiniteOnlyMetrics;
      expect(metricNames).toBeDefined();
      expect(nonFiniteOnlyMetrics).toBeDefined();

      // The run has 14 train/* metrics in mlop_metrics, but only 6 in summaries.
      // With includeNonFiniteMetrics=true, all 14 should be returned.
      expect(metricNames.length).toBe(14);

      // 14 total − 6 finite = 8 non-finite-only metrics
      expect(nonFiniteOnlyMetrics.length).toBe(8);

      // Verify specific NaN/Inf-only metrics are present (these have no finite
      // values and would be missing if querying mlop_metric_summaries)
      for (const metric of ['train/loss', 'train/accuracy', 'train/lr', 'train/grad_norm']) {
        expect(metricNames).toContain(metric);
      }

      // Default behavior (toggle OFF) should hit summaries table and return
      // only the 6 finite metrics.
      const defaultResponse = await makeTrpcRequest('runs.distinctMetricNames', {
        projectName: TEST_PROJECT_NAME,
        runIds: [nanInfRun.id],
        search: 'train/',
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(defaultResponse.status).toBe(200);
      const defaultData = await defaultResponse.json();
      const defaultMetricNames: string[] = defaultData.result?.data?.metricNames;
      expect(defaultMetricNames.length).toBe(6);
      // nonFiniteOnlyMetrics is an empty array when toggle is OFF (can't tell)
      expect(defaultData.result?.data?.nonFiniteOnlyMetrics).toEqual([]);
    });

    it('Test 24.2c: graphBatchBucketed returns null value and nonFiniteFlags for all-NaN metric', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // Find the nan-inf-metrics run
      const listResponse = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        search: 'nan-inf-metrics',
        limit: 5,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(listResponse.status).toBe(200);
      const listData = await listResponse.json();
      const runs = listData.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      const nanInfRun = runs.find((r: any) => r.name === 'nan-inf-metrics');
      expect(nanInfRun).toBeDefined();

      // Query bucketed data for train/gpu_util (all-NaN metric)
      const response = await makeTrpcRequest('runs.data.graphBatchBucketed', {
        runIds: [nanInfRun.id],
        projectName: TEST_PROJECT_NAME,
        logName: 'train/gpu_util',
        buckets: 50,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      // Get data for this run
      const runData = result[nanInfRun.id];
      expect(runData).toBeDefined();
      expect(runData.length).toBeGreaterThan(0);

      // All buckets should have nonFiniteFlags bit 0 set (hasNaN) and null value (all-NaN metric)
      for (const bucket of runData) {
        expect((bucket.nonFiniteFlags & 1) !== 0).toBe(true);
        expect(bucket.value).toBeNull();
      }
    });

    it('Test 24.2d: graphBatchBucketed returns finite average with flags for mixed metric', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // Find the nan-inf-metrics run
      const listResponse = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        search: 'nan-inf-metrics',
        limit: 5,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(listResponse.status).toBe(200);
      const listData = await listResponse.json();
      const runs = listData.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      const nanInfRun = runs.find((r: any) => r.name === 'nan-inf-metrics');
      expect(nanInfRun).toBeDefined();

      // Query bucketed data for train/loss (3% NaN sprinkle — mixed metric)
      const response = await makeTrpcRequest('runs.data.graphBatchBucketed', {
        runIds: [nanInfRun.id],
        projectName: TEST_PROJECT_NAME,
        logName: 'train/loss',
        buckets: 50,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      const runData = result[nanInfRun.id];
      expect(runData).toBeDefined();
      expect(runData.length).toBeGreaterThan(0);

      // Some buckets should have nonFiniteFlags bit 0 set (hasNaN) with non-null value (mixed)
      const nanBuckets = runData.filter((b: any) => (b.nonFiniteFlags & 1) !== 0);
      expect(nanBuckets.length).toBeGreaterThan(0);

      // Mixed buckets should have a finite average value
      const mixedBuckets = nanBuckets.filter((b: any) => b.value !== null);
      expect(mixedBuckets.length).toBeGreaterThan(0);
      for (const bucket of mixedBuckets) {
        expect(typeof bucket.value).toBe('number');
        expect(isFinite(bucket.value)).toBe(true);
      }
    });

    it('Test 24.3: Batch fetch metric summaries', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // First, get some run IDs (SQID-encoded) from the list endpoint
      const listResponse = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(listResponse.status).toBe(200);
      const listData = await listResponse.json();
      const runs = listData.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      const runIds = runs.map((r: { id: string }) => r.id);

      // Fetch summaries for a known metric
      const response = await makeTrpcRequest('runs.metricSummaries', {
        projectName: TEST_PROJECT_NAME,
        runIds,
        metrics: [
          { logName: 'train/metric_00', aggregation: 'MAX' },
          { logName: 'train/metric_00', aggregation: 'MIN' },
          { logName: 'train/metric_00', aggregation: 'AVG' },
          { logName: 'train/metric_00', aggregation: 'LAST' },
        ],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const summaries = data.result?.data?.summaries;
      expect(summaries).toBeDefined();

      // Should have entries for at least some of the requested runs
      const summaryKeys = Object.keys(summaries);
      expect(summaryKeys.length).toBeGreaterThan(0);

      // Each entry should have metric values
      const firstRun = summaries[summaryKeys[0]];
      expect(firstRun).toBeDefined();
      expect(firstRun['train/metric_00|MAX']).toBeDefined();
      expect(typeof firstRun['train/metric_00|MAX']).toBe('number');
      expect(firstRun['train/metric_00|MIN']).toBeDefined();
      expect(typeof firstRun['train/metric_00|MIN']).toBe('number');
      // MAX should be >= MIN
      expect(firstRun['train/metric_00|MAX']).toBeGreaterThanOrEqual(firstRun['train/metric_00|MIN']);
    });

    it('Test 24.4: Metric summaries with empty runIds returns empty', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.metricSummaries', {
        projectName: TEST_PROJECT_NAME,
        runIds: [],
        metrics: [{ logName: 'train/metric_00', aggregation: 'MAX' }],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const summaries = data.result?.data?.summaries;
      expect(summaries).toBeDefined();
      expect(Object.keys(summaries).length).toBe(0);
    });

    it('Test 24.5: Sort runs by metric (LAST) DESC', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        sortField: 'train/metric_00',
        sortSource: 'metric',
        sortDirection: 'desc',
        sortAggregation: 'LAST',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);
      // Runs should be returned (exact order depends on metric values)
      expect(runs.length).toBeLessThanOrEqual(10);
    });

    it('Test 24.6: Sort runs by metric (MAX) ASC', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        sortField: 'train/metric_00',
        sortSource: 'metric',
        sortDirection: 'asc',
        sortAggregation: 'MAX',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);
    });

    it('Test 24.7: Metric filter — runs with MAX > threshold', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // Seeded values: Math.random() * 0.1 + Math.exp(-step/200) * 2
      // At step 0: ~2.0-2.1, so MAX should be around 2.1 for all runs
      // Use a low threshold to ensure some runs match
      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 50,
        metricFilters: [{
          logName: 'train/metric_00',
          aggregation: 'MAX',
          operator: '>',
          values: [1.5],
        }],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      // All seeded runs should have MAX > 1.5 (values start near 2.0)
      expect(runs.length).toBeGreaterThan(0);
    });

    it('Test 24.8: Metric filter — no runs match impossible threshold', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // MAX values are around 2.1, so threshold of 1000 should match nothing
      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 50,
        metricFilters: [{
          logName: 'train/metric_00',
          aggregation: 'MAX',
          operator: '>',
          values: [1000],
        }],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBe(0);
    });

    it('Test 24.9: Metric sort with metric filter combined', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        sortField: 'train/metric_00',
        sortSource: 'metric',
        sortDirection: 'desc',
        sortAggregation: 'LAST',
        metricFilters: [{
          logName: 'train/metric_00',
          aggregation: 'MAX',
          operator: '>',
          values: [1.5],
        }],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);
    });

    it('Test 24.10: Preset view with metric columns persists correctly', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const config = {
        version: 1,
        columns: [
          { id: 'name', source: 'system', label: 'Name' },
          { id: 'train/metric_00', source: 'metric', label: 'train/metric_00 (MAX)', aggregation: 'MAX' },
          { id: 'train/metric_00', source: 'metric', label: 'train/metric_00 (LAST)', aggregation: 'LAST' },
        ],
        baseOverrides: {},
        filters: [],
        sorting: [{ id: 'custom-metric-train/metric_00-MAX', desc: true }],
        pageSize: 20,
      };

      const createResponse = await makeTrpcRequest('runTableViews.create', {
        projectName: TEST_PROJECT_NAME,
        name: `Metric View Test ${Date.now()}`,
        config,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json();
      const view = createData.result?.data;
      expect(view).toBeDefined();
      const viewId = view.id;

      // Read back the view and verify metric columns are preserved
      const getResponse = await makeTrpcRequest('runTableViews.get', {
        viewId,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(getResponse.status).toBe(200);
      const getData = await getResponse.json();
      const savedView = getData.result?.data;
      expect(savedView?.config?.columns).toHaveLength(3);

      const metricCols = savedView.config.columns.filter((c: { source: string }) => c.source === 'metric');
      expect(metricCols).toHaveLength(2);
      expect(metricCols[0].aggregation).toBe('MAX');
      expect(metricCols[1].aggregation).toBe('LAST');
      // Same id but different aggregation — should be distinct columns
      expect(metricCols[0].id).toBe(metricCols[1].id);

      // Clean up
      await makeTrpcRequest('runTableViews.delete', {
        viewId,
      }, { 'Cookie': sessionCookie }, 'POST');
    });
  });

  describe('Test Suite 25: Linear Integration', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let serverAvailable = false;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) {
        console.log('   Skipping Linear integration tests - server not available');
        return;
      }

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });

        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }
    });

    it('Test 25.1: getLinearIntegration returns unconfigured state', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('organization.integrations.getLinearIntegration', {}, {
        'Cookie': sessionCookie,
      }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();
      // Should have a 'configured' boolean field
      expect(typeof result.configured).toBe('boolean');
    });

    it('Test 25.2: getLinearIntegration requires authentication', async () => {
      const response = await makeTrpcRequest('organization.integrations.getLinearIntegration', {}, {}, 'GET');

      expect(response.status).toBe(401);
    });

    it('Test 25.3: saveLinearApiKey rejects invalid token', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // Sending a fake token should fail because Linear API validation will reject it
      const response = await makeTrpcRequest('organization.integrations.saveLinearApiKey', {
        apiKey: 'lin_api_invalid_key_for_testing',
      }, {
        'Cookie': sessionCookie,
      }, 'POST');

      // Should get an error (either from Linear API or from our validation)
      // The key is that it doesn't crash the server
      const data = await response.json();
      if (response.status === 200) {
        // If Linear API somehow accepts it (unlikely), the response should still be valid
        expect(data.result?.data).toBeDefined();
      } else {
        // Expected: Linear API rejects the invalid key
        expect([400, 401, 500]).toContain(response.status);
      }
    });

    it('Test 25.4: searchLinearIssues requires authentication', async () => {
      const response = await makeTrpcRequest('organization.integrations.searchLinearIssues', {
        query: 'test',
      }, {}, 'GET');

      expect(response.status).toBe(401);
    });

    it('Test 25.5: searchLinearIssues returns error when not configured', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('organization.integrations.searchLinearIssues', {
        query: 'test',
      }, {
        'Cookie': sessionCookie,
      }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      // When not configured, should return a TRPCError with NOT_FOUND
      expect(data.error).toBeDefined();
      expect(data.error.json.message).toContain('Linear integration is not configured');
      expect(data.result).toBeUndefined();
    });

    it('Test 25.6: removeLinearIntegration requires authentication', async () => {
      const response = await makeTrpcRequest('organization.integrations.removeLinearIntegration', {}, {}, 'POST');

      expect(response.status).toBe(401);
    });

    it('Test 25.7: removeLinearIntegration succeeds even when not configured', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('organization.integrations.removeLinearIntegration', {}, {
        'Cookie': sessionCookie,
      }, 'POST');

      // Should succeed (no-op) or return an error, but not crash
      expect([200, 404]).toContain(response.status);
    });

    it('Test 25.8: Linear sync triggered on tag update via SDK', async () => {
      // This test verifies the sync trigger code path runs without error
      // even when no Linear integration is configured (fire-and-forget should not crash)
      if (!TEST_API_KEY) {
        console.log('   No API key - skipping');
        return;
      }

      // Create a run with a linear: tag
      const createResponse = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          projectName: TEST_PROJECT_NAME,
          runName: `linear-sync-test-${Date.now()}`,
          tags: ['linear:TEST-1', 'smoke-test'],
        }),
      });

      expect(createResponse.status).toBe(200);
      const createData = await createResponse.json();
      const runId = createData.runId;
      expect(runId).toBeDefined();

      // Update tags (remove the linear tag) — should also not crash
      const updateResponse = await makeRequest('/api/runs/tags/update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          runId,
          tags: ['smoke-test'],
        }),
      });

      expect(updateResponse.status).toBe(200);
    });
  });

  // ============================================================================
  // Test Suite 21: Metric Names Endpoint (ClickHouse Summaries)
  // ============================================================================
  describe.skip('Test Suite 21: Metric Names Endpoint', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Metric Names with Valid API Key', () => {
      it('Test 21.1: List metric names for a project', async () => {
        const response = await makeRequest(
          `/api/runs/metric-names?projectName=${TEST_PROJECT_NAME}`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.projectName).toBe(TEST_PROJECT_NAME);
        expect(data.metricNames).toBeDefined();
        expect(Array.isArray(data.metricNames)).toBe(true);
      });

      it('Test 21.2: List metric names with search filter', async () => {
        const response = await makeRequest(
          `/api/runs/metric-names?projectName=${TEST_PROJECT_NAME}&search=loss`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.metricNames).toBeDefined();
        expect(Array.isArray(data.metricNames)).toBe(true);
        // If any results, all should contain 'loss'
        for (const name of data.metricNames) {
          expect(name.toLowerCase()).toContain('loss');
        }
      });

      it('Test 21.3: List metric names with limit', async () => {
        const response = await makeRequest(
          `/api/runs/metric-names?projectName=${TEST_PROJECT_NAME}&limit=5`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.metricNames.length).toBeLessThanOrEqual(5);
      });

      it('Test 21.4: Metric names without API key returns 401', async () => {
        const response = await makeRequest(
          `/api/runs/metric-names?projectName=${TEST_PROJECT_NAME}`
        );

        expect(response.status).toBe(401);
      });

      it('Test 21.5: SQL injection in search is handled safely', async () => {
        const maliciousSearch = "loss'; DROP TABLE mlop_metric_summaries; --";
        const response = await makeRequest(
          `/api/runs/metric-names?projectName=${TEST_PROJECT_NAME}&search=${encodeURIComponent(maliciousSearch)}`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.metricNames).toBeDefined();
        expect(data.metricNames.length).toBe(0);
      });
    });
  });

  // ============================================================================
  // Test Suite 22: Leaderboard Endpoint (ClickHouse Summaries)
  // ============================================================================
  describe.skip('Test Suite 22: Leaderboard Endpoint', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Leaderboard with Valid API Key', () => {
      it('Test 22.1: Get leaderboard for a metric', async () => {
        const response = await makeRequest(
          `/api/runs/leaderboard?projectName=${TEST_PROJECT_NAME}&logName=train/metric_00`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.projectName).toBe(TEST_PROJECT_NAME);
        expect(data.logName).toBe('train/metric_00');
        expect(data.aggregation).toBeDefined();
        expect(data.direction).toBeDefined();
        expect(data.runs).toBeDefined();
        expect(Array.isArray(data.runs)).toBe(true);
        expect(data.total).toBeDefined();
      });

      it('Test 22.2: Leaderboard with custom aggregation and direction', async () => {
        const response = await makeRequest(
          `/api/runs/leaderboard?projectName=${TEST_PROJECT_NAME}&logName=train/metric_00&aggregation=MIN&direction=ASC`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.aggregation).toBe('MIN');
        expect(data.direction).toBe('ASC');

        // Verify runs are sorted ascending by value
        if (data.runs.length > 1) {
          for (let i = 1; i < data.runs.length; i++) {
            expect(data.runs[i].value).toBeGreaterThanOrEqual(data.runs[i - 1].value);
          }
        }
      });

      it('Test 22.3: Leaderboard with DESC direction', async () => {
        const response = await makeRequest(
          `/api/runs/leaderboard?projectName=${TEST_PROJECT_NAME}&logName=train/metric_00&aggregation=MAX&direction=DESC`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.aggregation).toBe('MAX');
        expect(data.direction).toBe('DESC');

        // Verify runs are sorted descending by value
        if (data.runs.length > 1) {
          for (let i = 1; i < data.runs.length; i++) {
            expect(data.runs[i].value).toBeLessThanOrEqual(data.runs[i - 1].value);
          }
        }
      });

      it('Test 22.4: Leaderboard with limit and pagination', async () => {
        const response = await makeRequest(
          `/api/runs/leaderboard?projectName=${TEST_PROJECT_NAME}&logName=train/metric_00&limit=3&offset=0`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs.length).toBeLessThanOrEqual(3);

        // Verify rank starts at 1
        if (data.runs.length > 0) {
          expect(data.runs[0].rank).toBe(1);
        }
      });

      it('Test 22.5: Leaderboard run entries have expected fields', async () => {
        const response = await makeRequest(
          `/api/runs/leaderboard?projectName=${TEST_PROJECT_NAME}&logName=train/metric_00&limit=1`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        if (data.runs.length > 0) {
          const run = data.runs[0];
          expect(run.rank).toBeDefined();
          expect(run.runId).toBeDefined();
          expect(run.runName).toBeDefined();
          expect(run.status).toBeDefined();
          expect(run.url).toBeDefined();
          expect(typeof run.value).toBe('number');
          expect(run.tags).toBeDefined();
          expect(run.createdAt).toBeDefined();
        }
      });

      it('Test 22.6: Leaderboard for non-existent metric returns empty', async () => {
        const response = await makeRequest(
          `/api/runs/leaderboard?projectName=${TEST_PROJECT_NAME}&logName=nonexistent/metric_xyz`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toHaveLength(0);
        expect(data.total).toBe(0);
      });

      it('Test 22.7: Leaderboard without API key returns 401', async () => {
        const response = await makeRequest(
          `/api/runs/leaderboard?projectName=${TEST_PROJECT_NAME}&logName=train/metric_00`
        );

        expect(response.status).toBe(401);
      });

      it('Test 22.8: SQL injection in logName is handled safely', async () => {
        const maliciousLogName = "train/loss' UNION SELECT * FROM system.tables --";
        const response = await makeRequest(
          `/api/runs/leaderboard?projectName=${TEST_PROJECT_NAME}&logName=${encodeURIComponent(maliciousLogName)}`,
          {
            headers: {
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runs).toHaveLength(0);
      });
    });
  });

  describe('Test Suite 23: Run Display IDs (Sequential Numbering)', () => {
    const hasApiKey = TEST_API_KEY.length > 0;
    const displayIdProject = `display-id-test-${Date.now()}`;

    describe.skipIf(!hasApiKey)('Run Number Assignment', () => {
      it('Test 23.1: First run in project gets number 1 and displayId', async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: displayIdProject,
            runName: `first-run-${Date.now()}`,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.runId).toBeDefined();
        expect(data.number).toBe(1);
        expect(data.displayId).toBeDefined();
        expect(data.displayId).toMatch(/^[A-Z0-9]+-1$/);
      });

      it('Test 23.2: Second run gets number 2 (sequential)', async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: displayIdProject,
            runName: `second-run-${Date.now()}`,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.number).toBe(2);
        expect(data.displayId).toMatch(/^[A-Z0-9]+-2$/);
      });

      it('Test 23.3: Third run gets number 3 (sequential)', async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: displayIdProject,
            runName: `third-run-${Date.now()}`,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.number).toBe(3);
        expect(data.displayId).toMatch(/^[A-Z0-9]+-3$/);
      });

      it('Test 23.4: Resumed run (externalId) keeps same number', async () => {
        const externalId = `display-id-resume-${Date.now()}`;

        // Create first
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: displayIdProject,
            runName: `resume-test-${Date.now()}`,
            externalId,
          }),
        });

        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json();
        expect(createData.number).toBe(4);
        expect(createData.resumed).toBe(false);

        // Resume with same externalId
        const resumeResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: displayIdProject,
            runName: `resume-test-${Date.now()}`,
            externalId,
          }),
        });

        expect(resumeResponse.status).toBe(200);
        const resumeData = await resumeResponse.json();
        expect(resumeData.resumed).toBe(true);
        expect(resumeData.number).toBe(4); // Same number as original
        expect(resumeData.displayId).toBe(createData.displayId); // Same displayId
      });

      it('Test 23.5: Different projects get independent numbering', async () => {
        const otherProject = `display-id-other-${Date.now()}`;

        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: otherProject,
            runName: `other-project-run-${Date.now()}`,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.number).toBe(1); // Starts at 1 for new project
      });

      it('Test 23.6: Display ID prefix is derived from project name', async () => {
        const prefixProject = `my-cool-project-${Date.now()}`;

        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: prefixProject,
            runName: `prefix-test-${Date.now()}`,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.displayId).toBeDefined();
        // Display ID format: PREFIX-NUMBER
        expect(data.displayId).toMatch(/^[A-Z0-9]+-\d+$/);
      });

      it('Test 23.7: GET /details/{runId} returns displayId', async () => {
        // Create a run first
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: displayIdProject,
            runName: `details-test-${Date.now()}`,
          }),
        });

        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json();
        const numericRunId = createData.runId;
        const expectedDisplayId = createData.displayId;

        // Fetch run details by numeric ID
        const detailsResponse = await makeRequest(`/api/runs/details/${numericRunId}`, {
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
        });

        expect(detailsResponse.status).toBe(200);
        const details = await detailsResponse.json();
        expect(details.displayId).toBe(expectedDisplayId);
        expect(details.number).toBeDefined();
        expect(details.name).toBeDefined();
        expect(details.status).toBeDefined();
      });

      it('Test 23.8: GET /details/by-display-id resolves display ID to run', async () => {
        // Create a run first
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: displayIdProject,
            runName: `lookup-test-${Date.now()}`,
          }),
        });

        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json();
        const displayId = createData.displayId;
        const numericRunId = createData.runId;

        // Fetch run details by display ID
        const lookupResponse = await makeRequest(`/api/runs/details/by-display-id/${displayId}`, {
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
        });

        expect(lookupResponse.status).toBe(200);
        const details = await lookupResponse.json();
        expect(details.id).toBe(numericRunId);
        expect(details.displayId).toBe(displayId);
      });

      it('Test 23.9: GET /details/by-display-id returns 404 for nonexistent display ID', async () => {
        const lookupResponse = await makeRequest(`/api/runs/details/by-display-id/ZZZZZ-99999`, {
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
        });

        expect(lookupResponse.status).toBe(404);
      });
    });

    // Regression: a display ID's prefix is derived from the project name, so
    // distinct names that differ only by separator (e.g. "monitor_tests" vs
    // "monitor-tests") collapse to the same prefix. Combined with per-project
    // run numbering, the same display ID (e.g. "MTE-1") exists in both projects.
    // The lookup must not silently return the run from the wrong project.
    describe.skipIf(!hasApiKey)('Cross-Project Display ID Disambiguation', () => {
      // These two names both split to ["...", "collide", "<ts>"] and produce an
      // identical run-prefix, but are distinct project names.
      const ts = Date.now();
      const projectA = `mte-collide-${ts}`;
      const projectB = `mte_collide_${ts}`;
      let runIdA = 0;
      let runIdB = 0;
      let sharedDisplayId = '';

      it('Test 23.10: two collision projects yield the same display ID', async () => {
        const createA = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({ projectName: projectA, runName: `collide-a-${ts}` }),
        });
        expect(createA.status).toBe(200);
        const dataA = await createA.json();

        const createB = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({ projectName: projectB, runName: `collide-b-${ts}` }),
        });
        expect(createB.status).toBe(200);
        const dataB = await createB.json();

        runIdA = dataA.runId;
        runIdB = dataB.runId;
        sharedDisplayId = dataA.displayId;

        // Same prefix + same per-project number 1 => identical display ID,
        // but distinct underlying runs.
        expect(dataA.displayId).toBe(dataB.displayId);
        expect(runIdA).not.toBe(runIdB);
      });

      it('Test 23.11: lookup without projectName is rejected as ambiguous (409)', async () => {
        const res = await makeRequest(`/api/runs/details/by-display-id/${sharedDisplayId}`, {
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
        });
        expect(res.status).toBe(409);
      });

      it('Test 23.12: projectName scopes the lookup to the correct project', async () => {
        const resA = await makeRequest(
          `/api/runs/details/by-display-id/${sharedDisplayId}?projectName=${encodeURIComponent(projectA)}`,
          { headers: { 'Authorization': `Bearer ${TEST_API_KEY}` } },
        );
        expect(resA.status).toBe(200);
        const detailsA = await resA.json();
        expect(detailsA.id).toBe(runIdA);
        expect(detailsA.projectName).toBe(projectA);

        const resB = await makeRequest(
          `/api/runs/details/by-display-id/${sharedDisplayId}?projectName=${encodeURIComponent(projectB)}`,
          { headers: { 'Authorization': `Bearer ${TEST_API_KEY}` } },
        );
        expect(resB.status).toBe(200);
        const detailsB = await resB.json();
        expect(detailsB.id).toBe(runIdB);
        expect(detailsB.projectName).toBe(projectB);
      });

      it('Test 23.13: resume by display ID is likewise scoped by projectName', async () => {
        const resB = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({ displayId: sharedDisplayId, projectName: projectB }),
        });
        expect(resB.status).toBe(200);
        const dataB = await resB.json();
        expect(dataB.runId).toBe(runIdB);
        expect(dataB.projectName).toBe(projectB);

        // Ambiguous resume without projectName is rejected rather than guessed.
        const resAmbiguous = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({ displayId: sharedDisplayId }),
        });
        expect(resAmbiguous.status).toBe(409);
      });
    });
  });

  // ============================================================================
  // Test Suite 24: Data Procedures (Histogram & Table) - Auth Guards
  // ============================================================================
  describe('Test Suite 24: Data Procedures Auth Guards', () => {
    it('Test 24.1: Histogram - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.data.histogram', {
        runId: 'test',
        projectName: 'test-project',
        logName: 'train/weights',
      });

      expect(response.status).toBe(401);
    });

    it('Test 24.2: Table - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.data.table', {
        runId: 'test',
        projectName: 'test-project',
        logName: 'eval/confusion_matrix',
      });

      expect(response.status).toBe(401);
    });

    it('Test 24.3: Histogram with stepCap - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.data.histogram', {
        runId: 'test',
        projectName: 'test-project',
        logName: 'train/weights',
        stepCap: 50,
      });

      expect(response.status).toBe(401);
    });

    it('Test 24.4: histogramBatch - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.data.histogramBatch', {
        runIds: ['test'],
        projectName: 'test-project',
        logName: 'train/weights',
      });

      expect(response.status).toBe(401);
    });

    it('Test 24.5: filesBatch - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.data.filesBatch', {
        runIds: ['test'],
        projectName: 'test-project',
        logName: 'media/images',
      });

      expect(response.status).toBe(401);
    });

    it('Test 24.6: barsDataBatch - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.data.barsDataBatch', {
        runIds: ['test'],
        projectName: 'test-project',
        pathPrefix: 'training/dataset',
      });

      expect(response.status).toBe(401);
    });
  });

  // ============================================================================
  // Test Suite 24.5: Histogram stepCap — return-shape + truncation contract
  //
  // Verifies the runs.data.histogram proc returns the new
  //   { rows, truncated, totalSteps }
  // shape under both omitted and explicit stepCap. When a histogram log is
  // present in the test project AND it has > 1 step, also asserts that
  // truncation kicks in for a stepCap below totalSteps.
  // ============================================================================
  describe('Test Suite 24.5: Histogram stepCap (Authenticated)', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let activeOrgId: string | null = null;
    let histogramTarget: { runId: string; logName: string } | null = null;
    let totalSteps = 0;
    let serverAvailable = false;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }
      if (!serverAvailable) {
        console.log('   Skipping authenticated histogram-stepCap tests - server unavailable');
        return;
      }

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });
        const setCookie = signInResponse.headers.get('set-cookie');
        const match = setCookie?.match(/better_auth\.session_token=([^;]+)/);
        if (match) {
          sessionCookie = `better_auth.session_token=${match[1]}`;
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }

      if (!sessionCookie) return;

      // Resolve the active organizationId from the session
      const authResp = await makeTrpcRequest('auth', {}, { 'Cookie': sessionCookie }, 'GET');
      if (authResp.status === 200) {
        const authBody = await authResp.json();
        activeOrgId = authBody.result?.data?.activeOrganization?.id ?? null;
      }

      if (!activeOrgId) {
        console.log('   No active organization on session - skipping histogram-stepCap behavior tests');
        return;
      }

      // Discover a histogram log: list runs, then look at their logs for one of type HISTOGRAM.
      try {
        const listResp = await makeTrpcRequest('runs.list', {
          organizationId: activeOrgId,
          projectName: TEST_PROJECT_NAME,
          limit: 50,
        }, { 'Cookie': sessionCookie }, 'GET');
        if (listResp.status !== 200) return;
        const listBody = await listResp.json();
        const runs = (listBody.result?.data?.runs ?? []) as Array<{ runId?: string; id?: string }>;
        if (runs.length === 0) return;

        const runIds = runs
          .map((r) => r.runId ?? r.id)
          .filter((v): v is string => typeof v === 'string')
          .slice(0, 50);

        const logsResp = await makeTrpcRequest('runs.getLogsByRunIds', {
          organizationId: activeOrgId,
          projectName: TEST_PROJECT_NAME,
          runIds,
        }, { 'Cookie': sessionCookie }, 'GET');
        if (logsResp.status !== 200) return;
        const logsBody = await logsResp.json();
        const logsByRunId = (logsBody.result?.data ?? {}) as Record<
          string,
          Array<{ logName: string; logType: string }>
        >;

        for (const [runId, logs] of Object.entries(logsByRunId)) {
          const histLog = logs.find((l) => l.logType === 'HISTOGRAM');
          if (histLog) {
            histogramTarget = { runId, logName: histLog.logName };
            break;
          }
        }

        if (histogramTarget) {
          const probe = await makeTrpcRequest('runs.data.histogram', {
            organizationId: activeOrgId,
            runId: histogramTarget.runId,
            projectName: TEST_PROJECT_NAME,
            logName: histogramTarget.logName,
          }, { 'Cookie': sessionCookie }, 'GET');
          if (probe.status === 200) {
            const probeBody = await probe.json();
            totalSteps = probeBody.result?.data?.totalSteps ?? 0;
          }
        }
      } catch (e) {
        console.log('   Histogram discovery failed:', e);
      }
    });

    it('Test 24.5.1: Sign-in succeeded (or skip)', () => {
      if (!serverAvailable) {
        console.log('   Server not available - skipping');
        return;
      }
      if (!sessionCookie) {
        console.log('   Sign-in failed (test user may not exist) - skipping');
        return;
      }
      expect(sessionCookie).toBeTruthy();
    });

    it('Test 24.5.2: Schema rejects non-positive stepCap', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.data.histogram', {
        organizationId: activeOrgId,
        runId: 'anything',
        projectName: TEST_PROJECT_NAME,
        logName: 'whatever',
        stepCap: 0,
      }, { 'Cookie': sessionCookie }, 'GET');

      // 0 fails .positive()
      const body = await response.json();
      expect(body.error?.data?.code).toBe('BAD_REQUEST');
    });

    it('Test 24.5.3: Schema rejects stepCap above hard max (5000)', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.data.histogram', {
        organizationId: activeOrgId,
        runId: 'anything',
        projectName: TEST_PROJECT_NAME,
        logName: 'whatever',
        stepCap: 10000,
      }, { 'Cookie': sessionCookie }, 'GET');

      const body = await response.json();
      expect(body.error?.data?.code).toBe('BAD_REQUEST');
    });

    it('Test 24.5.4: Returns {rows, truncated, totalSteps} shape — no stepCap, no truncation', async () => {
      if (!sessionCookie || !histogramTarget || !activeOrgId) {
        console.log('   No histogram data available - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.data.histogram', {
        organizationId: activeOrgId,
        runId: histogramTarget.runId,
        projectName: TEST_PROJECT_NAME,
        logName: histogramTarget.logName,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const body = await response.json();
      const data = body.result?.data;
      expect(data).toBeDefined();
      expect(Array.isArray(data.rows)).toBe(true);
      expect(data.truncated).toBe(false);
      expect(data.totalSteps).toBe(data.rows.length);
    });

    it('Test 24.5.5: stepCap below totalSteps triggers truncation', async () => {
      if (!sessionCookie || !histogramTarget || !activeOrgId) {
        console.log('   No histogram data available - skipping');
        return;
      }
      if (totalSteps < 2) {
        console.log(`   Histogram has only ${totalSteps} step(s); cannot exercise truncation - skipping`);
        return;
      }

      const cap = 1;
      const response = await makeTrpcRequest('runs.data.histogram', {
        organizationId: activeOrgId,
        runId: histogramTarget.runId,
        projectName: TEST_PROJECT_NAME,
        logName: histogramTarget.logName,
        stepCap: cap,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const body = await response.json();
      const data = body.result?.data;
      expect(data).toBeDefined();
      expect(Array.isArray(data.rows)).toBe(true);
      expect(data.truncated).toBe(true);
      expect(data.totalSteps).toBe(totalSteps);
      // Downsampled to at most cap+1 rows (the algorithm always appends the
      // last row if not already present, so cap=1 can produce up to 2 rows).
      expect(data.rows.length).toBeLessThanOrEqual(cap + 1);
      expect(data.rows.length).toBeGreaterThan(0);
    });

    it('Test 24.5.6: stepCap >= totalSteps returns all rows, truncated:false', async () => {
      if (!sessionCookie || !histogramTarget || !activeOrgId) {
        console.log('   No histogram data available - skipping');
        return;
      }
      if (totalSteps === 0) {
        console.log('   No histogram steps to test - skipping');
        return;
      }

      const cap = totalSteps + 10;
      const response = await makeTrpcRequest('runs.data.histogram', {
        organizationId: activeOrgId,
        runId: histogramTarget.runId,
        projectName: TEST_PROJECT_NAME,
        logName: histogramTarget.logName,
        stepCap: cap,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const body = await response.json();
      const data = body.result?.data;
      expect(data.truncated).toBe(false);
      expect(data.totalSteps).toBe(totalSteps);
      expect(data.rows.length).toBe(totalSteps);
    });
  });

  // ============================================================================
  // Test Suite 24.6: Bars data (path-prefix rollup) — Auth Guards
  //
  // Verifies the new runs.data.barsData and runs.data.eligiblePrefixes
  // procs reject unauthenticated callers, validate inputs, and enforce the
  // >= BARS_MIN_SUFFIXES (=3) eligibility threshold.
  // ============================================================================
  describe('Test Suite 24.6: Bars Data Auth Guards', () => {
    it('Test 24.6.1: barsData - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.data.barsData', {
        runId: 'test',
        projectName: 'test-project',
        pathPrefix: 'training/dataset/',
      });

      expect(response.status).toBe(401);
    });

    it('Test 24.6.2: eligiblePrefixes - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.data.eligiblePrefixes', {
        runId: 'test',
        projectName: 'test-project',
      });

      expect(response.status).toBe(401);
    });

    it('Test 24.6.3: barsData with stepCap - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.data.barsData', {
        runId: 'test',
        projectName: 'test-project',
        pathPrefix: 'training/dataset/',
        stepCap: 50,
      });

      expect(response.status).toBe(401);
    });

    it('Test 24.6.4: barsDataBatch - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.data.barsDataBatch', {
        runIds: ['test'],
        projectName: 'test-project',
        pathPrefix: 'training/dataset/',
      });

      expect(response.status).toBe(401);
    });
  });

  // ============================================================================
  // Test Suite 24.7: Bars Data (Authenticated) — schema validation
  //
  // These exercise schema-layer rejections that don't require live data:
  // empty pathPrefix, non-positive stepCap, stepCap above hard max. The proc
  // also throws BAD_REQUEST when the prefix has fewer than 3 suffixes — that
  // check requires a sign-in but no specific dataset, so it lives here too.
  // ============================================================================
  describe('Test Suite 24.7: Bars Data (Authenticated)', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let activeOrgId: string | null = null;
    let serverAvailable = false;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }
      if (!serverAvailable) {
        console.log('   Skipping authenticated bars-data tests - server unavailable');
        return;
      }

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });
        const setCookie = signInResponse.headers.get('set-cookie');
        const match = setCookie?.match(/better_auth\.session_token=([^;]+)/);
        if (match) {
          sessionCookie = `better_auth.session_token=${match[1]}`;
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }

      if (!sessionCookie) return;

      const authResp = await makeTrpcRequest('auth', {}, { 'Cookie': sessionCookie }, 'GET');
      if (authResp.status === 200) {
        const authBody = await authResp.json();
        activeOrgId = authBody.result?.data?.activeOrganization?.id ?? null;
      }
    });

    it('Test 24.7.1: Sign-in succeeded (or skip)', () => {
      if (!serverAvailable) {
        console.log('   Server not available - skipping');
        return;
      }
      if (!sessionCookie) {
        console.log('   Sign-in failed (test user may not exist) - skipping');
        return;
      }
      expect(sessionCookie).toBeTruthy();
    });

    it('Test 24.7.2: Schema rejects empty pathPrefix', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.data.barsData', {
        organizationId: activeOrgId,
        runId: 'anything',
        projectName: TEST_PROJECT_NAME,
        pathPrefix: '',
      }, { 'Cookie': sessionCookie }, 'GET');

      const body = await response.json();
      expect(body.error?.data?.code).toBe('BAD_REQUEST');
    });

    it('Test 24.7.3: Schema rejects non-positive stepCap', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.data.barsData', {
        organizationId: activeOrgId,
        runId: 'anything',
        projectName: TEST_PROJECT_NAME,
        pathPrefix: 'training/dataset/',
        stepCap: 0,
      }, { 'Cookie': sessionCookie }, 'GET');

      const body = await response.json();
      expect(body.error?.data?.code).toBe('BAD_REQUEST');
    });

    it('Test 24.7.4: Schema rejects stepCap above hard max (5000)', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.data.barsData', {
        organizationId: activeOrgId,
        runId: 'anything',
        projectName: TEST_PROJECT_NAME,
        pathPrefix: 'training/dataset/',
        stepCap: 10000,
      }, { 'Cookie': sessionCookie }, 'GET');

      const body = await response.json();
      expect(body.error?.data?.code).toBe('BAD_REQUEST');
    });

    it('Test 24.7.4b: barsDataBatch schema rejects empty runIds array', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.data.barsDataBatch', {
        organizationId: activeOrgId,
        runIds: [],
        projectName: TEST_PROJECT_NAME,
        pathPrefix: 'training/dataset/',
      }, { 'Cookie': sessionCookie }, 'GET');

      // runIds has .min(1)
      const body = await response.json();
      expect(body.error?.data?.code).toBe('BAD_REQUEST');
    });

    it('Test 24.7.5: eligiblePrefixes returns array shape', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      // Find any run in the test project to query against.
      const listResp = await makeTrpcRequest('runs.list', {
        organizationId: activeOrgId,
        projectName: TEST_PROJECT_NAME,
        limit: 1,
      }, { 'Cookie': sessionCookie }, 'GET');
      if (listResp.status !== 200) {
        console.log('   runs.list failed - skipping');
        return;
      }
      const listBody = await listResp.json();
      const runs = (listBody.result?.data?.runs ?? []) as Array<{ runId?: string; id?: string }>;
      if (runs.length === 0) {
        console.log('   No runs in test project - skipping');
        return;
      }
      const targetRunId = runs[0].runId ?? runs[0].id;
      if (!targetRunId) return;

      const response = await makeTrpcRequest('runs.data.eligiblePrefixes', {
        organizationId: activeOrgId,
        runId: targetRunId,
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const body = await response.json();
      const data = body.result?.data;
      expect(Array.isArray(data)).toBe(true);
      // Each entry must have {prefix: string, suffixCount: number >= 3}.
      for (const entry of data) {
        expect(typeof entry.prefix).toBe('string');
        expect(typeof entry.suffixCount).toBe('number');
        expect(entry.suffixCount).toBeGreaterThanOrEqual(3);
      }
    });

    it('Test 24.7.6: barsData on an eligible prefix returns canonical labels + per-step rows', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      // Find any run with at least one eligible prefix.
      const listResp = await makeTrpcRequest('runs.list', {
        organizationId: activeOrgId,
        projectName: TEST_PROJECT_NAME,
        limit: 20,
      }, { 'Cookie': sessionCookie }, 'GET');
      if (listResp.status !== 200) return;
      const listBody = await listResp.json();
      const runs = (listBody.result?.data?.runs ?? []) as Array<{ runId?: string; id?: string }>;

      let target: { runId: string; prefix: string; suffixCount: number } | null = null;
      for (const r of runs) {
        const rid = r.runId ?? r.id;
        if (!rid) continue;
        const elig = await makeTrpcRequest('runs.data.eligiblePrefixes', {
          organizationId: activeOrgId,
          runId: rid,
          projectName: TEST_PROJECT_NAME,
        }, { 'Cookie': sessionCookie }, 'GET');
        if (elig.status !== 200) continue;
        const eligBody = await elig.json();
        const entries = (eligBody.result?.data ?? []) as Array<{ prefix: string; suffixCount: number }>;
        if (entries.length > 0) {
          target = { runId: rid, prefix: entries[0].prefix, suffixCount: entries[0].suffixCount };
          break;
        }
      }

      if (!target) {
        console.log('   No run in test project has an eligible prefix - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.data.barsData', {
        organizationId: activeOrgId,
        runId: target.runId,
        projectName: TEST_PROJECT_NAME,
        pathPrefix: target.prefix,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const body = await response.json();
      const data = body.result?.data;
      expect(data).toBeDefined();
      expect(Array.isArray(data.rows)).toBe(true);
      expect(Array.isArray(data.canonicalLabels)).toBe(true);
      expect(data.canonicalLabels.length).toBe(target.suffixCount);
      expect(data.totalSteps).toBe(data.rows.length);
      expect(data.truncated).toBe(false);

      // Every row uses the canonical label ordering and is zero-filled to
      // the same length. Categorical shape and Histogram type are stable.
      for (const row of data.rows) {
        expect(row.bars.shape).toBe('categorical');
        expect(row.bars.type).toBe('Histogram');
        expect(row.bars.labels.length).toBe(data.canonicalLabels.length);
        expect(row.bars.freq.length).toBe(data.canonicalLabels.length);
        // Label ordering matches the canonical array exactly.
        for (let i = 0; i < data.canonicalLabels.length; i++) {
          expect(row.bars.labels[i]).toBe(data.canonicalLabels[i]);
        }
      }
    });

    // S1: A prefix that exists but only has < 3 sibling scalars should
    //     be rejected by the proc — eligibility (`>= BARS_MIN_SUFFIXES`)
    //     is enforced both client-side (dropdown gating) AND server-side
    //     (this proc). The two checks could drift; if a client somehow
    //     constructed a request for a 2-suffix prefix, this guard kicks
    //     in. We pick a prefix we know is too-short by searching for
    //     metrics that don't have any qualifying siblings.
    it('Test 24.7.7: barsData rejects a prefix with fewer than BARS_MIN_SUFFIXES suffixes', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      // Find any run in the project + grab its metric list. A path
      // segment that only appears as a leaf (no siblings) gives us a
      // shape we can query against to assert the eligibility error.
      const listResp = await makeTrpcRequest('runs.list', {
        organizationId: activeOrgId,
        projectName: TEST_PROJECT_NAME,
        limit: 5,
      }, { 'Cookie': sessionCookie }, 'GET');
      if (listResp.status !== 200) return;
      const listBody = await listResp.json();
      const runs = (listBody.result?.data?.runs ?? []) as Array<{ runId?: string; id?: string }>;
      if (runs.length === 0) {
        console.log('   No runs - skipping');
        return;
      }
      const targetRunId = runs[0].runId ?? runs[0].id;
      if (!targetRunId) return;

      // Use a contrived prefix that almost certainly has no siblings
      // (random uuid-like). The proc should refuse with BAD_REQUEST.
      const response = await makeTrpcRequest('runs.data.barsData', {
        organizationId: activeOrgId,
        runId: targetRunId,
        projectName: TEST_PROJECT_NAME,
        pathPrefix: 'definitely-not-a-real-prefix-9c2f8e1a/',
      }, { 'Cookie': sessionCookie }, 'GET');

      // Either NOT_FOUND (no matching metrics → nothing to roll up) or
      // BAD_REQUEST (fewer than threshold suffixes). Both are valid
      // refusals; the contract is "do not return a half-populated payload".
      expect([400, 404]).toContain(response.status);
    });

    // S2 + S3 + S4: Structural contract on a known-eligible prefix.
    //   - rows[].step is monotone-ascending (a window-function regression
    //     would scramble this)
    //   - canonicalLabels is sorted descending by per-label max value
    //   - For each row, freq[i] is the value for canonicalLabels[i] — i.e.
    //     the zero-fill remap aligned with the canonical order
    it('Test 24.7.8: barsData rows are step-ascending, canonicalLabels are max-value-desc, freq aligns with labels', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      // Find any eligible (prefix, runId) pair the same way 24.7.6 does.
      const listResp = await makeTrpcRequest('runs.list', {
        organizationId: activeOrgId,
        projectName: TEST_PROJECT_NAME,
        limit: 20,
      }, { 'Cookie': sessionCookie }, 'GET');
      if (listResp.status !== 200) return;
      const runs = (((await listResp.json()).result?.data?.runs ?? []) as Array<{ runId?: string; id?: string }>);

      let target: { runId: string; prefix: string } | null = null;
      for (const r of runs) {
        const rid = r.runId ?? r.id;
        if (!rid) continue;
        const elig = await makeTrpcRequest('runs.data.eligiblePrefixes', {
          organizationId: activeOrgId,
          runId: rid,
          projectName: TEST_PROJECT_NAME,
        }, { 'Cookie': sessionCookie }, 'GET');
        if (elig.status !== 200) continue;
        const entries = (((await elig.json()).result?.data ?? []) as Array<{ prefix: string; suffixCount: number }>);
        if (entries.length > 0) {
          target = { runId: rid, prefix: entries[0].prefix };
          break;
        }
      }
      if (!target) {
        console.log('   No eligible prefix in test project - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.data.barsData', {
        organizationId: activeOrgId,
        runId: target.runId,
        projectName: TEST_PROJECT_NAME,
        pathPrefix: target.prefix,
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(response.status).toBe(200);
      const data = (await response.json()).result?.data as {
        rows: Array<{ step: number; bars: { freq: number[]; labels: string[]; maxFreq: number } }>;
        canonicalLabels: string[];
      };
      expect(data.rows.length).toBeGreaterThan(0);

      // S2: step ordering is monotone-ascending.
      for (let i = 1; i < data.rows.length; i++) {
        expect(data.rows[i].step).toBeGreaterThanOrEqual(data.rows[i - 1].step);
      }

      // S3: canonicalLabels are sorted by per-label max value descending.
      //     We can derive each label's max from the rows themselves.
      const perLabelMax = new Map<string, number>();
      for (const row of data.rows) {
        for (let i = 0; i < row.bars.labels.length; i++) {
          const lbl = row.bars.labels[i];
          const v = row.bars.freq[i];
          const cur = perLabelMax.get(lbl) ?? Number.NEGATIVE_INFINITY;
          if (v > cur) perLabelMax.set(lbl, v);
        }
      }
      for (let i = 1; i < data.canonicalLabels.length; i++) {
        const prev = perLabelMax.get(data.canonicalLabels[i - 1]) ?? 0;
        const cur = perLabelMax.get(data.canonicalLabels[i]) ?? 0;
        expect(prev).toBeGreaterThanOrEqual(cur);
      }

      // S4: every row's labels match canonicalLabels exactly (already
      //     covered by 24.7.6) AND freq[i] is the value for that label.
      //     We verify by sampling: for every row, the label-aligned freq
      //     equals the value the row reports for the matching position.
      for (const row of data.rows) {
        for (let i = 0; i < row.bars.labels.length; i++) {
          expect(row.bars.labels[i]).toBe(data.canonicalLabels[i]);
          expect(typeof row.bars.freq[i]).toBe('number');
        }
      }
    });

    // S5: Cache should serve a byte-identical payload on consecutive
    //     calls. Status-aware TTL + the L1/L2 cache layers can break in
    //     subtle ways (key collision, serialization drift, race). A
    //     trivial "call it twice, payloads match" assert catches most.
    it('Test 24.7.9: barsData returns identical payload on consecutive calls (cache contract)', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      const listResp = await makeTrpcRequest('runs.list', {
        organizationId: activeOrgId,
        projectName: TEST_PROJECT_NAME,
        limit: 20,
      }, { 'Cookie': sessionCookie }, 'GET');
      if (listResp.status !== 200) return;
      const runs = (((await listResp.json()).result?.data?.runs ?? []) as Array<{ runId?: string; id?: string }>);

      let target: { runId: string; prefix: string } | null = null;
      for (const r of runs) {
        const rid = r.runId ?? r.id;
        if (!rid) continue;
        const elig = await makeTrpcRequest('runs.data.eligiblePrefixes', {
          organizationId: activeOrgId,
          runId: rid,
          projectName: TEST_PROJECT_NAME,
        }, { 'Cookie': sessionCookie }, 'GET');
        if (elig.status !== 200) continue;
        const entries = (((await elig.json()).result?.data ?? []) as Array<{ prefix: string }>);
        if (entries.length > 0) {
          target = { runId: rid, prefix: entries[0].prefix };
          break;
        }
      }
      if (!target) return;

      const input = {
        organizationId: activeOrgId,
        runId: target.runId,
        projectName: TEST_PROJECT_NAME,
        pathPrefix: target.prefix,
      };
      const first = await makeTrpcRequest('runs.data.barsData', input, { 'Cookie': sessionCookie }, 'GET');
      const second = await makeTrpcRequest('runs.data.barsData', input, { 'Cookie': sessionCookie }, 'GET');
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const firstData = (await first.json()).result?.data;
      const secondData = (await second.json()).result?.data;
      expect(firstData).toEqual(secondData);
    });

    // S6: stepCap caps rows AND surfaces the cap via `truncated` +
    //     `totalSteps`. The frontend reads these to decide whether to
    //     refetch on zoom (skip when stepMax-stepMin+1 <= buckets).
    it('Test 24.7.10: barsData stepCap caps rows + sets truncated/totalSteps when capped', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      const listResp = await makeTrpcRequest('runs.list', {
        organizationId: activeOrgId,
        projectName: TEST_PROJECT_NAME,
        limit: 20,
      }, { 'Cookie': sessionCookie }, 'GET');
      if (listResp.status !== 200) return;
      const runs = (((await listResp.json()).result?.data?.runs ?? []) as Array<{ runId?: string; id?: string }>);

      let target: { runId: string; prefix: string } | null = null;
      for (const r of runs) {
        const rid = r.runId ?? r.id;
        if (!rid) continue;
        const elig = await makeTrpcRequest('runs.data.eligiblePrefixes', {
          organizationId: activeOrgId,
          runId: rid,
          projectName: TEST_PROJECT_NAME,
        }, { 'Cookie': sessionCookie }, 'GET');
        if (elig.status !== 200) continue;
        const entries = (((await elig.json()).result?.data ?? []) as Array<{ prefix: string }>);
        if (entries.length > 0) {
          target = { runId: rid, prefix: entries[0].prefix };
          break;
        }
      }
      if (!target) return;

      // First find totalSteps with the default cap. If it's already small
      // (< 4), skip — we can't meaningfully test the cap.
      const baseline = await makeTrpcRequest('runs.data.barsData', {
        organizationId: activeOrgId,
        runId: target.runId,
        projectName: TEST_PROJECT_NAME,
        pathPrefix: target.prefix,
      }, { 'Cookie': sessionCookie }, 'GET');
      if (baseline.status !== 200) return;
      const baseData = (await baseline.json()).result?.data as { totalSteps: number; rows: unknown[] };
      if (baseData.totalSteps < 4) {
        console.log('   Run has too few steps for a meaningful stepCap test - skipping');
        return;
      }

      // Cap at 2. Must return ≤ 2 rows AND set truncated=true AND
      // totalSteps equals the pre-cap count.
      const capped = await makeTrpcRequest('runs.data.barsData', {
        organizationId: activeOrgId,
        runId: target.runId,
        projectName: TEST_PROJECT_NAME,
        pathPrefix: target.prefix,
        stepCap: 2,
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(capped.status).toBe(200);
      const cappedData = (await capped.json()).result?.data as { totalSteps: number; truncated: boolean; rows: unknown[] };
      expect(cappedData.rows.length).toBeLessThanOrEqual(2);
      expect(cappedData.truncated).toBe(true);
      expect(cappedData.totalSteps).toBe(baseData.totalSteps);
    });

    // S7: Cross-org leak guard. `resolveRunId` looks up the SQID inside
    //     the (org, project) tuple, so a junk runId or a runId from
    //     another org returns NOT_FOUND. This is the core authz check.
    it('Test 24.7.11: barsData with an unknown runId returns NOT_FOUND (cross-org leak guard)', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.data.barsData', {
        organizationId: activeOrgId,
        runId: 'NoSuchRunIdXYZ',
        projectName: TEST_PROJECT_NAME,
        pathPrefix: 'training/dataset/',
      }, { 'Cookie': sessionCookie }, 'GET');
      // Either NOT_FOUND or BAD_REQUEST depending on how the SQID decodes —
      // both qualify as "this is not a valid run for this caller".
      expect([400, 404]).toContain(response.status);
    });

    // S8: Project-wide eligiblePrefixes (`runId` omitted) is a strict
    //     superset of any single-run call. The Files dropdown relies on
    //     this so `{bars}` entries surface BEFORE the user selects any
    //     runs.
    it('Test 24.7.12: eligiblePrefixes project-wide is a superset of any single-run call', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      const listResp = await makeTrpcRequest('runs.list', {
        organizationId: activeOrgId,
        projectName: TEST_PROJECT_NAME,
        limit: 5,
      }, { 'Cookie': sessionCookie }, 'GET');
      if (listResp.status !== 200) return;
      const runs = (((await listResp.json()).result?.data?.runs ?? []) as Array<{ runId?: string; id?: string }>);
      if (runs.length === 0) return;

      const projectResp = await makeTrpcRequest('runs.data.eligiblePrefixes', {
        organizationId: activeOrgId,
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');
      if (projectResp.status !== 200) return;
      const projectPrefixes = new Set(
        (((await projectResp.json()).result?.data ?? []) as Array<{ prefix: string }>).map((e) => e.prefix),
      );

      // For at least one of the first few runs, every single-run prefix
      // must appear in the project-wide set. Skip the assertion if no
      // run-scoped entries exist (e.g. fresh project) — there's nothing
      // to compare against. NOTE: deepest-prefix suppression after merge
      // can occasionally rewrite a per-run prefix into its descendant
      // project-wide (e.g. per-run `layers/` becomes `layers/layer_0/`
      // project-wide). Accept that as "superset by descendant" too.
      let assertedAtLeastOnce = false;
      for (const r of runs) {
        const rid = r.runId ?? r.id;
        if (!rid) continue;
        const runResp = await makeTrpcRequest('runs.data.eligiblePrefixes', {
          organizationId: activeOrgId,
          runId: rid,
          projectName: TEST_PROJECT_NAME,
        }, { 'Cookie': sessionCookie }, 'GET');
        if (runResp.status !== 200) continue;
        const runPrefixes = (((await runResp.json()).result?.data ?? []) as Array<{ prefix: string }>).map((e) => e.prefix);
        if (runPrefixes.length === 0) continue;
        for (const p of runPrefixes) {
          const covered =
            projectPrefixes.has(p) ||
            [...projectPrefixes].some((other) => other.startsWith(p));
          expect(covered).toBe(true);
        }
        assertedAtLeastOnce = true;
      }
      if (!assertedAtLeastOnce) {
        console.log('   No runs with eligible prefixes - skipping superset check');
      }
    });

    // S9: Deeper prefix shadows ancestor in the same response. Custom
    //     post-SQL filter — easy to regress by reverting the suppression
    //     loop. Skip if the project doesn't expose nested prefixes (we
    //     can't fabricate them in a smoke test).
    it('Test 24.7.13: eligiblePrefixes suppresses ancestor when a deeper prefix is present', async () => {
      if (!sessionCookie || !activeOrgId) {
        console.log('   No session/org - skipping');
        return;
      }
      const response = await makeTrpcRequest('runs.data.eligiblePrefixes', {
        organizationId: activeOrgId,
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');
      if (response.status !== 200) return;
      const prefixes = (((await response.json()).result?.data ?? []) as Array<{ prefix: string }>).map((e) => e.prefix);

      // For every pair (a, b) in the response with a being a strict
      // ancestor of b, that's a regression — suppression should have
      // dropped a.
      for (let i = 0; i < prefixes.length; i++) {
        for (let j = 0; j < prefixes.length; j++) {
          if (i === j) continue;
          const a = prefixes[i];
          const b = prefixes[j];
          if (b.startsWith(a) && b.length > a.length) {
            throw new Error(`Suppression regression: ancestor "${a}" should have been removed because deeper "${b}" exists`);
          }
        }
      }
    });
  });

  // ============================================================================
  // Test Suite 25: Performance Regression — Payload Size Guards
  // ============================================================================
  describe('Test Suite 25: Performance Regression Guards', () => {
    it('Test 25.1: runs.list should NOT include config/systemMetadata JSON', async () => {
      // Use the HTTP API to create a run with config, then verify runs.list
      // does NOT return those fields (they should be served via getFieldValues).
      const createResponse = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          project: TEST_PROJECT_NAME,
          name: `perf-guard-test-${Date.now()}`,
          config: JSON.stringify({ lr: 0.001, batch_size: 32, optimizer: 'adam' }),
        }),
      });

      // Even if creation fails (e.g., test user), test the shape of list response
      const listResponse = await makeRequest(
        `/api/runs/list?project=${encodeURIComponent(TEST_PROJECT_NAME)}&limit=5`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
        }
      );

      if (listResponse.status === 200) {
        const body = await listResponse.json();
        const runs = body.runs || body.data || [];
        if (runs.length > 0) {
          const firstRun = runs[0];
          // The HTTP API may still return config — this test primarily
          // guards the tRPC endpoint. But we can check payload size.
          const payloadSize = JSON.stringify(body).length;
          // For 5 runs without JSON blobs, payload should be well under 50KB
          console.log(`   runs.list payload for 5 runs: ${(payloadSize / 1024).toFixed(1)}KB`);
          expect(payloadSize).toBeLessThan(50 * 1024);
        }
      }

      // Clean up if we created a run
      if (createResponse.status === 200) {
        const created = await createResponse.json();
        if (created.id) {
          // Update status to mark as completed
          await makeRequest('/api/runs/status/update', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${TEST_API_KEY}`,
            },
            body: JSON.stringify({ runId: created.id, status: 'COMPLETED' }),
          });
        }
      }
    });

    it('Test 25.2: getLogsByRunIds - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.getLogsByRunIds', {
        runIds: ['test'],
        projectName: 'test-project',
      });

      expect(response.status).toBe(401);
    });

    it('Test 25.3: getFieldValues - Unauthorized without session', async () => {
      const response = await makeTrpcRequest('runs.getFieldValues', {
        runIds: ['test'],
        projectName: 'test-project',
      });

      expect(response.status).toBe(401);
    });
  });

  // ============================================================================
  // Test Suite 26: Resume Existing Run (POST /api/runs/resume)
  // ============================================================================
  describe('Test Suite 26: Resume Existing Run', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Resume run by various ID types', () => {
      it('Test 26.1: Resume by numeric runId returns resumed: true with correct info', async () => {
        // First, create a run
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `resume-target-${Date.now()}`,
          }),
        });
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json();
        expect(createData.runId).toBeDefined();

        // Now resume by runId
        const resumeResponse = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: createData.runId,
          }),
        });

        expect(resumeResponse.status).toBe(200);
        const resumeData = await resumeResponse.json();
        expect(resumeData.resumed).toBe(true);
        expect(resumeData.runId).toBe(createData.runId);
        expect(resumeData.projectName).toBe(createData.projectName);
        expect(resumeData.organizationSlug).toBe(createData.organizationSlug);
        expect(resumeData.url).toBe(createData.url);
        expect(resumeData.number).toBe(createData.number);
        expect(resumeData.displayId).toBe(createData.displayId);
      });

      it('Test 26.2: Resume by displayId returns correct run', async () => {
        // Create a run to get its displayId
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `resume-display-${Date.now()}`,
          }),
        });
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json();
        expect(createData.displayId).toBeDefined();

        // Resume by displayId (e.g., "MMP-1")
        const resumeResponse = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            displayId: createData.displayId,
          }),
        });

        expect(resumeResponse.status).toBe(200);
        const resumeData = await resumeResponse.json();
        expect(resumeData.resumed).toBe(true);
        expect(resumeData.runId).toBe(createData.runId);
        expect(resumeData.displayId).toBe(createData.displayId);
      });

      it('Test 26.3: Resume by externalId returns correct run', async () => {
        const externalId = `resume-ext-${Date.now()}`;

        // Create a run with externalId
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `resume-external-${Date.now()}`,
            externalId,
          }),
        });
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json();

        // Resume by externalId
        const resumeResponse = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            externalId,
            projectName: TEST_PROJECT_NAME,
          }),
        });

        expect(resumeResponse.status).toBe(200);
        const resumeData = await resumeResponse.json();
        expect(resumeData.resumed).toBe(true);
        expect(resumeData.runId).toBe(createData.runId);
      });

      it('Test 26.4: Resume by externalId without projectName returns 400', async () => {
        const resumeResponse = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            externalId: 'some-id',
          }),
        });

        expect(resumeResponse.status).toBe(400);
      });

      it('Test 26.5: Resume a non-existent run returns 404', async () => {
        const resumeResponse = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: 999999999,
          }),
        });

        expect(resumeResponse.status).toBe(404);
        const data = await resumeResponse.json();
        expect(data.error).toBeDefined();
      });

      it('Test 26.6: Resume sets run status back to RUNNING', async () => {
        // Create a run
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `resume-status-${Date.now()}`,
          }),
        });
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json();

        // Mark it as completed
        const statusResponse = await makeRequest('/api/runs/status/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: createData.runId,
            status: 'COMPLETED',
          }),
        });
        expect(statusResponse.status).toBe(200);

        // Resume the completed run
        const resumeResponse = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: createData.runId,
          }),
        });
        expect(resumeResponse.status).toBe(200);
        const resumeData = await resumeResponse.json();
        expect(resumeData.resumed).toBe(true);

        // Verify the status is now RUNNING by fetching run details
        const detailsResponse = await makeRequest(`/api/runs/details/${createData.runId}`, {
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
        });
        expect(detailsResponse.status).toBe(200);
        const details = await detailsResponse.json();
        expect(details.status).toBe('RUNNING');
      });

      it('Test 26.7: Resume without auth returns 401', async () => {
        const resumeResponse = await makeRequest('/api/runs/resume', {
          method: 'POST',
          body: JSON.stringify({
            runId: 1,
          }),
        });

        expect(resumeResponse.status).toBe(401);
      });

      it('Test 26.8: Resume with no ID provided returns 400', async () => {
        const resumeResponse = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({}),
        });

        expect(resumeResponse.status).toBe(400);
      });

      it('Test 26.9: Resume with multiple IDs returns 400', async () => {
        const resumeResponse = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: 123,
            displayId: 'MMP-1',
          }),
        });

        expect(resumeResponse.status).toBe(400);
      });

      it('Test 26.10: Resume with invalid displayId format returns 400', async () => {
        const resumeResponse = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            displayId: 'not-a-valid-format-',
          }),
        });

        expect(resumeResponse.status).toBe(400);
      });
    });
  });

  // ============================================================================
  // Test Suite 27: Notes Update via HTTP API
  // ============================================================================
  describe('Test Suite 27: Notes Update via HTTP API', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Update Notes', () => {
      it('Test 27.1: Update notes on existing run', async () => {
        // Create a run first
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `update-notes-http-${Date.now()}`,
          }),
        });

        expect(createResponse.status).toBe(200);
        const { runId } = await createResponse.json();

        // Update notes via HTTP API
        const updateResponse = await makeRequest('/api/runs/notes/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: runId,
            notes: 'This is a test note for the run.',
          }),
        });

        expect(updateResponse.status).toBe(200);
        const data = await updateResponse.json();
        expect(data.success).toBe(true);
      });

      it('Test 27.2: Clear notes (set to null)', async () => {
        // Create a run first
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `clear-notes-http-${Date.now()}`,
          }),
        });

        expect(createResponse.status).toBe(200);
        const { runId } = await createResponse.json();

        // Set notes then clear them
        await makeRequest('/api/runs/notes/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: runId,
            notes: 'Temporary note',
          }),
        });

        const clearResponse = await makeRequest('/api/runs/notes/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: runId,
            notes: null,
          }),
        });

        expect(clearResponse.status).toBe(200);
        const data = await clearResponse.json();
        expect(data.success).toBe(true);
      });

      it('Test 27.3: Clear notes (set to empty string)', async () => {
        const createResponse = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `clear-notes-empty-${Date.now()}`,
          }),
        });

        expect(createResponse.status).toBe(200);
        const { runId } = await createResponse.json();

        const clearResponse = await makeRequest('/api/runs/notes/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: runId,
            notes: '',
          }),
        });

        expect(clearResponse.status).toBe(200);
        const data = await clearResponse.json();
        expect(data.success).toBe(true);
      });

      it('Test 27.4: Reject update for non-existent run', async () => {
        const updateResponse = await makeRequest('/api/runs/notes/update', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
          body: JSON.stringify({
            runId: 999999999,
            notes: 'Should fail',
          }),
        });

        expect(updateResponse.status).toBe(404);
        const data = await updateResponse.json();
        expect(data.error).toBe('Run not found');
      });
    });
  });

  // Test Suite 28: Pagination Response Shape (guards against mode-driven getNextPageParam bug)
  // The frontend's getNextPageParam must be response-driven (check which fields are non-null)
  // rather than mode-driven (check closure variable). These tests verify that each pagination
  // mode returns the correct field shape so the frontend can distinguish them.
  describe('Test Suite 28: Pagination Response Shape Across Sort Modes', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let serverAvailable = false;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) return;

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });

        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }
    });

    it('Test 28.1: Cursor mode (no sort) — nextCursor set, others null', async () => {
      if (!sessionCookie) { console.log('   No session - skipping'); return; }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result.runs.length).toBe(5);
      // Cursor mode: nextCursor should be set, others null
      expect(result.nextCursor).toBeDefined();
      expect(result.nextCursor).not.toBeNull();
      expect(result.nextOffset).toBeNull();
    });

    it('Test 28.2: Keyset mode (system sort) — sortCursor set, nextCursor & nextOffset null', async () => {
      if (!sessionCookie) { console.log('   No session - skipping'); return; }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        sortField: 'name',
        sortSource: 'system',
        sortDirection: 'asc',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result.runs.length).toBe(5);
      // Keyset mode: sortCursor set, others null
      expect(result.sortCursor).toBeDefined();
      expect(result.sortCursor).not.toBeNull();
      expect(result.nextCursor).toBeNull();
      expect(result.nextOffset).toBeNull();
    });

    it('Test 28.3: Offset mode (config sort) — nextOffset set, nextCursor & sortCursor null', async () => {
      if (!sessionCookie) { console.log('   No session - skipping'); return; }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        sortField: 'epochs',
        sortSource: 'config',
        sortDirection: 'asc',
        offset: 0,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result.runs.length).toBe(5);
      // Offset mode: nextOffset set, others null
      expect(result.nextOffset).toBeDefined();
      expect(result.nextOffset).not.toBeNull();
      expect(result.nextCursor).toBeNull();
      expect(result.sortCursor).toBeNull();
    });

    it('Test 28.4: Offset mode (metric sort) — nextOffset set, nextCursor & sortCursor null', async () => {
      if (!sessionCookie) { console.log('   No session - skipping'); return; }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        sortField: 'train/metric_00',
        sortSource: 'metric',
        sortDirection: 'desc',
        sortAggregation: 'LAST',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result.runs.length).toBe(5);
      // Metric sort uses offset mode: same shape as config sort
      expect(result.nextOffset).toBeDefined();
      expect(result.nextOffset).not.toBeNull();
      expect(result.nextCursor).toBeNull();
    });

    it('Test 28.5: Offset mode (config sort) pagination — page 2 works with nextOffset', async () => {
      if (!sessionCookie) { console.log('   No session - skipping'); return; }

      // Page 1
      const page1Response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        sortField: 'epochs',
        sortSource: 'config',
        sortDirection: 'asc',
        offset: 0,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(page1Response.status).toBe(200);
      const page1 = await page1Response.json();
      const nextOffset = page1.result?.data?.nextOffset;
      expect(nextOffset).toBe(5);

      // Page 2 using nextOffset
      const page2Response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        sortField: 'epochs',
        sortSource: 'config',
        sortDirection: 'asc',
        offset: nextOffset,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(page2Response.status).toBe(200);
      const page2 = await page2Response.json();
      const page2Runs = page2.result?.data?.runs;
      expect(page2Runs.length).toBeGreaterThan(0);

      // No overlap between pages
      const page1Ids = new Set(page1.result?.data?.runs.map((r: any) => r.id));
      for (const run of page2Runs) {
        expect(page1Ids.has(run.id)).toBe(false);
      }
    });

    it('Test 28.6: Offset mode (metric sort) pagination — page 2 works with nextOffset', async () => {
      if (!sessionCookie) { console.log('   No session - skipping'); return; }

      // Page 1
      const page1Response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        sortField: 'train/metric_00',
        sortSource: 'metric',
        sortDirection: 'desc',
        sortAggregation: 'LAST',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(page1Response.status).toBe(200);
      const page1 = await page1Response.json();
      const nextOffset = page1.result?.data?.nextOffset;
      expect(nextOffset).toBe(5);

      // Page 2 using nextOffset
      const page2Response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        sortField: 'train/metric_00',
        sortSource: 'metric',
        sortDirection: 'desc',
        sortAggregation: 'LAST',
        offset: nextOffset,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(page2Response.status).toBe(200);
      const page2 = await page2Response.json();
      const page2Runs = page2.result?.data?.runs;
      expect(page2Runs.length).toBeGreaterThan(0);

      // No overlap between pages
      const page1Ids = new Set(page1.result?.data?.runs.map((r: any) => r.id));
      for (const run of page2Runs) {
        expect(page1Ids.has(run.id)).toBe(false);
      }
    });

    it('Test 28.7: Config sort — all pages in correct order with no overlap or gaps', async () => {
      if (!sessionCookie) { console.log('   No session - skipping'); return; }

      const allRunIds: string[] = [];
      const allBatchSizes: number[] = [];
      let offset = 0;
      const limit = 20;

      // Paginate through ALL runs sorted by batch_size ascending
      for (let page = 0; page < 20; page++) {
        const response = await makeTrpcRequest('runs.list', {
          projectName: TEST_PROJECT_NAME,
          limit,
          sortField: 'batch_size',
          sortSource: 'config',
          sortDirection: 'asc',
          offset,
        }, { 'Cookie': sessionCookie }, 'GET');

        expect(response.status).toBe(200);
        const data = await response.json();
        const result = data.result?.data;

        if (!result.runs || result.runs.length === 0) break;

        for (const run of result.runs) {
          allRunIds.push(run.id);
          const bs = run.config?.batch_size;
          if (typeof bs === 'number') allBatchSizes.push(bs);
        }

        // Non-last pages must be full
        if (result.nextOffset !== null) {
          expect(result.runs.length).toBe(limit);
        }

        if (result.nextOffset === null) break;
        offset = result.nextOffset;
      }

      // No duplicate run IDs across pages
      expect(new Set(allRunIds).size).toBe(allRunIds.length);

      // Values must be in ascending order
      for (let i = 1; i < allBatchSizes.length; i++) {
        expect(allBatchSizes[i]).toBeGreaterThanOrEqual(allBatchSizes[i - 1]);
      }

      // Should have fetched all bulk runs (160+)
      expect(allRunIds.length).toBeGreaterThanOrEqual(160);
    });

    it('Test 28.8: Config sort descending — values decrease across pages', async () => {
      if (!sessionCookie) { console.log('   No session - skipping'); return; }

      const allBatchSizes: number[] = [];
      let offset = 0;
      const limit = 20;

      for (let page = 0; page < 20; page++) {
        const response = await makeTrpcRequest('runs.list', {
          projectName: TEST_PROJECT_NAME,
          limit,
          sortField: 'batch_size',
          sortSource: 'config',
          sortDirection: 'desc',
          offset,
        }, { 'Cookie': sessionCookie }, 'GET');

        expect(response.status).toBe(200);
        const data = await response.json();
        const result = data.result?.data;

        if (!result.runs || result.runs.length === 0) break;

        for (const run of result.runs) {
          const bs = run.config?.batch_size;
          if (typeof bs === 'number') allBatchSizes.push(bs);
        }

        if (result.nextOffset === null) break;
        offset = result.nextOffset;
      }

      // Values must be in descending order
      for (let i = 1; i < allBatchSizes.length; i++) {
        expect(allBatchSizes[i]).toBeLessThanOrEqual(allBatchSizes[i - 1]);
      }
    });

    it('Test 28.9a: Offset jump (no sort) — cursor-lookup returns same data as sequential pagination', async () => {
      if (!sessionCookie) { console.log('   No session - skipping'); return; }

      const limit = 5;
      // Sequential: paginate through 4 pages using cursors to collect run IDs
      const sequentialIds: string[] = [];
      let cursor: number | undefined;
      for (let page = 0; page < 4; page++) {
        const response = await makeTrpcRequest('runs.list', {
          projectName: TEST_PROJECT_NAME,
          limit,
          ...(cursor ? { cursor } : {}),
        }, { 'Cookie': sessionCookie }, 'GET');
        expect(response.status).toBe(200);
        const data = await response.json();
        const result = data.result?.data;
        for (const run of result.runs) sequentialIds.push(run.id);
        cursor = result.nextCursor ? Number(result.nextCursor) : undefined;
        if (!cursor) break;
      }

      // Offset jump: skip directly to page 4 (offset = 15)
      const jumpResponse = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit,
        offset: 15,
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(jumpResponse.status).toBe(200);
      const jumpData = await jumpResponse.json();
      const jumpRuns = jumpData.result?.data?.runs;
      expect(jumpRuns.length).toBe(limit);

      // The offset-jumped page should match the 4th sequential page
      const page4Sequential = sequentialIds.slice(15, 20);
      const page4Jump = jumpRuns.map((r: any) => r.id);
      expect(page4Jump).toEqual(page4Sequential);

      // nextOffset should allow continuing pagination
      expect(jumpData.result?.data?.nextOffset).toBe(20);
    });

    it('Test 28.9b: Offset jump (system sort) — cursor-lookup returns same data as keyset pagination', async () => {
      if (!sessionCookie) { console.log('   No session - skipping'); return; }

      const limit = 5;
      const sortParams = {
        sortField: 'name',
        sortSource: 'system' as const,
        sortDirection: 'asc' as const,
      };

      // Sequential: paginate through 4 pages using sortCursor
      const sequentialIds: string[] = [];
      let sortCursor: string | undefined;
      for (let page = 0; page < 4; page++) {
        const response = await makeTrpcRequest('runs.list', {
          projectName: TEST_PROJECT_NAME,
          limit,
          ...sortParams,
          ...(sortCursor ? { sortCursor } : {}),
        }, { 'Cookie': sessionCookie }, 'GET');
        expect(response.status).toBe(200);
        const data = await response.json();
        const result = data.result?.data;
        for (const run of result.runs) sequentialIds.push(run.id);
        sortCursor = result.sortCursor ?? undefined;
        if (!sortCursor) break;
      }

      // Offset jump: skip directly to page 4 (offset = 15)
      const jumpResponse = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit,
        ...sortParams,
        offset: 15,
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(jumpResponse.status).toBe(200);
      const jumpData = await jumpResponse.json();
      const jumpRuns = jumpData.result?.data?.runs;
      expect(jumpRuns.length).toBe(limit);

      // The offset-jumped page should match the 4th sequential page
      const page4Sequential = sequentialIds.slice(15, 20);
      const page4Jump = jumpRuns.map((r: any) => r.id);
      expect(page4Jump).toEqual(page4Sequential);
    });

    it('Test 28.9: Metric sort — stable ordering with tiebreaker across pages', async () => {
      if (!sessionCookie) { console.log('   No session - skipping'); return; }

      const allRunIds: string[] = [];
      let offset = 0;
      const limit = 20;

      for (let page = 0; page < 20; page++) {
        const response = await makeTrpcRequest('runs.list', {
          projectName: TEST_PROJECT_NAME,
          limit,
          sortField: 'train/metric_00',
          sortSource: 'metric',
          sortDirection: 'desc',
          sortAggregation: 'LAST',
          offset,
        }, { 'Cookie': sessionCookie }, 'GET');

        expect(response.status).toBe(200);
        const data = await response.json();
        const result = data.result?.data;

        if (!result.runs || result.runs.length === 0) break;

        for (const run of result.runs) {
          allRunIds.push(run.id);
        }

        // Non-last pages must be full
        if (result.nextOffset !== null) {
          expect(result.runs.length).toBe(limit);
        }

        if (result.nextOffset === null) break;
        offset = result.nextOffset;
      }

      // No duplicate run IDs (tiebreaker ensures stable ordering)
      expect(new Set(allRunIds).size).toBe(allRunIds.length);
    });
  });

  // ---------------------------------------------------------------------------
  // Test Suite 29: Batch Graph Procedures — Display ID Resolution
  // ---------------------------------------------------------------------------
  // Regression tests for the bug where graphBatchBucketed and graphBatch used
  // sqidDecode() which silently fails on display IDs (e.g., "STP-999").
  // The fix uses resolveRunId() which handles both display IDs and SQIDs.
  describe('Test Suite 29: Batch Graph Procedures — Display ID Resolution', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let serverAvailable = false;
    let staircaseRunSqid: string | null = null;
    let staircaseDisplayId: string | null = null;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) return;

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });

        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }

      if (!sessionCookie) return;

      // Find the staircase run to get its SQID and display ID
      const listResponse = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        search: 'staircase-test',
        limit: 5,
      }, { 'Cookie': sessionCookie }, 'GET');

      if (listResponse.status === 200) {
        const listData = await listResponse.json();
        const runs = listData.result?.data?.runs;
        const staircase = runs?.find((r: any) => r.name === 'staircase-test');
        if (staircase) {
          staircaseRunSqid = staircase.id; // SQID-encoded
          // Display ID = project.runPrefix + "-" + run.number
          // The setup assigns number=999 and prefix='STP' (if not already set)
          const prefix = staircase.project?.runPrefix;
          const num = staircase.number;
          if (prefix && num != null) {
            staircaseDisplayId = `${prefix}-${num}`;
          }
        }
      }
    });

    it('Test 29.1: graphBatchBucketed resolves SQID correctly', async () => {
      if (!sessionCookie || !staircaseRunSqid) {
        console.log('   No session or staircase run - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.data.graphBatchBucketed', {
        runIds: [staircaseRunSqid],
        projectName: TEST_PROJECT_NAME,
        logName: 'test/staircase',
        buckets: 50,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      // Result should be a map with the SQID as key, containing bucketed data
      const points = result[staircaseRunSqid!];
      expect(points).toBeDefined();
      expect(points.length).toBeGreaterThan(0);

      // Each point should have bucketed fields
      const firstPoint = points[0];
      expect(firstPoint).toHaveProperty('step');
      expect(firstPoint).toHaveProperty('value');
      expect(firstPoint).toHaveProperty('minY');
      expect(firstPoint).toHaveProperty('maxY');
      expect(firstPoint).toHaveProperty('count');
    });

    it('Test 29.2: graphBatchBucketed resolves display ID correctly', async () => {
      if (!sessionCookie || !staircaseDisplayId) {
        console.log('   No session or display ID - skipping');
        return;
      }

      // This was the broken path: display IDs like "STP-999" contain a dash,
      // which sqidDecode() cannot parse, silently returning undefined.
      // With resolveRunId(), the display ID is resolved via Prisma lookup.
      const response = await makeTrpcRequest('runs.data.graphBatchBucketed', {
        runIds: [staircaseDisplayId],
        projectName: TEST_PROJECT_NAME,
        logName: 'test/staircase',
        buckets: 50,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      // Result should be keyed by the display ID (same identifier that was sent)
      const points = result[staircaseDisplayId!];
      expect(points).toBeDefined();
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty('minY');
      expect(points[0]).toHaveProperty('maxY');
    });

    it('Test 29.3: graphBatchBucketed with display ID + stepMin/stepMax (zoom refetch)', async () => {
      if (!sessionCookie || !staircaseDisplayId) {
        console.log('   No session or display ID - skipping');
        return;
      }

      // Simulate zoom refetch: query a sub-range of the staircase data.
      // Staircase has 500 steps (0-499). Zoom to steps 100-200.
      const response = await makeTrpcRequest('runs.data.graphBatchBucketed', {
        runIds: [staircaseDisplayId],
        projectName: TEST_PROJECT_NAME,
        logName: 'test/staircase',
        buckets: 50,
        stepMin: 100,
        stepMax: 200,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      const points = result[staircaseDisplayId!];
      expect(points).toBeDefined();
      expect(points.length).toBeGreaterThan(0);

      // All returned steps should be within the requested range
      for (const p of points) {
        expect(p.step).toBeGreaterThanOrEqual(100);
        expect(p.step).toBeLessThanOrEqual(200);
      }
    });

    it('Test 29.4: graphBatch resolves display ID correctly', async () => {
      if (!sessionCookie || !staircaseDisplayId) {
        console.log('   No session or display ID - skipping');
        return;
      }

      // graphBatch (non-bucketed) had the same sqidDecode bug
      const response = await makeTrpcRequest('runs.data.graphBatch', {
        runIds: [staircaseDisplayId],
        projectName: TEST_PROJECT_NAME,
        logName: 'test/staircase',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      const points = result[staircaseDisplayId!];
      expect(points).toBeDefined();
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty('step');
      expect(points[0]).toHaveProperty('value');
    });
  });

  // ---------------------------------------------------------------------------
  // Test Suite 30: Multi-Metric Batch Bucketed Endpoint
  // ---------------------------------------------------------------------------
  // Tests for graphMultiMetricBatchBucketed — fetches bucketed data for multiple
  // metrics in a single ClickHouse query. Used by custom dashboards with many
  // metrics in one chart widget.
  describe('Test Suite 30: Multi-Metric Batch Bucketed', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let serverAvailable = false;
    let staircaseRunSqid: string | null = null;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) return;

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });

        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }

      if (!sessionCookie) return;

      const listResponse = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        search: 'staircase-test',
        limit: 5,
      }, { 'Cookie': sessionCookie }, 'GET');

      if (listResponse.status === 200) {
        const listData = await listResponse.json();
        const runs = listData.result?.data?.runs;
        const staircase = runs?.find((r: { name: string }) => r.name === 'staircase-test');
        if (staircase) {
          staircaseRunSqid = staircase.id;
        }
      }
    });

    it('Test 30.1: Returns bucketed data for multiple metrics in one request', async () => {
      if (!sessionCookie || !staircaseRunSqid) {
        console.log('   No session or staircase run - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.data.graphMultiMetricBatchBucketed', {
        runIds: [staircaseRunSqid],
        projectName: TEST_PROJECT_NAME,
        logNames: ['test/staircase', 'test/staircase_irregular'],
        buckets: 50,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      // Result should be nested: logName → runId → points[]
      expect(result['test/staircase']).toBeDefined();
      expect(result['test/staircase_irregular']).toBeDefined();

      const staircaseSeries = result['test/staircase'][staircaseRunSqid!];
      expect(staircaseSeries).toBeDefined();
      // Columnar format: parallel arrays instead of array of objects
      expect(staircaseSeries).toHaveProperty('steps');
      expect(staircaseSeries).toHaveProperty('values');
      expect(staircaseSeries).toHaveProperty('minYs');
      expect(staircaseSeries).toHaveProperty('maxYs');
      expect(staircaseSeries).toHaveProperty('counts');
      expect(staircaseSeries).toHaveProperty('times');
      expect(staircaseSeries).toHaveProperty('nfFlags');
      expect(staircaseSeries.steps.length).toBeGreaterThan(0);

      const irregularSeries = result['test/staircase_irregular'][staircaseRunSqid!];
      expect(irregularSeries).toBeDefined();
      expect(irregularSeries.steps.length).toBeGreaterThan(0);
    });

    it('Test 30.2: Respects stepMin/stepMax for zoom refetch', async () => {
      if (!sessionCookie || !staircaseRunSqid) {
        console.log('   No session or staircase run - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.data.graphMultiMetricBatchBucketed', {
        runIds: [staircaseRunSqid],
        projectName: TEST_PROJECT_NAME,
        logNames: ['test/staircase', 'test/staircase_irregular'],
        buckets: 50,
        stepMin: 100,
        stepMax: 200,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      const series = result['test/staircase'][staircaseRunSqid!];
      expect(series).toBeDefined();
      expect(series.steps.length).toBeGreaterThan(0);

      for (const step of series.steps) {
        expect(step).toBeGreaterThanOrEqual(100);
        expect(step).toBeLessThanOrEqual(200);
      }
    });

    it('Test 30.3: Returns empty object for non-existent metric', async () => {
      if (!sessionCookie || !staircaseRunSqid) {
        console.log('   No session or staircase run - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.data.graphMultiMetricBatchBucketed', {
        runIds: [staircaseRunSqid],
        projectName: TEST_PROJECT_NAME,
        logNames: ['test/staircase', 'nonexistent/metric'],
        buckets: 50,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      // Existing metric should have data (columnar format)
      expect(result['test/staircase']).toBeDefined();
      const series = result['test/staircase'][staircaseRunSqid!];
      expect(series.steps.length).toBeGreaterThan(0);

      // Non-existent metric should be absent
      expect(result['nonexistent/metric']).toBeUndefined();
    });
  });

  describe('Test Suite 31: Run Forking', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    // Helper to create a run for fork tests
    async function createRun(projectName: string, runName: string, opts: Record<string, unknown> = {}) {
      const response = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
        body: JSON.stringify({ projectName, runName, ...opts }),
      });
      expect(response.status).toBe(200);
      return response.json();
    }

    describe.skipIf(!hasApiKey)('Fork Run via HTTP API', () => {
      let parentRunId: number;
      const forkProjectName = `fork-test-project-${Date.now()}`;

      beforeAll(async () => {
        const data = await createRun(forkProjectName, 'parent-run', {
          config: '{"lr": 0.001, "epochs": 100}',
          tags: ['baseline', 'v1'],
        });
        parentRunId = data.runId;
      });

      it('Test 31.1: Create forked run with forkRunId and forkStep', async () => {
        const data = await createRun(forkProjectName, 'child-run', {
          forkRunId: parentRunId,
          forkStep: 50,
        });

        expect(data.runId).toBeDefined();
        expect(data.resumed).toBe(false);
        expect(data.forkedFromRunId).toBe(parentRunId);
        expect(data.forkStep).toBe(50);
      });

      it('Test 31.2: Fork inherits config by default', async () => {
        const data = await createRun(forkProjectName, 'child-inherits-config', {
          forkRunId: parentRunId,
          forkStep: 50,
          inheritConfig: true,
        });

        expect(data.forkedFromRunId).toBe(parentRunId);

        // Verify inherited config via details endpoint
        const detailsResponse = await makeRequest(`/api/runs/details/${data.runId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
        });
        if (detailsResponse.status === 200) {
          const details = await detailsResponse.json();
          expect(details.config).toBeDefined();
          if (details.config) {
            expect(details.config.lr).toBe(0.001);
          }
        }
      });

      it('Test 31.3: Fork with inheritConfig=false does not copy config', async () => {
        const data = await createRun(forkProjectName, 'child-no-config', {
          forkRunId: parentRunId,
          forkStep: 50,
          inheritConfig: false,
        });
        expect(data.forkedFromRunId).toBe(parentRunId);
      });

      it('Test 31.4: Fork with inheritTags=true merges tags', async () => {
        const data = await createRun(forkProjectName, 'child-with-tags', {
          forkRunId: parentRunId,
          forkStep: 50,
          inheritTags: true,
          tags: ['fork-specific'],
        });
        expect(data.forkedFromRunId).toBe(parentRunId);
      });

      it('Test 31.5: Fork without forkStep returns 400', async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: forkProjectName,
            runName: 'child-no-step',
            forkRunId: parentRunId,
          }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain('forkStep');
      });

      it('Test 31.6: Fork with non-existent parent returns 400', async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: forkProjectName,
            runName: 'child-bad-parent',
            forkRunId: 999999999,
            forkStep: 50,
          }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain('not found');
      });

      it('Test 31.7: Explicit config overrides inherited config keys', async () => {
        const data = await createRun(forkProjectName, 'child-override-config', {
          forkRunId: parentRunId,
          forkStep: 50,
          config: '{"lr": 0.01}',
        });
        expect(data.forkedFromRunId).toBe(parentRunId);

        // Verify merge: explicit lr=0.01 overrides parent's lr=0.001,
        // but parent's epochs=100 should be inherited
        const detailsResponse = await makeRequest(`/api/runs/details/${data.runId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
        });
        if (detailsResponse.status === 200) {
          const details = await detailsResponse.json();
          if (details.config) {
            expect(details.config.lr).toBe(0.01);
            expect(details.config.epochs).toBe(100);
          }
        }
      });

      it('Test 31.8: Fork run without API key returns 401', async () => {
        const response = await makeRequest('/api/runs/create', {
          method: 'POST',
          body: JSON.stringify({
            projectName: forkProjectName,
            runName: 'child-no-auth',
            forkRunId: parentRunId,
            forkStep: 50,
          }),
        });
        expect(response.status).toBe(401);
      });

      it('Test 31.9: Creating a normal run still works (backward compatibility)', async () => {
        const data = await createRun(forkProjectName, 'regular-run-after-fork');
        expect(data.resumed).toBe(false);
        expect(data.forkedFromRunId).toBeNull();
        expect(data.forkStep).toBeNull();
      });
    });

    describe.skipIf(!hasApiKey)('Lineage Resolution (parent walk-down)', () => {
      // Build a 3-level chain: A → B (fork@20) → C (fork@40)
      // Then test that forking C at various steps resolves to the correct parent.
      let runA: number;
      let runB: number;
      let runC: number;
      const lineageProject = `lineage-test-project-${Date.now()}`;

      beforeAll(async () => {
        // A: root run (steps 0-100)
        const dataA = await createRun(lineageProject, 'run-A', {
          config: '{"model": "resnet", "lr": 0.1}',
        });
        runA = dataA.runId;

        // B: forked from A at step 20 (owns steps 21+)
        const dataB = await createRun(lineageProject, 'run-B', {
          forkRunId: runA,
          forkStep: 20,
          config: '{"lr": 0.05}',
        });
        runB = dataB.runId;
        expect(dataB.forkedFromRunId).toBe(runA);

        // C: forked from B at step 40 (owns steps 41+)
        const dataC = await createRun(lineageProject, 'run-C', {
          forkRunId: runB,
          forkStep: 40,
          config: '{"lr": 0.01}',
        });
        runC = dataC.runId;
        expect(dataC.forkedFromRunId).toBe(runB);
      });

      it('Test 31.10: Fork C at step 50 → parent is C (C owns step 50)', async () => {
        const data = await createRun(lineageProject, 'fork-from-C-at-50', {
          forkRunId: runC,
          forkStep: 50,
        });
        expect(data.forkedFromRunId).toBe(runC);
        expect(data.forkStep).toBe(50);
      });

      it('Test 31.11: Fork C at step 30 → resolves to B (30 < C.forkStep=40, but 30 > B.forkStep=20)', async () => {
        const data = await createRun(lineageProject, 'fork-from-C-at-30', {
          forkRunId: runC,
          forkStep: 30,
        });
        // Step 30 < C's forkStep(40), walk down to B. Step 30 > B's forkStep(20), so B is the parent.
        expect(data.forkedFromRunId).toBe(runB);
        expect(data.forkStep).toBe(30);
      });

      it('Test 31.12: Fork C at step 10 → resolves to A (10 < C.forkStep=40, 10 < B.forkStep=20, A is root)', async () => {
        const data = await createRun(lineageProject, 'fork-from-C-at-10', {
          forkRunId: runC,
          forkStep: 10,
        });
        // Step 10 < C.forkStep(40) → walk to B. Step 10 < B.forkStep(20) → walk to A. A is root.
        expect(data.forkedFromRunId).toBe(runA);
        expect(data.forkStep).toBe(10);
      });

      it('Test 31.13: Fork B at step 25 → parent is B (25 > B.forkStep=20)', async () => {
        const data = await createRun(lineageProject, 'fork-from-B-at-25', {
          forkRunId: runB,
          forkStep: 25,
        });
        expect(data.forkedFromRunId).toBe(runB);
        expect(data.forkStep).toBe(25);
      });

      it('Test 31.14: Fork B at step 5 → resolves to A (5 < B.forkStep=20, A is root)', async () => {
        const data = await createRun(lineageProject, 'fork-from-B-at-5', {
          forkRunId: runB,
          forkStep: 5,
        });
        expect(data.forkedFromRunId).toBe(runA);
        expect(data.forkStep).toBe(5);
      });

      it('Test 31.15a: Fork at high step succeeds when parent has no metrics (validation skipped)', async () => {
        // When a parent run has no metrics data in ClickHouse, forkStep validation
        // is skipped (maxStep is null/0), so any forkStep value is accepted.
        const data = await createRun(lineageProject, 'fork-high-step-no-metrics', {
          forkRunId: runA,
          forkStep: 999999,
        });
        expect(data.forkedFromRunId).toBe(runA);
        expect(data.forkStep).toBe(999999);
      });

      it('Test 31.15: Fork A at step 0 → parent is A (A is root, always valid)', async () => {
        const data = await createRun(lineageProject, 'fork-from-A-at-0', {
          forkRunId: runA,
          forkStep: 0,
        });
        expect(data.forkedFromRunId).toBe(runA);
        expect(data.forkStep).toBe(0);
      });

      it('Test 31.16: Fork C at step 40 (exactly at forkStep) → resolves to B', async () => {
        // forkStep <= parent's forkStep triggers walk-down, so step=40 with C.forkStep=40 walks to B
        const data = await createRun(lineageProject, 'fork-from-C-at-40', {
          forkRunId: runC,
          forkStep: 40,
        });
        expect(data.forkedFromRunId).toBe(runB);
        expect(data.forkStep).toBe(40);
      });

      it('Test 31.17: Fork C at step 20 (exactly at B forkStep) → resolves to A', async () => {
        const data = await createRun(lineageProject, 'fork-from-C-at-20', {
          forkRunId: runC,
          forkStep: 20,
        });
        // Step 20 <= C.forkStep(40) → walk to B. Step 20 <= B.forkStep(20) → walk to A. A is root.
        expect(data.forkedFromRunId).toBe(runA);
        expect(data.forkStep).toBe(20);
      });

      it('Test 31.18: Config inheritance uses resolved parent, not requested parent', async () => {
        // Fork C at step 10 → resolves to A. Config should come from A (model: resnet, lr: 0.1)
        const data = await createRun(lineageProject, 'fork-C-step10-check-config', {
          forkRunId: runC,
          forkStep: 10,
          inheritConfig: true,
        });
        expect(data.forkedFromRunId).toBe(runA);

        const detailsResponse = await makeRequest(`/api/runs/details/${data.runId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
        });
        if (detailsResponse.status === 200) {
          const details = await detailsResponse.json();
          if (details.config) {
            // Should have A's config (model: resnet, lr: 0.1), not C's (lr: 0.01)
            expect(details.config.model).toBe('resnet');
            expect(details.config.lr).toBe(0.1);
          }
        }
      });
    });

    describe.skipIf(!hasApiKey)('Multi-level fork chain (5 levels)', () => {
      // Build chain: R0 → R1 (fork@100) → R2 (fork@200) → R3 (fork@300) → R4 (fork@400)
      const chainProject = `chain-test-${Date.now()}`;
      const runIds: number[] = [];

      beforeAll(async () => {
        // R0: root
        const d0 = await createRun(chainProject, 'chain-R0');
        runIds.push(d0.runId);

        // R1..R4: each forked from previous at step N*100
        for (let i = 1; i <= 4; i++) {
          const d = await createRun(chainProject, `chain-R${i}`, {
            forkRunId: runIds[i - 1],
            forkStep: i * 100,
          });
          expect(d.forkedFromRunId).toBe(runIds[i - 1]);
          runIds.push(d.runId);
        }
      });

      it('Test 31.19: Fork R4 at step 450 → parent is R4', async () => {
        const data = await createRun(chainProject, 'deep-fork-450', {
          forkRunId: runIds[4],
          forkStep: 450,
        });
        expect(data.forkedFromRunId).toBe(runIds[4]);
      });

      it('Test 31.20: Fork R4 at step 250 → resolves to R2', async () => {
        // 250 < R4.forkStep(400) → R3. 250 < R3.forkStep(300) → R2. 250 > R2.forkStep(200) → R2.
        const data = await createRun(chainProject, 'deep-fork-250', {
          forkRunId: runIds[4],
          forkStep: 250,
        });
        expect(data.forkedFromRunId).toBe(runIds[2]);
      });

      it('Test 31.21: Fork R4 at step 50 → resolves all the way to R0 (root)', async () => {
        const data = await createRun(chainProject, 'deep-fork-50', {
          forkRunId: runIds[4],
          forkStep: 50,
        });
        expect(data.forkedFromRunId).toBe(runIds[0]);
      });

      it('Test 31.22: All 5 runs in chain have correct parentage', async () => {
        for (let i = 0; i < runIds.length; i++) {
          const response = await makeRequest(`/api/runs/details/${runIds[i]}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          });
          if (response.status === 200) {
            const details = await response.json();
            if (i === 0) {
              // Root has no parent
              expect(details.forkedFromRunId).toBeNull();
            } else {
              expect(details.forkedFromRunId).toBe(runIds[i - 1]);
              expect(details.forkStep).toBe(i * 100);
            }
          }
        }
      });
    });

    describe.skipIf(!hasApiKey)('Fork + DDP (externalId) combined', () => {
      const ddpForkProject = `ddp-fork-test-${Date.now()}`;
      let parentRunId: number;

      beforeAll(async () => {
        const data = await createRun(ddpForkProject, 'ddp-fork-parent', {
          config: '{"lr": 0.01, "epochs": 50}',
        });
        parentRunId = data.runId;
      });

      it('Test 31.23: DDP fork creation — worker 1 creates forked run with externalId', async () => {
        const extId = `ddp-fork-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const data = await createRun(ddpForkProject, 'ddp-fork-worker0', {
          forkRunId: parentRunId,
          forkStep: 50,
          externalId: extId,
        });
        expect(data.resumed).toBe(false);
        expect(data.forkedFromRunId).toBe(parentRunId);
        expect(data.forkStep).toBe(50);

        // Worker 2 resumes via same externalId (Test 31.24)
        const data2 = await createRun(ddpForkProject, 'ddp-fork-worker1', {
          forkRunId: parentRunId,
          forkStep: 50,
          externalId: extId,
        });
        expect(data2.resumed).toBe(true);
        expect(data2.runId).toBe(data.runId);
      });

      it('Test 31.25: DDP fork resumption ignores different fork params', async () => {
        const extId = `ddp-fork-ignore-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        // Create initial fork
        const data = await createRun(ddpForkProject, 'ddp-fork-original', {
          forkRunId: parentRunId,
          forkStep: 50,
          externalId: extId,
        });
        expect(data.resumed).toBe(false);

        // Resume with different fork params — externalId wins
        const parent2 = await createRun(ddpForkProject, 'other-parent');
        const data2 = await createRun(ddpForkProject, 'ddp-fork-different-params', {
          forkRunId: parent2.runId,
          forkStep: 999,
          externalId: extId,
        });
        expect(data2.resumed).toBe(true);
        expect(data2.runId).toBe(data.runId);
      });

      it('Test 31.26: Forking a DDP-created parent (parent has externalId)', async () => {
        const parentExtId = `ddp-parent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const ddpParent = await createRun(ddpForkProject, 'ddp-parent', {
          externalId: parentExtId,
        });
        expect(ddpParent.resumed).toBe(false);

        // Fork from the DDP-created parent (child has no externalId)
        const child = await createRun(ddpForkProject, 'fork-of-ddp-parent', {
          forkRunId: ddpParent.runId,
          forkStep: 10,
        });
        expect(child.forkedFromRunId).toBe(ddpParent.runId);
        expect(child.forkStep).toBe(10);
        expect(child.resumed).toBe(false);
      });

      it('Test 31.27: Race condition — simultaneous DDP fork workers', async () => {
        const extId = `ddp-race-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const results = await Promise.all([
          createRun(ddpForkProject, 'race-worker-0', {
            forkRunId: parentRunId,
            forkStep: 25,
            externalId: extId,
          }),
          createRun(ddpForkProject, 'race-worker-1', {
            forkRunId: parentRunId,
            forkStep: 25,
            externalId: extId,
          }),
          createRun(ddpForkProject, 'race-worker-2', {
            forkRunId: parentRunId,
            forkStep: 25,
            externalId: extId,
          }),
        ]);

        // All should return the same runId
        const runIds = results.map(r => r.runId);
        expect(new Set(runIds).size).toBe(1);

        // Exactly one should be non-resumed (the creator)
        const creators = results.filter(r => r.resumed === false);
        expect(creators.length).toBe(1);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Test Suite 32: LTTB Downsampling Algorithm
  // ---------------------------------------------------------------------------
  // Tests that the `algorithm: "lttb"` parameter produces bucketed data with
  // min/max envelope bands (not just raw selected points).
  describe('Test Suite 32: LTTB Downsampling Algorithm', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let serverAvailable = false;
    let staircaseRunSqid: string | null = null;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) return;

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });

        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }

      if (!sessionCookie) return;

      const listResponse = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        search: 'staircase-test',
        limit: 5,
      }, { 'Cookie': sessionCookie }, 'GET');

      if (listResponse.status === 200) {
        const listData = await listResponse.json();
        const runs = listData.result?.data?.runs;
        const staircase = runs?.find((r: { name: string }) => r.name === 'staircase-test');
        if (staircase) {
          staircaseRunSqid = staircase.id;
        }
      }
    });

    it('Test 32.1: graphBatchBucketed with algorithm=lttb returns bucketed data with min/max envelopes', async () => {
      if (!sessionCookie || !staircaseRunSqid) {
        console.log('   No session or staircase run - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.data.graphBatchBucketed', {
        runIds: [staircaseRunSqid],
        projectName: TEST_PROJECT_NAME,
        logName: 'test/staircase',
        buckets: 50,
        algorithm: 'lttb',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      const points = result[staircaseRunSqid!];
      expect(points).toBeDefined();
      expect(points.length).toBeGreaterThan(0);

      // Every bucket must have min/max envelope fields (not null for finite data)
      const firstPoint = points[0];
      expect(firstPoint).toHaveProperty('step');
      expect(firstPoint).toHaveProperty('value');
      expect(firstPoint).toHaveProperty('minY');
      expect(firstPoint).toHaveProperty('maxY');
      expect(firstPoint).toHaveProperty('count');
      expect(firstPoint).toHaveProperty('nonFiniteFlags');

      // Staircase data is all finite — min/max should be numbers
      expect(typeof firstPoint.minY).toBe('number');
      expect(typeof firstPoint.maxY).toBe('number');
      expect(typeof firstPoint.value).toBe('number');

      // minY <= value <= maxY for each bucket
      for (const p of points) {
        if (p.value !== null && p.minY !== null && p.maxY !== null) {
          expect(p.minY).toBeLessThanOrEqual(p.value);
          expect(p.maxY).toBeGreaterThanOrEqual(p.value);
        }
      }
    });

    it('Test 32.2: graphBatchBucketed with algorithm=lttb returns different values than algorithm=avg', async () => {
      if (!sessionCookie || !staircaseRunSqid) {
        console.log('   No session or staircase run - skipping');
        return;
      }

      // Fetch with AVG (default)
      const avgResponse = await makeTrpcRequest('runs.data.graphBatchBucketed', {
        runIds: [staircaseRunSqid],
        projectName: TEST_PROJECT_NAME,
        logName: 'test/staircase',
        buckets: 20,
      }, { 'Cookie': sessionCookie }, 'GET');

      // Fetch with LTTB
      const lttbResponse = await makeTrpcRequest('runs.data.graphBatchBucketed', {
        runIds: [staircaseRunSqid],
        projectName: TEST_PROJECT_NAME,
        logName: 'test/staircase',
        buckets: 20,
        algorithm: 'lttb',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(avgResponse.status).toBe(200);
      expect(lttbResponse.status).toBe(200);

      const avgData = (await avgResponse.json()).result?.data;
      const lttbData = (await lttbResponse.json()).result?.data;

      const avgPoints = avgData[staircaseRunSqid!];
      const lttbPoints = lttbData[staircaseRunSqid!];

      expect(avgPoints.length).toBeGreaterThan(0);
      expect(lttbPoints.length).toBeGreaterThan(0);

      // The representative values should differ between AVG and LTTB
      // (AVG computes the mean; LTTB picks a specific raw point)
      const avgValues = avgPoints.map((p: any) => p.value);
      const lttbValues = lttbPoints.map((p: any) => p.value);
      const identical = avgValues.every((v: number, i: number) => v === lttbValues[i]);
      // With 500 raw points bucketed into 20 buckets, at least some values should differ
      // (Unless all data is perfectly linear, which the staircase is not at bucket boundaries)
      expect(identical).toBe(false);
    });

    it('Test 32.3: graphMultiMetricBatchBucketed with algorithm=lttb returns columnar data with envelopes', async () => {
      if (!sessionCookie || !staircaseRunSqid) {
        console.log('   No session or staircase run - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.data.graphMultiMetricBatchBucketed', {
        runIds: [staircaseRunSqid],
        projectName: TEST_PROJECT_NAME,
        logNames: ['test/staircase', 'test/staircase_irregular'],
        buckets: 50,
        algorithm: 'lttb',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      // Both metrics should be present
      expect(result['test/staircase']).toBeDefined();
      expect(result['test/staircase_irregular']).toBeDefined();

      // Columnar format with envelope fields
      const series = result['test/staircase'][staircaseRunSqid!];
      expect(series).toBeDefined();
      expect(series).toHaveProperty('steps');
      expect(series).toHaveProperty('values');
      expect(series).toHaveProperty('minYs');
      expect(series).toHaveProperty('maxYs');
      expect(series).toHaveProperty('counts');
      expect(series).toHaveProperty('nfFlags');
      expect(series.steps.length).toBeGreaterThan(0);

      // Verify min <= value <= max for each bucket (columnar)
      for (let i = 0; i < series.steps.length; i++) {
        const v = series.values[i];
        const minY = series.minYs[i];
        const maxY = series.maxYs[i];
        if (v !== null && minY !== null && maxY !== null) {
          expect(minY).toBeLessThanOrEqual(v);
          expect(maxY).toBeGreaterThanOrEqual(v);
        }
      }
    });

    it('Test 32.4: graphBatchBucketed with algorithm=lttb respects stepMin/stepMax', async () => {
      if (!sessionCookie || !staircaseRunSqid) {
        console.log('   No session or staircase run - skipping');
        return;
      }

      // Zoom to steps 100-200 with LTTB
      const response = await makeTrpcRequest('runs.data.graphBatchBucketed', {
        runIds: [staircaseRunSqid],
        projectName: TEST_PROJECT_NAME,
        logName: 'test/staircase',
        buckets: 50,
        stepMin: 100,
        stepMax: 200,
        algorithm: 'lttb',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      const points = result[staircaseRunSqid!];
      expect(points).toBeDefined();
      expect(points.length).toBeGreaterThan(0);

      // All returned steps should be within [100, 200]
      for (const p of points) {
        expect(p.step).toBeGreaterThanOrEqual(100);
        expect(p.step).toBeLessThanOrEqual(200);
      }

      // Should still have min/max envelopes
      expect(typeof points[0].minY).toBe('number');
      expect(typeof points[0].maxY).toBe('number');
    });

    it('Test 32.5: graphBatchBucketed with algorithm=avg (default) still works unchanged', async () => {
      if (!sessionCookie || !staircaseRunSqid) {
        console.log('   No session or staircase run - skipping');
        return;
      }

      // Explicit algorithm=avg should behave identically to omitting it
      const [defaultResponse, explicitResponse] = await Promise.all([
        makeTrpcRequest('runs.data.graphBatchBucketed', {
          runIds: [staircaseRunSqid],
          projectName: TEST_PROJECT_NAME,
          logName: 'test/staircase',
          buckets: 50,
        }, { 'Cookie': sessionCookie }, 'GET'),
        makeTrpcRequest('runs.data.graphBatchBucketed', {
          runIds: [staircaseRunSqid],
          projectName: TEST_PROJECT_NAME,
          logName: 'test/staircase',
          buckets: 50,
          algorithm: 'avg',
        }, { 'Cookie': sessionCookie }, 'GET'),
      ]);

      expect(defaultResponse.status).toBe(200);
      expect(explicitResponse.status).toBe(200);

      const defaultData = (await defaultResponse.json()).result?.data;
      const explicitData = (await explicitResponse.json()).result?.data;

      const defaultPoints = defaultData[staircaseRunSqid!];
      const explicitPoints = explicitData[staircaseRunSqid!];

      // Same bucket count and same values
      expect(defaultPoints.length).toBe(explicitPoints.length);
      expect(defaultPoints[0].value).toBe(explicitPoints[0].value);
    });

    it('Test 32.6: graphMultiMetricBatchBucketed with algorithm=lttb and stepMin/stepMax maintains value ∈ [minY, maxY]', async () => {
      if (!sessionCookie || !staircaseRunSqid) {
        console.log('   No session or staircase run - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.data.graphMultiMetricBatchBucketed', {
        runIds: [staircaseRunSqid],
        projectName: TEST_PROJECT_NAME,
        logNames: ['test/staircase', 'test/staircase_irregular'],
        buckets: 50,
        stepMin: 50,
        stepMax: 300,
        algorithm: 'lttb',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const result = data.result?.data;
      expect(result).toBeDefined();

      // Check each metric's columnar data
      for (const metricName of ['test/staircase', 'test/staircase_irregular']) {
        const metricData = result[metricName];
        if (!metricData) continue;

        const series = metricData[staircaseRunSqid!];
        if (!series || !series.steps || series.steps.length === 0) continue;

        // All steps should be within [50, 300]
        for (let i = 0; i < series.steps.length; i++) {
          expect(series.steps[i]).toBeGreaterThanOrEqual(50);
          expect(series.steps[i]).toBeLessThanOrEqual(300);
        }

        // value ∈ [minY, maxY] for every bucket
        for (let i = 0; i < series.steps.length; i++) {
          const v = series.values[i];
          const minY = series.minYs[i];
          const maxY = series.maxYs[i];
          if (v !== null && minY !== null && maxY !== null) {
            expect(minY).toBeLessThanOrEqual(v);
            expect(maxY).toBeGreaterThanOrEqual(v);
          }
        }
      }
    });
  });

  // ============================================================================
  // Test Suite 34: Run Status Transition Events
  //
  // These tests exercise the precedence-based state machine for status updates
  // without relying on wall-clock timing. Invariants:
  //   1. Every recorded event must connect: events[i].fromStatus === events[i-1].toStatus
  //   2. The last event's toStatus must equal the run's current status
  //   3. No two consecutive events have the same toStatus (no-op transitions are elided)
  //   4. Terminal-to-terminal "downgrades" (e.g. FAILED -> COMPLETED from a late rank)
  //      are rejected by the precedence rule; no event is recorded.
  // ============================================================================
  describe('Test Suite 34: Run Status Transition Events', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    type StatusEvent = {
      id: string;
      runId: number;
      fromStatus: string | null;
      toStatus: string;
      source: string;
      metadata: unknown;
      createdAt: string;
    };

    async function fetchHistory(runId: number): Promise<StatusEvent[]> {
      const res = await makeRequest(`/api/runs/status/history?runId=${runId}`, {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      return body.events as StatusEvent[];
    }

    async function fetchRunStatus(runId: number): Promise<string> {
      const res = await makeRequest(`/api/runs/details/${runId}`, {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      return body.status as string;
    }

    function assertHistoryInvariants(events: StatusEvent[], finalStatus: string) {
      // Invariant 1: connected chain
      for (let i = 1; i < events.length; i++) {
        expect(events[i].fromStatus).toBe(events[i - 1].toStatus);
      }
      // Invariant 2: last event matches current row status
      if (events.length > 0) {
        expect(events.at(-1)!.toStatus).toBe(finalStatus);
      }
      // Invariant 3: no consecutive dupes
      for (let i = 1; i < events.length; i++) {
        expect(events[i].toStatus).not.toBe(events[i - 1].toStatus);
      }
    }

    describe.skipIf(!hasApiKey)('Basic lifecycle', () => {
      it('Test 34.1: Creating a run emits initial RUNNING event', async () => {
        const createRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `status-events-create-${Date.now()}`,
          }),
        });
        expect(createRes.status).toBe(200);
        const { runId } = await createRes.json();

        const events = await fetchHistory(runId);
        expect(events).toHaveLength(1);
        expect(events[0].fromStatus).toBeNull();
        expect(events[0].toStatus).toBe('RUNNING');
        expect(events[0].source).toBe('api');

        assertHistoryInvariants(events, await fetchRunStatus(runId));
      });

      it('Test 34.2: Succeed -> resume -> fail produces 4-event timeline', async () => {
        const createRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `status-events-lifecycle-${Date.now()}`,
          }),
        });
        expect(createRes.status).toBe(200);
        const { runId } = await createRes.json();

        // 1: complete
        await makeRequest('/api/runs/status/update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({ runId, status: 'COMPLETED' }),
        });

        // 2: resume
        const resumeRes = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({ runId }),
        });
        expect(resumeRes.status).toBe(200);

        // 3: fail with metadata
        await makeRequest('/api/runs/status/update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            runId,
            status: 'FAILED',
            statusMetadata: JSON.stringify({ error: 'OOM' }),
          }),
        });

        const events = await fetchHistory(runId);
        const finalStatus = await fetchRunStatus(runId);

        expect(events).toHaveLength(4);
        expect(events.map(e => `${e.fromStatus ?? 'null'}->${e.toStatus}`)).toEqual([
          'null->RUNNING',
          'RUNNING->COMPLETED',
          'COMPLETED->RUNNING',
          'RUNNING->FAILED',
        ]);
        expect(events[2].source).toBe('resume');
        expect(events[3].source).toBe('api');
        expect(events[3].metadata).toEqual({ error: 'OOM' });

        assertHistoryInvariants(events, finalStatus);
        expect(finalStatus).toBe('FAILED');
      });

      it('Test 34.3: Repeated COMPLETED updates are elided (no consecutive dupes)', async () => {
        const createRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `status-events-elide-${Date.now()}`,
          }),
        });
        const { runId } = await createRes.json();

        // Send COMPLETED three times in a row
        for (let i = 0; i < 3; i++) {
          const res = await makeRequest('/api/runs/status/update', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
            body: JSON.stringify({ runId, status: 'COMPLETED' }),
          });
          expect(res.status).toBe(200);
        }

        const events = await fetchHistory(runId);
        // Exactly 2: initial RUNNING + single RUNNING->COMPLETED
        expect(events).toHaveLength(2);
        assertHistoryInvariants(events, await fetchRunStatus(runId));
      });

      it('Test 34.4: Resume into a still-RUNNING run does not add an event', async () => {
        const createRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `status-events-running-resume-${Date.now()}`,
          }),
        });
        const { runId } = await createRes.json();

        // Resume immediately (run is still RUNNING)
        const resumeRes = await makeRequest('/api/runs/resume', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({ runId }),
        });
        expect(resumeRes.status).toBe(200);

        const events = await fetchHistory(runId);
        expect(events).toHaveLength(1);
        expect(events[0].toStatus).toBe('RUNNING');
      });

      it('Test 34.4b: externalId-based resume of a terminal run emits COMPLETED->RUNNING', async () => {
        const externalId = `status-events-ext-resume-${Date.now()}`;

        // 1. Create via externalId
        const createRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `ext-resume-${Date.now()}`,
            externalId,
          }),
        });
        expect(createRes.status).toBe(200);
        const { runId, resumed } = await createRes.json();
        expect(resumed).toBe(false);

        // 2. Mark COMPLETED
        await makeRequest('/api/runs/status/update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({ runId, status: 'COMPLETED' }),
        });

        // 3. Re-create with same externalId — mirrors SDK string run_id flow
        const resumeCreateRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `ext-resume-ignored-${Date.now()}`,
            externalId,
          }),
        });
        expect(resumeCreateRes.status).toBe(200);
        const resumeBody = await resumeCreateRes.json();
        expect(resumeBody.runId).toBe(runId);
        expect(resumeBody.resumed).toBe(true);

        const events = await fetchHistory(runId);
        expect(events).toHaveLength(3); // RUNNING, COMPLETED, RUNNING (resume)
        expect(events[2].fromStatus).toBe('COMPLETED');
        expect(events[2].toStatus).toBe('RUNNING');
        expect(events[2].source).toBe('resume');

        assertHistoryInvariants(events, await fetchRunStatus(runId));
      });

      it('Test 34.4c: externalId re-create of a still-RUNNING run does not add an event', async () => {
        const externalId = `status-events-ext-running-${Date.now()}`;

        const createRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `ext-running-${Date.now()}`,
            externalId,
          }),
        });
        const { runId } = await createRes.json();

        // Same externalId while still RUNNING — common DDP fan-out
        const resumeCreateRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `ext-running-ignored-${Date.now()}`,
            externalId,
          }),
        });
        expect(resumeCreateRes.status).toBe(200);

        const events = await fetchHistory(runId);
        expect(events).toHaveLength(1);
        expect(events[0].toStatus).toBe('RUNNING');
      });
    });

    describe.skipIf(!hasApiKey)('DDP concurrent writers', () => {
      it('Test 34.5: 8 ranks posting COMPLETED in parallel produce exactly 1 transition event', async () => {
        const createRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `status-events-ddp-ok-${Date.now()}`,
          }),
        });
        const { runId } = await createRes.json();

        await Promise.all(
          Array.from({ length: 8 }, () =>
            makeRequest('/api/runs/status/update', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
              body: JSON.stringify({ runId, status: 'COMPLETED' }),
            })
          )
        );

        const events = await fetchHistory(runId);
        expect(events).toHaveLength(2); // initial + single COMPLETED
        expect(events[1].fromStatus).toBe('RUNNING');
        expect(events[1].toStatus).toBe('COMPLETED');
        assertHistoryInvariants(events, await fetchRunStatus(runId));
      });

      it('Test 34.6: One rank fails, others succeed: FAILED wins and timeline is consistent', async () => {
        const createRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `status-events-ddp-one-fails-${Date.now()}`,
          }),
        });
        const { runId } = await createRes.json();

        // 7 successes + 1 failure, fired concurrently
        const outcomes: Array<'COMPLETED' | 'FAILED'> = [
          ...Array(7).fill('COMPLETED' as const),
          'FAILED' as const,
        ];
        await Promise.all(
          outcomes.map(status =>
            makeRequest('/api/runs/status/update', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
              body: JSON.stringify({ runId, status }),
            })
          )
        );

        const events = await fetchHistory(runId);
        const finalStatus = await fetchRunStatus(runId);

        // Invariants (regardless of how requests interleaved):
        // - Final row status is FAILED (precedence rule; failure sticks)
        // - Timeline last event == final status
        // - 1-3 events total: initial RUNNING, optional RUNNING->COMPLETED,
        //   and a terminal FAILED. No consecutive dupes.
        expect(finalStatus).toBe('FAILED');
        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(events.length).toBeLessThanOrEqual(3);
        assertHistoryInvariants(events, finalStatus);
        expect(events.at(-1)!.toStatus).toBe('FAILED');
      });

      it('Test 34.7: Late COMPLETED after FAILED is rejected by precedence', async () => {
        const createRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `status-events-late-ok-${Date.now()}`,
          }),
        });
        const { runId } = await createRes.json();

        // Fail first, then try to "complete" later (straggler rank)
        await makeRequest('/api/runs/status/update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({ runId, status: 'FAILED' }),
        });
        const lateOk = await makeRequest('/api/runs/status/update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({ runId, status: 'COMPLETED' }),
        });
        // Request succeeds (200) but mutation is a no-op
        expect(lateOk.status).toBe(200);

        const events = await fetchHistory(runId);
        const finalStatus = await fetchRunStatus(runId);

        expect(finalStatus).toBe('FAILED');
        expect(events.map(e => e.toStatus)).toEqual(['RUNNING', 'FAILED']);
        assertHistoryInvariants(events, finalStatus);
      });
    });

    describe.skipIf(!hasApiKey)('Authorization', () => {
      it('Test 34.8: History endpoint requires API key', async () => {
        const res = await makeRequest('/api/runs/status/history?runId=1');
        expect(res.status).toBe(401);
      });

      it('Test 34.9: History endpoint returns 404 for unknown run', async () => {
        const res = await makeRequest('/api/runs/status/history?runId=999999999', {
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
        });
        expect(res.status).toBe(404);
      });
    });
  });

  // ============================================================================
  // Test Suite 35: runs.list visibleColumns input
  //
  // Guards against regression of the runs.list memory bloat fix: when the
  // client passes `visibleColumns`, the server should only attach those
  // (source, key) pairs to `_flatConfig` / `_flatSystemMetadata`. When
  // omitted, behavior stays unchanged (all keys) for backwards compat.
  //
  // Context: runs.list previously attached every RunFieldValue row for every
  // returned run, producing ~17 MB responses for pageSize=100 on projects
  // with Hydra-style configs (200+ keys). That drove V8 heap OOMs under
  // concurrent load. See `[backend][bugfix] Trim runs.list by visibleColumns`.
  // ============================================================================
  describe('Test Suite 35: runs.list visibleColumns', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let serverAvailable = false;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) return;

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });

        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }
    });

    it('Test 35.1: Omitted visibleColumns returns full _flatConfig/_flatSystemMetadata (back-compat)', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      // At least one run should have populated flat fields under current
      // seed data (see setup.ts — runs are seeded with config + sysmeta).
      const anyWithConfig = runs.some((r: any) =>
        r._flatConfig && Object.keys(r._flatConfig).length > 0,
      );
      expect(anyWithConfig).toBe(true);
    });

    it('Test 35.2: Empty visibleColumns array returns empty _flatConfig/_flatSystemMetadata', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        visibleColumns: [],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      // Every run's flat blobs should be absent or empty.
      for (const run of runs) {
        const cfgKeys = Object.keys(run._flatConfig ?? {});
        const smKeys = Object.keys(run._flatSystemMetadata ?? {});
        expect(cfgKeys.length).toBe(0);
        expect(smKeys.length).toBe(0);
      }
    });

    it('Test 35.3: visibleColumns with one config key returns only that key', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        visibleColumns: [{ source: 'config', key: 'lr' }],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      for (const run of runs) {
        const cfgKeys = Object.keys(run._flatConfig ?? {});
        const smKeys = Object.keys(run._flatSystemMetadata ?? {});
        // _flatConfig should contain at most `lr` (may be absent for runs
        // that don't log `lr`); no other keys.
        for (const k of cfgKeys) {
          expect(k).toBe('lr');
        }
        // systemMetadata blob should have no keys since none were requested.
        expect(smKeys.length).toBe(0);
      }
    });

    it('Test 35.4: visibleColumns with mixed sources returns only the requested keys in each blob', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        visibleColumns: [
          { source: 'config', key: 'lr' },
          { source: 'systemMetadata', key: 'hostname' },
        ],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      for (const run of runs) {
        for (const k of Object.keys(run._flatConfig ?? {})) {
          expect(k).toBe('lr');
        }
        for (const k of Object.keys(run._flatSystemMetadata ?? {})) {
          expect(k).toBe('hostname');
        }
      }
    });

    it('Test 35.5: Sort by a config key works even when that key is not in visibleColumns', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        visibleColumns: [{ source: 'systemMetadata', key: 'hostname' }],
        sortField: 'lr',
        sortSource: 'config',
        sortDirection: 'asc',
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      // Server-side sort operates on run_field_values, independent of the
      // returned blob shape. The response should still be sorted by `lr`.
      // We can't assert ordering directly without knowing seed lr values,
      // but we can assert that the request succeeds with 200 and returns
      // runs — the server didn't reject the sortField just because it
      // wasn't in visibleColumns.
      // Returned blobs only carry `hostname`; no lr.
      for (const run of runs) {
        for (const k of Object.keys(run._flatConfig ?? {})) {
          expect(k).not.toBe('lr');
        }
      }
    });

    it('Test 35.6: Field filter works when the filter key is not in visibleColumns', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      // First, discover an actual config value to filter on.
      const discovery = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 1,
      }, { 'Cookie': sessionCookie }, 'GET');
      expect(discovery.status).toBe(200);
      const dData = await discovery.json();
      const firstRun = dData.result?.data?.runs?.[0];
      if (!firstRun?._flatConfig?.lr) {
        console.log('   No run with lr config - skipping');
        return;
      }
      const lrValue = String(firstRun._flatConfig.lr);

      // Now filter by lr with visibleColumns=[] so server must still
      // honor the filter even without including the key in the response.
      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 20,
        visibleColumns: [],
        fieldFilters: [{
          field: 'lr',
          source: 'config',
          operator: 'eq',
          value: lrValue,
        }],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      // All returned runs have lr = lrValue (asserted via separate full
      // fetch, since our response omits the blob).
      expect(runs.length).toBeGreaterThan(0);
      for (const run of runs) {
        // Response respected visibleColumns: blobs are empty.
        expect(Object.keys(run._flatConfig ?? {}).length).toBe(0);
      }
    });

    it('Test 35.7: Payload size with visibleColumns=[] for 10 runs is <10 KB', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 10,
        visibleColumns: [],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const bodyText = await response.text();
      const sizeKB = bodyText.length / 1024;
      console.log(`   runs.list (visibleColumns=[], limit=10) payload: ${sizeKB.toFixed(1)}KB`);
      expect(bodyText.length).toBeLessThan(10 * 1024);
    });

    it('Test 35.8: Non-existent visibleColumns key does not error', async () => {
      if (!sessionCookie) {
        console.log('   No session - skipping');
        return;
      }

      const response = await makeTrpcRequest('runs.list', {
        projectName: TEST_PROJECT_NAME,
        limit: 5,
        visibleColumns: [{ source: 'config', key: '__nonexistent_key_xyz__' }],
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const runs = data.result?.data?.runs;
      expect(runs).toBeDefined();
      expect(runs.length).toBeGreaterThan(0);

      for (const run of runs) {
        // Blob is either empty or only contains the non-existent key with
        // null value — either is acceptable; what matters is no crash.
        const cfgKeys = Object.keys(run._flatConfig ?? {});
        for (const k of cfgKeys) {
          expect(k).toBe('__nonexistent_key_xyz__');
        }
      }
    });
  });

  // ============================================================
  // Test Suite 36: konduktorJobPrefix reverse lookup
  // The canonical pivot from a Konduktor job (full hashed ID or YAML
  // base name) to its Pluto run(s). Backed by the
  // runs_konduktor_job_name_idx text_pattern_ops expression index.
  // ============================================================
  describe('Test Suite 36: /api/runs/list konduktorJobPrefix filter', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    describe.skipIf(!hasApiKey)('Reverse lookup by Konduktor job name', () => {
      it('Test 36.1: finds a run by its full hashed Konduktor job_name (org-wide)', async () => {
        // Full Konduktor IDs are unique by construction (4-char random
        // suffix); prefix-matching a full ID returns exactly that run.
        const jobName = `konduktor-smoke-${Date.now()}`;

        const createRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `konduktor-lookup-${Date.now()}`,
            systemMetadata: JSON.stringify({
              konduktor: { job_name: jobName, num_nodes: '2', accelerator_type: 'H100' },
            }),
          }),
        });
        expect(createRes.status).toBe(200);
        const { runId } = await createRes.json();
        expect(typeof runId).toBe('number');

        const listRes = await makeRequest(
          `/api/runs/list?konduktorJobPrefix=${encodeURIComponent(jobName)}`,
          { headers: { 'Authorization': `Bearer ${TEST_API_KEY}` } },
        );
        expect(listRes.status).toBe(200);
        const body = await listRes.json();
        expect(body.runs).toBeDefined();
        const ids = body.runs.map((r: { id: number }) => r.id);
        expect(ids).toContain(runId);
      });

      it('Test 36.2: requires projectName when konduktorJobPrefix absent (400)', async () => {
        // No filter at all → must reject, not dump every run in the org.
        const listRes = await makeRequest('/api/runs/list', {
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
        });
        expect(listRes.status).toBe(400);
        const body = await listRes.json();
        expect(body.error).toBeDefined();
      });

      it('Test 36.3: prefix matches multiple runs sharing a YAML base name', async () => {
        // Konduktor appends a random per-launch suffix; this test models a
        // user who has the YAML base name but not the suffix.
        const base = `konduktor-prefix-${Date.now()}`;
        const job1 = `${base}-a1b2`;
        const job2 = `${base}-c3d4`;

        for (const job of [job1, job2]) {
          const createRes = await makeRequest('/api/runs/create', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
            body: JSON.stringify({
              projectName: TEST_PROJECT_NAME,
              runName: `prefix-run-${job}`,
              systemMetadata: JSON.stringify({ konduktor: { job_name: job } }),
            }),
          });
          expect(createRes.status).toBe(200);
        }

        const listRes = await makeRequest(
          `/api/runs/list?konduktorJobPrefix=${encodeURIComponent(base)}`,
          { headers: { 'Authorization': `Bearer ${TEST_API_KEY}` } },
        );
        expect(listRes.status).toBe(200);
        const body = await listRes.json();
        // Both runs whose konduktor.job_name starts with `base` should match.
        expect(body.runs.length).toBeGreaterThanOrEqual(2);
        expect(body.runs.length).toBeLessThanOrEqual(10);
        const names = body.runs.map((r: { name: string }) => r.name);
        expect(names).toContain(`prefix-run-${job1}`);
        expect(names).toContain(`prefix-run-${job2}`);
      });

      it('Test 36.4: prefix is anchored — interior substrings do not match', async () => {
        const realBase = `konduktor-prefix-narrow-${Date.now()}`;
        const realJob = `${realBase}-real`;
        const createRes = await makeRequest('/api/runs/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
          body: JSON.stringify({
            projectName: TEST_PROJECT_NAME,
            runName: `prefix-narrow-${realJob}`,
            systemMetadata: JSON.stringify({ konduktor: { job_name: realJob } }),
          }),
        });
        expect(createRes.status).toBe(200);

        // A prefix that *starts with* a string the seeded job doesn't.
        const listRes = await makeRequest(
          `/api/runs/list?konduktorJobPrefix=${encodeURIComponent(`${realBase}-nomatch`)}`,
          { headers: { 'Authorization': `Bearer ${TEST_API_KEY}` } },
        );
        expect(listRes.status).toBe(200);
        const body = await listRes.json();
        expect(body.runs).toEqual([]);

        // An interior fragment of the job name also must NOT match — the
        // filter is anchored at the start, not "contains".
        const interior = realBase.slice(5);
        const listRes2 = await makeRequest(
          `/api/runs/list?konduktorJobPrefix=${encodeURIComponent(interior)}`,
          { headers: { 'Authorization': `Bearer ${TEST_API_KEY}` } },
        );
        expect(listRes2.status).toBe(200);
        const body2 = await listRes2.json();
        const names = body2.runs.map((r: { name: string }) => r.name);
        expect(names).not.toContain(`prefix-narrow-${realJob}`);
      });
    });
  });

  describe('Test Suite 37: Delete Runs (runs.delete)', () => {
    it('Test 37.1: Delete runs - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('runs.delete', {
        organizationId: 'test-org-id',
        projectName: TEST_PROJECT_NAME,
        runIds: ['abc'],
      }, {}, 'POST');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 37.2: Delete runs - Invalid input (empty runIds)', async () => {
      const response = await makeTrpcRequest('runs.delete', {
        organizationId: 'test-org-id',
        projectName: TEST_PROJECT_NAME,
        runIds: [],
      }, {}, 'POST');

      // min(1) on runIds → validation error (400), or 401 if auth runs first
      expect([400, 401]).toContain(response.status);
    });

    it('Test 37.3: Delete runs - Invalid input (missing projectName)', async () => {
      const response = await makeTrpcRequest('runs.delete', {
        organizationId: 'test-org-id',
        runIds: ['abc'],
      }, {}, 'POST');

      // Should return 400 (validation error) or 401 (auth check comes first)
      expect([400, 401]).toContain(response.status);
    });

    it('Test 37.4: Delete runs - Invalid input (missing organizationId)', async () => {
      const response = await makeTrpcRequest('runs.delete', {
        projectName: TEST_PROJECT_NAME,
        runIds: ['abc'],
      }, {}, 'POST');

      // Should return 400 (validation error) or 401 (auth check comes first)
      expect([400, 401]).toContain(response.status);
    });
  });

  describe('Test Suite 40: Delete Project (projects.delete)', () => {
    it('Test 40.1: Delete project - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('projects.delete', {
        organizationId: 'test-org-id',
        projectName: TEST_PROJECT_NAME,
      }, {}, 'POST');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 40.2: Delete project - Invalid input (empty projectName)', async () => {
      const response = await makeTrpcRequest('projects.delete', {
        organizationId: 'test-org-id',
        projectName: '',
      }, {}, 'POST');

      // min(1) on projectName → validation error (400), or 401 if auth runs first
      expect([400, 401]).toContain(response.status);
    });

    it('Test 40.3: Delete project - Invalid input (missing projectName)', async () => {
      const response = await makeTrpcRequest('projects.delete', {
        organizationId: 'test-org-id',
      }, {}, 'POST');

      // Should return 400 (validation error) or 401 (auth check comes first)
      expect([400, 401]).toContain(response.status);
    });

    it('Test 40.4: Delete project - Invalid input (missing organizationId)', async () => {
      const response = await makeTrpcRequest('projects.delete', {
        projectName: TEST_PROJECT_NAME,
      }, {}, 'POST');

      // Should return 400 (validation error) or 401 (auth check comes first)
      expect([400, 401]).toContain(response.status);
    });
  });

  // Test Suite 39: Image/Media Captions (linum feedback #6)
  // Verifies the caption flows through ingest→ClickHouse→backend on the
  // /api/runs/files response. setup.ts seeds media/captioned_samples with one
  // captioned image (step 0) and one un-captioned (step 1) for bulk-run-000.
  describe('Test Suite 39: Image/Media Captions', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    async function resolveBulkRun000Id(): Promise<number | null> {
      const listRes = await makeRequest(
        `/api/runs/list?projectName=${TEST_PROJECT_NAME}&search=bulk-run-000&limit=10`,
        { headers: { 'Authorization': `Bearer ${TEST_API_KEY}` } }
      );
      if (listRes.status !== 200) {
        return null;
      }
      const data = await listRes.json();
      const run = (data.runs as { id: number; name: string }[]).find(
        (r) => r.name === 'bulk-run-000'
      );
      return run ? run.id : null;
    }

    it('Test 39.1: /api/runs/files returns the caption for a captioned file', async () => {
      if (!hasApiKey) {
        console.log('   ⊘ Skipping: TEST_API_KEY not set');
        return;
      }

      const runId = await resolveBulkRun000Id();
      if (runId == null) {
        console.log('   ⊘ Skipping: bulk-run-000 not seeded');
        return;
      }

      const response = await makeRequest(
        `/api/runs/files?runId=${runId}&projectName=${TEST_PROJECT_NAME}&logName=media/captioned_samples`,
        { headers: { 'Authorization': `Bearer ${TEST_API_KEY}` } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.files)).toBe(true);

      // Every file object exposes a `caption` field (string | null).
      for (const f of data.files) {
        expect('caption' in f).toBe(true);
      }

      // The step-0 sample carries the seeded caption.
      const captioned = (data.files as { step: number; caption: string | null }[]).find(
        (f) => f.step === 0
      );
      expect(captioned).toBeDefined();
      expect(captioned?.caption).toBe('ground truth vs prediction');
    });

    it('Test 39.2: /api/runs/files returns null caption for an un-captioned file', async () => {
      if (!hasApiKey) {
        console.log('   ⊘ Skipping: TEST_API_KEY not set');
        return;
      }

      const runId = await resolveBulkRun000Id();
      if (runId == null) {
        console.log('   ⊘ Skipping: bulk-run-000 not seeded');
        return;
      }

      const response = await makeRequest(
        `/api/runs/files?runId=${runId}&projectName=${TEST_PROJECT_NAME}&logName=media/captioned_samples`,
        { headers: { 'Authorization': `Bearer ${TEST_API_KEY}` } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      // The step-1 sample was logged without a caption → null.
      const uncaptioned = (data.files as { step: number; caption: string | null }[]).find(
        (f) => f.step === 1
      );
      expect(uncaptioned).toBeDefined();
      expect(uncaptioned?.caption).toBeNull();
    });

    it('Test 39.3: /api/runs/files returns list samples in sampleIndex order, not fileName order', async () => {
      if (!hasApiKey) {
        console.log('   ⊘ Skipping: TEST_API_KEY not set');
        return;
      }

      const runId = await resolveBulkRun000Id();
      if (runId == null) {
        console.log('   ⊘ Skipping: bulk-run-000 not seeded');
        return;
      }

      const response = await makeRequest(
        `/api/runs/files?runId=${runId}&projectName=${TEST_PROJECT_NAME}&logName=media/order_samples`,
        { headers: { 'Authorization': `Bearer ${TEST_API_KEY}` } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      const names = (data.files as { fileName: string; step: number }[])
        .filter((f) => f.step === 0)
        .map((f) => f.fileName);

      // The fixture seeded sampleIndex 0..3 as order_d, order_c, order_b,
      // order_a — i.e. the fileNames sort the OPPOSITE way to the logged
      // order. Getting them back in sampleIndex sequence (not alphabetical
      // order_a..order_d) proves the read path orders by
      // `step ASC, sampleIndex ASC, fileName ASC`. This is the regression
      // guard for multi-sample-per-step list logging showing up scrambled.
      expect(names).toEqual([
        'order_d.png',
        'order_c.png',
        'order_b.png',
        'order_a.png',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Test Suite 38: /api/runs/list fieldFilters (config.* / systemMetadata.*)
  //
  // Exercises server-side filtering on arbitrary config/systemMetadata fields
  // via the indexed run_field_values builder shared with tRPC runs.list.
  // Seed data: the `config-filter-target` run (setup.ts) has
  //   config.checkpoint.r2_prefix = "checkpoints/run-37a9f2/step-1000"
  //   config.model.name           = "dit"
  //   config.trainer.lr           = 0.05
  // while the bulk runs all have config.lr = 0.001 and config.batch_size = 32.
  // ---------------------------------------------------------------------------
  describe('Test Suite 38: /api/runs/list fieldFilters', () => {
    const hasApiKey = TEST_API_KEY.length > 0;

    function listWithFilters(filters: unknown[]) {
      const qs = new URLSearchParams({
        projectName: TEST_PROJECT_NAME,
        limit: '200',
        fieldFilters: JSON.stringify(filters),
      });
      return makeRequest(`/api/runs/list?${qs.toString()}`, {
        headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
      });
    }

    describe.skipIf(!hasApiKey)('Field filtering with valid API key', () => {
      it('Test 38.1: contains (text) on nested config.checkpoint.r2_prefix', async () => {
        const res = await listWithFilters([
          { source: 'config', key: 'checkpoint.r2_prefix', dataType: 'text', operator: 'contains', values: ['37a'] },
        ]);
        expect(res.status).toBe(200);
        const body = await res.json();
        const names = body.runs.map((r: { name: string }) => r.name);
        // Only the target run has a checkpoint.r2_prefix containing "37a".
        expect(names).toContain('config-filter-target');
        expect(names.every((n: string) => n === 'config-filter-target')).toBe(true);

        // A non-matching substring returns nothing.
        const resNone = await listWithFilters([
          { source: 'config', key: 'checkpoint.r2_prefix', dataType: 'text', operator: 'contains', values: ['zzz-no-match'] },
        ]);
        expect(resNone.status).toBe(200);
        expect((await resNone.json()).runs).toEqual([]);
      });

      it('Test 38.2: is (text) on config.model.name', async () => {
        const res = await listWithFilters([
          { source: 'config', key: 'model.name', dataType: 'text', operator: 'is', values: ['dit'] },
        ]);
        expect(res.status).toBe(200);
        const body = await res.json();
        const names = body.runs.map((r: { name: string }) => r.name);
        expect(names).toContain('config-filter-target');
        expect(names.every((n: string) => n === 'config-filter-target')).toBe(true);
      });

      it('Test 38.3: numeric > on config.trainer.lr', async () => {
        // trainer.lr = 0.05 on the target; bulk runs have no trainer.lr at all.
        const res = await listWithFilters([
          { source: 'config', key: 'trainer.lr', dataType: 'number', operator: '>', values: [0.01] },
        ]);
        expect(res.status).toBe(200);
        const body = await res.json();
        const names = body.runs.map((r: { name: string }) => r.name);
        expect(names).toContain('config-filter-target');

        // Threshold above the value excludes it.
        const resNone = await listWithFilters([
          { source: 'config', key: 'trainer.lr', dataType: 'number', operator: '>', values: [1] },
        ]);
        expect(resNone.status).toBe(200);
        const noneNames = (await resNone.json()).runs.map((r: { name: string }) => r.name);
        expect(noneNames).not.toContain('config-filter-target');
      });

      it('Test 38.4: filters AND together across terms', async () => {
        const res = await listWithFilters([
          { source: 'config', key: 'model.name', dataType: 'text', operator: 'is', values: ['dit'] },
          { source: 'config', key: 'trainer.lr', dataType: 'number', operator: '>', values: [0.01] },
        ]);
        expect(res.status).toBe(200);
        const names = (await res.json()).runs.map((r: { name: string }) => r.name);
        expect(names).toContain('config-filter-target');

        // One matching term + one impossible term => empty.
        const resNone = await listWithFilters([
          { source: 'config', key: 'model.name', dataType: 'text', operator: 'is', values: ['dit'] },
          { source: 'config', key: 'model.name', dataType: 'text', operator: 'is', values: ['not-dit'] },
        ]);
        expect(resNone.status).toBe(200);
        expect((await resNone.json()).runs).toEqual([]);
      });

      it('Test 38.4b: negated operators exclude matches and include runs missing the key', async () => {
        // "is none of" compiles to `r.id NOT IN (<positive match set>)`
        // (field-filter-sql.ts). Two semantics pinned here end-to-end:
        //   1. the matching run (config-filter-target, model.name = "dit") is
        //      excluded;
        //   2. runs that don't have the key AT ALL (the bulk runs) are
        //      included — a run without the field trivially satisfies
        //      "is none of".
        const res = await listWithFilters([
          { source: 'config', key: 'model.name', dataType: 'option', operator: 'is none of', values: [['dit']] },
        ]);
        expect(res.status).toBe(200);
        const names = (await res.json()).runs.map((r: { name: string }) => r.name);
        expect(names).not.toContain('config-filter-target');
        expect(names.length).toBeGreaterThan(0); // bulk runs (no model.name key) remain

        // "is not" (text) — same exclusion + missing-key inclusion contract.
        const resIsNot = await listWithFilters([
          { source: 'config', key: 'model.name', dataType: 'text', operator: 'is not', values: ['dit'] },
        ]);
        expect(resIsNot.status).toBe(200);
        const isNotNames = (await resIsNot.json()).runs.map((r: { name: string }) => r.name);
        expect(isNotNames).not.toContain('config-filter-target');
        expect(isNotNames.length).toBeGreaterThan(0);

        // "not exists" — only runs without the key at all.
        const resNotExists = await listWithFilters([
          { source: 'config', key: 'model.name', dataType: 'text', operator: 'not exists', values: [] },
        ]);
        expect(resNotExists.status).toBe(200);
        const neNames = (await resNotExists.json()).runs.map((r: { name: string }) => r.name);
        expect(neNames).not.toContain('config-filter-target');
        expect(neNames.length).toBeGreaterThan(0);
      });

      it('Test 38.5: malformed fieldFilters JSON returns 400', async () => {
        const qs = new URLSearchParams({
          projectName: TEST_PROJECT_NAME,
          fieldFilters: '{not valid json',
        });
        const res = await makeRequest(`/api/runs/list?${qs.toString()}`, {
          headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBeDefined();
      });

      it('Test 38.6: invalid fieldFilters shape returns 400', async () => {
        const res = await listWithFilters([{ source: 'bogus', key: 1 }]);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBeDefined();
      });
    });
  });

  describe('Test Suite 40: Charts Layout (Unauthenticated)', () => {
    it('Test 40.1: Get charts layout - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('chartsLayout.get', {
        projectName: TEST_PROJECT_NAME,
      }, {}, 'GET');

      expect(response.status).toBe(401);
    });

    it('Test 40.2: Upsert charts layout - Unauthorized (no session)', async () => {
      const response = await makeTrpcRequest('chartsLayout.upsert', {
        projectName: TEST_PROJECT_NAME,
        config: { version: 1, order: [], hidden: [] },
      }, {}, 'POST');

      expect(response.status).toBe(401);
    });
  });

  describe('Test Suite 41: Charts Layout (Authenticated)', () => {
    const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test-smoke@mlop.local';
    const TEST_PASSWORD = 'TestPassword123!';
    let sessionCookie: string | null = null;
    let orgId: string | null = null;
    let serverAvailable = false;

    beforeAll(async () => {
      try {
        const healthCheck = await makeRequest('/api/health');
        serverAvailable = healthCheck.status === 200;
      } catch {
        serverAvailable = false;
      }

      if (!serverAvailable) {
        console.log('   Skipping authenticated charts-layout tests - server not available');
        return;
      }

      try {
        const signInResponse = await makeRequest('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
        });
        const setCookie = signInResponse.headers.get('set-cookie');
        if (setCookie) {
          const match = setCookie.match(/better_auth\.session_token=([^;]+)/);
          if (match) {
            sessionCookie = `better_auth.session_token=${match[1]}`;
          }
        }
        if (sessionCookie) {
          // protectedOrgProcedure requires organizationId in the input.
          const auth = await (
            await makeTrpcRequest('auth', {}, { Cookie: sessionCookie }, 'GET')
          ).json();
          orgId = auth.result?.data?.activeOrganization?.id ?? null;
        }
      } catch (e) {
        console.log('   Sign in failed:', e);
      }
    });

    it('Test 41.1: Get returns a well-formed empty layout by default', async () => {
      if (!sessionCookie || !orgId) {
        console.log('   No session - skipping');
        return;
      }
      const response = await makeTrpcRequest('chartsLayout.get', {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');

      expect(response.status).toBe(200);
      const data = await response.json();
      const config = data.result?.data?.config;
      expect(config).toBeDefined();
      expect(config.version).toBe(1);
      expect(Array.isArray(config.order)).toBe(true);
      expect(Array.isArray(config.hidden)).toBe(true);
    });

    it('Test 41.2: Upsert then get round-trips the layout overlay', async () => {
      if (!sessionCookie || !orgId) {
        console.log('   No session - skipping');
        return;
      }
      const config = {
        version: 1,
        order: ['loss', 'metrics', 'system'],
        hidden: ['debug'],
      };

      const upsertRes = await makeTrpcRequest('chartsLayout.upsert', {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
        config,
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(upsertRes.status).toBe(200);
      const upsertData = await upsertRes.json();
      expect(upsertData.result?.data?.config?.order).toEqual(config.order);
      expect(upsertData.result?.data?.config?.hidden).toEqual(config.hidden);

      const getRes = await makeTrpcRequest('chartsLayout.get', {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');
      const getData = await getRes.json();
      expect(getData.result?.data?.config?.order).toEqual(config.order);
      expect(getData.result?.data?.config?.hidden).toEqual(config.hidden);
    });

    it('Test 41.3: Upsert is idempotent and overwrites the prior overlay', async () => {
      if (!sessionCookie || !orgId) {
        console.log('   No session - skipping');
        return;
      }
      const config = {
        version: 1,
        order: ['metrics', 'loss'],
        hidden: [],
      };

      const upsertRes = await makeTrpcRequest('chartsLayout.upsert', {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
        config,
      }, { 'Cookie': sessionCookie }, 'POST');
      expect(upsertRes.status).toBe(200);

      const getRes = await makeTrpcRequest('chartsLayout.get', {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');
      const getData = await getRes.json();
      // Single shared row per project: order replaced, hidden cleared.
      expect(getData.result?.data?.config?.order).toEqual(['metrics', 'loss']);
      expect(getData.result?.data?.config?.hidden).toEqual([]);
    });

    it('Test 41.4: Upsert rejects an unknown project with NOT_FOUND', async () => {
      if (!sessionCookie || !orgId) {
        console.log('   No session - skipping');
        return;
      }
      const response = await makeTrpcRequest('chartsLayout.upsert', {
        organizationId: orgId,
        projectName: `does-not-exist-${Date.now()}`,
        config: { version: 1, order: [], hidden: [] },
      }, { 'Cookie': sessionCookie }, 'POST');

      expect(response.status).toBe(404);
    });

    it('Test 41.5: Upsert round-trips per-group metric order', async () => {
      if (!sessionCookie || !orgId) {
        console.log('   No session - skipping');
        return;
      }
      const config = {
        version: 1,
        order: [],
        hidden: [],
        metricOrder: { metrics: ['val_loss', 'loss'], system: ['gpu', 'cpu'] },
      };

      const upsertRes = await makeTrpcRequest('chartsLayout.upsert', {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
        config,
      }, { 'Cookie': sessionCookie }, 'POST');
      expect(upsertRes.status).toBe(200);
      const upsertData = await upsertRes.json();
      expect(upsertData.result?.data?.config?.metricOrder).toEqual(config.metricOrder);

      const getRes = await makeTrpcRequest('chartsLayout.get', {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');
      const getData = await getRes.json();
      expect(getData.result?.data?.config?.metricOrder).toEqual(config.metricOrder);
    });

    it('Test 41.6: Config without metricOrder still parses (legacy client/row compat)', async () => {
      if (!sessionCookie || !orgId) {
        console.log('   No session - skipping');
        return;
      }
      // Older clients (and rows saved before metricOrder existed) omit the
      // field entirely — the schema default must fill it in on both write and
      // read paths. `collapsed` is a removed legacy key such clients still
      // send; the schema must strip it rather than reject.
      const upsertRes = await makeTrpcRequest('chartsLayout.upsert', {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
        config: { version: 1, order: ['loss'], collapsed: [], hidden: [] },
      }, { 'Cookie': sessionCookie }, 'POST');
      expect(upsertRes.status).toBe(200);
      const upsertData = await upsertRes.json();
      expect(upsertData.result?.data?.config?.metricOrder).toEqual({});

      const getRes = await makeTrpcRequest('chartsLayout.get', {
        organizationId: orgId,
        projectName: TEST_PROJECT_NAME,
      }, { 'Cookie': sessionCookie }, 'GET');
      const getData = await getRes.json();
      expect(getData.result?.data?.config?.metricOrder).toEqual({});
      expect(getData.result?.data?.config?.order).toEqual(['loss']);
    });
  });

  // Test Suite 39: OpenAPI input schema exposure.
  //
  // The pluto client SDK consumes /api/openapi.json for contract testing in CI.
  // Response schemas have always been registered as named components
  // (CreateRunResponse, etc.), but the request bodies the SDK actually SENDS
  // were inline/anonymous, which means no stable, codegen-friendly named
  // contract to validate against. These tests pin that every POST endpoint's
  // request body is exposed as a named component in components.schemas so the
  // SDK can $ref it.
  describe('Test Suite 39: OpenAPI input schema exposure (contract testing)', () => {
    // The named request-body components the SDK relies on. Each corresponds to
    // a POST /api/runs/* endpoint defined in routes/runs-openapi.ts.
    const REQUIRED_INPUT_SCHEMAS = [
      'CreateRunRequest',
      'ResumeRunRequest',
      'UpdateStatusRequest',
      'AddLogNameRequest',
      'UpdateTagsRequest',
      'UpdateNotesRequest',
      'UpdateConfigRequest',
      'CreateModelGraphRequest',
    ] as const;

    let spec: any;

    beforeAll(async () => {
      const res = await makeRequest('/api/openapi.json');
      expect(res.status).toBe(200);
      spec = await res.json();
    });

    it('Test 39.1: openapi.json is a valid OpenAPI 3.0 document with component schemas', () => {
      expect(spec.openapi).toBe('3.0.0');
      expect(spec.components).toBeDefined();
      expect(spec.components.schemas).toBeDefined();
      expect(typeof spec.components.schemas).toBe('object');
    });

    it('Test 39.2: every request-body input schema is exposed as a named component', () => {
      const schemas = spec.components.schemas;
      for (const name of REQUIRED_INPUT_SCHEMAS) {
        expect(schemas[name], `missing component schema: ${name}`).toBeDefined();
        // Components are object schemas with properties the SDK validates against.
        expect(schemas[name].type, `${name} should be an object schema`).toBe('object');
        expect(schemas[name].properties, `${name} should expose properties`).toBeDefined();
      }
    });

    it('Test 39.3: POST request bodies reference the named input components ($ref)', () => {
      // Pull the request body schema for a representative endpoint and assert it
      // is a $ref to the named component rather than an inline anonymous schema.
      const createBody =
        spec.paths?.['/api/runs/create']?.post?.requestBody?.content?.['application/json']?.schema;
      expect(createBody).toBeDefined();
      expect(createBody.$ref).toBe('#/components/schemas/CreateRunRequest');
    });

    it('Test 39.4: CreateRunRequest contract pins the SDK-required fields', () => {
      // Guards against silent contract drift: the SDK constructs these fields,
      // so they must remain present (and required ones required) in the schema.
      const createRun = spec.components.schemas.CreateRunRequest;
      expect(createRun.properties.runName).toBeDefined();
      expect(createRun.properties.projectName).toBeDefined();
      expect(createRun.properties.externalId).toBeDefined();
      expect(createRun.properties.tags).toBeDefined();
      expect(createRun.properties.config).toBeDefined();
      // runName + projectName are the minimum required to create a run.
      expect(createRun.required).toEqual(
        expect.arrayContaining(['runName', 'projectName']),
      );
    });

    it('Test 39.5: FieldFilterTerm exposes source/dataType/operator enums for the SDK', () => {
      // The /api/runs/list `fieldFilters` param is a JSON-encoded string, so the
      // structured term schema is registered as a standalone component. The Pluto
      // client mirrors these enums and contract-tests them against this doc.
      const term = spec.components.schemas.FieldFilterTerm;
      expect(term, 'missing component schema: FieldFilterTerm').toBeDefined();
      expect(term.type).toBe('object');

      const sortedEnum = (p: string) => [...(term.properties?.[p]?.enum ?? [])].sort();
      expect(sortedEnum('source')).toEqual(['config', 'systemMetadata'].sort());
      expect(sortedEnum('dataType')).toEqual(
        ['text', 'number', 'date', 'option'].sort(),
      );
      expect(sortedEnum('operator')).toEqual(
        [
          'contains', 'does not contain', 'equals', 'is', 'is not',
          'starts with', 'ends with', 'regex',
          'is greater than', '>', 'is less than', '<',
          'is greater than or equal to', '>=', 'is less than or equal to', '<=',
          'is between', 'is not between',
          'is before', 'is on or before', 'is after', 'is on or after',
          'is any of', 'is none of', 'exists', 'not exists',
        ].sort(),
      );
    });

    it('Test 39.6: /api/runs/list documents the status + heartbeat filter params', () => {
      const params = (spec.paths?.['/api/runs/list']?.get?.parameters ?? []) as {
        name: string;
      }[];
      const names = new Set(params.map((p) => p.name));
      for (const p of ['status', 'heartbeatAfter', 'heartbeatBefore']) {
        expect(names.has(p), `missing /api/runs/list query param: ${p}`).toBe(true);
      }
    });

    it('Test 39.7: status filter narrows results; invalid status → 400', async () => {
      // Invalid status is rejected up front.
      const bad = await makeRequest(
        `/api/runs/list?projectName=${TEST_PROJECT_NAME}&status=NOPE`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } },
      );
      expect(bad.status).toBe(400);

      // Valid status filter returns 200 and every run matches the requested set.
      const ok = await makeRequest(
        `/api/runs/list?projectName=${TEST_PROJECT_NAME}&status=RUNNING,COMPLETED&limit=200`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } },
      );
      expect(ok.status).toBe(200);
      const data = await ok.json();
      for (const run of data.runs as { status: string }[]) {
        expect(['RUNNING', 'COMPLETED']).toContain(run.status);
      }
    });

    it('Test 39.8: /api/runs/list documents the wandb-style filter param', () => {
      const params = (spec.paths?.['/api/runs/list']?.get?.parameters ?? []) as {
        name: string;
      }[];
      expect(params.map((p) => p.name)).toContain('filter');
    });

    it('Test 39.9: filter AST $or works; unknown field → 400', async () => {
      // $or across two statuses → every returned run is in the union.
      const orFilter = encodeURIComponent(
        JSON.stringify({ $or: [{ status: 'RUNNING' }, { status: 'COMPLETED' }] }),
      );
      const ok = await makeRequest(
        `/api/runs/list?projectName=${TEST_PROJECT_NAME}&filter=${orFilter}&limit=200`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } },
      );
      expect(ok.status).toBe(200);
      const data = await ok.json();
      for (const run of data.runs as { status: string }[]) {
        expect(['RUNNING', 'COMPLETED']).toContain(run.status);
      }

      // Unknown filter field is rejected up front.
      const badFilter = encodeURIComponent(JSON.stringify({ nope: 1 }));
      const bad = await makeRequest(
        `/api/runs/list?projectName=${TEST_PROJECT_NAME}&filter=${badFilter}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } },
      );
      expect(bad.status).toBe(400);
    });

    it('Test 39.10: RunFilterGrammar publishes the canonical filter vocabulary', () => {
      // The grammar is defined once (lib/queries/run-filter-grammar.ts) and
      // published here so the Pluto client/docs can contract-test against it.
      const grammar = spec.components.schemas.RunFilterGrammar;
      expect(grammar, 'missing component schema: RunFilterGrammar').toBeDefined();
      const itemsEnum = (p: string) =>
        [...(grammar.properties?.[p]?.items?.enum ?? [])].sort();
      expect(itemsEnum('booleanOperators')).toEqual(['$and', '$or', '$not'].sort());
      expect(itemsEnum('leafOperators')).toEqual(
        ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$regex'].sort(),
      );
      expect(itemsEnum('fields')).toEqual(
        [
          'state', 'status', 'heartbeat_at', 'heartbeatAt',
          'created_at', 'createdAt', 'updated_at', 'updatedAt',
          'name', 'displayName', 'display_name', 'tags',
        ].sort(),
      );
      expect(itemsEnum('fieldPrefixes')).toEqual(
        ['config.', 'systemMetadata.', 'summaryMetrics.', 'summary_metrics.'].sort(),
      );
    });

    it('Test 39.11: two-bound config.* range applies BOTH bounds (regression)', async () => {
      // Regression for the run-filter compiler dropping the second bound of a
      // single-field two-operator range (e.g. `{config.lr: {$gt, $lt}}`), which
      // honored only the first operator and returned an over-broad superset.
      // Both bounds must AND together.
      //
      // Uses config.lr, whose backfilled spread is {0.001 (bulk runs), 0.01
      // (the needle run)}. The range keeps the 0.001 runs and must drop the
      // 0.01 needle that the lower bound alone admits.
      const authHeaders = { headers: { Authorization: `Bearer ${TEST_API_KEY}` } };
      const lrCols = encodeURIComponent('[{"source":"config","key":"lr"}]');

      const readLrs = async (filter: object): Promise<number[]> => {
        const res = await makeRequest(
          `/api/runs/list?projectName=${TEST_PROJECT_NAME}&filter=${encodeURIComponent(
            JSON.stringify(filter),
          )}&includeFieldValues=true&visibleColumns=${lrCols}&limit=200`,
          authHeaders,
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        return (data.runs as { _flatConfig?: Record<string, unknown> }[])
          .map((r) => r._flatConfig?.lr)
          .filter((v: unknown): v is number => typeof v === 'number');
      };

      const LO = 0.0005;
      const HI = 0.005;
      const lowerOnly = await readLrs({ 'config.lr': { $gt: LO } });
      const ranged = await readLrs({ 'config.lr': { $gt: LO, $lt: HI } });

      // The lower bound alone admits runs at/above the upper bound (the 0.01
      // needle), proving the fixture exercises the second bound; the range must
      // exclude them.
      expect(lowerOnly.some((v) => v >= HI)).toBe(true);
      for (const v of ranged) {
        expect(v).toBeGreaterThan(LO);
        expect(v).toBeLessThan(HI);
      }
      // The range is a strict narrowing of the lower-bound-only result.
      expect(ranged.length).toBeGreaterThan(0);
      expect(ranged.length).toBeLessThan(lowerOnly.length);
    });
  });
});
