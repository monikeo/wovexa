'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useStudio } from '@/stores/studio-store';

/**
 * Shown while another tab edits this project (it had it open first, or took it over): a project
 * is edited in one tab at a time, so two never save over each other. Editing can move here.
 */
export function EditLockNotice() {
  const lock = useStudio((s) => s.editLock);
  const takeOver = useStudio((s) => s.takeOverEditing);
  const [busy, setBusy] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const open = lock === 'elsewhere' || lock === 'lost';
  useEffect(() => {
    if (open) primary.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} className="w-full max-w-md rounded-2xl border border-line bg-[var(--surface-panel)] p-6 shadow-xl">
        <h2 id={titleId} className="heading text-xl">
          {lock === 'elsewhere' ? 'This project is open in another tab' : 'Editing moved to another tab'}
        </h2>
        <p id={bodyId} className="mt-3 text-sm text-fg-2">
          {lock === 'elsewhere'
            ? 'It’s edited in one tab or window at a time, so the two can’t save over each other.'
            : 'Another tab or window took this project over, so this one stopped saving. Everything up to then is saved.'}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            ref={primary}
            className="btn btn-ink"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void takeOver().finally(() => setBusy(false));
            }}
          >
            Edit here instead
          </button>
          <Link href="/dashboard" className="text-sm font-semibold underline underline-offset-4">
            Back to projects
          </Link>
        </div>
      </div>
    </div>
  );
}
