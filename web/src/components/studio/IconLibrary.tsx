'use client';
/**
 * Icon library (spec ED2-09): all of Lucide's line icons, about two thousand, found by name or by
 * Lucide's own tags, browsed by category, with recently used ones first. They land as editable line
 * shapes (lib/icons/icon-shape.ts): recolour them, change their line weight, edit their points, or
 * turn the line into a filled shape. The icons, their tags and the catalogue load the first time
 * the library opens (lib/icons/library.ts), so the studio's own start-up stays as light as it was.
 * Keyboard: the arrow keys move through a grid (Home and End to its ends), Down from the search
 * goes into it and Up from its top row comes back.
 */
import { Search, Smile } from 'lucide-react';
import { createElement, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { IconData } from '@/lib/icons/icon-shape';
import { addIcon } from './actions';

type IconLibrary = typeof import('@/lib/icons/library');

let pending: Promise<IconLibrary> | null = null;
/** The icon library, fetched once (and again after a failed try). */
function loadLibrary(): Promise<IconLibrary> {
  pending ??= import('@/lib/icons/library').catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

function useIconLibrary() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ lib: IconLibrary | null; failed: boolean }>({ lib: null, failed: false });
  useEffect(() => {
    let alive = true;
    loadLibrary().then(
      (lib) => alive && setState({ lib, failed: false }),
      () => alive && setState({ lib: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  return {
    ...state,
    retry: () => {
      setState({ lib: null, failed: false });
      setAttempt((a) => a + 1);
    },
  };
}

const RECENT_KEY = 'wovexa.recent-icons';
const MAX_RECENT = 12;

function readRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function rememberRecent(name: string): string[] {
  const next = [name, ...readRecent().filter((n) => n !== name)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

/** An icon drawn as Lucide draws it: 2-unit lines on its 24-unit grid, round at ends and corners. */
export function IconGlyph({ icon, size = 22 }: { icon: IconData; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {icon.node.map(([tag, attrs], i) => createElement(tag, { ...attrs, key: i }))}
    </svg>
  );
}

/** Icons shown at a time, and added by Show more: whole rows at six, seven or eight across. */
const PAGE = 168;

/**
 * A grid of icon buttons that takes one Tab stop: the arrow keys move through it, a row at a time up
 * and down, Home and End go to its first and last icon, and Up from the top row calls `onTop`.
 */
function IconGrid({ names, lib, columns, label, onPick, onTop }: { names: readonly string[]; lib: IconLibrary; columns: number; label: string; onPick: (name: string) => void; onTop?: () => void }) {
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const current = Math.max(0, Math.min(active, names.length - 1));
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const last = names.length - 1;
    const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns, Home: -current, End: last - current };
    if (!(e.key in steps) || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const to = current + steps[e.key];
    if (to < 0 && e.key === 'ArrowUp') return onTop?.();
    const next = Math.max(0, Math.min(last, to));
    setActive(next);
    ref.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };
  const cell = 'touch-hit grid aspect-square place-items-center rounded-lg border border-line text-fg hover:border-line-strong hover:bg-hover';
  return (
    <div ref={ref} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="group" aria-label={label} onKeyDown={onKeyDown}>
      {names.map((name, i) => {
        const icon = lib.iconData(name);
        const text = lib.iconLabel(name);
        return (
          <button key={name} className={cell} tabIndex={i === current ? 0 : -1} title={text} aria-label={`Add ${text.toLowerCase()} icon`} onFocus={() => setActive(i)} onClick={() => onPick(name)}>
            {icon ? <IconGlyph icon={icon} /> : null}
          </button>
        );
      })}
    </div>
  );
}

const chip = 'rounded-full border border-line px-2.5 py-1 text-xs font-medium text-fg-2 hover:text-fg aria-pressed:border-transparent aria-pressed:bg-inverse aria-pressed:text-fg-inverse';

export function IconsGrid({ onPick, columns = 7, focusSearch = false }: { onPick: (icon: IconData, label: string) => void; columns?: number; focusSearch?: boolean }) {
  const { lib, failed, retry } = useIconLibrary();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  // Typing stays quick while the grid catches up.
  const shownQuery = useDeferredValue(query);
  useEffect(() => {
    if (focusSearch) search.current?.focus();
  }, [focusSearch]);
  const names = useMemo(() => (lib ? lib.searchIcons(shownQuery, category) : []), [lib, shownQuery, category]);
  const searching = !!shownQuery.trim();
  const recentShown = !searching && !category && lib ? recent.filter((n) => lib.iconData(n)) : [];
  const pick = (name: string) => {
    const icon = lib?.iconData(name);
    if (!lib || !icon) return;
    setRecent(rememberRecent(name));
    onPick(icon, lib.iconLabel(name));
  };
  const intoGrid = () => results.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  const categoryLabel = lib?.ICON_CATEGORIES.find((c) => c.id === category)?.label;
  const heading = searching ? `${names.length.toLocaleString()} ${names.length === 1 ? 'icon' : 'icons'} found` : categoryLabel ? `${categoryLabel} (${names.length})` : `All ${names.length.toLocaleString()} icons`;
  return (
    <div>
      <label className="relative block">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
        <input
          ref={search}
          className="field h-9 w-full pl-8 text-sm"
          type="search"
          placeholder={lib ? `Search ${lib.ICON_NAMES.length.toLocaleString()} icons: star, music, coffee` : 'Search icons: star, music, coffee'}
          aria-label="Search icons"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown') return;
            e.preventDefault();
            intoGrid();
          }}
        />
      </label>
      {lib ? (
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Icon category">
          {[{ id: null, label: 'All' }, ...lib.ICON_CATEGORIES].map((c) => (
            <button
              key={c.id ?? 'all'}
              className={chip}
              aria-pressed={category === c.id}
              onClick={() => {
                setCategory(c.id);
                setLimit(PAGE);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={results} className="mt-2 max-h-[min(52vh,420px)] space-y-3 overflow-y-auto pr-0.5">
        {failed ? (
          <div className="py-6 text-center text-xs text-fg-2">
            <p>The icons couldn’t load. Check your connection and try again.</p>
            <button className="btn btn-outline mt-2 text-xs" onClick={retry}>
              Try again
            </button>
          </div>
        ) : !lib ? (
          <p className="py-6 text-center text-xs text-fg-2" role="status">
            Loading icons…
          </p>
        ) : (
          <>
            {recentShown.length ? (
              <section>
                <h4 className="mb-1 text-[11px] font-semibold text-fg-2">Recently used</h4>
                <IconGrid names={recentShown} lib={lib} columns={columns} label="Recently used icons" onPick={pick} onTop={() => search.current?.focus()} />
              </section>
            ) : null}
            <section>
              <h4 className="mb-1 text-[11px] font-semibold text-fg-2">{heading}</h4>
              <p className="sr-only" role="status">
                {searching ? heading : ''}
              </p>
              {names.length ? (
                <>
                  <IconGrid
                    key={`${shownQuery}|${category}`}
                    names={names.slice(0, limit)}
                    lib={lib}
                    columns={columns}
                    label="Icons"
                    onPick={pick}
                    onTop={recentShown.length ? undefined : () => search.current?.focus()}
                  />
                  {names.length > limit ? (
                    <button className="btn btn-outline mt-2 w-full text-xs" onClick={() => setLimit((l) => l + PAGE)}>
                      Show more icons ({(names.length - limit).toLocaleString()} left)
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="py-6 text-center text-xs text-fg-2">No icons match “{shownQuery.trim()}”. Try one simple word, like star, music or coffee.</p>
              )}
            </section>
          </>
        )}
      </div>
      {lib ? (
        <details className="mt-2 text-[11px] text-fg-3">
          <summary className="cursor-pointer hover:text-fg-2">Line icons by Lucide: free to change and to print on garments you sell. Licence details</summary>
          <div className="mt-1.5 space-y-1.5">
            {lib.ICON_LICENCE_SUMMARY.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line p-2 font-mono text-[10px] leading-snug">{lib.LUCIDE_LICENCE}</pre>
          </div>
        </details>
      ) : (
        <p className="mt-2 text-[11px] text-fg-3">Line icons by Lucide: free to change and to print on garments you sell.</p>
      )}
    </div>
  );
}

/** The tool-rail button and its panel. The command palette opens it too ("wovexa:icons"). */
export function IconsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const show = (e: Event) => {
      // Taken here: the palette then leaves the phone's Add sheet alone.
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('wovexa:icons', show);
    return () => window.removeEventListener('wovexa:icons', show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="relative" ref={ref}>
      <button ref={trigger} className="icon-btn" aria-label="Add an icon" title="Icons" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Smile size={18} />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Icons"
          // Beside the tool rail and just under the header, whatever the window's height: opening
          // down from the button, a short window would cut off its foot.
          className="fixed left-[calc(var(--toolrail-width)+0.5rem)] top-16 z-40 max-h-[calc(100dvh-5rem)] w-[22rem] max-w-[calc(100vw-var(--toolrail-width)-1rem)] overflow-y-auto rounded-xl border border-line bg-floating p-2.5 shadow-xl"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            close();
          }}
        >
          <IconsGrid
            focusSearch
            onPick={(icon, label) => {
              if (addIcon(icon, label)) setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
