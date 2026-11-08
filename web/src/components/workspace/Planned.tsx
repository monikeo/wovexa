import { PageHeader } from './WorkspaceShell';

/** Honest placeholder for sections on the roadmap (spec §35.2: no hidden broken buttons). */
export function Planned({
  title,
  summary,
  items,
  release,
  specRef,
}: {
  title: string;
  summary: string;
  items: string[];
  release: string;
  specRef: string;
}) {
  return (
    <>
      <PageHeader title={title} description={summary} />
      <div className="max-w-2xl rounded-2xl border border-line bg-panel p-6">
        <p className="text-sm font-semibold">Not built yet. Planned for {release}.</p>
        <ul className="mt-4 space-y-2 text-sm">
          {items.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="mt-2 h-1 w-3 flex-none bg-fg" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-5 text-xs text-fg-3">Specification reference: {specRef}</p>
      </div>
    </>
  );
}
