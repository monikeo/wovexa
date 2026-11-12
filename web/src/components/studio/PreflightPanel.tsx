'use client';
import { AlertTriangle, CheckCircle2, Info, XOctagon } from 'lucide-react';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { artboardOf } from '@/domain/areas';
import { getGarment } from '@/domain/garments';
import { DEFAULT_PREFLIGHT, runPreflight, summarize, type PreflightIssue, type Severity } from '@/domain/preflight';
import { fontIssues, seamIssues } from '@/lib/preflight-browser';
import { isAreaId, isLockupId, type DesignDocument } from '@/domain/schema';
import { useStudio } from '@/stores/studio-store';
import { selectProjection } from './projection-actions';

// ---- The open design's checks, worked out once for every badge, tab and panel that shows them ----

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
/** The browser's checks (seams, fonts) as last run, on the version of the design they ran on. */
type BrowserChecked = { doc: DesignDocument; issues: PreflightIssue[] };
let browserChecked: BrowserChecked | null = null;
let wanted: DesignDocument | null = null;
/** Goes up when fonts finish loading, or when something still loading is worth another look. */
let generation = 0;
let checkedGeneration = -1;
let timer: ReturnType<typeof setTimeout> | null = null;
let idle: number | null = null;
let watchingFonts = false;
const subscribers = new Set<() => void>();
const pureChecks = new WeakMap<DesignDocument, PreflightIssue[]>();
const merged = new WeakMap<DesignDocument, { checked: BrowserChecked | null; issues: PreflightIssue[] }>();

function lookAgain() {
  generation++;
  if (wanted) requestBrowserChecks(wanted);
}

function runBrowserChecks() {
  idle = null;
  const doc = wanted;
  if (!doc) return;
  const seams = seamIssues(doc);
  const fonts = fontIssues(doc);
  browserChecked = { doc, issues: [...seams.issues, ...fonts.issues] };
  checkedGeneration = generation;
  for (const notify of subscribers) notify();
  // An image or font still loading: look again shortly.
  if (seams.pending || fonts.pending) setTimeout(lookAgain, 1500);
}

/**
 * The browser's checks draw each changed layer and read its pixels back, which waits for the GPU
 * (the 3D view's texture uploads included): run inside an edit they held it up by as much as half
 * a second, typing included. They run once editing pauses instead, a moment later.
 */
function requestBrowserChecks(doc: DesignDocument) {
  wanted = doc;
  if (browserChecked?.doc === doc && checkedGeneration === generation) return;
  if (!watchingFonts && typeof document !== 'undefined' && document.fonts) {
    watchingFonts = true;
    document.fonts.addEventListener('loadingdone', lookAgain);
  }
  if (timer) clearTimeout(timer);
  if (idle !== null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
  idle = null;
  timer = setTimeout(() => {
    timer = null;
    if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(runBrowserChecks, { timeout: 1000 });
    else runBrowserChecks();
  }, 250);
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}
const checkedNow = () => browserChecked;
const checkedOnServer = () => null;

/** The pure checks for this version (at once), with the browser's last findings on layers still there. */
function issuesOf(doc: DesignDocument, checked: BrowserChecked | null): PreflightIssue[] {
  const hit = merged.get(doc);
  if (hit && hit.checked === checked) return hit.issues;
  let pure = pureChecks.get(doc);
  if (!pure) pureChecks.set(doc, (pure = runPreflight(doc, DEFAULT_PREFLIGHT)));
  const there = (i: PreflightIssue) => (i.projectionId ? !!doc.projections.layers[i.projectionId] : i.layerId ? !!artboardOf(doc, i.zoneId)?.layers[i.layerId] : true);
  const issues = [...pure, ...(checked?.issues.filter(there) ?? [])].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  merged.set(doc, { checked, issues });
  return issues;
}

/**
 * Every print check for the open design. The pure checks follow each edit at once; the browser's
 * (seam clearance, fonts) follow a moment after editing pauses, again once fonts finish loading,
 * and shortly after while an image or font is still on its way.
 */
export function usePreflight() {
  const doc = useStudio((s) => s.document);
  const checked = useSyncExternalStore(subscribe, checkedNow, checkedOnServer);
  useEffect(() => {
    if (doc) requestBrowserChecks(doc);
  }, [doc]);
  return useMemo(() => (doc ? issuesOf(doc, checked) : []), [doc, checked]);
}

export const SEVERITY: Record<Severity, { label: string; Icon: typeof Info; className: string }> = {
  error: { label: 'Must fix', Icon: XOctagon, className: 'text-danger' },
  warning: { label: 'Check', Icon: AlertTriangle, className: 'text-warning' },
  info: { label: 'Note', Icon: Info, className: 'text-fg-2' },
};

export function IssueItem({ issue, onSelect }: { issue: PreflightIssue; onSelect?: () => void }) {
  const doc = useStudio((s) => s.document);
  const { label, Icon, className } = SEVERITY[issue.severity];
  const area = isAreaId(issue.zoneId) ? doc?.areas?.items[issue.zoneId] : undefined;
  const layerName = issue.projectionId ? doc?.projections.layers[issue.projectionId]?.name : issue.layerId && doc ? artboardOf(doc, issue.zoneId)?.layers[issue.layerId]?.name : undefined;
  const zoneLabel = issue.projectionId
    ? 'Across seams'
    : area
      ? area.name
      : ((doc && !isAreaId(issue.zoneId) && !isLockupId(issue.zoneId) ? getGarment(doc.garment.modelId).zones[issue.zoneId]?.label : undefined) ?? issue.zoneId.replace('_', ' '));
  const body = (
    <>
      <Icon size={16} className={`mt-0.5 flex-none ${className}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">
          <span className={`font-semibold ${className}`}>{label}: </span>
          {issue.message}
        </span>
        {issue.fix ? <span className="mt-0.5 block text-xs text-fg-2">{issue.fix}</span> : null}
        {issue.code !== 'empty_design' && issue.code !== 'allover_print' ? (
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
    if (issue.projectionId) {
      selectProjection(issue.projectionId);
      onNavigate?.();
      return;
    }
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
