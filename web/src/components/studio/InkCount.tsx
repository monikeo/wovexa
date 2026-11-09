'use client';
/**
 * The ink count for the print area being designed (spec PRT-06): how many inks (screens, threads or
 * vinyl colours) the artwork takes, each with its share of the print, and on dark garments the white
 * underbase. Any one screen can be shown alone on the 2D artboard.
 */
import { Layers, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { colourName } from '@/domain/color-harmony';
import type { ArtboardId, LayerStack, PrintMethod } from '@/domain/schema';
import { needsUnderbase } from '@/lib/export/separations';
import { analyzeInks, matchesGarment, plateCanvas, PRESS_HEADS, type InkReport } from '@/lib/ink-report';
import { useLive } from '@/stores/studio-store';

const UNIT: Partial<Record<PrintMethod, [string, string]>> = {
  SCREEN_PRINT: ['ink', 'inks'],
  PUFF_PRINT: ['puff ink', 'puff inks'],
  EMBROIDERY: ['thread colour', 'thread colours'],
  HEAT_TRANSFER: ['vinyl colour', 'vinyl colours'],
};

const percent = (share: number) => (share >= 0.995 ? '100%' : share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`);

export function InkCount({ zoneId, stack, widthMm, heightMm, garment, method }: { zoneId: ArtboardId; stack: LayerStack; widthMm: number; heightMm: number; garment: string; method: PrintMethod }) {
  const [report, setReport] = useState<InkReport | null>(null);
  const [retry, setRetry] = useState(0);
  const preview = useLive((s) => (s.platePreview?.zoneId === zoneId ? s.platePreview : null));

  // Count again a moment after the artwork settles (and once more if an image was still loading).
  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = analyzeInks(stack, widthMm, heightMm);
      setReport(next);
      if (!next.complete && retry < 5) window.setTimeout(() => setRetry((n) => n + 1), 700);
      // A screen being previewed follows the artwork.
      const live = useLive.getState();
      const p = live.platePreview?.zoneId === zoneId ? live.platePreview : null;
      if (p && (p.plate === 'underbase' ? next.inks.length : p.plate < next.inks.length)) live.setPlatePreview({ ...p, canvas: plateCanvas(next, p.plate, garment), garment });
      else if (p) live.setPlatePreview(null);
    }, 300);
    return () => window.clearTimeout(id);
  }, [stack, widthMm, heightMm, garment, retry, zoneId]);

  // Leaving the panel puts the artwork back.
  useEffect(() => () => useLive.getState().setPlatePreview(null), []);

  if (!report) return null;
  const { inks } = report;
  const dark = needsUnderbase(garment);
  const underbase = dark && inks.length > 0 && (method === 'SCREEN_PRINT' || method === 'DTG' || method === 'PUFF_PRINT');
  const knockouts = inks.filter((ink) => matchesGarment(ink, garment)).length;
  const [one, many] = UNIT[method] ?? ['colour', 'colours'];
  const toggle = (plate: 'underbase' | number) => {
    const live = useLive.getState();
    if (preview?.plate === plate) return live.setPlatePreview(null);
    const label = plate === 'underbase' ? 'White underbase' : `${one[0].toUpperCase()}${one.slice(1)} ${plate + 1}, ${colourName(inks[plate].hex)}`;
    live.setPlatePreview({ zoneId, plate, label, canvas: plateCanvas(report, plate, garment), garment });
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-line p-3" aria-live="polite">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">
          {inks.length ? `${inks.length} ${inks.length === 1 ? one : many}` : 'No artwork yet'}
          {underbase ? ' + white underbase' : ''}
        </span>
        {method === 'SCREEN_PRINT' && inks.length ? <span className="num text-xs text-fg-2">{inks.length + (underbase ? 1 : 0)} screens</span> : null}
      </div>
      {inks.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Inks, most used first. Choose one to see only that screen on the artboard.">
          {inks.map((ink, k) => {
            const same = matchesGarment(ink, garment);
            return (
              <li key={`${ink.hex}${k}`}>
                <button
                  className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] hover:border-line-strong aria-pressed:border-[var(--accent)] aria-pressed:bg-selected ${same ? 'border-dashed border-line-strong' : 'border-line'}`}
                  aria-pressed={preview?.plate === k}
                  title={`${colourName(ink.hex)} ${ink.hex}: ${percent(ink.share)} of the print.${same ? ' Same as the garment: it can be left off and the fabric shows through.' : ''} Show only this screen.`}
                  onClick={() => toggle(k)}
                >
                  <span className="h-3.5 w-3.5 rounded-sm border border-black/15" style={{ background: ink.hex }} aria-hidden />
                  <span className="num">{percent(ink.share)}</span>
                  <span className="sr-only">
                    {colourName(ink.hex)}
                    {same ? ', same as the garment' : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {underbase ? (
        <button className="btn btn-outline w-full justify-start px-2 text-xs" aria-pressed={preview?.plate === 'underbase'} onClick={() => toggle('underbase')}>
          <Layers size={14} /> {preview?.plate === 'underbase' ? 'Show the artwork again' : 'Preview the white underbase'}
        </button>
      ) : null}
      {preview && preview.plate !== 'underbase' ? (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-fg-2">Showing {preview.label.toLowerCase()} only</span>
          <button className="btn btn-ghost min-h-8 px-2 text-xs" onClick={() => useLive.getState().setPlatePreview(null)}>
            <Undo2 size={13} /> Artwork
          </button>
        </div>
      ) : null}
      <p className="text-[11px] text-fg-3">
        {method === 'SCREEN_PRINT'
          ? `Each ink is one screen, so fewer inks cost less to set up.${dark ? ' On a dark garment, a white underbase goes down first so the colours stay bright.' : ''}${inks.length > PRESS_HEADS ? ` That is more than most presses hold (6 to ${PRESS_HEADS} heads): merge close colours, or print it by DTF or DTG.` : ''}`
          : method === 'DTF'
            ? 'Direct to film prints any number of colours, backed by a white layer.'
            : method === 'DTG'
              ? `Direct to garment prints any number of colours in one pass.${dark ? ' On a dark garment it lays white ink under them first.' : ''}`
              : method === 'SUBLIMATION' && dark
                ? 'Sublimation dyes the fabric and cannot print on a dark garment: choose a light colourway or another method.'
                : `Counted from the artwork's own colours; near-identical shades share one ${one}.`}
        {knockouts && method !== 'SUBLIMATION' ? ` ${knockouts === 1 ? 'One ink matches' : `${knockouts} inks match`} the garment (dashed): it can be left off and the fabric shows through, with no underbase under it.` : ''}
        {report.tonal ? ' Photos and gradients print best halftoned: add a halftone screen to them, or ask for a simulated-process separation.' : ''}
      </p>
    </div>
  );
}
