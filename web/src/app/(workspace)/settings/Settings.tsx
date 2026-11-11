'use client';
import { useEffect, useState } from 'react';
import { formatBytes } from '@/lib/assets';
import { clearLocalData, requestPersistentStorage, storageEstimate, storagePersisted } from '@/lib/local-db';
import { setPreference, usePreference, type Preferences } from '@/lib/preferences';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { ConfirmDialog, toast } from '@/components/ui/primitives';
import { PageHeader } from '@/components/workspace/WorkspaceShell';

function Choice<K extends keyof Preferences>({ name, label, help, options }: { name: K; label: string; help: string; options: [Preferences[K], string][] }) {
  const value = usePreference(name);
  return (
    <fieldset className="grid gap-3 border-t border-line py-6 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <legend className="font-semibold">{label}</legend>
        <p className="mt-1 text-sm text-fg-2">{help}</p>
      </div>
      <div className="seg w-fit">
        {options.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => setPreference(name, v)}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Settings() {
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => void storageEstimate().then(setUsage), []);
  useEffect(() => void storagePersisted().then(setPersisted), []);

  return (
    <>
      <PageHeader title="Settings" description="Preferences apply to this device only." />
      <div className="max-w-3xl">
        <Choice name="units" label="Measurements" help="Used in the inspector. Designs are always stored in millimetres." options={[['mm', 'Millimetres'], ['in', 'Inches']]} />
        <Choice name="theme" label="Appearance" help="System follows your device setting." options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} />
        <Choice
          name="quality"
          label="3D quality"
          help="Automatic picks a level from your device’s memory and screen. Lower it if the preview feels slow."
          options={[['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]}
        />

        <section className="border-t border-line py-6">
          <h2 className="font-semibold">Account</h2>
          {isSupabaseConfigured() ? (
            <p className="mt-1 text-sm text-fg-2">Cloud sync is configured for this deployment. Sign in from the start page to sync projects across devices.</p>
          ) : (
            <p className="mt-1 max-w-xl text-sm text-fg-2">
              You’re in local mode: no account, and projects stay in this browser. Accounts, cloud sync and sharing switch on once a Supabase project is connected to this deployment.
            </p>
          )}
        </section>

        <section className="border-t border-line py-6">
          <h2 className="font-semibold">Storage on this device</h2>
          <p className="mt-1 text-sm text-fg-2">
            {usage ? `Using ${formatBytes(usage.usage)} of about ${formatBytes(usage.quota)} available to this site.` : 'Storage use is not reported by this browser.'} Clearing
            browser data for this site deletes projects that aren’t synced.
          </p>
          {persisted === null ? null : persisted ? (
            <p className="mt-3 text-sm text-fg-2">
              <span className="font-semibold text-fg">Protected.</span> The browser keeps your projects even when the device runs low on space.
            </p>
          ) : (
            <div className="mt-3 max-w-xl text-sm text-fg-2">
              <p>
                <span className="font-semibold text-fg">Not protected yet.</span> When the device runs low on space, or after weeks without a visit in some browsers, the browser may clear this site’s data, and your projects with it.
              </p>
              <button
                className="btn btn-outline mt-3"
                onClick={async () => {
                  const kept = await requestPersistentStorage();
                  setPersisted(kept);
                  toast(kept ? 'Your projects are protected on this device.' : 'The browser didn’t agree this time. Installing WOVEXA as an app, or bookmarking it, usually lets it protect your projects.', kept ? 'success' : undefined);
                }}
              >
                Protect my projects
              </button>
            </div>
          )}
          <button className="btn btn-outline mt-4 text-danger" onClick={() => setConfirm(true)}>
            Delete all local projects and artwork…
          </button>
        </section>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Delete everything on this device?"
        body="Every project and uploaded image in this browser is removed permanently. This can’t be undone."
        confirmLabel="Delete everything"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          await clearLocalData();
          toast('Local projects and artwork deleted.');
          setUsage(await storageEstimate());
        }}
      />
    </>
  );
}
