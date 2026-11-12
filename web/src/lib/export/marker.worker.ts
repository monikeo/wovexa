/**
 * Fabric marker work off the main thread: nesting the pieces of an order, and comparing roll widths
 * (the same nesting on every width). A large team order takes a few seconds either way, and the
 * export dialog stays responsive meanwhile: its progress moves and Cancel works.
 */
import { getGarment } from '@/domain/garments';
import { compareRollWidths, type MarkerSettings } from './marker-layout';
import { nest, type NestOptions, type NestPiece } from './nesting';
import type { Roster } from './roster';

export interface CompareRequest {
  modelId: string;
  sampleSize: string;
  roster: Roster | null;
  settings: MarkerSettings;
  widthsCm: number[];
}

export interface NestRequest {
  pieces: NestPiece[];
  options: NestOptions;
}

export type MarkerRequest = ({ kind: 'compare' } & CompareRequest) | ({ kind: 'nest' } & NestRequest);

export type MarkerReply<T> = { ok: true; value: T } | { ok: false; message: string };

addEventListener('message', (e: MessageEvent<MarkerRequest>) => {
  const req = e.data;
  let reply: MarkerReply<unknown>;
  try {
    reply = { ok: true, value: req.kind === 'nest' ? nest(req.pieces, req.options) : compareRollWidths(getGarment(req.modelId), req.sampleSize, req.roster, req.settings, req.widthsCm) };
  } catch (error) {
    reply = { ok: false, message: error instanceof Error ? error.message : req.kind === 'nest' ? 'Nesting the pieces failed.' : 'The roll comparison failed.' };
  }
  postMessage(reply);
});
