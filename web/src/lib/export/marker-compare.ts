/** Fabric marker work in a web worker (on this thread where workers are unavailable). */
import { getGarment } from '@/domain/garments';
import { compareRollWidths, type RollEstimate } from './marker-layout';
import { nest, type NestOptions, type NestPiece, type NestResult } from './nesting';
import type { CompareRequest, MarkerReply, MarkerRequest } from './marker.worker';

const cancelled = () => new DOMException('Export cancelled', 'AbortError');

function offThread<T>(request: MarkerRequest, here: () => T, failed: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    let worker: Worker;
    try {
      worker = new Worker(new URL('./marker.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      try {
        resolve(here());
      } catch (error) {
        reject(error);
      }
      return;
    }
    const stop = () => {
      worker.terminate();
      reject(cancelled());
    };
    signal?.addEventListener('abort', stop, { once: true });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', stop);
    };
    worker.onmessage = (e: MessageEvent<MarkerReply<T>>) => {
      finish();
      if (e.data.ok) resolve(e.data.value);
      else reject(new Error(e.data.message));
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || failed));
    };
    worker.postMessage(request);
  });
}

export function compareRollWidthsOffThread(req: CompareRequest): Promise<RollEstimate[]> {
  return offThread({ kind: 'compare', ...req }, () => compareRollWidths(getGarment(req.modelId), req.sampleSize, req.roster, req.settings, req.widthsCm), 'The roll comparison failed.');
}

/** Nests an order's pieces on the roll: seconds for a large team order, with the page responsive throughout. */
export function nestOffThread(pieces: readonly NestPiece[], options: NestOptions, signal?: AbortSignal): Promise<NestResult> {
  // Only what nesting reads goes across.
  const plain = pieces.map(({ id, shape, outline, group }) => ({ id, shape, outline, group }));
  return offThread({ kind: 'nest', pieces: plain, options }, () => nest(plain, options), 'Nesting the pieces failed.', signal);
}
