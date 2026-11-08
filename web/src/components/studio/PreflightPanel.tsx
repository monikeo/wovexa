'use client';
import { AlertTriangle, CheckCircle2, Info, XOctagon } from 'lucide-react';
import { useMemo } from 'react';
import { getGarment } from '@/domain/garments';
import { runPreflight, summarize, type PreflightIssue, type Severity } from '@/domain/preflight';
import { useStudio } from '@/stores/studio-store';

export function usePreflight() {
  const doc = useStudio((s) => s.document);
  return useMemo(() => (doc ? runPreflight(doc) : []), [doc]);
}

export const SEVERITY: Record<Severity, { label: string; Icon: typeof Info; className: string }> = {
  error: { label: 'Must fix', Icon: XOctagon, className: 'text-danger' },
  warning: { label: 'Check', Icon: AlertTriangle, className: 'text-warning' },
  info: { label: 'Note', Icon: Info, className: 'text-fg-2' },
};

export function IssueItem({ issue, onSelect }: { issue: PreflightIssue; onSelect?: () => void }) {
  const doc = useStudio((s) => s.document);
  const { label, Icon, className } = SEVERITY[issue.severity];
  const layerName = issue.layerId ? doc?.zones[issue.zoneId].layers[issue.layerId]?.name : undefined;
  const zoneLabel = doc ? getGarment(doc.garment.modelId).zones[issue.zoneId].label : issue.zoneId;
  const body = (
    <>
      <Icon size={16} className={`mt-0.5 flex-none ${className}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">
          <span className={`font-semibold ${className}`}>{label}: </span>
          {issue.message}
        </span>
        {issue.fix ? <span className="mt-0.5 block text-xs text-fg-2">{issue.fix}</span> : null}
        {issue.code !== 'empty_design' ? (
          <span className="mt-0.5 block text-xs text-fg-3">
            {zoneLabel}
            {layerName ? `, ${layerName}` : ''}
          </span>
        ) : null}
      </span>
    </>
  );
  return onSelect ? (
    <button className="flex w-full items-start gap-2.5 rounded-lg p-2 text-left hover:bg-hover" onClick={onSelect}>
      {body}
    </button>
  ) : (
    <div className="flex items-start gap-2.5 p-2">{body}</div>
  );
}

export function PreflightPanel({ onNavigate }: { onNavigate?: () => void }) {
  const issues = usePreflight();
  const { errors, warnings } = summarize(issues);
  const go = (issue: PreflightIssue) => () => {
    const s = useStudio.getState();
    if (s.activeZoneId !== issue.zoneId) s.setActiveZone(issue.zoneId);
    if (issue.layerId) s.select([issue.layerId]);
    onNavigate?.();
  };
  return (
    <div className="px-2 pb-4 pt-3">
      <div className="flex items-center justify-between px-2">
        <h2 className="panel-title">Print checks</h2>
        <span className="text-xs text-fg-2">
          {errors} to fix, {warnings} to check
        </span>
      </div>
      {issues.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 px-2 text-sm">
          <CheckCircle2 size={16} className="text-success" aria-hidden /> Every layer is inside its print area at a good resolution.
        </p>
      ) : (
        <ul className="mt-2 space-y-0.5">
          {issues.map((issue) => (
            <li key={issue.id}>
              <IssueItem issue={issue} onSelect={issue.code === 'empty_design' ? undefined : go(issue)} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 px-2 text-xs text-fg-3">Resolution limits are 250 dpi recommended and 150 dpi minimum. Your print shop has the final say.</p>
    </div>
  );
}
