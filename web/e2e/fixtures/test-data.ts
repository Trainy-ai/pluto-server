/**
 * Test data constants for E2E tests
 * These match the test data created by web/server/tests/setup.ts
 */

export const TEST_USER = {
  email: "test-smoke@mlop.local",
  name: "Smoke Test User",
  firstName: "Smoke",
  lastName: "User",
};

export const TEST_ORG = {
  name: "smoke-test-org",
  slug: "smoke-test-org",
};

export const TEST_ORG_2 = {
  name: "smoke-test-org-2",
  slug: "smoke-test-org-2",
};

export const TEST_PROJECT = {
  name: "smoke-test-project",
};

/**
 * DummyIdP configuration (actual values from dummyidp.com)
 * This is for test-only usage
 */
export const DUMMYIDP_CONFIG = {
  entryPoint:
    "https://dummyidp.com/apps/app_01kdyrtw7dcmd45xjejfhvtkdh/sso",
  entityId: "https://dummyidp.com/apps/app_01kdyrtw7dcmd45xjejfhvtkdh",
  appId: "app_01kdyrtw7dcmd45xjejfhvtkdh",
};
