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

async function makeTrpcRequest(procedure: string, input: any = {}, headers: Record<string, string> = {}) {
  const response = await fetch(`${BASE_URL}/trpc/${procedure}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(input),
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
      });

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 3.2: List Organization Members - Unauthorized', async () => {
      const response = await makeTrpcRequest('organization.listMembers');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });
  });

  describe('Test Suite 4: Projects and Runs (tRPC)', () => {
    it('Test 4.1: List Projects - Unauthorized', async () => {
      const response = await makeTrpcRequest('projects.list', {
        limit: 50,
        offset: 0,
      });

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 4.2: Project Count - Unauthorized', async () => {
      const response = await makeTrpcRequest('projects.count');

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 4.3: List Runs - Unauthorized', async () => {
      const response = await makeTrpcRequest('runs.list', {
        projectName: 'test-project',
        limit: 50,
      });

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 4.4: Get Run Details - Unauthorized', async () => {
      const response = await makeTrpcRequest('runs.get', {
        runId: 'test-run-id',
      });

      // Should fail without authentication
      expect(response.status).toBe(401);
    });

    it('Test 4.5: Latest Runs - Unauthorized', async () => {
      const response = await makeTrpcRequest('runs.latest', {
        limit: 10,
      });

      // Should fail without authentication
      expect(response.status).toBe(401);
    });
  });

  describe('Test Suite 5: MinIO/S3 Integration', () => {
    // These tests require internal function access and are better tested via integration tests
    it.skip('Test 5.1: Upload File to S3', () => {
      // Requires internal access to uploadFileToR2()
    });

    it.skip('Test 5.2: Generate Presigned URL', () => {
      // Requires internal access to getImageUrl()
    });
  });

  describe('Test Suite 6: Error Handling', () => {
    it('Test 6.1: Unauthorized Access', async () => {
      const response = await makeTrpcRequest('organization.createOrg', {
        name: 'Test Org',
        slug: 'test-org',
      });

      expect(response.status).toBe(401);
    });

    it('Test 6.3: Invalid Input Validation', async () => {
      const response = await makeTrpcRequest('runs.get', {
        runId: 'invalid',
      });

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
          'Authorization': 'invalid_key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectName: 'test-project',
          name: 'test-run',
          config: { lr: 0.001 },
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
          'Authorization': TEST_API_KEY,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.slug).toBeDefined();
      expect(typeof data.slug).toBe('string');
    });
  });

  describe.skipIf(!hasApiKey)('Run Management with Valid API Key', () => {
    it('Test 6.1: Create Run (SDK)', async () => {
      const response = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: {
          'Authorization': TEST_API_KEY,
        },
        body: JSON.stringify({
          projectName: TEST_PROJECT_NAME,
          name: `smoke-test-run-${Date.now()}`,
          config: { lr: 0.001 },
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.url).toBeDefined();
      expect(data.runId).toBeDefined();
      expect(data.url).toContain(TEST_ORG_SLUG);
      expect(data.url).toContain(TEST_PROJECT_NAME);
    });

    it('Test 6.2: Update Run Status (SDK)', async () => {
      // First create a run
      const createResponse = await makeRequest('/api/runs/create', {
        method: 'POST',
        headers: {
          'Authorization': TEST_API_KEY,
        },
        body: JSON.stringify({
          projectName: TEST_PROJECT_NAME,
          name: `smoke-test-run-status-${Date.now()}`,
          config: {},
        }),
      });

      expect(createResponse.status).toBe(200);
      const { runId } = await createResponse.json();

      // Update the run status
      const updateResponse = await makeRequest('/api/runs/status/update', {
        method: 'POST',
        headers: {
          'Authorization': TEST_API_KEY,
        },
        body: JSON.stringify({
          runId,
          status: 'COMPLETED',
        }),
      });

      expect(updateResponse.status).toBe(200);
    });
  });
});
