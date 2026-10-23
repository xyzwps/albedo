import { expect, test } from '@playwright/test';

const EDITOR_URL = new URL('../../svg-editor.html', import.meta.url).href;

const THREE_RECTS = [
  '<rect id="one" x="10" y="10" width="20" height="20" fill="#ff0000"/>',
  '<rect id="two" x="50" y="10" width="20" height="20" fill="#00ff00"/>',
  '<rect id="three" x="90" y="10" width="20" height="20" fill="#0000ff"/>'
];

const svg = (body, attrs = 'width="128" height="128" viewBox="0 0 128 128"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

async function reset(page) {
  await page.evaluate(() => window.__ALBEDO_TEST__.load({
    name: 'test', width: 128, height: 128, background: 'none', shapes: []
  }));
}

async function importSvg(page, text, name = 'spec.svg') {
  return page.evaluate(({ text, name }) => window.__ALBEDO_TEST__.importSvg(text, name), { text, name });
}

async function doc(page) {
  return page.evaluate(() => window.__ALBEDO_TEST__.doc());
}

async function exportSvg(page) {
  return page.evaluate(() => window.__ALBEDO_TEST__.export());
}

async function waitForShapes(page, count) {
  await expect.poll(async () => (await doc(page)).shapes.length).toBe(count);
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

async function click(page, x, y) {
  const screen = await point(page, x, y);
  await page.mouse.click(screen.x, screen.y);
}

async function selectAndNudgeRight(page, x, y) {
  await click(page, x, y);
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
}

function tagCount(text, tag) {
  return (text.match(new RegExp('<' + tag + '\\b', 'g')) || []).length;
}

async function parseExport(page, text) {
  return page.evaluate((value) => {
    const parsed = new DOMParser().parseFromString(value, 'image/svg+xml');
    return {
      rects: Array.from(parsed.querySelectorAll('rect')).map((rect) => ({
        id: rect.getAttribute('id'),
        x: rect.getAttribute('x'),
        y: rect.getAttribute('y'),
        width: rect.getAttribute('width'),
        height: rect.getAttribute('height')
      }))
    };
  }, text);
}

test.beforeEach(async ({ page }) => {
  await page.goto(EDITOR_URL);
  await expect(page.locator('#stage')).toBeVisible();
});

test('[SVG-001] three imported rects stay three rects', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg(THREE_RECTS.join('')));
  await waitForShapes(page, 3);

  const out = await exportSvg(page);
  expect(tagCount(out, 'rect')).toBe(3);
  expect(tagCount(out, 'path')).toBe(0);
  expect((await parseExport(page, out)).rects.map((rect) => rect.width)).toEqual(['20', '20', '20']);
});

test('[SVG-002] imported primitive element types are not rewritten', async ({ page }) => {
  await reset(page);
  const body = [
    '<rect id="r" x="5" y="5" width="14" height="14" fill="#ff0000"/>',
    '<circle id="c" cx="35" cy="12" r="7" fill="#00ff00"/>',
    '<ellipse id="e" cx="60" cy="12" rx="10" ry="7" fill="#0000ff"/>',
    '<line id="l" x1="78" y1="5" x2="96" y2="20" stroke="#111111" stroke-width="2"/>',
    '<polygon id="g" points="102,5 122,5 112,22" fill="#ff8800"/>',
    '<polyline id="pl" points="5,40 20,55 35,40" fill="none" stroke="#222222"/>',
    '<path id="p" d="M 5 80 L 40 80" fill="none" stroke="#333333"/>'
  ].join('');
  await importSvg(page, svg(body));
  await waitForShapes(page, 7);

  const out = await exportSvg(page);
  ['rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path']
    .forEach((tag) => expect(tagCount(out, tag)).toBe(1));
  expect(tagCount(out, 'rect')).toBe(1);
});

test('[SVG-003] imported coordinates are not rescaled to the canvas', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg(THREE_RECTS.join('')));
  await waitForShapes(page, 3);

  const out = await exportSvg(page);
  const rects = (await parseExport(page, out)).rects;
  expect(rects.map((rect) => rect.x)).toEqual(['10', '50', '90']);
  expect(rects.map((rect) => rect.y)).toEqual(['10', '10', '10']);
  expect(rects.map((rect) => rect.width)).toEqual(['20', '20', '20']);
});

test('[SVG-004] untouched markup keeps ids, order, numbers, comments and defs', async ({ page }) => {
  await reset(page);
  const rect = '<rect id="one" class="warm" x="010" y="10" width="20" height="20" fill="#ff0000"/>';
  await importSvg(page, svg(
    '<!-- keep this comment --><defs><style>.warm { fill: #ff0000; }</style></defs>' + rect
  ));
  await waitForShapes(page, 1);

  const out = await exportSvg(page);
  expect(out).toContain('<!-- keep this comment -->');
  expect(out).toContain('<style>.warm { fill: #ff0000; }</style>');
  expect(out).toContain(rect);
});

test('[SVG-005] a translated viewBox does not move the imported geometry', async ({ page }) => {
  await reset(page);
  const rect = '<rect id="offset" x="10" y="20" width="20" height="20" fill="#ff0000"/>';
  await importSvg(page, svg(rect, 'width="128" height="128" viewBox="10 20 128 128"'));
  await waitForShapes(page, 1);

  const out = await exportSvg(page);
  expect(out).toContain(rect);
  expect(out).toContain('transform="matrix(1 0 0 1 -10 -20)"');
});

test('[SVG-006] exporting never adds a full-canvas background shape', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg('<rect id="only" x="10" y="10" width="20" height="20" fill="#ff0000"/>'));
  await waitForShapes(page, 1);

  const out = await exportSvg(page);
  const rects = (await parseExport(page, out)).rects;
  expect(rects).toHaveLength(1);
  expect(rects[0].width).toBe('20');
  expect(tagCount(out, 'path')).toBe(0);
});

test('[SVG-007] importing a new file uses the source canvas size', async ({ page }) => {
  const source = svg(
    '<rect id="a" x="10" y="12" width="20" height="20" fill="#ff0000"/>' +
    '<rect id="b" x="50" y="12" width="20" height="20" fill="#00ff00"/>' +
    '<rect id="c" x="90" y="12" width="20" height="20" fill="#0000ff"/>',
    'width="128" height="96" viewBox="0 0 128 96"'
  );
  await page.evaluate((text) => window.__ALBEDO_TEST__.importSvg(text, 'canvas.svg'), source);
  await waitForShapes(page, 3);

  const document = await doc(page);
  expect({ width: document.width, height: document.height }).toEqual({ width: 128, height: 96 });
  expect(document.shapes.map((shape) => shape.x)).toEqual([10, 50, 90]);
});

test('[SVG-008] appending imports only grows the canvas', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg('<rect id="a" x="10" y="10" width="20" height="20"/>',
    'width="300" height="150" viewBox="0 0 300 150"'));
  await waitForShapes(page, 1);
  expect({ width: (await doc(page)).width, height: (await doc(page)).height }).toEqual({ width: 300, height: 150 });

  await importSvg(page, svg('<rect id="b" x="10" y="10" width="20" height="20"/>',
    'width="100" height="80" viewBox="0 0 100 80"'));
  await waitForShapes(page, 2);
  expect({ width: (await doc(page)).width, height: (await doc(page)).height }).toEqual({ width: 300, height: 150 });
});

test('[SVG-009] editing one rect leaves its siblings untouched', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg(THREE_RECTS.join('')));
  await waitForShapes(page, 3);

  await click(page, 120, 120);
  await page.waitForTimeout(450);
  await selectAndNudgeRight(page, 20, 20);

  const out = await exportSvg(page);
  expect(tagCount(out, 'rect')).toBe(3);
  expect(out).toContain(THREE_RECTS[1]);
  expect(out).toContain(THREE_RECTS[2]);
  expect((await parseExport(page, out)).rects[0].x).toBe('11');
});

test('[SVG-010] a moved rect is still a rect', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg('<rect id="one" x="10" y="10" width="20" height="20" fill="#ff0000"/>'));
  await waitForShapes(page, 1);

  await selectAndNudgeRight(page, 20, 20);
  const out = await exportSvg(page);
  expect(tagCount(out, 'rect')).toBe(1);
  expect(tagCount(out, 'path')).toBe(0);
  expect((await parseExport(page, out)).rects[0].x).toBe('11');
});

test('[SVG-011] a moved arc path keeps its A commands', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg(
    '<path id="arc" d="M 10 100 A 20 20 0 0 1 50 100 L 50 120" fill="none" stroke="#111111" stroke-width="2"/>'
  ));
  await waitForShapes(page, 1);

  await selectAndNudgeRight(page, 30, 80);
  const out = await exportSvg(page);
  expect(tagCount(out, 'path')).toBe(1);
  expect(out).toContain('A 20 20 0 0 1 51 100');
  expect(out).not.toContain(' C ');
});

test('[SVG-012] moving a shape keeps its gradient and dash settings', async ({ page }) => {
  await reset(page);
  const rect = '<rect id="grad" x="10" y="10" width="40" height="40" fill="url(#g)" stroke="#111111" stroke-width="2" stroke-dasharray="4 2"/>';
  await importSvg(page, svg(
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>' +
    '</linearGradient></defs>' + rect
  ));
  await waitForShapes(page, 1);

  await selectAndNudgeRight(page, 20, 20);
  const out = await exportSvg(page);
  expect(out).toContain('<linearGradient id="g"');
  expect(out).toContain('fill="url(#g)"');
  expect(out).toContain('stroke-dasharray="4 2"');
  expect(out).toContain('id="grad"');
});

test('[SVG-013] deleting one rect removes its source element and only its own', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg(THREE_RECTS.join('')));
  await waitForShapes(page, 3);

  await click(page, 120, 120);
  await page.waitForTimeout(450);
  await click(page, 20, 20);
  await page.waitForTimeout(200);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);

  const out = await exportSvg(page);
  expect(tagCount(out, 'rect')).toBe(2);
  expect(out).not.toContain('id="one"');
  expect(out).toContain(THREE_RECTS[1]);
  expect(out).toContain(THREE_RECTS[2]);
});

test('[SVG-014] a newly drawn rect is appended as a native rect', async ({ page }) => {
  await reset(page);
  const base = '<rect id="base" x="10" y="10" width="20" height="20" fill="#ff0000"/>';
  await importSvg(page, svg(base));
  await waitForShapes(page, 1);

  await page.keyboard.press('r');
  await waitForShapes(page, 2);
  const out = await exportSvg(page);
  expect(tagCount(out, 'rect')).toBe(2);
  expect(tagCount(out, 'path')).toBe(0);
  expect(out).toContain(base);
});

test('[SVG-015] layer reordering keeps the source markup in the new order', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg(THREE_RECTS[0] + THREE_RECTS[1]));
  await waitForShapes(page, 2);
  const ids = (await doc(page)).shapes.map((shape) => shape.id);

  await page.evaluate((id) => {
    const row = document.querySelector(`[data-layer-id="${id}"]`);
    row?.querySelector('[data-layer-action="up"]')?.click();
  }, ids[0]);
  await page.waitForTimeout(150);

  const out = await exportSvg(page);
  expect(out.indexOf('id="two"')).toBeLessThan(out.indexOf('id="one"'));
  expect(out).toContain(THREE_RECTS[0]);
  expect(out).toContain(THREE_RECTS[1]);
});

test('[SVG-016] reloading keeps the untouched source structure', async ({ page }) => {
  await reset(page);
  const source = svg(
    THREE_RECTS.join('') +
    '<path id="arc" d="M 10 100 A 20 20 0 0 1 50 100 L 50 120" fill="none" stroke="#111111" stroke-width="2"/>'
  );
  await importSvg(page, source);
  await waitForShapes(page, 4);
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('albedo-svg-studio:source:v1')))).toBe(true);

  await page.reload();
  await expect(page.locator('#stage')).toBeVisible();
  await waitForShapes(page, 4);

  const out = await exportSvg(page);
  expect(tagCount(out, 'rect')).toBe(3);
  expect(tagCount(out, 'path')).toBe(1);
  expect(out).toContain('A 20 20 0 0 1');
  THREE_RECTS.forEach((markup) => expect(out).toContain(markup));
});

test('[SVG-017] undoing an import restores the previous structure', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg(THREE_RECTS[0] + THREE_RECTS[1]));
  await waitForShapes(page, 2);
  await importSvg(page, svg('<circle cx="64" cy="64" r="20" fill="#00ffff"/>'));
  await waitForShapes(page, 3);

  await page.locator('#undoBtn').click();
  await page.waitForTimeout(150);
  await waitForShapes(page, 2);

  const out = await exportSvg(page);
  expect(tagCount(out, 'rect')).toBe(2);
  expect(tagCount(out, 'circle')).toBe(0);
});

test('[SVG-018] redoing an import restores the new structure', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg(THREE_RECTS[0] + THREE_RECTS[1]));
  await waitForShapes(page, 2);
  await importSvg(page, svg('<circle cx="64" cy="64" r="20" fill="#00ffff"/>'));
  await waitForShapes(page, 3);
  await page.locator('#undoBtn').click();
  await page.waitForTimeout(150);
  await page.locator('#redoBtn').click();
  await page.waitForTimeout(150);
  await waitForShapes(page, 3);

  const out = await exportSvg(page);
  expect(tagCount(out, 'rect')).toBe(2);
  expect(tagCount(out, 'circle')).toBe(1);
  expect(out).toContain('<circle cx="64" cy="64" r="20"');
});

test('[SVG-019] root opacity is applied only once after an edit', async ({ page }) => {
  await reset(page);
  await importSvg(page, svg(
    '<rect id="dim" x="10" y="10" width="40" height="40" fill="#ff0000"/>',
    'width="128" height="128" viewBox="0 0 128 128" opacity="0.5"'
  ));
  await waitForShapes(page, 1);

  await selectAndNudgeRight(page, 20, 20);
  const out = await exportSvg(page);
  expect((out.match(/opacity="0\.5"/g) || []).length).toBe(1);
  expect((await parseExport(page, out)).rects[0].x).toBe('11');
});

test('[SVG-020] appending a file keeps its root fill inheritance', async ({ page }) => {
  await reset(page);
  const base = '<rect id="base" x="10" y="10" width="20" height="20" fill="#00ff00"/>';
  const inherited = '<rect id="inherited" x="50" y="10" width="20" height="20"/>';
  await importSvg(page, svg(base));
  await waitForShapes(page, 1);
  await importSvg(page, svg(inherited, 'width="128" height="128" viewBox="0 0 128 128" fill="#ff0000"'));
  await waitForShapes(page, 2);

  const shapes = (await doc(page)).shapes;
  expect(shapes[1].fill).toBe('#ff0000');
  const out = await exportSvg(page);
  expect(out).toContain('fill="#ff0000"');
  expect(out).toContain(base);
  expect(out).toContain(inherited);
});

test('[SVG-021] colliding ids from two imports do not cross references', async ({ page }) => {
  await reset(page);
  const gradient = (color) =>
    '<defs><linearGradient id="paint"><stop offset="0" stop-color="' + color + '"/>' +
    '<stop offset="1" stop-color="' + color + '"/></linearGradient></defs>';
  await importSvg(page, svg(
    gradient('#ff0000') + '<rect id="a" x="10" y="10" width="20" height="20" fill="url(#paint)"/>'
  ));
  await waitForShapes(page, 1);
  await importSvg(page, svg(
    gradient('#0000ff') + '<rect id="b" x="50" y="10" width="20" height="20" fill="url(#paint)"/>'
  ));
  await waitForShapes(page, 2);

  const shapes = (await doc(page)).shapes;
  expect(shapes.map((shape) => shape.fill)).toEqual(['#ff0000', '#0000ff']);
  const out = await exportSvg(page);
  expect(tagCount(out, 'linearGradient')).toBe(2);
  expect((out.match(/fill="url\(#/g) || []).length).toBe(2);
  expect(out).toMatch(/fill="url\(#paint\)"/);
  expect(out).toMatch(/fill="url\(#imp_[^)]+-paint\)"/);
});

test('[SVG-022] text and image elements survive an edit to a sibling', async ({ page }) => {
  await reset(page);
  const text = '<text id="label" x="70" y="20" font-family="Arial" font-size="12">hello</text>';
  const image = '<image id="pic" x="90" y="60" width="20" height="20" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0kAAAAASUVORK5CYII="/>';
  const rect = '<rect id="box" x="10" y="10" width="20" height="20" fill="#ff0000"/>';
  await importSvg(page, svg(text + image + rect));
  await waitForShapes(page, 1);

  await selectAndNudgeRight(page, 20, 20);
  const out = await exportSvg(page);
  expect(out).toContain(text);
  expect(out).toContain(image);
  expect((await parseExport(page, out)).rects[0].x).toBe('11');
});

test('[SVG-023] a file with no editable shapes is rejected without touching the document', async ({ page }) => {
  await reset(page);
  const ok = await importSvg(page, svg(
    '<text id="label" x="10" y="20" font-family="Arial">hello</text>' +
    '<image id="pic" x="40" y="10" width="20" height="20" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0kAAAAASUVORK5CYII="/>'
  ));
  expect(ok).toBe(false);
  expect((await doc(page)).shapes).toHaveLength(0);
  await expect(page.locator('#toast')).toContainText('no importable shapes');
});

test('[SVG-024] a root title becomes the canvas name', async ({ page }) => {
  const source = svg('<title>My Icon</title><rect id="box" x="10" y="10" width="20" height="20" fill="#ff0000"/>');
  await importSvg(page, source, 'title.svg');
  await waitForShapes(page, 1);

  expect((await doc(page)).name).toBe('My Icon');
  await expect(page.locator('#docTitle')).toHaveValue('My Icon');
  expect(await exportSvg(page)).toContain('<title>My Icon</title>');
});

test('[SVG-025] an existing canvas name survives an import', async ({ page }) => {
  await page.evaluate(() => window.__ALBEDO_TEST__.load({
    name: 'Working', width: 128, height: 128, background: 'none', shapes: []
  }));
  const source = svg('<title>Other</title><rect id="box" x="10" y="10" width="20" height="20" fill="#ff0000"/>');
  await importSvg(page, source, 'other.svg');
  await waitForShapes(page, 1);

  expect((await doc(page)).name).toBe('Working');
  await expect(page.locator('#docTitle')).toHaveValue('Working');
  expect(await exportSvg(page)).toContain('<title>Working</title>');
});

test('[SVG-026] an empty canvas adopts the imported source size', async ({ page }) => {
  await page.evaluate(() => window.__ALBEDO_TEST__.load({
    name: 'blank', width: 960, height: 640, background: 'none', shapes: []
  }));
  await importSvg(page, svg('<rect id="box" x="10" y="10" width="20" height="20" fill="#ff0000"/>'));
  await waitForShapes(page, 1);

  expect({ width: (await doc(page)).width, height: (await doc(page)).height }).toEqual({ width: 128, height: 128 });
  expect((await doc(page)).shapes[0]).toMatchObject({ x: 10, y: 10, w: 20, h: 20 });
});

test('[SVG-027] importing a small file does not shrink a canvas with content', async ({ page }) => {
  await page.evaluate(() => window.__ALBEDO_TEST__.load({
    name: 'composition', width: 960, height: 640, background: 'none', shapes: [{
      id: 'existing', type: 'rect', name: 'existing', x: 100, y: 100, w: 200, h: 200,
      rx: 0, fill: '#00ff00', stroke: '#1b1d22', strokeWidth: 1, opacity: 1
    }]
  }));
  await importSvg(page, svg('<rect id="box" x="10" y="10" width="20" height="20" fill="#ff0000"/>'));
  await waitForShapes(page, 2);

  expect({ width: (await doc(page)).width, height: (await doc(page)).height }).toEqual({ width: 960, height: 640 });
  expect((await doc(page)).shapes[0]).toMatchObject({ id: 'existing', x: 100, y: 100, w: 200, h: 200 });
});

test('[SVG-031] importing leaves every layer unselected', async ({ page }) => {
  await reset(page);
  await page.locator('#leftRail [data-rail-go="layers"]').click();
  await importSvg(page, svg(THREE_RECTS.join('')));
  await waitForShapes(page, 3);

  await expect(page.locator('#layers .layer-row')).toHaveCount(3);
  await expect(page.locator('#layers .layer-row.selected')).toHaveCount(0);
  await expect(page.locator('.selection-box')).toHaveCount(0);
});
