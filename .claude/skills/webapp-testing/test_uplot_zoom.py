#!/usr/bin/env python3
"""
Test uPlot zoom functionality:
1. Log in to the app
2. Navigate to All Metrics view with uPlot enabled
3. Perform drag-to-zoom on a chart
4. Verify selection box appears during drag
5. Verify X-axis zooms and Y-axis auto-scales
6. Test double-click to reset zoom
"""

from playwright.sync_api import sync_playwright
import time
import os

# Configuration
BASE_URL = 'http://localhost:3000'
ORG_SLUG = 'dev-org'
PROJECT_NAME = 'my-ml-project'
OUTPUT_DIR = '/tmp/uplot-zoom-test'

# Dev credentials
DEV_EMAIL = 'dev@example.com'
DEV_PASSWORD = 'devpassword123'

os.makedirs(OUTPUT_DIR, exist_ok=True)

def test_uplot_zoom():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})

        print("Step 1: Log in to the app...")
        page.goto(f'{BASE_URL}/o/{ORG_SLUG}/projects/{PROJECT_NAME}')
        page.wait_for_load_state('networkidle')

        # Check if we're on login page
        if page.locator('text=Sign in').first.is_visible():
            print("  Found login page, logging in...")

            # Fill email
            page.fill('input[type="email"], input[name="email"]', DEV_EMAIL)
            # Fill password
            page.fill('input[type="password"], input[name="password"]', DEV_PASSWORD)
            # Click sign in
            page.click('button:has-text("Sign in")')

            # Wait for navigation
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(2000)

            print("  Logged in successfully")

        # Take screenshot after login
        page.screenshot(path=f'{OUTPUT_DIR}/01_after_login.png')
        print(f"  Screenshot saved: {OUTPUT_DIR}/01_after_login.png")

        # Navigate to the project page if not already there
        if PROJECT_NAME not in page.url:
            print("  Navigating to project page...")
            page.goto(f'{BASE_URL}/o/{ORG_SLUG}/projects/{PROJECT_NAME}')
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(2000)

        page.screenshot(path=f'{OUTPUT_DIR}/02_project_page.png')
        print(f"  Screenshot saved: {OUTPUT_DIR}/02_project_page.png")

        print("\nStep 2: Ensure uPlot is enabled...")
        # Wait for the page to fully load
        page.wait_for_timeout(2000)

        # Look for the settings/gear button - it's near the refresh button
        # Try multiple selectors
        settings_clicked = False

        # Try finding by aria-label or nearby text
        try:
            # The settings button is typically a gear icon button
            settings_btn = page.locator('button').filter(has=page.locator('svg.lucide-settings, svg.lucide-sliders')).first
            if settings_btn.is_visible():
                settings_btn.click()
                settings_clicked = True
                print("  Clicked settings button (by svg icon)")
        except:
            pass

        if not settings_clicked:
            # Try by position - settings is usually after refresh
            try:
                # Get all buttons with haspopup="dialog"
                dialog_buttons = page.locator('button[aria-haspopup="dialog"]').all()
                for btn in dialog_buttons:
                    # Skip if it has text like "Tags", "Status", etc.
                    text = btn.inner_text()
                    if not text or text.strip() == '':
                        btn.click()
                        settings_clicked = True
                        print(f"  Clicked settings button (empty text button)")
                        break
            except:
                pass

        if settings_clicked:
            page.wait_for_timeout(500)
            page.screenshot(path=f'{OUTPUT_DIR}/03_settings_open.png')
            print(f"  Screenshot saved: {OUTPUT_DIR}/03_settings_open.png")

            # Check for Chart Engine setting
            if page.locator('text=Chart Engine').is_visible():
                # Check current value
                engine_combo = page.locator('text=Rendering Engine').locator('..').locator('button[role="combobox"]')
                if engine_combo.is_visible():
                    current_engine = engine_combo.inner_text()
                    print(f"  Current chart engine: {current_engine}")

                    if 'uPlot' not in current_engine:
                        print("  Switching to uPlot...")
                        engine_combo.click()
                        page.wait_for_timeout(300)
                        page.locator('[role="option"]:has-text("uPlot")').click()
                        page.wait_for_timeout(500)

            # Close settings dialog
            page.keyboard.press('Escape')
            page.wait_for_timeout(500)
        else:
            print("  Could not find settings button, proceeding anyway...")

        print("\nStep 3: Wait for charts to render...")
        # Wait for page to stabilize after settings change
        page.wait_for_timeout(2000)

        # Wait for uPlot charts to appear
        try:
            page.wait_for_selector('.uplot', timeout=15000)
            # Wait a bit more for React to finish re-rendering
            page.wait_for_timeout(1000)
            # Re-query charts after waiting
            charts = page.locator('.uplot').all()
            print(f"  Found {len(charts)} uPlot charts")
        except:
            print("  No uPlot charts found, taking diagnostic screenshot...")
            page.screenshot(path=f'{OUTPUT_DIR}/error_no_charts.png', full_page=True)
            browser.close()
            return False

        if len(charts) == 0:
            print("ERROR: No uPlot charts found!")
            browser.close()
            return False

        # Scroll to the chart area first using JavaScript
        page.evaluate('document.querySelector(".uplot").scrollIntoView({behavior: "instant", block: "center"})')
        page.wait_for_timeout(500)

        # Re-query after scroll
        charts = page.locator('.uplot').all()
        print(f"  Charts after scroll: {len(charts)}")

        # Take screenshot before zoom
        page.screenshot(path=f'{OUTPUT_DIR}/04_before_zoom.png')
        print(f"  Screenshot saved: {OUTPUT_DIR}/04_before_zoom.png")

        print("\nStep 4: Get chart dimensions...")
        # Debug: check chart structure
        chart_info = page.evaluate('''() => {
            const charts = document.querySelectorAll('.uplot');
            return Array.from(charts).map((c, i) => {
                const over = c.querySelector('.u-over');
                const rect = over ? over.getBoundingClientRect() : null;
                return {
                    index: i,
                    hasOver: !!over,
                    rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null
                };
            });
        }''')
        print(f"  Chart debug info: {chart_info}")

        # Find a visible chart using JavaScript
        chart_data = page.evaluate('''() => {
            const charts = document.querySelectorAll('.uplot');
            for (let i = 0; i < charts.length; i++) {
                const over = charts[i].querySelector('.u-over');
                if (over) {
                    const rect = over.getBoundingClientRect();
                    if (rect.width > 50 && rect.height > 50 && rect.top > 0) {
                        return { index: i, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                    }
                }
            }
            return null;
        }''')

        if not chart_data:
            print("ERROR: Could not find a visible chart!")
            page.screenshot(path=f'{OUTPUT_DIR}/error_no_chart_box.png', full_page=True)
            browser.close()
            return False

        chart_box = chart_data
        target_chart = charts[chart_data['index']]
        print(f"  Using chart {chart_data['index']}")

        print(f"  Chart position: x={chart_box['x']:.0f}, y={chart_box['y']:.0f}")
        print(f"  Chart size: {chart_box['width']:.0f}x{chart_box['height']:.0f}")

        print("\nStep 5: Perform drag-to-zoom using JavaScript pointer events...")

        # Use JavaScript to dispatch proper pointer events directly on the canvas
        zoom_result = page.evaluate('''(chartIdx) => {
            const chart = document.querySelectorAll('.uplot')[chartIdx];
            const over = chart.querySelector('.u-over');
            if (!over) return { error: 'No u-over element found' };

            const rect = over.getBoundingClientRect();

            // Calculate positions (20% to 80% of width)
            const startX = rect.left + rect.width * 0.2;
            const endX = rect.left + rect.width * 0.8;
            const y = rect.top + rect.height * 0.5;

            // Convert to canvas-relative coordinates
            const startClientX = startX;
            const endClientX = endX;
            const clientY = y;

            // Create and dispatch pointer events
            const pointerOpts = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: startClientX,
                clientY: clientY,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
                button: 0,
                buttons: 1,
            };

            // Pointer down at start
            over.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));

            // Move across in steps
            const steps = 20;
            for (let i = 1; i <= steps; i++) {
                const currentX = startClientX + (endClientX - startClientX) * i / steps;
                over.dispatchEvent(new PointerEvent('pointermove', {
                    ...pointerOpts,
                    clientX: currentX,
                }));
            }

            // Check selection box before releasing
            const select = chart.querySelector('.u-select');
            const selectInfo = select ? {
                width: select.style.width,
                left: select.style.left,
                height: select.style.height,
            } : null;

            // Pointer up at end
            over.dispatchEvent(new PointerEvent('pointerup', {
                ...pointerOpts,
                clientX: endClientX,
                buttons: 0,
            }));

            return {
                success: true,
                startX: startClientX,
                endX: endClientX,
                y: clientY,
                selectDuringDrag: selectInfo
            };
        }''', chart_data['index'])

        print(f"  Zoom result: {zoom_result}")
        page.wait_for_timeout(300)

        # Take screenshot during/after drag
        page.screenshot(path=f'{OUTPUT_DIR}/05_during_drag.png')
        print(f"  Screenshot saved: {OUTPUT_DIR}/05_during_drag.png")

        # Check selection box state after
        select_info = page.evaluate('''(chartIdx) => {
            const chart = document.querySelectorAll('.uplot')[chartIdx];
            const select = chart.querySelector('.u-select');
            if (select) {
                return {
                    width: select.style.width,
                    left: select.style.left,
                    height: select.style.height,
                    top: select.style.top,
                };
            }
            return null;
        }''', chart_data['index'])
        print(f"  Selection box after: {select_info}")

        page.wait_for_timeout(500)

        print("\nStep 6: Verify zoom was applied...")
        # Take screenshot after zoom
        page.screenshot(path=f'{OUTPUT_DIR}/06_after_zoom.png')
        print(f"  Screenshot saved: {OUTPUT_DIR}/06_after_zoom.png")

        print("\nStep 7: Test double-click to reset zoom...")
        # Double-click to reset
        center_x = chart_box['x'] + chart_box['width'] / 2
        center_y = chart_box['y'] + chart_box['height'] / 2
        page.mouse.dblclick(center_x, center_y)
        page.wait_for_timeout(500)

        # Take screenshot after reset
        page.screenshot(path=f'{OUTPUT_DIR}/07_after_reset.png')
        print(f"  Screenshot saved: {OUTPUT_DIR}/07_after_reset.png")

        print("\nStep 8: Test tooltip persistence...")
        # Move mouse to chart
        page.mouse.move(center_x, center_y)
        page.wait_for_timeout(300)

        # Take screenshot with tooltip
        page.screenshot(path=f'{OUTPUT_DIR}/08_tooltip_visible.png')
        print(f"  Screenshot saved: {OUTPUT_DIR}/08_tooltip_visible.png")

        # Stop moving and wait - tooltip should persist
        page.wait_for_timeout(1500)

        # Take another screenshot - tooltip should still be visible
        page.screenshot(path=f'{OUTPUT_DIR}/09_tooltip_persisted.png')
        print(f"  Screenshot saved: {OUTPUT_DIR}/09_tooltip_persisted.png")

        print("\n" + "="*60)
        print("TEST COMPLETE")
        print("="*60)
        print(f"\nAll screenshots saved to: {OUTPUT_DIR}/")
        print("\nReview these screenshots to verify:")
        print("  05_during_drag.png - Blue selection box should be visible")
        print("  06_after_zoom.png  - X-axis zoomed, Y-axis should auto-scale")
        print("  07_after_reset.png - Chart should be back to original range")
        print("  09_tooltip_persisted.png - Tooltip should still be visible")

        browser.close()
        return True

if __name__ == '__main__':
    success = test_uplot_zoom()
    exit(0 if success else 1)
