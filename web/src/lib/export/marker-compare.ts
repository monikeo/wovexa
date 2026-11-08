/** Fabric needed on each roll width, worked out in a web worker (on this thread where workers are unavailable). */
import { getGarment } from '@/domain/garments';
import { compareRollWidths, type RollEstimate } from './marker-layout';
import type { CompareReply, CompareRequest } from './marker.worker';

export function compareRollWidthsOffThread(req: CompareRequest): Promise<RollEstimate[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./marker.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      try {
        resolve(compareRollWidths(getGarment(req.modelId), req.sampleSize, req.roster, req.settings, req.widthsCm));
      } catch (error) {
        reject(error);
      }
      return;
    }
    worker.onmessage = (e: MessageEvent<CompareReply>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.estimates);
      else reject(new Error(e.data.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The roll comparison failed.'));
    };
    worker.postMessage(req);
  });
}
