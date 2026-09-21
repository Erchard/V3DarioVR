import { test, expect } from '@playwright/test';

test('nearby prey and danger glow, neutral and distant cells do not', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/highlight-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0"><div id="scene"></div></body></html>',
    }),
  );
  await page.goto('/highlight-fixture');
  const result = await page.evaluate(
    async ({ renderPath, corePath }) => {
      const { ArenaRenderer } = await import(renderPath);
      const { createWorld, addActor, getCell, snapshot } = await import(corePath);
      const world = createWorld(42, { bots: 0, foodTarget: 0, protectionTicks: 0 });
      const own = getCell(world, world.humanId);
      own.mass = 80;
      own.position = { x: 0, y: 0, z: 0 };
      const ids: string[] = [];
      for (const [name, mass, x, y, z] of [
        ['ЗДОБИЧ', 20, -3, 0, -9],
        ['НЕБЕЗПЕКА', 160, 4, 0, -12],
        ['НЕЙТРАЛЬНА', 80, 0, -4, -12],
        ['ДАЛЕКО', 20, -8, 4, -34],
      ] as const) {
        const actor = addActor(world, name);
        actor.color = 0x7195c7;
        const cell = getCell(world, actor.id);
        Object.assign(cell, { mass, position: { x, y, z } });
        ids.push(cell.id);
      }
      const renderer = new ArenaRenderer(document.querySelector('#scene'));
      renderer.position(own.position);
      renderer.sync(snapshot(world), own.actorId);
      renderer.render();
      const initial = ids.map((id) => {
        const halo = renderer.halos.get(id);
        return { visible: halo.visible, color: halo.material.color.getHex() };
      });
      (window as any).fixture = { renderer, world, own, ids, snapshot };
      return initial;
    },
    { renderPath: '/apps/client/render.ts', corePath: '/packages/core/index.ts' },
  );
  expect(result).toEqual([
    { visible: true, color: 0x38ff80 },
    { visible: true, color: 0xff3547 },
    { visible: false, color: 0x38ff80 },
    { visible: false, color: 0x38ff80 },
  ]);
  await page.screenshot({ path: 'test-results/highlights.png' });
  const cleanup = await page.evaluate(() => {
    const { renderer, world, own, ids, snapshot } = (window as any).fixture;
    own.protectedUntil = 180;
    renderer.sync(snapshot(world), own.actorId);
    const protectedVisible = [...renderer.halos.values()].some((h: any) => h.visible);
    world.cells = world.cells.filter((c: any) => c.id === own.id);
    renderer.sync(snapshot(world), own.actorId);
    return { protectedVisible, halos: renderer.halos.size, removed: !renderer.cells.has(ids[0]) };
  });
  expect(cleanup).toEqual({ protectedVisible: false, halos: 0, removed: true });
  expect(errors).toEqual([]);
});
