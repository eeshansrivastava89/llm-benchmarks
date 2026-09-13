import { test, expect } from '@playwright/test';

test('Cherry Blossom Tree Verification', async ({ page }) => {
  // Navigate to the HTML file
  await page.goto('file:///Users/eeshans/dev/local-llm-visual-benchmark/index.html', {
    waitUntil: 'networkidle'
  });

  // Wait for canvas to be ready
  await page.waitForSelector('canvas', { timeout: 10000 });

  // Verify canvas exists and has size
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const [width, height] = await canvas.evaluate((el) => [el.width, el.height]);
  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);

  // Verify background gradient (pastel pink to lavender)
  const gradient = page.locator('body');
  await expect(gradient).toHaveComputedStyle({ backgroundColor: 'rgba(255, 182, 194, 1)' });

  // Take screenshot
  await page.screenshot({
    path: 'public/export/screenshots/cherry-blossom-tree.png',
    fullPage: true
  });

  // Take short video (5 seconds)
  await page.screenshot({
    path: 'public/export/videos/cherry-blossom-tree.mp4',
    fullPage: true,
    clip: {
      x: 0,
      y: 0,
      width: page.viewport().width || 1920,
      height: page.viewport().height || 1080
    },
    delayed: true,
    delay: 3000
  });

  // Verify tree is centered
  const treeData = page.locator('canvas');
  const rect = await treeData.boundingBox();
  expect(rect).not.toBeNull();
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  // Verify tree is fully within viewport
  expect(centerX < canvas.width).toBe(true, 'Tree should not leak right');
  expect(centerX + canvas.width / 2 > 0).toBe(true, 'Tree should not leak left');
  expect(centerY + canvas.height / 2 > 0).toBe(true, 'Tree should not leak bottom');
  expect(centerY - canvas.height / 2 < canvas.height).toBe(true, 'Tree should not leak top');
});
