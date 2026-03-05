import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user.json' });

test.describe('Seed', () => {
  test('seed', async ({ page }) => {
    // Navigate to the dev org's project page (seeded data)
    await page.goto('/o/dev-org');
    await expect(page.locator('body')).toBeVisible();
  });
});
