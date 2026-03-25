import { defineConfig, devices } from "@playwright/test";
import { stablyReporter } from "@stablyai/playwright-test";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./e2e/specs",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Use 2 parallel workers on CI (tests are sharded across Buildkite agents) */
  workers: process.env.CI ? 4 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ["html"],
    ["list"],
    ...(process.env.STABLY_API_KEY
      ? [
          stablyReporter({
            apiKey: process.env.STABLY_API_KEY,
            projectId: process.env.STABLY_PROJECT_ID,
          }),
        ]
      : []),
    ...(process.env.CI
      ? [["json", { outputFile: "test-results.json" }] as const]
      : []),
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.BASE_URL || "http://localhost:3000",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
/* Collect trace for failed tests. See https://playwright.dev/docs/trace-viewer */
trace: "retain-on-failure",

    /* Capture screenshot only when test fails */
    screenshot: "only-on-failure",

    /* Capture video only when test fails and we retry */
    video: {
      mode: "retain-on-failure",
      size: { width: 1920, height: 1080 },
    },

    /* Maximum time each action such as `click()` can take */
    actionTimeout: 10000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "setup",
      testDir: "./e2e/fixtures",
      testMatch: "auth.setup.ts", // Only match auth.setup.ts, not perf-auth.setup.ts
      use: {
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--ignore-certificate-errors',
            '--disable-dev-shm-usage',
            '--disable-http2',
            '--disable-gpu',
            '--disable-software-rasterizer',
          ],
        },
      },
    },
    {
      name: "chromium",
      timeout: 360_000, // 6 minutes — if a test takes longer, something is wrong
      testIgnore: [
        /performance\/.*\.spec\.ts/,       // Perf tests run in dedicated pipeline step
        /nan-inf-ingest-e2e\.spec\.ts/,    // Requires Rust ingest; runs in "Non-Finite Metrics Ingestion Test" step
      ],
      use: {
        ...devices["Desktop Chrome"],
        // Use prepared auth state
        storageState: "e2e/.auth/user.json",
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--ignore-certificate-errors',
            '--disable-dev-shm-usage',
            '--disable-http2',
            '--disable-gpu',
            '--disable-software-rasterizer',
          ],
        },
      },
      dependencies: ["setup"],
    },
    {
      name: "perf-setup",
      testDir: "./e2e/fixtures",
      testMatch: /perf-auth\.setup\.ts/,
      use: {
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--ignore-certificate-errors',
            '--disable-dev-shm-usage',
            '--disable-http2',
            '--disable-gpu',
            '--disable-software-rasterizer',
          ],
        },
      },
    },
    {
      name: "performance",
      testMatch: /performance\/.*\.spec\.ts/,
      timeout: 60000, // Longer timeout for performance tests
      use: {
        ...devices["Desktop Chrome"],
        // Larger viewport ensures more charts render initially (triggers IntersectionObserver)
        viewport: { width: 1920, height: 1080 },
        // Use auth state created by perf-setup
        storageState: "e2e/.auth/perf-user.json",
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--ignore-certificate-errors',
            '--disable-dev-shm-usage',
            '--disable-http2',
            '--disable-gpu',
            '--disable-software-rasterizer',
          ],
        },
      },
      dependencies: ["perf-setup"],
      // Use single worker for consistent timing
      fullyParallel: false,
    },

    // Uncomment to test on other browsers
    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     storageState: 'e2e/.auth/user.json',
    //   },
    //   dependencies: ['setup'],
    // },

    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //     storageState: 'e2e/.auth/user.json',
    //   },
    //   dependencies: ['setup'],
    // },
  ],

  /* Run your local dev server before starting the tests (only in local dev, not CI) */
  webServer: process.env.CI
    ? undefined
    : {
        command: "pnpm --filter @mlop/app dev:test",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120000,
      },
});
