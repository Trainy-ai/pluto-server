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

    it('Test 1.2: Database Connections', async () => {
      // This test verifies the server is running and can connect to databases
      // If health check passes, databases should be connected
      const response = await makeRequest('/api/health');
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
  });
});
