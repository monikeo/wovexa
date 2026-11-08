/**
 * Compares roll widths for a fabric marker off the main thread. Nesting a large team order on
 * every width takes a few seconds, and the export dialog stays responsive meanwhile.
 */
import { getGarment } from '@/domain/garments';
import { compareRollWidths, type MarkerSettings, type RollEstimate } from './marker-layout';
import type { Roster } from './roster';

export interface CompareRequest {
  modelId: string;
  sampleSize: string;
  roster: Roster | null;
  settings: MarkerSettings;
  widthsCm: number[];
}

export type CompareReply = { ok: true; estimates: RollEstimate[] } | { ok: false; message: string };

addEventListener('message', (e: MessageEvent<CompareRequest>) => {
  const { modelId, sampleSize, roster, settings, widthsCm } = e.data;
  let reply: CompareReply;
  try {
    reply = { ok: true, estimates: compareRollWidths(getGarment(modelId), sampleSize, roster, settings, widthsCm) };
  } catch (error) {
    reply = { ok: false, message: error instanceof Error ? error.message : 'The roll comparison failed.' };
  }
  postMessage(reply);
});
