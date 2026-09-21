import { test, expect, type Page } from '@playwright/test';

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
});
const position = (page: Page) =>
  page.evaluate(() => {
    const g = (window as any).__game;
    return g.state.cells.find((c: any) => c.actorId === g.playerId).position;
  });

test('touch movement, simultaneous look, cancellation and pause', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test');
  await page.getByRole('button', { name: 'Грати проти ботів' }).tap();
  await expect(page.locator('#touch-controls')).toBeVisible();
  await expect(page.locator('#countdown')).toBeHidden({ timeout: 10000 });
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  const start = await position(page);
  const stick = (await page.locator('#touch-stick').boundingBox())!;
  const up = (await page.getByRole('button', { name: 'Рух угору' }).boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const points = [
    { id: 1, x: stick.x + stick.width / 2, y: stick.y + 18 },
    { id: 2, x: 600, y: 170 },
    { id: 3, x: up.x + 29, y: up.y + 29 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  points[1].x += 65;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points });
  await expect.poll(async () => (await position(page)).y).toBeGreaterThan(start.y);
  expect(await page.evaluate(() => (window as any).__game.view.yaw)).toBeLessThan(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const stopped = await position(page);
  await page.waitForTimeout(250);
  expect(await position(page)).toEqual(stopped);
  await page.screenshot({ path: 'test-results/mobile-landscape.png' });
  await page.getByRole('button', { name: 'Ігрове меню', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Пауза', exact: true })).toBeVisible();
  await expect(page.locator('#touch-controls')).toBeHidden();
  await page.getByRole('button', { name: 'Продовжити' }).tap();
  await expect(page.locator('#touch-controls')).toBeVisible();
  const resumed = await position(page);
  await page.waitForTimeout(200);
  expect(await position(page)).toEqual(resumed);
  expect(errors).toEqual([]);
});

test('portrait menus, saved graphics and orientation pause', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?test');
  await page.getByRole('button', { name: 'Налаштування', exact: true }).tap();
  await expect(page.locator('#low')).toBeChecked();
  await page.locator('#low').uncheck();
  await page.getByRole('button', { name: 'Зберегти' }).tap();
  await page.reload();
  await page.getByRole('button', { name: 'Налаштування', exact: true }).tap();
  await expect(page.locator('#low')).not.toBeChecked();
  await page.getByRole('button', { name: 'Зберегти' }).tap();
  await page.getByRole('button', { name: 'Як грати' }).tap();
  await expect(page.locator('.control-list')).toContainText('Лівий джойстик');
  await page.getByRole('button', { name: 'Зрозуміло' }).tap();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/mobile-portrait.png' });
  await page.getByRole('button', { name: 'Грати проти ботів' }).tap();
  await expect(page.locator('#touch-controls')).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('heading', { name: 'Пауза', exact: true })).toBeVisible();
  await expect(page.locator('#touch-controls')).toBeHidden();
});
