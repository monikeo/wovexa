import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { VIEW_FILE } from '@/domain/model-library';
import { apiError } from '@/lib/api';
import { modelPath, versionOf } from '../library';

/** A saved 2D view is a PNG this size at most. */
const MAX_VIEW_BYTES = 8 * 1048576;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const TYPES: [RegExp, string][] = [
  [/\.glb$/i, 'model/gltf-binary'],
  [/\.png$/i, 'image/png'],
  [/\.jpe?g$/i, 'image/jpeg'],
  [/\.webp$/i, 'image/webp'],
  [/\.svg$/i, 'image/svg+xml'],
];

/**
 * GET: one library file, a model's GLB or one of its 2D views, by its path in the folder
 * (/api/models/Hoodies/Hoodie1.glb). Browsers keep it and check back with its version (ETag), so
 * a file downloads once and again only when it changes in the folder.
 */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const rel = parts.join('/');
  const full = modelPath(rel);
  if (!full) return apiError(404, 'not_found', 'No such 3D model.');
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(full);
  } catch {
    return apiError(404, 'not_found', 'No such 3D model.');
  }
  if (!info.isFile()) return apiError(404, 'not_found', 'No such 3D model.');
  const etag = `"${versionOf(info)}"`;
  const headers: Record<string, string> = { ETag: etag, 'Cache-Control': 'public, max-age=0, must-revalidate' };
  // A 2D view drawn as SVG is shown as a picture, never run as a page.
  if (/\.svg$/i.test(rel)) headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const body = Readable.toWeb(createReadStream(full)) as ReadableStream<Uint8Array>;
  const type = TYPES.find(([re]) => re.test(rel))?.[1] ?? 'application/octet-stream';
  return new Response(body, { headers: { ...headers, 'Content-Type': type, 'Content-Length': String(info.size) } });
}

/**
 * PUT: save a model's 2D view (a PNG drawn by the studio) beside it in the folder, so it ships
 * with the library: /api/models/Hoodies/Hoodie1.front.png. Only while developing, only from the
 * app's own pages, only for a model that is in the folder.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (process.env.NODE_ENV !== 'development') return apiError(403, 'forbidden', 'The model library can only be changed while developing.');
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return apiError(403, 'forbidden', 'Only the app itself can save into the model library.');
  const { path: parts } = await params;
  const rel = parts.join('/');
  const view = VIEW_FILE.exec(rel);
  const full = modelPath(rel);
  if (!view || !full || view[2].toLowerCase() !== 'png') return apiError(400, 'bad_request', 'Save a 2D view as Name.front.png or Name.back.png.');
  const model = modelPath(`${rel.slice(0, view.index)}.glb`);
  const info = model ? await stat(model).catch(() => null) : null;
  if (!info?.isFile()) return apiError(404, 'not_found', 'No such 3D model.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_VIEW_BYTES) return apiError(413, 'too_large', 'A 2D view can be 8 MB at most.');
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return apiError(400, 'bad_request', 'A 2D view must be a PNG.');
  await writeFile(full, bytes);
  return new Response(null, { status: 204 });
}
