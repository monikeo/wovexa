'use client';
/**
 * Version history and approval (spec PRJ-08, COL-04, COL-05, FAC-06, PRT-10).
 * Versions are immutable snapshots. Restoring applies a snapshot as a new, undoable edit
 * after saving the current design, so nothing is ever lost. Approval freezes a version for
 * production and is blocked while print checks fail.
 */
import { BadgeCheck, ExternalLink, GitCompare, Loader2, RotateCcw, Save } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { restoreSnapshot } from '@/domain/commands';
import { diffDocuments, type Change } from '@/domain/diff';
import { documentHash } from '@/domain/hash';
import { runPreflight, summarize } from '@/domain/preflight';
import { migrateDesignDocument, type DesignDocument } from '@/domain/schema';
import { approveVersion, approvalState, listVersions, saveVersion, updateProjectMeta, type StoredVersion } from '@/lib/local-db';
import { thumbnailWithin } from '@/lib/thumbnail';
import { ConfirmDialog, toast } from '@/components/ui/primitives';
import { BlobImage } from '@/components/workspace/projects';
import { useStudio } from '@/stores/studio-store';

const SOURCE_LABEL: Record<StoredVersion['source'], string> = {
  manual: 'Saved',
  approval: 'Approved on save',
  'before-restore': 'Automatic, before restore',
  'before-upgrade': 'Automatic, before format upgrade',
};

function formatDate(ms: number) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function useVersionDocument(version: StoredVersion | null): DesignDocument | null {
  return useMemo(() => {
    if (!version) return null;
    const parsed = migrateDesignDocument(version.document);
    return parsed.ok ? parsed.document : null;
  }, [version]);
}

function ChangeList({ changes }: { changes: Change[] }) {
  if (!changes.length) return <p className="text-xs text-fg-2">No differences. The current design matches this version.</p>;
  return (
    <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
      {changes.map((c, i) => (
        <li key={i} className="flex gap-2">
          <span className={`w-14 flex-none font-semibold ${c.kind === 'added' ? 'text-success' : c.kind === 'removed' ? 'text-danger' : 'text-fg-2'}`}>
            {c.kind === 'added' ? 'Added' : c.kind === 'removed' ? 'Removed' : 'Changed'}
          </span>
          <span>
            <span className="text-fg-2">{c.area}: </span>
            {c.text.replace(/^Added |^Removed /, '')}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ApproveForm({ doc, onApprove, onCancel }: { doc: DesignDocument; onApprove: (by: string, note: string) => Promise<void>; onCancel: () => void }) {
  const issues = useMemo(() => runPreflight(doc), [doc]);
  const { errors, warnings } = summarize(issues);
  const [by, setBy] = useState(() => {
    try {
      return localStorage.getItem('wovexa.approver') ?? '';
    } catch {
      return '';
    }
  });
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  if (errors) {
    return (
      <div className="rounded-lg border border-danger/50 p-3 text-xs">
        <p className="font-semibold text-danger">This version can’t be approved yet.</p>
        <p className="mt-1">{errors} print {errors === 1 ? 'check fails' : 'checks fail'}. Fix them, save a new version, then approve that one.</p>
        <button className="btn btn-outline mt-2 min-h-8 text-xs" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }
  return (
    <form
      className="space-y-2 rounded-lg border border-line p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          localStorage.setItem('wovexa.approver', by.trim());
        } catch {}
        try {
          await onApprove(by.trim(), note.trim());
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-xs text-fg-2">Approval freezes this version. Exports and the tech pack can then point at it, and later edits show as changes since approval.</p>
      <label className="grid gap-1 text-xs">
        <span className="text-fg-2">Approved by</span>
        <input className="field" required value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" />
      </label>
      <label className="grid gap-1 text-xs">
        <span className="text-fg-2">Note (optional)</span>
        <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Approved after sample 2" />
      </label>
      {warnings ? (
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />I’ve reviewed {warnings} print {warnings === 1 ? 'warning' : 'warnings'} and accept them.
        </label>
      ) : null}
      <div className="flex gap-2">
        <button className="btn btn-primary min-h-8 flex-1 text-xs" disabled={busy || !by.trim() || (warnings > 0 && !ack)}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />} Approve
        </button>
        <button type="button" className="btn btn-outline min-h-8 text-xs" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function VersionRow({ version, current, approvedId, onChanged }: { version: StoredVersion; current: DesignDocument; approvedId?: string; onChanged: () => void }) {
  const doc = useVersionDocument(version);
  const dispatch = useStudio((s) => s.dispatch);
  const [mode, setMode] = useState<null | 'compare' | 'approve'>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const changes = useMemo(() => (doc && mode === 'compare' ? diffDocuments(doc, current) : []), [doc, current, mode]);
  const superseded = version.approval && approvedId !== version.id;

  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex gap-3">
        <div className="h-14 w-14 flex-none overflow-hidden rounded-lg bg-[var(--surface-hover)]">
          {version.thumbnail ? <BlobImage blob={version.thumbnail} className="h-full w-full object-contain" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            <span className="num text-fg-2">v{version.number}</span> {version.label}
          </p>
          <p className="text-xs text-fg-2">
            {formatDate(version.createdAt)}, {SOURCE_LABEL[version.source].toLowerCase()}
          </p>
          {version.approval ? (
            <p className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${superseded ? 'text-fg-3' : 'text-success'}`}>
              <BadgeCheck size={13} />
              {superseded ? 'Superseded approval' : 'Approved'} by {version.approval.approvedBy}, {formatDate(version.approval.approvedAt)}
            </p>
          ) : null}
        </div>
      </div>
      {!doc ? <p className="mt-2 text-xs text-danger">This version couldn’t be read.</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button className="btn btn-outline min-h-8 px-2.5 text-xs" disabled={!doc} aria-pressed={mode === 'compare'} onClick={() => setMode(mode === 'compare' ? null : 'compare')}>
          <GitCompare size={13} /> Compare
        </button>
        <button className="btn btn-outline min-h-8 px-2.5 text-xs" disabled={!doc} onClick={() => setConfirmRestore(true)}>
          <RotateCcw size={13} /> Restore
        </button>
        {!version.approval ? (
          <button className="btn btn-outline min-h-8 px-2.5 text-xs" disabled={!doc} onClick={() => setMode(mode === 'approve' ? null : 'approve')}>
            <BadgeCheck size={13} /> Approve
          </button>
        ) : (
          <Link className="btn btn-outline min-h-8 px-2.5 text-xs" href={`/production/${version.projectId}?version=${version.id}`}>
            <ExternalLink size={13} /> Tech pack
          </Link>
        )}
      </div>
      {mode === 'compare' && doc ? (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-semibold">Since v{version.number}</p>
          <ChangeList changes={changes} />
        </div>
      ) : null}
      {mode === 'approve' && doc ? (
        <div className="mt-3">
          <ApproveForm
            doc={doc}
            onCancel={() => setMode(null)}
            onApprove={async (by, note) => {
              try {
                await approveVersion(version.id, { approvedBy: by, note, approvedAt: Date.now() });
                await useStudio.getState().refreshMeta();
                toast(`Version ${version.number} approved for production.`, 'success');
                setMode(null);
                onChanged();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Approval failed.', 'error');
              }
            }}
          />
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmRestore}
        title={`Restore version ${version.number}?`}
        body="Your current design is saved as a new version first, then this version becomes your working design. You can also undo the restore."
        confirmLabel="Restore"
        onCancel={() => setConfirmRestore(false)}
        onConfirm={async () => {
          setConfirmRestore(false);
          const now = useStudio.getState().document;
          if (!doc || !now) return;
          if ((await documentHash(doc)) === (await documentHash(now))) {
            toast(`The current design already matches version ${version.number}.`);
            return;
          }
          try {
            // The design as it is now is kept first, so the restore never loses anything.
            await saveVersion({ projectId: now.projectId, label: `Before restoring v${version.number}`, document: now, source: 'before-restore', hash: await documentHash(now), thumbnail: await thumbnailWithin(now) });
          } catch {
            toast(`Version ${version.number} wasn’t restored: the current design couldn’t be kept as a version first. Try again.`, 'error');
            return;
          }
          if (dispatch(restoreSnapshot(doc, `Restore v${version.number}`))) {
            toast(`Restored version ${version.number}. Your previous design is saved in history.`, 'success');
          } else {
            toast(`Version ${version.number} wasn’t restored. Your current design is unchanged and also saved as a version.`, 'error');
          }
          onChanged();
        }}
      />
    </li>
  );
}

export function HistoryPanel() {
  const doc = useStudio((s) => s.document);
  const meta = useStudio((s) => s.meta);
  const [versions, setVersions] = useState<StoredVersion[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<null | 'save' | 'approve'>(null);
  const [approving, setApproving] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const projectId = doc?.projectId;

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    listVersions(projectId).then(
      (v) => alive && setVersions(v),
      () => {
        if (!alive) return;
        setVersions([]);
        toast('Versions couldn’t be read from this browser’s storage.', 'error');
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId, tick]);

  if (!doc) return null;
  const state = meta ? approvalState(meta) : 'draft';

  const snapshot = async (source: StoredVersion['source'], text: string, approval?: { approvedBy: string; note: string }) => {
    await useStudio.getState().saveNow();
    // A version (an approval above all) is of the design as saved: not of changes that failed to save.
    const { document: current, saveState, saveError } = useStudio.getState();
    if (!current || saveState === 'error') throw new Error(saveError ?? 'The design couldn’t be saved, so no version was made.');
    const hash = await documentHash(current);
    const version = await saveVersion({
      projectId: current.projectId,
      label: text,
      document: structuredClone(current),
      source,
      hash,
      thumbnail: await thumbnailWithin(current),
      approval: approval ? { ...approval, approvedAt: Date.now() } : undefined,
    });
    if (approval) await updateProjectMeta(current.projectId, { approvedVersionId: version.id, approvedVersionNumber: version.number, approvedHash: hash });
    await useStudio.getState().refreshMeta();
    return version;
  };
  const failed = (e: unknown, what: string) => toast(e instanceof Error && e.message ? e.message : `${what} failed: this browser’s storage refused it. Try again.`, 'error');

  return (
    <div className="space-y-5 p-4">
      <section aria-labelledby="status">
        <h3 id="status" className="panel-title">
          Status
        </h3>
        <p className="mt-1 text-sm">
          {state === 'approved' ? (
            <span className="flex items-center gap-1.5 font-semibold text-success">
              <BadgeCheck size={15} /> Matches approved version {meta?.approvedVersionNumber}
            </span>
          ) : state === 'changed' ? (
            <span>
              <span className="font-semibold text-warning">Changed since version {meta?.approvedVersionNumber} was approved.</span> Approve again before sending new files to production.
            </span>
          ) : (
            <span className="text-fg-2">Draft. No version has been approved yet.</span>
          )}
        </p>
      </section>

      <section aria-labelledby="save-version" className="space-y-2">
        <h3 id="save-version" className="panel-title">
          Save a version
        </h3>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy('save');
            try {
              const v = await snapshot('manual', label.trim() || `Version ${(versions?.[0]?.number ?? 0) + 1}`);
              setLabel('');
              toast(`Saved version ${v.number}.`, 'success');
            } catch (error) {
              failed(error, 'Saving the version');
            } finally {
              setBusy(null);
              refresh();
            }
          }}
        >
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. Sample 1" aria-label="Version name" maxLength={120} />
          <button className="btn btn-ink flex-none" disabled={!!busy}>
            {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
          </button>
        </form>
        {state !== 'approved' ? (
          approving ? (
            <ApproveForm
              doc={doc}
              onCancel={() => setApproving(false)}
              onApprove={async (by, note) => {
                setBusy('approve');
                try {
                  const v = await snapshot('approval', label.trim() || 'Approved for production', { approvedBy: by, note });
                  setApproving(false);
                  setLabel('');
                  toast(`Version ${v.number} saved and approved for production.`, 'success');
                } catch (error) {
                  failed(error, 'Approving');
                } finally {
                  setBusy(null);
                  refresh();
                }
              }}
            />
          ) : (
            <button className="btn btn-outline w-full text-xs" onClick={() => setApproving(true)}>
              <BadgeCheck size={14} /> Save and approve the current design
            </button>
          )
        ) : null}
      </section>

      <section aria-labelledby="versions">
        <h3 id="versions" className="panel-title mb-2">
          Versions
        </h3>
        {versions === null ? (
          <p className="text-sm text-fg-2">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-fg-2">No versions yet. Save one before big changes or before sending files to a print shop.</p>
        ) : (
          <ul className="space-y-2">
            {versions.map((v) => (
              <VersionRow key={v.id} version={v} current={doc} approvedId={meta?.approvedVersionId} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
