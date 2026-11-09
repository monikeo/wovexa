import { NextResponse } from 'next/server';
import { listModels } from './library';

/** GET: the 3D model library, every .glb in the app's `3d_models` folder, named after its file. */
export async function GET() {
  const models = await listModels();
  return NextResponse.json({ models }, { headers: { 'Cache-Control': 'no-cache' } });
}
