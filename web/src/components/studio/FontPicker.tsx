'use client';
/**
 * Font picker (spec ED2-06/07, AST-07, TYP-03): search, categories, live previews in each face,
 * brand fonts first, and uploaded fonts with a licence confirmation. Keyboard: arrows move,
 * Enter picks, Escape closes. Stylesheets load only for fonts scrolled into view.
 */
import { Check, ChevronDown, Loader2, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cleanFamilyName, deleteFont, ensureCustomFonts, FONT_ACCEPT, FontError, importFontFile, listFonts } from '@/lib/font-library';
import { ARTWORK_FONTS, FONT_CATEGORIES, loadFontStylesheets, type FontCategory } from '@/lib/fonts';
import type { StoredFont } from '@/lib/local-db';
import { toast } from '@/components/ui/primitives';

export interface PickedFont {
  family: string;
  fontAssetId?: string;
  weights: number[];
}

interface Option {
  key: string;
  family: string;
  fontAssetId?: string;
  weights: number[];
  category: FontCategory | 'brand' | 'yours';
  note?: string;
}

type Filter = 'all' | 'brand' | 'yours' | FontCategory;

export function FontPicker({ family, fontAssetId, sample, brandFonts, onChange }: { family: string; fontAssetId?: string; sample: string; brandFonts: string[]; onChange: (font: PickedFont) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [active, setActive] = useState(0);
  const [uploaded, setUploaded] = useState<StoredFont[]>([]);
  /** The uploaded font whose delete button was pressed once, waiting for the second press. */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    listFonts().then(
      (fonts) => {
        setUploaded(fonts);
        void ensureCustomFonts(fonts.map((f) => f.id));
      },
      () => {},
    );
  }, [open]);

  const options = useMemo(() => {
    const brand: Option[] = brandFonts
      .map((f) => ARTWORK_FONTS.find((a) => a.family === f))
      .filter((f): f is (typeof ARTWORK_FONTS)[number] => !!f)
      .map((f) => ({ key: `brand:${f.family}`, family: f.family, weights: f.weights, category: 'brand', note: 'Brand' }));
    const yours: Option[] = uploaded.map((f) => ({ key: `yours:${f.id}`, family: f.family, fontAssetId: f.id, weights: [400, 700], category: 'yours', note: 'Uploaded' }));
    const all: Option[] = ARTWORK_FONTS.map((f) => ({ key: f.family, family: f.family, weights: f.weights, category: f.category, note: f.note }));
    const q = query.trim().toLowerCase();
    const rest = all.filter((o) => !brandFonts.includes(o.family));
    const pool = filter === 'all' ? [...brand, ...yours, ...rest] : filter === 'brand' ? brand : filter === 'yours' ? yours : all.filter((o) => o.category === filter);
    return q ? pool.filter((o) => o.family.toLowerCase().includes(q) || (o.note ?? '').toLowerCase().includes(q) || o.category.includes(q)) : pool;
  }, [brandFonts, uploaded, filter, query]);

  // Load each face's stylesheet as its row scrolls into view, so previews show the real font.
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const families = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.family!);
        if (families.length) void loadFontStylesheets(families);
      },
      { root: list, rootMargin: '120px' },
    );
    list.querySelectorAll('[data-family]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [open, options]);

  const close = (restore: boolean) => {
    setOpen(false);
    setQuery('');
    if (restore) triggerRef.current?.focus();
  };

  const pick = (o: Option) => {
    onChange({ family: o.family, fontAssetId: o.fontAssetId, weights: o.weights });
    close(true);
  };

  const sampleFor = (o: Option) => {
    const cat = FONT_CATEGORIES.find((c) => c.id === o.category);
    const text = sample.trim().split('\n')[0].slice(0, 24);
    return cat?.sample && !/[^ -ɏ]/.test(text) ? `${cat.sample} ${text}`.trim() : text || 'Wovexa';
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, Math.min(options.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      setActive(next);
      listRef.current?.querySelector(`#${CSS.escape(`${id}-opt-${next}`)}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && options[active]) {
      e.preventDefault();
      pick(options[active]);
    }
  };

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    ...(brandFonts.length ? [{ id: 'brand' as const, label: 'Brand' }] : []),
    { id: 'yours', label: 'Uploaded' },
    ...FONT_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
  ];

  return (
    <div className="grid grid-cols-[52px_1fr] items-start gap-2">
      <span className="label pt-2">Font</span>
      <div className="min-w-0">
        <button
          ref={triggerRef}
          type="button"
          className="field flex items-center justify-between gap-2 text-left"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          <span className="truncate text-sm" style={{ fontFamily: `"${family}"` }}>
            {family}
          </span>
          <ChevronDown size={14} className="flex-none text-fg-3" />
        </button>
        {open ? (
          <div className="mt-1.5 rounded-lg border border-line bg-floating p-2 shadow-lg" onKeyDown={onKeyDown}>
            <label className="relative block">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" />
              <input
                autoFocus
                type="search"
                className="field pl-8"
                placeholder="Search fonts"
                aria-label="Search fonts"
                role="combobox"
                aria-expanded="true"
                aria-controls={`${id}-list`}
                aria-activedescendant={options[active] ? `${id}-opt-${active}` : undefined}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Font categories">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="touch-hit rounded-full border border-line px-2.5 py-0.5 text-[11px] font-semibold text-fg-2 aria-pressed:border-transparent aria-pressed:bg-inverse aria-pressed:text-fg-inverse"
                  aria-pressed={filter === f.id}
                  onClick={() => {
                    setFilter(f.id);
                    setActive(0);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Fonts" className="mt-2 max-h-64 overflow-y-auto overscroll-contain">
              {options.length ? (
                options.map((o, i) => {
                  const selected = o.family === family && (o.fontAssetId ?? undefined) === (fontAssetId ?? undefined);
                  return (
                    <div
                      key={o.key}
                      id={`${id}-opt-${i}`}
                      role="option"
                      aria-selected={selected}
                      data-family={o.family}
                      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${i === active ? 'bg-hover' : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(o)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-lg leading-tight" style={{ fontFamily: `"${o.family}", system-ui` }}>
                          {sampleFor(o)}
                        </div>
                        <div className="truncate text-[11px] text-fg-3">
                          {o.family}
                          {o.note ? ` · ${o.note}` : ''}
                        </div>
                      </div>
                      {selected ? <Check size={14} className="flex-none text-accent" /> : null}
                      {o.fontAssetId && confirmingDelete === o.fontAssetId ? (
                        // A second click deletes: the file (and its licence note) is gone for good.
                        <button
                          type="button"
                          className="btn btn-danger min-h-7 flex-none px-2 text-xs"
                          aria-label={`Delete uploaded font ${o.family} for good`}
                          onClick={async (e) => {
                            e.stopPropagation();
                            setConfirmingDelete(null);
                            try {
                              await deleteFont(o.fontAssetId!);
                              setUploaded((list) => list.filter((f) => f.id !== o.fontAssetId));
                              toast(`Deleted ${o.family} from this device.`);
                            } catch (error) {
                              toast(error instanceof Error ? error.message : 'The font could not be deleted.', 'error');
                            }
                          }}
                        >
                          Delete
                        </button>
                      ) : o.fontAssetId ? (
                        <button
                          type="button"
                          className="icon-btn hover-reveal h-7 w-7 text-fg-3"
                          aria-label={`Delete uploaded font ${o.family}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmingDelete(o.fontAssetId!);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="px-2 py-3 text-xs text-fg-3">{filter === 'yours' ? 'No uploaded fonts yet.' : 'No fonts match.'}</p>
              )}
            </div>
            <FontUpload
              busy={uploading}
              onUpload={async (file, name, note) => {
                setUploading(true);
                try {
                  const font = await importFontFile(file, name, note);
                  setUploaded((list) => [font, ...list]);
                  toast(`Added ${font.family} to your fonts on this device.`, 'success');
                  pick({ key: `yours:${font.id}`, family: font.family, fontAssetId: font.id, weights: [400, 700], category: 'yours' });
                } catch (error) {
                  toast(error instanceof FontError ? error.message : 'The font could not be added.', 'error');
                } finally {
                  setUploading(false);
                }
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FontUpload({ busy, onUpload }: { busy: boolean; onUpload: (file: File, name: string, note: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [allowed, setAllowed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-2 border-t border-line pt-2">
      <input
        ref={inputRef}
        type="file"
        accept={FONT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          if (f) setName(cleanFamilyName(f.name));
          e.target.value = '';
        }}
      />
      {!file ? (
        <button type="button" className="btn btn-ghost w-full justify-start px-2 text-xs" onClick={() => inputRef.current?.click()}>
          <Upload size={14} /> Upload a font (TTF, OTF, WOFF, WOFF2)
        </button>
      ) : (
        <div className="space-y-2">
          <p className="truncate text-xs text-fg-2">{file.name}</p>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} aria-label="Font name" placeholder="Font name" maxLength={60} />
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Licence (optional)" placeholder="Licence, e.g. desktop + merchandise" maxLength={300} />
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5 h-4 w-4 flex-none accent-[var(--accent)]" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />
            I have the right to use this font on printed products and to send it to my printer.
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline flex-1 text-xs" onClick={() => setFile(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary flex-1 text-xs" disabled={!allowed || !name.trim() || busy} onClick={() => onUpload(file, name, note)}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Add font
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
