import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addText, designOf, dropPhoto, frontLayers, newProject, palette, platePreview, selectLayers, unzip } from './helpers';

test.beforeEach(async ({ page }) => {
  await newProject(page);
});

test('clips a shape into lettering, and releases it', async ({ page }) => {
  await addText(page, 'WOVEXA');
  await palette(page, 'rectangle');
  await expect.poll(async () => (await frontLayers(page)).length).toBe(2);
  // The new rectangle is selected, on top of the lettering.
  await page.keyboard.press('Control+Alt+G');
  await expect.poll(async () => (await frontLayers(page))[1].clip).toBe(true);
  await expect(page.getByText('Clipped to WOVEXA.')).toBeAttached();
  await page.keyboard.press('Control+Alt+G');
  await expect.poll(async () => (await frontLayers(page))[1].clip ?? false).toBe(false);
});

test('colours each letter from a ready-made run', async ({ page }) => {
  await addText(page, 'GO TEAM');
  await page.getByRole('group', { name: 'Fill type' }).getByRole('button', { name: 'Letters' }).click();
  await page.getByRole('button', { name: 'Rainbow letter colours' }).click();
  await expect.poll(async () => {
    const text = (await frontLayers(page))[0].content;
    return text.kind === 'text' ? text.letterColors?.length : 0;
  }).toBe(6);
});

test('crops a photo square without moving it, then frames it in a circle', async ({ page }) => {
  await dropPhoto(page);
  const before = (await frontLayers(page))[0].transform;
  await palette(page, 'crop image');
  const editor = page.getByRole('group', { name: 'Crop the image' });
  await editor.getByRole('button', { name: '1:1' }).click();
  await editor.getByRole('button', { name: 'Apply' }).click();
  const cropped = (await frontLayers(page))[0];
  expect(cropped.content.kind === 'image' && cropped.content.crop).toBeTruthy();
  expect(cropped.transform.widthMm).toBeCloseTo(cropped.transform.heightMm, 1);
  // The kept middle stays where it was.
  expect(cropped.transform.centerXmm).toBeCloseTo(before.centerXmm, 1);
  await page.getByRole('group', { name: 'Image shape' }).getByRole('button', { name: 'Circle' }).click();
  await expect.poll(async () => {
    const c = (await frontLayers(page))[0].content;
    return c.kind === 'image' ? c.mask : undefined;
  }).toBe('circle');
});

test('counts the inks and previews the white underbase on a dark garment', async ({ page }) => {
  await addText(page, 'INK');
  await palette(page, 'rectangle');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Jet black' }).first().click();
  await page.locator('section', { has: page.getByRole('heading', { name: /Print method/ }) }).locator('select').selectOption('SCREEN_PRINT');
  await expect(page.getByText(/\d+ inks? \+ white underbase/)).toBeVisible();
  await expect(page.getByText(/\d+ screens/)).toBeVisible();
  await page.getByRole('button', { name: 'Preview the white underbase' }).click();
  await expect.poll(() => platePreview(page)).toBe('White underbase');
  await page.getByRole('button', { name: 'Show the artwork again' }).click();
  await expect.poll(() => platePreview(page)).toBe(null);
});

test('adds a ruler guide by dragging it out of the ruler', async ({ page }) => {
  await page.getByRole('button', { name: '2D', exact: true }).click();
  const ruler = page.locator('canvas[title^="Drag down"]');
  const box = (await ruler.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 150, { steps: 8 });
  await page.mouse.move(box.x + 300, box.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await designOf(page)).zones.front.guides?.y.length ?? 0).toBe(1);
});

test('exports a sticker outline as a vector path with a cut file', async ({ page }) => {
  await addText(page, 'STICKER');
  await palette(page, 'sticker outline');
  await expect.poll(async () => (await frontLayers(page))[0].style.outline?.widthMm).toBe(3);
  await palette(page, 'export files');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Vector files/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/_vector_.*\.zip$/);
  const files = unzip(await readFile((await file.path())!));
  const names = Object.keys(files);
  const art = names.find((n) => n.endsWith('.svg') && !n.endsWith('_cut.svg'));
  const cut = names.find((n) => n.endsWith('_cut.svg'));
  expect(art && cut).toBeTruthy();
  // The outline is a traced path, not a picture; the cut file holds just its edge.
  expect(files[art!].toString()).toContain('fill-rule="evenodd"');
  expect(files[art!].toString()).not.toContain('<image');
  expect(files[cut!].toString()).toContain('id="CutContour"');
});

test('stages the garment on a podium and for a flat lay', async ({ page }) => {
  await palette(page, 'scene: podium');
  await expect.poll(async () => (await designOf(page)).scene?.stage).toBe('podium');
  await palette(page, 'scene: flat lay');
  await expect.poll(async () => (await designOf(page)).scene?.stage).toBe('table');
  await expect.poll(async () => (await designOf(page)).scene?.drape).toBe('pressed');
});

test('undoes a clip with Ctrl+Z', async ({ page }) => {
  await addText(page, 'UNDO');
  await palette(page, 'rectangle');
  const [, rect] = await frontLayers(page);
  await selectLayers(page, [rect.id]);
  await page.keyboard.press('Control+Alt+G');
  await expect.poll(async () => (await frontLayers(page))[1].clip).toBe(true);
  await page.keyboard.press('Control+Z');
  await expect.poll(async () => (await frontLayers(page))[1].clip ?? false).toBe(false);
});

test('makes a lockup, places it on the back, and edits it once for both', async ({ page }) => {
  await addText(page, 'CREST');
  await palette(page, 'make a lockup');
  await expect.poll(async () => (await frontLayers(page))[0]?.content.kind).toBe('lockup');
  const lockupId = Object.keys((await designOf(page)).lockups!.items)[0];
  await page.getByRole('tab', { name: 'Back' }).click();
  await palette(page, 'place lockup');
  await expect.poll(async () => Object.values((await designOf(page)).zones.back.layers).filter((l) => l.content.kind === 'lockup').length).toBe(1);
  // Edit the words on the lockup's own board: both placements follow.
  await palette(page, 'edit lockup');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wovexaStudio: { getState: () => { activeZoneId: string } } }).__wovexaStudio.getState().activeZoneId)).toBe(lockupId);
  const textId = (await designOf(page)).lockups!.items[lockupId].orderedLayerIds[0];
  await selectLayers(page, [textId]);
  const box = page.getByRole('textbox', { name: 'Text content' });
  await box.fill('CLUB CREST');
  await box.press('Enter');
  await expect
    .poll(async () => {
      const doc = await designOf(page);
      return [...Object.values(doc.zones.front.layers), ...Object.values(doc.zones.back.layers)].map((l) => (l.content.kind === 'lockup' && l.content.layers[textId].content.kind === 'text' ? l.content.layers[textId].content.value : null));
    })
    .toEqual(['CLUB CREST', 'CLUB CREST']);
  // Back on the front, one placement comes apart into its own layers.
  await palette(page, 'done editing the lockup');
  // In development Next's tools badge sits over the first tab, so the tab is clicked directly.
  await page.getByRole('tab', { name: 'Front' }).dispatchEvent('click');
  await selectLayers(page, [(await frontLayers(page))[0].id]);
  await palette(page, 'detach from lockup');
  await expect.poll(async () => (await frontLayers(page)).map((l) => l.content.kind)).toEqual(['text']);
});

test('runs text round a circle and keeps its letter size as the words change', async ({ page }) => {
  await addText(page, 'TEAM');
  await palette(page, 'add ellipse');
  const [text, circle] = await frontLayers(page);
  await selectLayers(page, [text.id, circle.id]);
  await palette(page, 'put the text on the shape');
  await expect.poll(async () => {
    const c = (await frontLayers(page))[0].content;
    return c.kind === 'text' ? c.onPath?.span : undefined;
  }).toBe(0.4);
  await selectLayers(page, [text.id]);
  const box = page.getByRole('textbox', { name: 'Text content' });
  await box.fill('TEAM WOVEXA');
  await box.press('Enter');
  // Longer words run further round instead of shrinking.
  await expect.poll(async () => {
    const c = (await frontLayers(page))[0].content;
    return c.kind === 'text' ? (c.onPath?.span ?? 0) > 0.6 : false;
  }).toBe(true);
});

test('subtracts one shape from another into a single path', async ({ page }) => {
  await palette(page, 'add rectangle');
  await palette(page, 'add ellipse');
  const ids = (await frontLayers(page)).map((l) => l.id);
  await selectLayers(page, ids);
  await palette(page, 'subtract front shapes');
  await expect.poll(async () => (await frontLayers(page)).map((l) => (l.content.kind === 'shape' ? l.content.shape : l.content.kind))).toEqual(['path']);
});

test('exports a CMYK PDF/X-1a print file', async ({ page }) => {
  await addText(page, 'PRINT');
  await palette(page, 'export files');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /CMYK PDF\/X/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/_cmyk-pdfx_\d+dpi_.*\.pdf$/);
  const pdf = (await readFile((await file.path())!)).toString('latin1');
  expect(pdf).toContain('/GTS_PDFXVersion (PDF/X-1a:2003)');
  expect(pdf).toContain('/ColorSpace /DeviceCMYK');
  expect(pdf).not.toContain('/DeviceRGB');
});
