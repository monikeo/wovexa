'use client';
/**
 * Icon library (spec AST-09): about two hundred line icons from Lucide, in categories and
 * searchable, that land as editable line shapes (lib/icons/icon-shape.ts): recolour them, change
 * their line weight, edit their points, or turn the line into a filled shape. The icons load the
 * first time the library opens, so the studio's own start-up stays as light as it was.
 */
import { Search, Smile } from 'lucide-react';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { ICON_CATEGORIES, iconLabel, searchIcons } from '@/lib/icons/catalog';
import type { IconData } from '@/lib/icons/icon-shape';
import { addIcon } from './actions';

type IconSet = Readonly<Record<string, IconData>>;

let pending: Promise<IconSet> | null = null;
/** The icon set, fetched once (and again after a failed try). */
function loadIcons(): Promise<IconSet> {
  pending ??= import('@/lib/icons/lucide-set').then(
    (m) => m.ICON_DATA,
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

function useIconSet() {
  const [state, setState] = useState<{ icons: IconSet | null; failed: boolean }>({ icons: null, failed: false });
  useEffect(() => {
    let alive = true;
    loadIcons().then(
      (icons) => alive && setState({ icons, failed: false }),
      () => alive && setState({ icons: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
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

/** An icon drawn as Lucide draws it: 2-unit lines on its 24-unit grid. */
export function IconGlyph({ icon, size = 22 }: { icon: IconData; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {icon.node.map(([tag, attrs], i) => createElement(tag, { ...attrs, key: i }))}
    </svg>
  );
}

/** Arrow keys move through a grid of buttons, a row at a time up and down. */
function gridKeys(e: React.KeyboardEvent<HTMLElement>, columns: number) {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? columns : e.key === 'ArrowUp' ? -columns : 0;
  if (!step) return;
  const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  const next = buttons[i + step];
  if (!next) return;
  e.preventDefault();
  next.focus();
}

export function IconsGrid({ onPick, columns = 7, focusSearch = false }: { onPick: (icon: IconData) => void; columns?: number; focusSearch?: boolean }) {
  const { icons, failed } = useIconSet();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSearch) search.current?.focus();
  }, [focusSearch]);
  const names = useMemo(() => searchIcons(query, category), [query, category]);
  const shownRecent = !query && !category && icons ? recent.filter((n) => icons[n]) : [];
  const pick = (name: string) => {
    const icon = icons?.[name];
    if (!icon) return;
    setRecent(rememberRecent(name));
    onPick(icon);
  };
  const cell = 'touch-hit grid aspect-square place-items-center rounded-lg border border-line text-fg hover:border-line-strong hover:bg-hover';
  const grid = (list: readonly string[], label: string) => (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="group" aria-label={label} onKeyDown={(e) => gridKeys(e, columns)}>
      {list.map((name) => (
        <button key={name} className={cell} title={iconLabel(name)} aria-label={`Add ${iconLabel(name).toLowerCase()} icon`} onClick={() => pick(name)}>
          {icons?.[name] ? <IconGlyph icon={icons[name]} /> : null}
        </button>
      ))}
    </div>
  );
  return (
    <div>
      <label className="relative block">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
        <input ref={search} className="field h-9 w-full pl-8 text-sm" type="search" placeholder="Search icons: star, music, coffee" aria-label="Search icons" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Icon category">
        {[{ id: null, label: 'All' }, ...ICON_CATEGORIES].map((c) => (
          <button
            key={c.id ?? 'all'}
            className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-fg-2 hover:text-fg aria-pressed:border-transparent aria-pressed:bg-inverse aria-pressed:text-fg-inverse"
            aria-pressed={category === c.id}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-2 max-h-[min(52vh,420px)] space-y-3 overflow-y-auto pr-0.5">
        {failed ? (
          <p className="py-6 text-center text-xs text-fg-2">The icons couldn’t load. Check your connection, then open the icons again.</p>
        ) : !icons ? (
          <p className="py-6 text-center text-xs text-fg-2" role="status">
            Loading icons…
          </p>
        ) : (
          <>
            {shownRecent.length ? (
              <section>
                <h4 className="mb-1 text-[11px] font-semibold text-fg-2">Recently used</h4>
                {grid(shownRecent, 'Recently used icons')}
              </section>
            ) : null}
            {names.length ? (
              grid(names, 'Icons')
            ) : (
              <p className="py-6 text-center text-xs text-fg-2">No icons match “{query.trim()}”. Try one simple word, like star, music or coffee.</p>
            )}
          </>
        )}
      </div>
      <p className="mt-2 text-[11px] text-fg-3">Line icons by Lucide (ISC licence): free to use on your garments. Recolour and resize them like any shape.</p>
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
            onPick={(icon) => {
              if (addIcon(icon)) setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
