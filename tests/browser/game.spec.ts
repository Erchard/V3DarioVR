import { createWorld, snapshot } from '../../packages/core';
import { test, expect } from '@playwright/test';
test('menu, 3D rendering, controls and pause', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test');
  await expect(page.getByRole('heading', { name: /Твій простір/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/menu.png' });
  await page.getByRole('button', { name: 'Грати проти ботів' }).click();
  await expect(page.locator('#countdown')).toBeHidden({ timeout: 6000 });
  const start = await page.evaluate(() => {
    const g = (window as any).__game;
    return g.state.cells.find((c: any) => c.actorId === g.playerId).position;
  });
  await page.keyboard.down('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('Space');
  const end = await page.evaluate(() => {
    const g = (window as any).__game;
    return g.state.cells.find((c: any) => c.actorId === g.playerId).position;
  });
  expect(end.y).toBeGreaterThan(start.y);
  await page.screenshot({ path: 'test-results/gameplay.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Пауза', exact: true })).toBeVisible();
  const tick = await page.evaluate(() => (window as any).__game.state.tick);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__game.state.tick)).toBe(tick);
  expect(errors).toEqual([]);
});
test('result and repeat', async ({ page }) => {
  await page.goto('/?test');
  await page.getByRole('button', { name: 'Грати проти ботів' }).click();
  await page.evaluate(() => (window as any).__game.finish());
  await expect(page.getByRole('button', { name: 'Ще один матч' })).toBeVisible();
  await page.getByRole('button', { name: 'Ще один матч' }).click();
  expect(await page.evaluate(() => (window as any).__game.state.tick)).toBeLessThan(10);
  await page.evaluate(() => (window as any).__game.die());
  await expect(page.getByRole('heading', { name: 'Вас поглинули' })).toBeVisible();
});
test('settings and unsupported VR fallback', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
  await page.locator('#low').check();
  await page.getByRole('button', { name: 'Зберегти' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
  await expect(page.locator('#low')).toBeChecked();
  await page.getByRole('button', { name: 'Зберегти' }).click();
  await page.getByRole('button', { name: /Увійти у VR/ }).click();
  await expect(page.locator('#toast')).toBeVisible();
});
test('desktop and touch browser share a room and start', async ({ browser }) => {
  test.setTimeout(60000);
  const a = await browser.newContext({ viewport: { width: 800, height: 600 } }),
    b = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 844, height: 390 },
    });
  const p = await a.newPage(),
    q = await b.newPage();
  await p.goto('/');
  await p.getByRole('button', { name: 'Онлайн', exact: true }).click();
  await p.getByRole('button', { name: 'Створити кімнату' }).click();
  await expect(p.locator('#code')).toHaveText(/^[A-Z2-9]{8}$/);
  const code = await p.locator('#code').textContent();
  await q.goto('/');
  await q.getByRole('button', { name: 'Онлайн', exact: true }).click();
  await q.locator('#room').fill(code!);
  await q.getByRole('button', { name: 'Приєднатися', exact: true }).click();
  await expect(q.locator('#code')).toHaveText(code!);
  await p.getByRole('button', { name: 'Я готовий' }).click();
  await q.getByRole('button', { name: 'Я готовий' }).click();
  await expect(p.locator('#overlay')).toBeHidden({ timeout: 10000 });
  await expect(q.locator('#overlay')).toBeHidden({ timeout: 10000 });
  await expect(q.locator('#touch-controls')).toBeVisible();
  await q.getByRole('button', { name: 'Ігрове меню', exact: true }).tap();
  await expect(q.getByRole('heading', { name: 'Ігрове меню', exact: true })).toBeVisible();
  await expect(p.locator('#overlay')).toBeHidden();
  await a.close();
  await b.close();
});

test('online respawn stays disabled until the authoritative deadline', async ({ page }) => {
  const world = createWorld(42, { bots: 0, foodTarget: 0 });
  const playerId = world.humanId!;
  let transport: import('@playwright/test').WebSocketRoute;
  function sendState(phase: 'lobby' | 'playing') {
    transport.send(
      JSON.stringify({
        protocolVersion: 1,
        type: 'snapshot',
        state: snapshot(world),
        phase,
        countdown: 0,
        roster: [{ id: playerId, name: 'Test', ready: phase === 'playing', connected: true }],
        lastProcessedSeq: -1,
        foodMode: 'replace',
        removedFood: [],
      }),
    );
  }
  await page.routeWebSocket(/\/socket$/, (ws) => {
    transport = ws;
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'createRoom') {
        ws.send(
          JSON.stringify({
            protocolVersion: 1,
            type: 'welcome',
            playerId,
            roomCode: 'ABCDEFGH',
            resumeToken: 'a'.repeat(48),
            rulesVersion: 1,
          }),
        );
        sendState('lobby');
      }
      if (message.type === 'ready') sendState('playing');
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Онлайн', exact: true }).click();
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  await page.getByRole('button', { name: 'Я готовий' }).click();
  await expect(page.locator('#overlay')).toBeHidden();
  world.tick = 10;
  world.cells = [];
  world.actors[0].cellId = null;
  world.actors[0].respawnAt = 190;
  sendState('playing');
  await expect(page.locator('#respawn')).toBeDisabled();
  await expect(page.locator('#respawn')).toContainText('3 с');
  world.tick = 190;
  sendState('playing');
  await expect(page.locator('#respawn')).toBeEnabled();
});
