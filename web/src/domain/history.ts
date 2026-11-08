/**
 * Undo/redo built from Immer patches (spec ED2-14). Each entry stores the forward and
 * inverse patches of one semantic command, not a snapshot of the whole document.
 */
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type { Command } from './commands';
import type { DesignDocument } from './schema';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  at: number;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const MAX_HISTORY = 200;

export const emptyHistory = (): History => ({ past: [], future: [] });

export interface ApplyResult {
  document: DesignDocument;
  history: History;
  changed: boolean;
}

export function applyCommand(doc: DesignDocument, history: History, command: Command, now = Date.now()): ApplyResult {
  const [next, patches, inverse] = produceWithPatches(doc, command.recipe);
  if (patches.length === 0) return { document: doc, history, changed: false };
  const past = [...history.past, { label: command.label, patches, inverse, at: now }];
  if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY);
  return { document: next, history: { past, future: [] }, changed: true };
}

export function undo(doc: DesignDocument, history: History): ApplyResult {
  const entry = history.past[history.past.length - 1];
  if (!entry) return { document: doc, history, changed: false };
  return {
    document: applyPatches(doc, entry.inverse),
    history: { past: history.past.slice(0, -1), future: [entry, ...history.future] },
    changed: true,
  };
}

export function redo(doc: DesignDocument, history: History): ApplyResult {
  const entry = history.future[0];
  if (!entry) return { document: doc, history, changed: false };
  return {
    document: applyPatches(doc, entry.patches),
    history: { past: [...history.past, entry], future: history.future.slice(1) },
    changed: true,
  };
}
