'use client';
/**
 * Graphics library (spec AST-09): badges, sport marks, symbols and nature shapes that land as
 * editable vector layers, so fill, gradient, pattern and outline all apply and they print sharp
 * at any size.
 */
import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GRAPHIC_CATEGORIES, GRAPHICS, type Graphic } from '@/domain/graphics';
import { useMenuKeyboard } from '@/components/ui/primitives';
import { addGraphic } from './actions';

/** A graphic's outline at its own proportions, fitted in a square of `size` px. */
export function GraphicGlyph({ graphic, size = 32 }: { graphic: Graphic; size?: number }) {
  const w = graphic.aspect >= 1 ? size : size * graphic.aspect;
  const h = graphic.aspect >= 1 ? size / graphic.aspect : size;
  return (
    <svg width={w} height={h} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <path d={graphic.path} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

export function GraphicsGrid({ onPick, columns = 4 }: { onPick: (g: Graphic) => void; columns?: number }) {
  const [category, setCategory] = useState<Graphic['category'] | 'all'>('all');
  const list = category === 'all' ? GRAPHICS : GRAPHICS.filter((g) => g.category === category);
  return (
    <div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Graphic category">
        {[{ id: 'all' as const, label: 'All' }, ...GRAPHIC_CATEGORIES].map((c) => (
          <button
            key={c.id}
            className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-fg-2 hover:text-fg aria-pressed:border-transparent aria-pressed:bg-inverse aria-pressed:text-fg-inverse"
            aria-pressed={category === c.id}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {list.map((g) => (
          <button
            key={g.id}
            role="menuitem"
            className="touch-hit grid aspect-square place-items-center rounded-lg border border-line text-fg hover:border-line-strong hover:bg-hover"
            title={g.name}
            aria-label={`Add ${g.name}`}
            onClick={() => onPick(g)}
          >
            <GraphicGlyph graphic={g} size={28} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The tool-rail button and its popover. */
export function GraphicsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback((restore: boolean) => {
    setOpen(false);
    if (restore) triggerRef.current?.focus();
  }, []);
  useMenuKeyboard(menuRef, open, closeMenu);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button ref={triggerRef} className="icon-btn" aria-label="Add a graphic" title="Graphics" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Sparkles size={18} />
      </button>
      {open ? (
        <div ref={menuRef} role="menu" aria-label="Graphics" className="absolute left-full top-0 z-40 ml-2 w-64 rounded-xl border border-line bg-floating p-2.5 shadow-xl">
          <p className="mb-2 px-0.5 text-xs text-fg-2">Vector graphics: recolour, outline and resize freely.</p>
          <GraphicsGrid
            onPick={(g) => {
              addGraphic(g);
              closeMenu(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
