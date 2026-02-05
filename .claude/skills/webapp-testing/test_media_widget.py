"""
E2E test for media widget run selection.

Verifies that selecting additional runs adds their images to the media widget.
This tests the fix in groupMetrics that ensures all selected runs are included
in media-type metrics (IMAGE, AUDIO, VIDEO).

Prerequisites:
- Docker compose services running (frontend, backend, db, clickhouse, minio)
- Seed data loaded including images for 15+ runs (pnpm seed:images:docker)
"""

from playwright.sync_api import sync_playwright
import time
import sys


def test_media_widget_run_selection():
    """Test that selecting runs updates the media widget image count."""

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to project page
        page.goto('http://localhost:3000/o/dev-org/projects/my-ml-project')
        page.wait_for_load_state('networkidle')
        time.sleep(2)

        # Handle sign in if needed
        if page.locator('text=Sign in').count() > 0:
            page.fill('input[type="email"]', 'dev@example.com')
            page.fill('input[type="password"]', 'devpassword123')
            page.click('button:has-text("Sign in")')
            page.wait_for_load_state('networkidle')
            time.sleep(2)

        # Handle org selection if needed
        if page.locator('text=Welcome back').count() > 0:
            page.click('text=Development Org')
            page.wait_for_load_state('networkidle')
            time.sleep(2)
            page.goto('http://localhost:3000/o/dev-org/projects/my-ml-project')
            page.wait_for_load_state('networkidle')
            time.sleep(3)

        # Count initial images (default 5 runs selected)
        initial_images = page.locator('[class*="aspect"] img').all()
        initial_count = len(initial_images)
        print(f"Initial image count: {initial_count}")

        # Verify we have some images to start
        assert initial_count >= 3, f"Expected at least 3 initial images, got {initial_count}"

        # Select 3 additional runs
        runs_selected = 0
        rows = page.locator('table tbody tr').all()

        for row in rows[5:15]:  # Look at rows 6-15
            try:
                eye_button = row.locator('button').first
                if not eye_button.is_visible():
                    continue

                svg = eye_button.locator('svg')
                svg_class = svg.get_attribute('class') or ''

                # Check if this is a hidden run (eye-off icon)
                if 'lucide-eye-off' in svg_class:
                    name_cell = row.locator('td').nth(1)
                    name = name_cell.inner_text(timeout=1000).strip()
                    print(f"  Selecting run: {name}")

                    eye_button.click()
                    time.sleep(1)
                    runs_selected += 1

                    if runs_selected >= 3:
                        break
            except Exception as e:
                print(f"  Skipping row due to: {e}")
                continue

        print(f"Selected {runs_selected} additional runs")

        # Wait for data to load
        time.sleep(3)

        # Count images after selection
        final_images = page.locator('[class*="aspect"] img').all()
        final_count = len(final_images)
        print(f"Final image count: {final_count}")

        # Take screenshot for verification
        page.screenshot(path='/tmp/test_media_widget_result.png', full_page=False)
        print("Screenshot saved to /tmp/test_media_widget_result.png")

        browser.close()

        # Verify image count increased
        expected_increase = runs_selected
        actual_increase = final_count - initial_count

        print(f"\nResults:")
        print(f"  Initial images: {initial_count}")
        print(f"  Final images: {final_count}")
        print(f"  Runs selected: {runs_selected}")
        print(f"  Expected increase: {expected_increase}")
        print(f"  Actual increase: {actual_increase}")

        # Allow for some tolerance (some runs might not have images)
        # but we should see at least some increase
        assert final_count >= initial_count, \
            f"Image count should not decrease. Was {initial_count}, now {final_count}"

        if runs_selected > 0:
            assert final_count > initial_count, \
                f"Expected more images after selecting {runs_selected} runs. " \
                f"Was {initial_count}, now {final_count}"

        print("\n✅ Test passed: Media widget correctly shows images for selected runs")
        return True


if __name__ == "__main__":
    try:
        success = test_media_widget_run_selection()
        sys.exit(0 if success else 1)
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Test error: {e}")
        sys.exit(1)
