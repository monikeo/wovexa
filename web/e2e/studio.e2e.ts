import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addText, designOf, dropLogo, dropPhoto, frontLayers, newProject, palette, platePreview, selectLayers, unzip } from './helpers';

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

test('edits a project in one tab at a time, and lets editing move with the latest work', async ({ page, context }) => {
  const saved = (p: typeof page) => expect.poll(() => p.evaluate(() => (window as unknown as { __wovexaStudio: { getState: () => { saveState: string } } }).__wovexaStudio.getState().saveState)).toBe('saved');
  await addText(page, 'FIRST');
  await saved(page);
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByRole('alertdialog')).toContainText('open in another tab');
  // The first tab keeps editing; the second picks that up when editing moves to it.
  await addText(page, 'SECOND');
  await saved(page);
  await second.getByRole('button', { name: 'Edit here instead' }).click();
  await expect(second.getByRole('alertdialog')).toBeHidden();
  await expect.poll(async () => (await frontLayers(second)).length).toBe(2);
  await expect(page.getByRole('alertdialog')).toContainText('Editing moved to another tab');
});

test('traces a logo into colour shapes, keeping the image hidden underneath', async ({ page }) => {
  await dropLogo(page);
  await palette(page, 'trace image to vector shapes');
  const panel = page.getByTestId('trace-panel');
  await expect(panel.getByRole('img', { name: /Preview: 2 colour shapes/ })).toBeVisible({ timeout: 20_000 });
  await expect(panel).toContainText('Leaves out #FFFFFF');
  await panel.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect.poll(async () => (await frontLayers(page)).map((l) => [l.content.kind, l.visible])).toEqual([
    ['image', false],
    ['shape', true],
    ['shape', true],
  ]);
  const [, red, navy] = await frontLayers(page);
  expect(red.content.kind === 'shape' && red.content.fill).toBe('#DC1E28');
  expect(navy.content.kind === 'shape' && navy.content.fill).toBe('#141E5A');
  expect(red.groupId && red.groupId === navy.groupId).toBeTruthy();
  // One undo brings the image back on its own.
  await page.keyboard.press('Control+Z');
  await expect.poll(async () => (await frontLayers(page)).map((l) => [l.content.kind, l.visible])).toEqual([['image', true]]);
});

test('reshapes the line text runs along, keeping the letters the same size', async ({ page }) => {
  await addText(page, 'TEAM');
  await palette(page, 'add ellipse');
  const [text, circle] = await frontLayers(page);
  await selectLayers(page, [text.id, circle.id]);
  await palette(page, 'put the text on the shape');
  await selectLayers(page, [text.id]);
  const before = (await frontLayers(page))[0].content;
  await palette(page, 'edit the line the text follows');
  const overlay = page.getByRole('application', { name: /Editing the line the text follows/ });
  await expect(overlay).toBeVisible();
  // Drag the first point of the circle further out from its middle: the line gets longer.
  const nodes = await Promise.all((await overlay.locator('[data-node]').all()).map(async (n) => (await n.boundingBox())!));
  const mid = nodes.reduce((m, b) => ({ x: m.x + (b.x + b.width / 2) / nodes.length, y: m.y + (b.y + b.height / 2) / nodes.length }), { x: 0, y: 0 });
  const from = { x: nodes[0].x + nodes[0].width / 2, y: nodes[0].y + nodes[0].height / 2 };
  const away = Math.hypot(from.x - mid.x, from.y - mid.y) || 1;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + ((from.x - mid.x) / away) * 60, from.y + ((from.y - mid.y) / away) * 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => {
    const c = (await frontLayers(page))[0].content;
    return c.kind === 'text' && before.kind === 'text' ? c.onPath?.d !== before.onPath?.d : false;
  }).toBe(true);
  // The line grew, so the same words cover less of it.
  const after = (await frontLayers(page))[0].content;
  expect(after.kind === 'text' && before.kind === 'text' && after.onPath!.span < before.onPath!.span).toBe(true);
  await page.keyboard.press('Enter');
  await expect(overlay).toBeHidden();
});

test('keeps a lockup in the brand kit and places it in another project', async ({ page }) => {
  await page.goto('/brands');
  await page.getByRole('button', { name: 'New brand kit' }).click();
  await page.getByRole('textbox', { name: 'Brand name' }).fill('Tigers FC');
  await page.getByRole('button', { name: 'Save brand kit' }).click();
  await expect(page.getByText('Saved Tigers FC.')).toBeVisible();

  const linkKit = async () => {
    await page.getByRole('tab', { name: 'Brand' }).click();
    await page.getByRole('combobox', { name: 'Link a brand kit' }).selectOption({ label: 'Tigers FC' });
    await expect.poll(async () => !!(await designOf(page)).brandKitId).toBe(true);
  };
  await newProject(page);
  await linkKit();
  await addText(page, 'TIGERS');
  await palette(page, 'make a lockup');
  await expect.poll(async () => (await frontLayers(page))[0]?.content.kind).toBe('lockup');
  const lockup = Object.values((await designOf(page)).lockups!.items)[0];
  await page.getByRole('button', { name: 'Save to brand kit' }).click();
  await expect(page.getByText(`Saved ${lockup.name} to Tigers FC`)).toBeVisible();
  await expect(page.getByTestId('kit-lockup').filter({ hasText: lockup.name })).toContainText('matching the kit');
  const lockupId = lockup.id;

  await newProject(page);
  await linkKit();
  const row = page.getByTestId('kit-lockup').filter({ hasText: lockup.name });
  await expect(row).toContainText('Not in this design yet');
  await row.getByRole('button', { name: 'Place' }).click();
  await expect.poll(async () => (await frontLayers(page)).map((l) => (l.content.kind === 'lockup' ? l.content.lockupId : null))).toEqual([lockupId]);
  await expect(row).toContainText('matching the kit');
});

test('files projects in a folder, tags them and archives them together', async ({ page }) => {
  await newProject(page);
  await page.goto('/projects');
  const select = page.getByRole('checkbox', { name: /^Select / });
  await expect(select).toHaveCount(2, { timeout: 15_000 });
  for (const box of await select.all()) await box.click();
  const bar = page.getByRole('toolbar', { name: 'Selected projects' });
  await expect(bar).toContainText('2 selected');
  await bar.getByRole('button', { name: /Move to/ }).click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Spring 2027');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Folders' }).getByRole('button', { name: /Spring 2027/ })).toBeVisible();
  for (const box of await select.all()) await box.click();
  await bar.getByRole('button', { name: /Tags/ }).click();
  // The tag field suggests tags already in use, so it is a combobox.
  await page.getByRole('combobox', { name: 'Tag to add' }).fill('Approved');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('group', { name: 'Tags' }).getByRole('button', { name: 'Approved' }).click();
  await expect(page.locator('article')).toHaveCount(2);
  await bar.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('Archived 2 projects.')).toBeVisible();
  await expect(page.locator('article')).toHaveCount(0);
  await page.getByRole('group', { name: 'Show projects' }).getByRole('button', { name: 'Archived' }).click();
  await expect(page.locator('article')).toHaveCount(2);
  // Still filed and tagged.
  await expect(page.locator('article').first()).toContainText('Spring 2027');
  await expect(page.locator('article').first()).toContainText('Approved');
});

test('scales artwork with garment size and prints it at the size on show', async ({ page }) => {
  await addText(page, 'GRADED');
  // The garment's settings show with nothing selected.
  await selectLayers(page, []);
  const grading = page.getByTestId('size-grading');
  await grading.getByRole('checkbox').check();
  await expect.poll(async () => (await designOf(page)).garment.grading?.baseSize).toBe('M');
  await expect(grading.getByRole('row', { name: /^M \(base\) 100%/ })).toBeVisible();
  await expect(grading.getByRole('row', { name: /^XL/ })).toContainText(/1\d\d%/);
  await page.getByRole('combobox', { name: 'Size', exact: true }).selectOption('XL');
  await expect(grading).toContainText('The 3D view shows size XL with its artwork scaled');
  await palette(page, 'export files');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Print files.*True-size PNG/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toContain('XL');
  await expect(page.getByText(/The artwork is at 1\d\d% for size XL/)).toBeVisible();
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
