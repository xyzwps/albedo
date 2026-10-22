import { expect, test } from '@playwright/test';

// Resolved from this file, not the cwd: the suite runs from the tool directory.
const EDITOR_URL = new URL('../../svg-editor.html', import.meta.url).href;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const rect = (id, x, y, w, h, fill = '#f2c75c') => ({
  id, type: 'rect', name: id.toUpperCase(), x, y, w, h, rx: 0,
  fill, stroke: '#1b1d22', strokeWidth: 1, opacity: 1
});

const circle = (id, cx, cy, r, fill = '#7bb6a4') => ({
  id, type: 'circle', name: id.toUpperCase(), cx, cy, r,
  fill, stroke: '#1b1d22', strokeWidth: 1, opacity: 1
});

async function load(page, shapes, extra = {}) {
  await page.evaluate(({ shapes, extra }) => {
    window.__ALBEDO_TEST__.load({
      name: 'test', width: 128, height: 128, background: 'none', shapes, ...extra
    });
  }, { shapes, extra });
}

async function doc(page) {
  return page.evaluate(() => window.__ALBEDO_TEST__.doc());
}

async function selection(page) {
  return page.evaluate(() => window.__ALBEDO_TEST__.selection());
}

async function exportSvg(page) {
  return page.evaluate(() => window.__ALBEDO_TEST__.export());
}

async function point(page, x, y) {
  return page.evaluate(([x, y]) => {
    const matrix = document.querySelector('#stage').getScreenCTM();
    return {
      x: matrix.a * x + matrix.c * y + matrix.e,
      y: matrix.b * x + matrix.d * y + matrix.f
    };
  }, [x, y]);
}

async function drag(page, from, to, options = {}) {
  const { steps = 10, alt = false } = options;
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  await page.waitForTimeout(80);
}

async function selectAll(page) {
  await page.keyboard.press(MOD + '+a');
  await page.waitForTimeout(80);
}

async function leftTab(page, key) {
  await page.locator(`#leftRail [data-rail-go="${key}"]`).click();
  await page.waitForTimeout(40);
}

async function rightTab(page, key) {
  await page.locator(`#inspectorRail [data-rail-go="${key}"]`).click();
  await page.waitForTimeout(40);
}

test.beforeEach(async ({ page }) => {
  await page.goto(EDITOR_URL);
  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('[data-boolean="unite"]')).toHaveCount(0);
});

test('shift-click builds a multi-selection and drags it as a group', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 20, 20), rect('b', 50, 10, 20, 20, '#f26b4f')]);
  await page.evaluate(() => window.__ALBEDO_TEST__.setSnap(false));

  await page.mouse.click(...Object.values(await point(page, 20, 20)));
  await page.keyboard.down('Shift');
  await page.mouse.click(...Object.values(await point(page, 60, 20)));
  await page.keyboard.up('Shift');
  await page.waitForTimeout(80);

  expect(await selection(page)).toEqual(['a', 'b']);
  await expect(page.locator('.selection-box')).toHaveCount(1);
  await expect(page.locator('#nodeStatus')).toContainText('2 shapes');

  await page.keyboard.down('Shift');
  await page.mouse.click(...Object.values(await point(page, 60, 20)));
  await page.keyboard.up('Shift');
  expect(await selection(page)).toEqual(['a']);
  await page.keyboard.down('Shift');
  await page.mouse.click(...Object.values(await point(page, 60, 20)));
  await page.keyboard.up('Shift');
  expect(await selection(page)).toEqual(['a', 'b']);

  await drag(page, await point(page, 20, 20), await point(page, 30, 20));
  const shapes = (await doc(page)).shapes;
  expect(shapes.find((shape) => shape.id === 'a').x).toBeCloseTo(20, 3);
  expect(shapes.find((shape) => shape.id === 'b').x).toBeCloseTo(60, 3);
});

test('marquee selects intersecting shapes and leaves the rest alone', async ({ page }) => {
  await load(page, [
    rect('a', 20, 20, 20, 20),
    rect('b', 50, 20, 20, 20, '#f26b4f'),
    rect('c', 100, 100, 20, 20, '#7bb6a4')
  ]);

  const from = await point(page, 5, 5);
  const to = await point(page, 80, 60);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(page.locator('.marquee')).toHaveCount(1);
  await page.mouse.up();
  await page.waitForTimeout(100);

  expect(await selection(page)).toEqual(['a', 'b']);
  await expect(page.locator('.marquee')).toHaveCount(0);
  await expect(page.locator('.selection-box')).toHaveCount(1);
});

test('union, undo, delete and export stay consistent', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 30, 30), rect('b', 30, 30, 30, 30, '#f26b4f')]);
  await selectAll(page);

  await page.locator('[data-boolean="unite"]').click();
  await page.waitForTimeout(100);
  let shapes = (await doc(page)).shapes;
  expect(shapes).toHaveLength(1);
  expect(shapes[0].type).toBe('path');
  expect(shapes[0].name).toBe('Union');
  expect(shapes[0].commands.filter((cmd) => cmd.type === 'M')).toHaveLength(1);

  const svg = await exportSvg(page);
  expect(svg).toContain('viewBox="0 0 128 128"');
  expect(svg).toContain('<path');
  expect(svg).not.toContain('<rect'); // the canvas is not an exported element

  await page.keyboard.press(MOD + '+z');
  await page.waitForTimeout(100);
  expect((await doc(page)).shapes).toHaveLength(2);

  await selectAll(page);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);
  expect((await doc(page)).shapes).toHaveLength(0);

  await page.keyboard.press(MOD + '+z');
  await page.waitForTimeout(100);
  expect((await doc(page)).shapes).toHaveLength(2);
});

test('subtract keeps the lower style and produces a hole', async ({ page }) => {
  await load(page, [
    rect('a', 0, 0, 100, 100, '#d8a24a'),
    rect('b', 25, 25, 50, 50, '#f26b4f')
  ]);
  await selectAll(page);
  await page.locator('[data-boolean="subtract"]').click();
  await page.waitForTimeout(100);

  const shapes = (await doc(page)).shapes;
  expect(shapes).toHaveLength(1);
  expect(shapes[0].fill).toBe('#d8a24a');
  expect(shapes[0].commands.filter((cmd) => cmd.type === 'M')).toHaveLength(2);
  expect((await exportSvg(page)).match(/<path/g)).toHaveLength(1);
});

test('align left and align to artboard move shapes by the right amount', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 20, 20), rect('b', 60, 40, 30, 20, '#f26b4f')]);
  await selectAll(page);
  await rightTab(page, 'align');
  await page.locator('[data-align="left"]').click();
  await page.waitForTimeout(80);
  let shapes = (await doc(page)).shapes;
  expect(shapes[0].x).toBeCloseTo(10, 3);
  expect(shapes[1].x).toBeCloseTo(10, 3);

  await load(page, [rect('a', 0, 0, 10, 10)]);
  await page.mouse.click(...Object.values(await point(page, 5, 5)));
  await rightTab(page, 'align');
  await page.locator('[data-align="center"]').click();
  await page.waitForTimeout(80);
  shapes = (await doc(page)).shapes;
  expect(shapes[0].x).toBeCloseTo(59, 3);
});

test('distribute equalizes horizontal gaps', async ({ page }) => {
  await load(page, [
    rect('a', 0, 0, 10, 10),
    rect('b', 30, 0, 10, 10, '#f26b4f'),
    rect('c', 100, 0, 10, 10, '#7bb6a4')
  ]);
  await selectAll(page);
  await rightTab(page, 'align');
  await page.locator('[data-distribute="x"]').click();
  await page.waitForTimeout(80);
  const shapes = (await doc(page)).shapes;
  expect(shapes.find((shape) => shape.id === 'a').x).toBe(0);
  expect(shapes.find((shape) => shape.id === 'b').x).toBeCloseTo(50, 3);
  expect(shapes.find((shape) => shape.id === 'c').x).toBe(100);
});

test('grid snapping moves to the nearest line and Alt bypasses it', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 30, 30)]);
  await page.evaluate(() => window.__ALBEDO_TEST__.setGrid(true, 8));
  await expect(page.locator('#gridLayer rect')).toHaveCount(1);
  const from = await point(page, 25, 25);
  const to = await point(page, 30.5, 25);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.locator('.snap-guide')).not.toHaveCount(0);
  await page.mouse.up();
  await page.waitForTimeout(80);
  expect((await doc(page)).shapes[0].x).toBeCloseTo(16, 3);
  await expect(page.locator('.snap-guide')).toHaveCount(0);

  await load(page, [rect('a', 10, 10, 30, 30)]);
  await page.evaluate(() => window.__ALBEDO_TEST__.setGrid(true, 8));
  await drag(page, await point(page, 25, 25), await point(page, 30.5, 25), { alt: true });
  expect((await doc(page)).shapes[0].x).toBeCloseTo(15.5, 2);
});

test('resizing a multi-selection scales each shape around its own frame', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 20, 20), rect('b', 60, 10, 30, 20, '#f26b4f')]);
  await page.evaluate(() => window.__ALBEDO_TEST__.setSnap(false));
  await selectAll(page);

  const handle = await page.locator('.sel-handle-g[data-handle="e"]').boundingBox();
  expect(handle).not.toBeNull();
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  const delta = await point(page, 20, 0);
  const origin = await point(page, 0, 0);
  await drag(page, from, {
    x: from.x + (delta.x - origin.x),
    y: from.y
  });

  const shapes = (await doc(page)).shapes;
  expect(shapes.find((shape) => shape.id === 'a').x).toBeCloseTo(10, 3);
  expect(shapes.find((shape) => shape.id === 'a').w).toBeCloseTo(25, 3);
  expect(shapes.find((shape) => shape.id === 'b').x).toBeCloseTo(72.5, 3);
  expect(shapes.find((shape) => shape.id === 'b').w).toBeCloseTo(37.5, 3);
});

test('non-uniform group resize converts a circle to an ellipse', async ({ page }) => {
  await load(page, [circle('a', 30, 30, 10), rect('b', 60, 20, 20, 20, '#f26b4f')]);
  await page.evaluate(() => window.__ALBEDO_TEST__.setSnap(false));
  await selectAll(page);

  const handle = await page.locator('.sel-handle-g[data-handle="e"]').boundingBox();
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  const delta = await point(page, 20, 0);
  const origin = await point(page, 0, 0);
  await drag(page, from, { x: from.x + (delta.x - origin.x), y: from.y });

  const shape = (await doc(page)).shapes.find((item) => item.id === 'a');
  expect(shape.type).toBe('ellipse');
  expect(shape.rx).not.toBeCloseTo(shape.ry, 3);
  expect(shape.ry).toBeCloseTo(10, 3);
});

test('export preserves an evenodd fill rule on paths', async ({ page }) => {
  await load(page, [{
    id: 'p', type: 'path', name: 'Donut', fillRule: 'evenodd',
    fill: '#f2c75c', stroke: '#1b1d22', strokeWidth: 1, opacity: 1,
    commands: [
      { type: 'M', x: 10, y: 10 }, { type: 'L', x: 110, y: 10 },
      { type: 'L', x: 110, y: 110 }, { type: 'L', x: 10, y: 110 }, { type: 'Z' },
      { type: 'M', x: 40, y: 40 }, { type: 'L', x: 80, y: 40 },
      { type: 'L', x: 80, y: 80 }, { type: 'L', x: 40, y: 80 }, { type: 'Z' }
    ]
  }]);
  const svg = await exportSvg(page);
  expect(svg).toContain('fill-rule="evenodd"');
});

test('editing a path anchor moves it and undo restores the geometry', async ({ page }) => {
  await load(page, [{
    id: 'p', type: 'path', name: 'Path', fill: '#f2c75c', stroke: '#1b1d22', strokeWidth: 1, opacity: 1,
    commands: [
      { type: 'M', x: 10, y: 10 }, { type: 'L', x: 110, y: 10 },
      { type: 'L', x: 110, y: 110 }, { type: 'L', x: 10, y: 110 }, { type: 'Z' }
    ]
  }]);
  await page.evaluate(() => window.__ALBEDO_TEST__.setSnap(false));
  await page.mouse.click(...Object.values(await point(page, 60, 60)));
  await expect(page.locator('.node[data-node="anchor"]')).toHaveCount(4);

  const cmdId = (await doc(page)).shapes[0].commands[0].id;
  const handle = await page.locator(`.node[data-node="anchor"][data-cmd="${cmdId}"]`).boundingBox();
  expect(handle).not.toBeNull();
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  const delta = await point(page, 12, 12);
  const origin = await point(page, 0, 0);
  await drag(page, from, { x: from.x + (delta.x - origin.x), y: from.y + (delta.y - origin.y) });

  let shape = (await doc(page)).shapes[0];
  expect(shape.commands[0].x).toBeCloseTo(22, 3);
  expect(shape.commands[0].y).toBeCloseTo(22, 3);

  await page.keyboard.press(MOD + '+z');
  await page.waitForTimeout(100);
  shape = (await doc(page)).shapes[0];
  expect(shape.commands[0].x).toBeCloseTo(10, 3);
  expect(shape.commands[0].y).toBeCloseTo(10, 3);
});

test('a boolean result keeps the topmost selected slot and stays below unselected top layers', async ({ page }) => {
  await load(page, [
    rect('a', 10, 10, 30, 30),
    rect('x', 20, 20, 30, 30, '#7bb6a4'),
    rect('b', 30, 30, 30, 30, '#f26b4f'),
    rect('y', 40, 40, 30, 30, '#d8a24a')
  ]);
  await leftTab(page, 'layers');
  await page.locator('[data-layer-id="a"] .layer-name').click();
  await page.keyboard.down('Shift');
  await page.locator('[data-layer-id="b"] .layer-name').click();
  await page.keyboard.up('Shift');
  expect((await selection(page)).sort()).toEqual(['a', 'b']);

  await page.locator('[data-boolean="unite"]').click();
  await page.waitForTimeout(100);
  const shapes = (await doc(page)).shapes;
  expect(shapes).toHaveLength(3);
  expect(shapes[0].id).toBe('x');
  expect(shapes[1].type).toBe('path');
  expect(shapes[2].id).toBe('y');
});

test('subtract leaves the result in the base layer slot', async ({ page }) => {
  await load(page, [
    rect('a', 10, 10, 60, 60),
    rect('x', 95, 95, 20, 20, '#7bb6a4'),
    rect('b', 30, 30, 30, 30, '#f26b4f'),
    rect('y', 105, 105, 15, 15, '#d8a24a')
  ]);
  await leftTab(page, 'layers');
  await page.locator('[data-layer-id="a"] .layer-name').click();
  await page.keyboard.down('Shift');
  await page.locator('[data-layer-id="b"] .layer-name').click();
  await page.keyboard.up('Shift');
  await page.locator('[data-boolean="subtract"]').click();
  await page.waitForTimeout(100);
  const shapes = (await doc(page)).shapes;
  expect(shapes).toHaveLength(3);
  expect(shapes[0].type).toBe('path');
  expect(shapes[1].id).toBe('x');
  expect(shapes[2].id).toBe('y');
});

test('the assist panel drives grid visibility, size and snapping', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 20, 20)]);
  let info = await page.evaluate(() => window.__ALBEDO_TEST__.snapInfo());
  expect(info.grid.visible).toBe(false);
  expect(info.enabled).toBe(true);

  await leftTab(page, 'guides');
  await page.locator('#gridToggle').check();
  await page.locator('#gridSize').selectOption('16');
  info = await page.evaluate(() => window.__ALBEDO_TEST__.snapInfo());
  expect(info.grid).toEqual({ visible: true, size: 16 });
  await expect(page.locator('#gridLayer rect')).toHaveCount(1);
  await expect(page.locator('#stageDefs pattern')).toHaveCount(1);

  await page.locator('#snapToggle').uncheck();
  info = await page.evaluate(() => window.__ALBEDO_TEST__.snapInfo());
  expect(info.enabled).toBe(false);
});

test('the guides tab contains the reference underlay controls', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 20, 20)]);
  await leftTab(page, 'guides');
  await expect(page.locator('#underlayImportBtn')).toBeVisible();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">
    <rect width="40" height="20" fill="#d8a24a"/>
  </svg>`;
  await page.locator('#underlayFile').setInputFiles({
    name: 'trace.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg)
  });

  await expect(page.locator('#underlayControls')).toBeVisible();
  await expect(page.locator('#underlayName')).toHaveText('trace.svg');
  await expect(page.locator('#underlayThumb')).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(page.locator('#leftPanelGuides')).toBeVisible();
  expect(await page.evaluate(() => window.__ALBEDO_TEST__.tabs().left)).toBe('guides');
});

test('side rails are tabs and only one section is shown at a time', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await load(page, [
    rect('a', 10, 10, 20, 20),
    rect('b', 50, 10, 20, 20, '#f26b4f')
  ]);

  await expect(page.locator('#leftRail .rail-btn')).toHaveCount(3);
  await expect(page.locator('#leftRail [data-rail-go="insert"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#leftRail [data-rail-go="layers"]')).toHaveAttribute('title', 'Layers');
  await expect(page.locator('#leftRail [data-rail-go="reference"]')).toHaveCount(0);
  await expect(page.locator('#leftPanelReference')).toHaveCount(0);
  await expect(page.locator('#leftPanelInsert')).toBeVisible();
  await expect(page.locator('#leftPanelLayers')).toBeHidden();

  await leftTab(page, 'layers');
  await expect(page.locator('#leftRail [data-rail-go="layers"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#leftPanelLayers')).toBeVisible();
  await expect(page.locator('#leftPanelInsert')).toBeHidden();
  await expect(page.locator('#leftPanelGuides')).toBeHidden();
  expect(await page.evaluate(() => window.__ALBEDO_TEST__.tabs().left)).toBe('layers');

  await leftTab(page, 'guides');
  await expect(page.locator('#leftPanelGuides')).toBeVisible();
  await expect(page.locator('#leftPanelLayers')).toBeHidden();
  await expect(page.locator('#underlayImportBtn')).toBeVisible();
  expect(await page.evaluate(() => window.__ALBEDO_TEST__.tabs().left)).toBe('guides');

  await leftTab(page, 'insert');
  await expect(page.locator('#leftPanelInsert')).toBeVisible();
  await expect(page.locator('#leftPanelGuides')).toBeHidden();
  await expect(page.locator('#leftPanelLayers')).toBeHidden();

  await selectAll(page);
  await expect(page.locator('#inspectorRail .rail-btn')).toHaveCount(3);
  await rightTab(page, 'align');
  await expect(page.locator('#inspectorRail [data-rail-go="align"]')).toHaveAttribute('aria-selected', 'true');
  const right = await page.evaluate(() => {
    const keys = ['operations', 'align', 'tips'];
    return Object.fromEntries(keys.map((key) => {
      const section = document.querySelector('#inspector [data-rail-section="' + key + '"]');
      return [key, !section.hidden && section.getBoundingClientRect().height > 0];
    }));
  });
  expect(right).toEqual({ operations: false, align: true, tips: false });
  expect(await page.evaluate(() => window.__ALBEDO_TEST__.tabs().right)).toBe('align');
});

test('importing an SVG adds editable vector shapes', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <g transform="translate(10 10)" opacity="0.8">
      <rect x="0" y="0" width="40" height="20" fill="#ff0000"/>
      <circle cx="70" cy="70" r="10" fill="#00ff00" stroke="#123456" stroke-width="2"/>
    </g>
  </svg>`;

  await page.locator('#importSvgFile').setInputFiles({
    name: 'mark.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg)
  });

  await expect.poll(async () => (await doc(page)).shapes.length).toBe(2);
  const shapes = (await doc(page)).shapes;
  expect(shapes.map((shape) => shape.type)).toEqual(['rect', 'circle']);
  expect(shapes.map((shape) => shape.fill).sort()).toEqual(['#00ff00', '#ff0000']);
  expect(shapes.map((shape) => shape.name)).toEqual(['mark 1', 'mark 2']);
  expect(shapes.find((shape) => shape.fill === '#123456' || shape.stroke === '#123456')).toBeTruthy();
  expect(shapes.every((shape) => shape.opacity === 0.8)).toBe(true);
  expect((await selection(page)).sort()).toEqual(shapes.map((shape) => shape.id).sort());
  await expect(page.locator('#toast')).toContainText('Imported 2 shapes');

  const bounds = await page.evaluate(() => window.__ALBEDO_TEST__.doc().shapes.map((shape) => {
    if (shape.type === 'rect') {
      return { minX: shape.x, maxX: shape.x + shape.w, minY: shape.y, maxY: shape.y + shape.h };
    }
    if (shape.type === 'circle') {
      return { minX: shape.cx - shape.r, maxX: shape.cx + shape.r, minY: shape.cy - shape.r, maxY: shape.cy + shape.r };
    }
    const xs = shape.commands.filter((cmd) => Number.isFinite(cmd.x)).map((cmd) => cmd.x);
    const ys = shape.commands.filter((cmd) => Number.isFinite(cmd.y)).map((cmd) => cmd.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }));
  for (const box of bounds) {
    expect(box.minX).toBeGreaterThanOrEqual(0);
    expect(box.minY).toBeGreaterThanOrEqual(0);
    expect(box.maxX).toBeLessThanOrEqual(128);
    expect(box.maxY).toBeLessThanOrEqual(128);
  }
});

test('importing primitives keeps rect geometry through translations and right angles', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect x="0" y="0" width="64" height="128" fill="#ff0000"/>
    <g transform="rotate(90 64 64)"><rect x="0" y="0" width="40" height="20" fill="#00aa00"/></g>
    <g transform="rotate(30 90 40)"><rect x="70" y="20" width="40" height="40" fill="#0000ff"/></g>
  </svg>`;

  await page.locator('#importSvgFile').setInputFiles({
    name: 'rects.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg)
  });

  await expect.poll(async () => (await doc(page)).shapes.length).toBe(3);
  const shapes = (await doc(page)).shapes;
  expect(shapes.map((shape) => shape.type)).toEqual(['rect', 'rect', 'path']);
  expect(shapes[0]).toMatchObject({ x: 0, y: 0, w: 64, h: 128 });
  expect(shapes[1]).toMatchObject({ x: 108, y: 0, w: 20, h: 40 });
});

test('importing rounded rects keeps the radius under uniform scale only', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <g transform="scale(2)"><rect x="0" y="0" width="32" height="64" rx="4" fill="#ff0000"/></g>
    <g transform="scale(2 1)"><rect x="40" y="20" width="24" height="40" rx="6" fill="#00aa00"/></g>
  </svg>`;

  await page.locator('#importSvgFile').setInputFiles({
    name: 'rounded.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg)
  });

  await expect.poll(async () => (await doc(page)).shapes.length).toBe(2);
  const shapes = (await doc(page)).shapes;
  expect(shapes[0]).toMatchObject({ type: 'rect', x: 0, y: 0, w: 64, h: 128, rx: 8 });
  expect(shapes[1].type).toBe('path');
});

test('importing circles and ellipses keeps round shapes round', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <circle cx="64" cy="64" r="64" fill="#ff0000"/>
    <g transform="rotate(45 64 64)"><circle cx="64" cy="64" r="20" fill="#00aa00"/></g>
    <g transform="rotate(90 64 64)"><ellipse cx="40" cy="64" rx="20" ry="10" fill="#0000ff"/></g>
    <g transform="rotate(30 100 30)"><ellipse cx="100" cy="30" rx="14" ry="6" fill="#aa00aa"/></g>
  </svg>`;

  await page.locator('#importSvgFile').setInputFiles({
    name: 'rounds.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg)
  });

  await expect.poll(async () => (await doc(page)).shapes.length).toBe(4);
  const shapes = (await doc(page)).shapes;
  expect(shapes.map((shape) => shape.type)).toEqual(['circle', 'circle', 'ellipse', 'path']);
  expect(shapes[0]).toMatchObject({ cx: 64, cy: 64, r: 64 });
  expect(shapes[2]).toMatchObject({ cx: 64, cy: 40, rx: 10, ry: 20 });
});

test('importing a path keeps its A arc commands', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <path d="M 0 64 A 64 64 0 1 0 128 64 A 64 64 0 1 0 0 64 Z" fill="#ff0000"/>
  </svg>`;

  await page.locator('#importSvgFile').setInputFiles({
    name: 'arc.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg)
  });

  await expect.poll(async () => (await doc(page)).shapes.length).toBe(1);
  const commands = (await doc(page)).shapes[0].commands;
  expect(commands.map((command) => command.type)).toEqual(['M', 'A', 'A', 'Z']);
  expect(commands[1]).toMatchObject({ rx: 64, ry: 64, rotation: 0, x: 128, y: 64 });
  expect(commands[2]).toMatchObject({ rx: 64, ry: 64, rotation: 0, x: 0, y: 64 });
  expect(await exportSvg(page)).toContain('A 64 64 0');
});

test('importing arcs through an affine transform keeps ellipse geometry', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <g transform="scale(2 1)">
      <path d="M 0 64 A 64 64 0 1 0 128 64 A 64 64 0 1 0 0 64 Z" fill="#00ff00"/>
    </g>
  </svg>`;

  await page.locator('#importSvgFile').setInputFiles({
    name: 'ellipse.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg)
  });

  await expect.poll(async () => (await doc(page)).shapes.length).toBe(1);
  const commands = (await doc(page)).shapes[0].commands;
  expect(commands.map((command) => command.type)).toEqual(['M', 'A', 'A', 'Z']);
  expect(commands[1]).toMatchObject({ rx: 128, ry: 64, rotation: 0, x: 256, y: 64 });
});

test('importing arcs from a translated viewBox keeps their geometry', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="10 20 128 128">
    <path d="M 10 84 A 64 64 0 0 1 138 84" fill="none" stroke="#0000ff" stroke-width="2"/>
  </svg>`;

  await page.locator('#importSvgFile').setInputFiles({
    name: 'viewbox.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg)
  });

  await expect.poll(async () => (await doc(page)).shapes.length).toBe(1);
  const commands = (await doc(page)).shapes[0].commands;
  expect(commands.map((command) => command.type)).toEqual(['M', 'A']);
  expect(commands[0]).toMatchObject({ x: 0, y: 64 });
  expect(commands[1]).toMatchObject({ rx: 64, ry: 64, x: 128, y: 64 });
});

test('export keeps imported element types and untouched markup', async ({ page }) => {
  await load(page, []);
  const source = [
    '<rect id="one" x="10" y="10" width="20" height="20" fill="#ff0000"/>',
    '<rect id="two" x="50" y="10" width="20" height="20" fill="#00ff00"/>',
    '<rect id="three" x="90" y="10" width="20" height="20" fill="#0000ff"/>',
    '<path id="arc" d="M 10 100 A 20 20 0 0 1 50 100 L 50 120" fill="none" stroke="#111111" stroke-width="2"/>'
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    ${source.join('\n    ')}
  </svg>`;

  await page.evaluate((text) => window.__ALBEDO_TEST__.importSvg(text, 'structure.svg'), svg);
  await expect.poll(async () => (await doc(page)).shapes.length).toBe(4);

  const shapes = (await doc(page)).shapes;
  expect(shapes.map((shape) => shape.type)).toEqual(['rect', 'rect', 'rect', 'path']);
  expect(shapes[0]).toMatchObject({ x: 10, y: 10, w: 20, h: 20 });
  expect(shapes[1]).toMatchObject({ x: 50, y: 10, w: 20, h: 20 });
  expect(shapes[2]).toMatchObject({ x: 90, y: 10, w: 20, h: 20 });
  expect(shapes[3].commands.map((command) => command.type)).toEqual(['M', 'A', 'L']);

  const untouched = await exportSvg(page);
  source.forEach((markup) => expect(untouched).toContain(markup));
  expect((untouched.match(/<rect\b/g) || []).length).toBe(3);
  expect((untouched.match(/<path\b/g) || []).length).toBe(1);
  expect(untouched).toContain('A 20 20 0 0 1');

  await page.mouse.click(...Object.values(await point(page, 120, 120)));
  await page.waitForTimeout(450);
  await page.mouse.click(...Object.values(await point(page, 20, 20)));
  await page.waitForTimeout(250);
  expect(await selection(page)).toEqual([shapes[0].id]);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);

  const edited = await exportSvg(page);
  expect((edited.match(/<rect\b/g) || []).length).toBe(3);
  expect((edited.match(/<path\b/g) || []).length).toBe(1);
  expect(edited).toContain(source[1]);
  expect(edited).toContain(source[2]);
  expect(edited).toContain(source[3]);
  expect(edited).toContain('A 20 20 0 0 1');

  const moved = await page.evaluate((text) => {
    const document = new DOMParser().parseFromString(text, 'image/svg+xml');
    const rect = document.querySelector('rect');
    return {
      x: Number(rect.getAttribute('x')),
      y: Number(rect.getAttribute('y')),
      width: Number(rect.getAttribute('width')),
      height: Number(rect.getAttribute('height'))
    };
  }, edited);
  expect(moved).toEqual({ x: 11, y: 10, width: 20, height: 20 });
});

test('source structural fidelity survives a reload', async ({ page }) => {
  await load(page, []);
  const source = [
    '<rect id="one" x="10" y="10" width="20" height="20" fill="#ff0000"/>',
    '<rect id="two" x="50" y="10" width="20" height="20" fill="#00ff00"/>',
    '<rect id="three" x="90" y="10" width="20" height="20" fill="#0000ff"/>',
    '<path id="arc" d="M 10 100 A 20 20 0 0 1 50 100 L 50 120" fill="none" stroke="#111111" stroke-width="2"/>'
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    ${source.join('\n    ')}
  </svg>`;
  await page.evaluate((text) => window.__ALBEDO_TEST__.importSvg(text, 'persist.svg'), svg);
  await expect.poll(async () => (await doc(page)).shapes.length).toBe(4);
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('albedo-svg-studio:source:v1')))).toBe(true);

  await page.reload();
  await expect(page.locator('#stage')).toBeVisible();
  await expect.poll(async () => (await doc(page)).shapes.length).toBe(4);

  const restored = await exportSvg(page);
  source.forEach((markup) => expect(restored).toContain(markup));
  expect((restored.match(/<rect\b/g) || []).length).toBe(3);
  expect((restored.match(/<path\b/g) || []).length).toBe(1);
  expect(restored).toContain('A 20 20 0 0 1');
});

test('undoing an import restores the previous source template', async ({ page }) => {
  await load(page, []);
  const first = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect x="10" y="10" width="20" height="20" fill="#ff0000"/>
    <rect x="50" y="10" width="20" height="20" fill="#00ff00"/>
    <rect x="90" y="10" width="20" height="20" fill="#0000ff"/>
  </svg>`;
  const second = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <circle cx="64" cy="64" r="20" fill="#00ffff"/>
  </svg>`;
  await page.evaluate((text) => window.__ALBEDO_TEST__.importSvg(text, 'first.svg'), first);
  await page.evaluate((text) => window.__ALBEDO_TEST__.importSvg(text, 'second.svg'), second);
  expect((await doc(page)).shapes).toHaveLength(4);

  await page.locator('#undoBtn').click();
  await page.waitForTimeout(150);
  expect((await doc(page)).shapes).toHaveLength(3);
  const undone = await exportSvg(page);
  expect((undone.match(/<rect\b/g) || []).length).toBe(3);
  expect(undone).not.toContain('<circle');

  await page.locator('#redoBtn').click();
  await page.waitForTimeout(150);
  expect((await doc(page)).shapes).toHaveLength(4);
  const redone = await exportSvg(page);
  expect((redone.match(/<rect\b/g) || []).length).toBe(3);
  expect(redone).toContain('<circle cx="64" cy="64" r="20"');
});

test('reordering imported layers keeps source markup in the new order', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect id="a" x="10" y="10" width="20" height="20" fill="#ff0000"/>
    <rect id="b" x="50" y="10" width="20" height="20" fill="#00ff00"/>
  </svg>`;
  await page.evaluate((text) => window.__ALBEDO_TEST__.importSvg(text, 'order.svg'), svg);
  const ids = (await doc(page)).shapes.map((shape) => shape.id);
  expect(ids).toHaveLength(2);
  await page.evaluate((id) => {
    const row = document.querySelector(`[data-layer-id="${id}"]`);
    row?.querySelector('[data-layer-action="up"]')?.click();
  }, ids[0]);
  await page.waitForTimeout(150);
  expect((await doc(page)).shapes.map((shape) => shape.name)).toEqual(['order 2', 'order 1']);

  const edited = await exportSvg(page);
  expect(edited.indexOf('id="b"')).toBeLessThan(edited.indexOf('id="a"'));
  expect(edited).toContain('<rect id="b" x="50" y="10" width="20" height="20" fill="#00ff00"/>');
  expect(edited).toContain('<rect id="a" x="10" y="10" width="20" height="20" fill="#ff0000"/>');
});

test('deleting an imported shape removes its source element', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect id="one" x="10" y="10" width="20" height="20" fill="#ff0000"/>
    <rect id="two" x="50" y="10" width="20" height="20" fill="#00ff00"/>
    <rect id="three" x="90" y="10" width="20" height="20" fill="#0000ff"/>
    <path id="arc" d="M 10 100 A 20 20 0 0 1 50 100 L 50 120" fill="none" stroke="#111111" stroke-width="2"/>
  </svg>`;
  await page.evaluate((text) => window.__ALBEDO_TEST__.importSvg(text, 'delete.svg'), svg);
  await expect.poll(async () => (await doc(page)).shapes.length).toBe(4);
  await page.mouse.click(...Object.values(await point(page, 120, 120)));
  await page.waitForTimeout(450);
  await page.mouse.click(...Object.values(await point(page, 20, 20)));
  await page.waitForTimeout(200);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  expect((await doc(page)).shapes).toHaveLength(3);

  const edited = await exportSvg(page);
  expect((edited.match(/<rect\b/g) || []).length).toBe(2);
  expect((edited.match(/<path\b/g) || []).length).toBe(1);
  expect(edited).not.toContain('id="one"');
  expect(edited).toContain('id="two"');
  expect(edited).toContain('A 20 20 0 0 1');
});

test('editing an imported arc keeps its A commands', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <path id="arc" d="M 10 100 A 20 20 0 0 1 50 100 L 50 120" fill="none" stroke="#111111" stroke-width="2"/>
  </svg>`;
  await page.evaluate((text) => window.__ALBEDO_TEST__.importSvg(text, 'arc-edit.svg'), svg);
  await expect.poll(async () => (await doc(page)).shapes.length).toBe(1);
  const shape = (await doc(page)).shapes[0];
  expect(shape.commands.map((command) => command.type)).toEqual(['M', 'A', 'L']);

  await page.mouse.click(...Object.values(await point(page, 30, 80)));
  await page.waitForTimeout(200);
  expect(await selection(page)).toEqual([shape.id]);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);

  const edited = await exportSvg(page);
  expect((edited.match(/<path\b/g) || []).length).toBe(1);
  expect(edited).not.toContain('C ');
  expect(edited).toContain('A 20 20 0 0 1 51 100');
  expect(edited).toContain('L 51 120');
});

test('moving an imported gradient shape keeps its paint server', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff0000"/>
        <stop offset="1" stop-color="#0000ff"/>
      </linearGradient>
    </defs>
    <rect id="grad" x="10" y="10" width="40" height="40" fill="url(#g)"/>
  </svg>`;
  await page.evaluate((text) => window.__ALBEDO_TEST__.importSvg(text, 'gradient.svg'), svg);
  await expect.poll(async () => (await doc(page)).shapes.length).toBe(1);

  await page.mouse.click(...Object.values(await point(page, 120, 120)));
  await page.waitForTimeout(450);
  await page.mouse.click(...Object.values(await point(page, 20, 20)));
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);

  const edited = await exportSvg(page);
  expect(edited).toContain('<linearGradient id="g"');
  expect(edited).toContain('fill="url(#g)"');
  expect(edited).toContain('id="grad"');
  expect(edited).not.toContain('fill="#ff0000"');
  expect(edited).toContain('x="11"');
});

test('root opacity is applied once when an imported shape is edited', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" opacity="0.5">
    <rect x="10" y="10" width="40" height="40" fill="#ff0000"/>
  </svg>`;
  await page.evaluate((text) => window.__ALBEDO_TEST__.importSvg(text, 'opacity.svg'), svg);
  await expect.poll(async () => (await doc(page)).shapes.length).toBe(1);

  await page.mouse.click(...Object.values(await point(page, 20, 20)));
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);

  const edited = await exportSvg(page);
  expect((edited.match(/opacity="0\.5"/g) || []).length).toBe(1);
  expect(edited).toContain('x="11"');
});

test('importing a compound arc path keeps every subpath', async ({ page }) => {
  await load(page, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <path fill-rule="evenodd" fill="#123456" d="M 0 64 A 64 64 0 1 0 128 64 A 64 64 0 1 0 0 64 Z M 32 64 A 32 32 0 1 0 96 64 A 32 32 0 1 0 32 64 Z"/>
  </svg>`;

  await page.locator('#importSvgFile').setInputFiles({
    name: 'compound.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg)
  });

  await expect.poll(async () => (await doc(page)).shapes.length).toBe(1);
  const shape = (await doc(page)).shapes[0];
  expect(shape.fillRule).toBe('evenodd');
  expect(shape.commands.map((command) => command.type)).toEqual(['M', 'A', 'A', 'Z', 'M', 'A', 'A', 'Z']);
  expect(shape.commands[1]).toMatchObject({ rx: 64, ry: 64 });
  expect(shape.commands[5]).toMatchObject({ rx: 32, ry: 32 });
});

test('importing into the untouched starter canvas replaces its sample shapes', async ({ page }) => {
  const before = await doc(page);
  expect(before.shapes).toHaveLength(3);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect x="16" y="16" width="96" height="96" fill="#3366ff"/>
  </svg>`;
  await page.locator('#importSvgFile').setInputFiles({
    name: 'starter.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg)
  });

  await expect.poll(async () => (await doc(page)).shapes.length).toBe(1);
  const after = await doc(page);
  expect(after.shapes[0].fill).toBe('#3366ff');
  expect(after.name).toBe('starter');
  await expect(page.locator('#docTitle')).toHaveValue('starter');
  await expect(page.locator('#undoBtn')).toBeEnabled();
});

test('exporting and re-importing repeatedly does not add shapes to the file', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 40, 30), circle('b', 80, 70, 20)], { background: '#1b1d22' });
  const first = await exportSvg(page);
  expect(first).not.toContain('<rect width="128" height="128"');

  const cycle = async (svg) => {
    await load(page, [], { background: '#1b1d22' });
    await page.evaluate((text) => window.__ALBEDO_TEST__.importSvg(text, 'cycle.svg'), svg);
    await expect.poll(async () => (await doc(page)).shapes.length).toBe(2);
    const shapes = (await doc(page)).shapes;
    expect(shapes.filter((shape) => shape.type === 'rect' && shape.w === 128 && shape.h === 128)).toHaveLength(0);
    return { shapes, svg: await exportSvg(page) };
  };

  const second = await cycle(first);
  expect(second.svg).not.toContain('<rect width="128" height="128"');
  const third = await cycle(second.svg);
  expect(third.svg).not.toContain('<rect width="128" height="128"');

  // Import keeps source coordinates (no auto-fit), so repeated cycles stay
  // stable instead of shrinking or growing the drawing.
  third.shapes.forEach((shape, index) => {
    const previous = second.shapes[index];
    expect(shape.type).toBe(previous.type);
    Object.entries(shape).forEach(([key, value]) => {
      if (typeof value !== 'number') return;
      expect(Math.abs(value - previous[key])).toBeLessThan(0.05);
    });
  });
});

test.describe('i18n', () => {
  test.describe('Simplified Chinese auto-detection', () => {
    test.use({ locale: 'zh-CN' });

    test('boots in Chinese from navigator.languages', async ({ page }) => {
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
      await expect(page).toHaveTitle('Albedo — SVG 编辑工作台');
      await expect(page.locator('#langSelect')).toHaveValue('auto');
      await expect(page.locator('#docTitle')).toHaveValue('未命名画布');
      await expect(page.locator('#nodeStatus')).toContainText('路径 · 3 条命令');
      await expect(page.locator('.inspector-title-block h1')).toHaveText('矢量路径');
      await expect(page.locator('.layer-name')).toContainText(['贝塞尔曲线 1', '圆角矩形 1', '椭圆 1']);
      await expect(page.locator('[data-add="ellipse"]')).toHaveAttribute('title', '添加椭圆 (O)');
      await expect(page.locator('#leftRail [data-rail-go="layers"]')).toHaveAttribute('title', '图层');
    });
  });

  test.describe('English auto-detection', () => {
    test.use({ locale: 'en-US' });

    test('boots in English from navigator.languages', async ({ page }) => {
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page).toHaveTitle('Albedo — SVG Studio');
      await expect(page.locator('#langSelect')).toHaveValue('auto');
      await expect(page.locator('#docTitle')).toHaveValue('Untitled Canvas');
      await expect(page.locator('#nodeStatus')).toContainText('Path · 3 commands');
      await expect(page.locator('.inspector-title-block h1')).toHaveText('Vector path');
      await expect(page.locator('.layer-name')).toContainText(['Bézier curve 1', 'Rounded rectangle 1', 'Ellipse 1']);
      await expect(page.locator('[data-add="ellipse"]')).toHaveAttribute('title', 'Add ellipse (O)');
      await expect(page.locator('#leftRail [data-rail-go="layers"]')).toHaveAttribute('title', 'Layers');
    });
  });

  test.describe('unsupported locale fallback', () => {
    test.use({ locale: 'fr-FR' });

    test('falls back to English', async ({ page }) => {
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('#docTitle')).toHaveValue('Untitled Canvas');
      await expect(page.locator('#nodeStatus')).toContainText('Path · 3 commands');
      await expect(page.locator('#langSelect')).toHaveValue('auto');
    });
  });

  test.describe('Traditional Chinese fallback', () => {
    test.use({ locale: 'zh-TW' });

    test('does not treat Traditional Chinese as Simplified Chinese', async ({ page }) => {
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('#docTitle')).toHaveValue('Untitled Canvas');
      await expect(page.locator('#nodeStatus')).toContainText('Path · 3 commands');
    });
  });

  test('explicit switching persists and auto mode can be restored', async ({ page }) => {
    await expect(page.locator('#docTitle')).toHaveValue('Untitled Canvas');
    await page.locator('#langSelect').selectOption('zh');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#docTitle')).toHaveValue('未命名画布');
    await expect(page.locator('.inspector-title-block h1')).toHaveText('矢量路径');
    await expect(page.locator('.layer-name')).toContainText(['贝塞尔曲线 1', '圆角矩形 1', '椭圆 1']);
    expect(await page.evaluate(() => localStorage.getItem('albedo-svg-studio:lang:v1'))).toBe('zh');

    await page.reload();
    await expect(page.locator('#langSelect')).toHaveValue('zh');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#docTitle')).toHaveValue('未命名画布');
    await expect(page.locator('#nodeStatus')).toContainText('未选择对象');

    await page.locator('#langSelect').selectOption('auto');
    await expect(page.locator('#langSelect')).toHaveValue('auto');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#docTitle')).toHaveValue('Untitled Canvas');
    await expect(page.locator('.layer-name')).toContainText(['Bézier curve 1', 'Rounded rectangle 1', 'Ellipse 1']);
    expect(await page.evaluate(() => localStorage.getItem('albedo-svg-studio:lang:v1'))).toBeNull();
  });

  test('switching languages re-renders dynamic UI and preserves custom names', async ({ page }) => {
    await load(page, [
      rect('a', 10, 10, 30, 30),
      { ...circle('b', 80, 80, 20), name: 'My Mark' }
    ]);
    await page.locator('#docTitle').fill('My Brand');
    await page.locator('#docTitle').blur();
    await leftTab(page, 'layers');
    await page.locator('[data-layer-id="a"] .layer-name').click();
    await page.locator('[data-layer-id="b"] .layer-name').click({ modifiers: ['Shift'] });
    await expect(page.locator('.multi-head h1')).toHaveText('2 shapes');

    await page.locator('#langSelect').selectOption('zh');
    await expect(page.locator('.multi-head h1')).toHaveText('2 个图形');
    await expect(page.locator('.inspector-title-block h1')).toHaveText('2 个图形');
    await expect(page.locator('#nodeStatus')).toContainText('2 个图形');
    await expect(page.locator('[data-boolean="unite"] b')).toHaveText('并集');
    await expect(page.locator('.layer-name')).toContainText(['My Mark', 'A']);
    await expect(page.locator('#docTitle')).toHaveValue('My Brand');

    await page.locator('#langSelect').selectOption('en');
    await expect(page.locator('.multi-head h1')).toHaveText('2 shapes');
    await expect(page.locator('[data-boolean="unite"] b')).toHaveText('Union');
    await expect(page.locator('#docTitle')).toHaveValue('My Brand');
    await expect(page.locator('.layer-name')).toContainText(['My Mark', 'A']);
  });

  test('toasts, new documents and generated names use the active language', async ({ page }) => {
    await page.locator('#langSelect').selectOption('zh');
    await page.locator('[data-add="rect"]').click();
    await expect(page.locator('#toast')).toContainText('已添加');
    await expect(page.locator('.layer-name').first()).toContainText('矩形 2');
    await expect(page.locator('.inspector-title-block h1')).toHaveText('矩形');
    await page.locator('#langSelect').selectOption('en');
    await expect(page.locator('.layer-name').first()).toContainText('Rectangle 2');
    await expect(page.locator('.inspector-title-block h1')).toHaveText('Rectangle');

    await page.locator('#newBtn').click();
    await expect(page.locator('#docTitle')).toHaveValue('Untitled Canvas');
    await expect(page.locator('#toast')).toContainText('New blank canvas');
  });

  test('canvas size modal follows the active language', async ({ page }) => {
    await page.locator('#langSelect').selectOption('zh');
    await page.locator('#canvasSizeBtn').click();
    await expect(page.locator('#canvasModalTitle')).toHaveText('画布尺寸');
    await expect(page.locator('#canvasApplyBtn')).toHaveText('应用尺寸');
    await page.locator('#canvasModal .modal-close').click();
    await page.locator('#langSelect').selectOption('en');
    await page.locator('#canvasSizeBtn').click();
    await expect(page.locator('#canvasModalTitle')).toHaveText('Canvas size');
  });
});

test('boolean result names follow the active language', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 30, 30), rect('b', 30, 30, 30, 30, '#f26b4f')]);
  await selectAll(page);
  await page.locator('[data-boolean="unite"]').click();
  await expect(page.locator('.layer-name').first()).toHaveText('Union');
  await page.locator('#langSelect').selectOption('zh');
  await expect(page.locator('.layer-name').first()).toHaveText('并集');
  await page.locator('#langSelect').selectOption('en');
  await expect(page.locator('.layer-name').first()).toHaveText('Union');
});

test('undo and redo keep generated names in the active language', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 30, 30)]);
  await page.locator('[data-add="ellipse"]').click();
  await page.locator('[data-add="rect"]').click();
  await expect(page.locator('.layer-name')).toContainText(['Rectangle 2', 'Ellipse 1']);
  await page.locator('#langSelect').selectOption('zh');
  await expect(page.locator('.layer-name')).toContainText(['矩形 2', '椭圆 1']);
  await page.keyboard.press(MOD + '+z');
  await expect(page.locator('.layer-name')).toContainText(['椭圆 1']);
  await expect(page.locator('.layer-name')).not.toContainText(['矩形 2']);
  await page.keyboard.press(MOD + '+Shift+z');
  await expect(page.locator('.layer-name')).toContainText(['矩形 2', '椭圆 1']);
});

test('zoom buttons resize the artboard and keep selection handles screen-sized', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 30, 30)]);
  const clickPoint = await point(page, 25, 25);
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await expect(page.locator('.sel-handle-g')).not.toHaveCount(0);

  const wrapWidth = () => page.evaluate(() => document.querySelector('#artboardWrap').offsetWidth);
  const handleWidth = async () => (await page.locator('.sel-handle-g').first().boundingBox()).width;
  const baseWidth = await wrapWidth();
  const baseHandle = await handleWidth();

  await page.locator('#zoomInBtn').click();
  await expect(page.locator('#zoomLabel')).toHaveText('125%');
  expect(await wrapWidth()).toBeGreaterThan(baseWidth + 20);
  expect(Math.abs(await handleWidth() - baseHandle)).toBeLessThan(1);

  await page.locator('#zoomOutBtn').click();
  await expect(page.locator('#zoomLabel')).toHaveText('100%');
  expect(await wrapWidth()).toBe(baseWidth);
});

test('zooming past fit makes the stage scrollable for panning', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 30, 30)]);
  const body = page.locator('.stage-body');
  expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await page.locator('#zoomInBtn').click();
  await page.locator('#zoomInBtn').click();
  await expect(page.locator('#zoomLabel')).toHaveText('150%');
  expect(await body.evaluate((el) => el.scrollWidth)).toBeGreaterThan(await body.evaluate((el) => el.clientWidth));
  expect(await body.evaluate((el) => el.scrollHeight)).toBeGreaterThan(await body.evaluate((el) => el.clientHeight));

  const scrolled = await body.evaluate((el) => {
    el.scrollLeft = 60;
    el.scrollTop = 40;
    return { x: el.scrollLeft, y: el.scrollTop };
  });
  expect(scrolled.x).toBeGreaterThan(0);
  expect(scrolled.y).toBeGreaterThan(0);
});

test('ctrl-wheel zoom keeps the document point under the cursor anchored', async ({ page }) => {
  await load(page, [rect('a', 10, 10, 30, 30)]);
  const docAt = (x, y) => page.evaluate(([px, py]) => {
    const p = new DOMPoint(px, py).matrixTransform(document.querySelector('#stage').getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }, [x, y]);

  const cursor = await point(page, 25, 25);
  await page.mouse.move(cursor.x, cursor.y);
  const before = await docAt(cursor.x, cursor.y);

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect(page.locator('#zoomLabel')).not.toHaveText('100%');

  const after = await docAt(cursor.x, cursor.y);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);

  await page.keyboard.press(MOD + '+0');
  await expect(page.locator('#zoomLabel')).toHaveText('100%');
});

test('keyboard zoom shortcuts step and reset the zoom', async ({ page }) => {
  await page.keyboard.press(MOD + '+-');
  await expect(page.locator('#zoomLabel')).toHaveText('90%');
  await page.keyboard.press(MOD + '+-');
  await expect(page.locator('#zoomLabel')).toHaveText('80%');
  await page.keyboard.press(MOD + '+0');
  await expect(page.locator('#zoomLabel')).toHaveText('100%');
  await page.keyboard.press(MOD + '+=');
  await expect(page.locator('#zoomLabel')).toHaveText('125%');
});

test.describe('text layers', () => {
  const text = (id, extra = {}) => ({
    id, type: 'text', name: id.toUpperCase(), x: 16, y: 24, text: 'Ab',
    fontFamily: '', fontDisplay: '', fontSize: 48,
    fill: '#1b1d22', stroke: 'none', strokeWidth: 0, opacity: 1, ...extra
  });

  test('the T shortcut adds a text layer that stays editable', async ({ page }) => {
    await load(page, []);
    await page.keyboard.press('t');
    await expect.poll(async () => (await doc(page)).shapes.length).toBe(1);
    expect((await doc(page)).shapes[0].type).toBe('text');
    const id = (await doc(page)).shapes[0].id;
    expect(await selection(page)).toEqual([id]);

    await page.fill('#inspector [data-prop="text"]', '图标 Icon');
    await expect.poll(async () => (await doc(page)).shapes[0].text).toBe('图标 Icon');
    expect((await doc(page)).shapes[0].type).toBe('text');
    expect((await doc(page)).shapes[0].id).toBe(id);
  });

  test('resizing a text layer scales its font size, not its glyphs', async ({ page }) => {
    await load(page, [text('t', { fontSize: 40 })]);
    await page.evaluate(() => window.__ALBEDO_TEST__.setSnap(false));
    await selectAll(page);

    const handle = await page.locator('.sel-handle-g[data-handle="s"]').boundingBox();
    expect(handle).not.toBeNull();
    const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    const delta = await point(page, 0, 20);
    const origin = await point(page, 0, 0);
    await drag(page, from, { x: from.x, y: from.y + (delta.y - origin.y) });

    const shape = (await doc(page)).shapes[0];
    expect(shape.type).toBe('text');
    expect(shape.text).toBe('Ab');
    expect(shape.fontSize).toBeGreaterThan(40);
  });

  test.describe('local fonts', () => {
    test.skip(process.platform !== 'darwin', 'the Font Access API fixture needs macOS system fonts');

    test('picking a local font outlines the text inside one <g>', async ({ page, context }) => {
      await context.grantPermissions(['local-fonts']);
      await load(page, [text('t')]);
      await page.keyboard.press(MOD + '+a');
      await page.locator('[data-action="choose-font"]').click();
      await expect(page.locator('#fontModal')).toBeVisible();
      await expect(page.locator('.font-item').first()).toBeVisible({ timeout: 20000 });

      await page.fill('#fontSearch', 'helvetica');
      const first = page.locator('.font-item').first();
      await expect(first).toBeVisible();
      expect((await first.getAttribute('data-font-ps')).toLowerCase()).toContain('helvetica');
      const psn = await first.getAttribute('data-font-ps');
      await first.click();

      await expect(page.locator('#fontModal')).toBeHidden();
      await expect.poll(async () => (await doc(page)).shapes[0].fontFamily).toBe(psn);
      expect((await doc(page)).shapes[0].fontDisplay).toBeTruthy();

      const svg = await exportSvg(page);
      expect(svg).toContain('<g>');
      expect(svg).toContain('<path d="M');
      expect(svg).not.toContain('<text');
      expect(svg).not.toContain('font-family');
    });

    test('recently picked fonts jump to the top of the picker', async ({ page, context }) => {
      await context.grantPermissions(['local-fonts']);
      await load(page, [text('t')]);
      await page.keyboard.press(MOD + '+a');

      const pick = async (query) => {
        await page.locator('[data-action="choose-font"]').click();
        await expect(page.locator('#fontModal')).toBeVisible();
        await page.fill('#fontSearch', query);
        const item = page.locator('.font-item').first();
        await expect(item).toBeVisible({ timeout: 20000 });
        const psn = await item.getAttribute('data-font-ps');
        await item.click();
        await expect(page.locator('#fontModal')).toBeHidden();
        return psn;
      };

      const courier = await pick('Courier');
      const helvetica = await pick('helvetica');

      await page.locator('[data-action="choose-font"]').click();
      await expect(page.locator('.font-group')).toHaveText('Recently used');
      const items = page.locator('.font-item');
      await expect(items.first()).toHaveAttribute('data-font-ps', helvetica);
      await expect(items.nth(1)).toHaveAttribute('data-font-ps', courier);
      await page.locator('#fontModal .modal-close').click();
      await expect(page.locator('#fontModal')).toBeHidden();

      // The order is a preference, not session state: it survives a reload.
      await page.reload();
      await page.locator('#stage').waitFor();
      await load(page, [text('t')]);
      await page.keyboard.press(MOD + '+a');
      await page.locator('[data-action="choose-font"]').click();
      await expect(page.locator('.font-item').first()).toHaveAttribute('data-font-ps', helvetica);
    });

    test('export refuses when the machine lacks the referenced font', async ({ page, context }) => {
      await context.grantPermissions(['local-fonts']);
      await load(page, [text('t', { fontFamily: 'AlbedoMissingFace', fontDisplay: 'Albedo Missing Face' })]);
      expect(await exportSvg(page)).toBeNull();
      await expect(page.locator('#toast')).toContainText('AlbedoMissingFace');
    });

    test('export refuses while the text layer has no font picked', async ({ page }) => {
      await load(page, [text('t')]);
      expect(await exportSvg(page)).toBeNull();
      await expect(page.locator('#toast')).toContainText(/no font/i);
    });
  });

  test('the picker explains a missing font permission instead of showing an empty list', async ({ page }) => {
    test.skip(process.platform !== 'darwin', 'the Font Access API fixture needs Chrome on macOS');
    // No grantPermissions here: Chrome answers an ungranted request with an
    // empty list, which is the failure the guidance has to name.
    await load(page, [text('t')]);
    await page.keyboard.press(MOD + '+a');
    await page.locator('[data-action="choose-font"]').click();

    await expect(page.locator('#fontDenied')).toBeVisible();
    await expect(page.locator('#fontDenied')).toContainText(/Get fonts|获取字体/);
    await expect(page.locator('#fontList')).toBeHidden();
    await expect(page.locator('.font-item')).toHaveCount(0);
    await expect(page.locator('#toast')).toContainText(/font|字体/);

    await page.locator('#fontRetryBtn').click();
    await expect(page.locator('#fontDenied')).toBeVisible();
  });
});
