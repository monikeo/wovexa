import { expect, type Page } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import type { ArtworkLayer, DesignDocument } from '../src/domain/schema';

type StudioWindow = Window & {
  __wovexaStudio: { getState: () => { status: string; document: DesignDocument | null; selectedLayerIds: string[]; select: (ids: string[]) => void } };
  __wovexaLive: { getState: () => { platePreview: { label: string } | null } };
};

/** Start a new project from the dashboard and wait for the studio to open it. */
export async function newProject(page: Page) {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.waitForURL(/\/studio\//);
  await page.waitForFunction(() => (window as unknown as StudioWindow).__wovexaStudio?.getState().status === 'ready');
}

/** Run a command from the palette (Ctrl+K), as someone typing its name would. */
export async function palette(page: Page, query: string) {
  await page.keyboard.press('Control+K');
  const input = page.getByRole('combobox', { name: 'Find an action' });
  await input.fill(query);
  await input.press('Enter');
  await expect(input).toBeHidden();
}

/** The design as the studio holds it now. */
export const designOf = (page: Page) => page.evaluate(() => (window as unknown as StudioWindow).__wovexaStudio.getState().document!);

/** The front print area's layers, bottom first. */
export async function frontLayers(page: Page): Promise<ArtworkLayer[]> {
  const doc = await designOf(page);
  return doc.zones.front.orderedLayerIds.map((id) => doc.zones.front.layers[id]);
}

export const selectLayers = (page: Page, ids: string[]) => page.evaluate((list) => (window as unknown as StudioWindow).__wovexaStudio.getState().select(list), ids);

export const platePreview = (page: Page) => page.evaluate(() => (window as unknown as StudioWindow).__wovexaLive.getState().platePreview?.label ?? null);

/** Add a text layer through the palette and type its words. */
export async function addText(page: Page, words: string) {
  await palette(page, 'add text');
  const box = page.getByRole('textbox', { name: 'Text content' });
  await expect(box).toBeFocused();
  await box.fill(words);
  await box.press('Enter');
  await expect.poll(async () => (await frontLayers(page)).some((l) => l.content.kind === 'text' && l.content.value === words)).toBe(true);
}

/** Drop a generated photo (a sky, a sun and hills) on the stage, as from the desktop. */
export async function dropPhoto(page: Page) {
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 1000;
    const g = c.getContext('2d')!;
    const sky = g.createLinearGradient(0, 0, 0, 1000);
    sky.addColorStop(0, '#2B59FF');
    sky.addColorStop(1, '#FFB4A2');
    g.fillStyle = sky;
    g.fillRect(0, 0, 1600, 1000);
    g.fillStyle = '#FFD100';
    g.beginPath();
    g.arc(1150, 330, 170, 0, Math.PI * 2);
    g.fill();
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const data = new DataTransfer();
    data.items.add(new File([blob], 'Landscape.jpg', { type: 'image/jpeg' }));
    const stage = document.querySelector('main[aria-label="Design stage"]')!;
    const r = stage.getBoundingClientRect();
    stage.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  });
  await expect.poll(async () => (await frontLayers(page)).some((l) => l.content.kind === 'image')).toBe(true);
}

/** The files in a ZIP, by name (stored and deflated entries). */
export function unzip(bytes: Buffer): Record<string, Buffer> {
  let eocd = bytes.length - 22;
  while (eocd > 0 && bytes.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = bytes.readUInt16LE(eocd + 10);
  let p = bytes.readUInt32LE(eocd + 16);
  const out: Record<string, Buffer> = {};
  for (let k = 0; k < count; k++) {
    const method = bytes.readUInt16LE(p + 10);
    const size = bytes.readUInt32LE(p + 20);
    const nameLength = bytes.readUInt16LE(p + 28);
    const extra = bytes.readUInt16LE(p + 30);
    const comment = bytes.readUInt16LE(p + 32);
    const offset = bytes.readUInt32LE(p + 42);
    const name = bytes.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    const data = bytes.subarray(start, start + size);
    out[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    p += 46 + nameLength + extra + comment;
  }
  return out;
}
