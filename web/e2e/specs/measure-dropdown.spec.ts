import { test, expect } from "@playwright/test";

test("measure visibility dropdown open time", async ({ page }) => {
  // Navigate to project page
  await page.goto("/o/smoke-test-org/projects/smoke-test-project");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });

  // Wait for page to settle
  await page.waitForTimeout(2000);

  // Find visibility button
  const visibilityButton = page.locator('button[aria-label="Visibility options"]');
  await expect(visibilityButton).toBeVisible();

  // Run 5 iterations and get average
  const iterations = 5;
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    // Close dropdown if open
    const isOpen = await page.locator('[data-radix-popper-content-wrapper]').count() > 0;
    if (isOpen) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

    // Measure opening time using requestAnimationFrame for accuracy
    const timingResult = await page.evaluate(() => {
      return new Promise<{ timeToVisible: number }>((resolve) => {
        const button = document.querySelector('button[aria-label="Visibility options"]') as HTMLButtonElement;
        if (!button) {
          resolve({ timeToVisible: 0 });
          return;
        }

        const startTime = performance.now();
        button.click();

        // Use RAF to check when visible
        function checkFrame() {
          const elapsed = performance.now() - startTime;

          if (elapsed > 3000) {
            resolve({ timeToVisible: elapsed });
            return;
          }

          const wrapper = document.querySelector('[data-radix-popper-content-wrapper]');
          if (wrapper) {
            const rect = wrapper.getBoundingClientRect();
            const style = window.getComputedStyle(wrapper);

            if (rect.width > 0 && rect.height > 0 &&
                parseFloat(style.opacity) > 0.9 &&
                style.visibility === 'visible' &&
                style.display !== 'none') {
              resolve({ timeToVisible: elapsed });
              return;
            }
          }

          requestAnimationFrame(checkFrame);
        }

        requestAnimationFrame(checkFrame);
      });
    });

    times.push(timingResult.timeToVisible);
    console.log(`Iteration ${i + 1}: ${timingResult.timeToVisible.toFixed(0)}ms`);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  console.log(`\n=== DROPDOWN TIMING SUMMARY ===`);
  console.log(`Average: ${avg.toFixed(0)}ms`);
  console.log(`Min: ${min.toFixed(0)}ms`);
  console.log(`Max: ${max.toFixed(0)}ms`);

  // Assert average is under 200ms (was ~400ms before optimization)
  expect(avg).toBeLessThan(200);
});
