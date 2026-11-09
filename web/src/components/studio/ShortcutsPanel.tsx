'use client';
/**
 * Every way to work the studio: keyboard, mouse, trackpad, and touch or pen, for the 2D canvas and
 * the 3D view. Opened with ? or from the project menu.
 */
import type { ReactNode } from 'react';

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? '⌘' : 'Ctrl';

function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {keys.split(' ').map((k, i) =>
        k === 'or' || k === 'then' ? (
          <span key={i} className="text-[11px] text-fg-3">
            {k}
          </span>
        ) : (
          <kbd key={i} className="rounded-md border border-line bg-hover px-1.5 py-0.5 font-sans text-[11px] font-medium text-fg">
            {k.replace('Mod', MOD).replace(/\+/g, ' + ')}
          </kbd>
        ),
      )}
    </span>
  );
}

function Rows({ rows }: { rows: [ReactNode, string][] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([what, how], i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-[13px]">
          <dt className="text-fg-2">{what}</dt>
          <dd>
            <Keys keys={how} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Gestures({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([what, how]) => (
        <div key={what} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3 py-1.5 text-[13px]">
          <dt className="text-fg-2">{what}</dt>
          <dd className="text-fg">{how}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="panel-title">{title}</h3>
      {children}
    </section>
  );
}

export function ShortcutsPanel() {
  return (
    <div className="space-y-6 px-4 pb-6 pt-1">
      <Section title="Keyboard">
        <Rows
          rows={[
            ['Undo, redo', 'Mod+Z Mod+Shift+Z or Mod+Y'],
            ['Copy, cut, paste layers (into any zone or design area)', 'Mod+C Mod+X Mod+V'],
            ['Duplicate', 'Mod+D'],
            ['Select all', 'Mod+A'],
            ['Next or previous layer (on the canvas)', 'Tab Shift+Tab'],
            ['Deselect', 'Esc'],
            ['Delete', 'Delete or Backspace'],
            ['Move 1 mm, 10 mm (a design area with nothing selected moves on the garment)', 'Arrows Shift+Arrows'],
            ['Rotate 1°, 15°', ', . Shift+, Shift+.'],
            ['Send backward, bring forward', '[ ]'],
            ['Group, ungroup', 'Mod+G Mod+Shift+G'],
            ['Previous or next print area', 'PageUp PageDown'],
            ['Add text', 'T'],
            ['Pen: draw your own shape (Enter closes it, Backspace takes back a point, Esc cancels)', 'P'],
            ['Zoom in, out', '+ −'],
            ['Fit the print area, zoom to the selection', 'Shift+1 Shift+2'],
            ['Actions menu', 'Shift+F10 or Menu'],
            ['Save now', 'Mod+S'],
            ['This list', '?'],
          ]}
        />
        <p className="text-[11px] text-fg-3">
          In the 3D view: arrows turn the view (in Place mode they move artwork), + and − zoom or resize, comma and period turn artwork 5° in Place mode, 1 to 7 jump to views, Home resets, O and P switch Orbit and Place.
        </p>
      </Section>
      <Section title="Mouse">
        <Gestures
          rows={[
            ['Select, add to selection', 'Click, Shift+click'],
            ['Move, resize, rotate', 'Drag the artwork or its handles'],
            ['Pan the canvas', 'Middle-drag, Space+drag, or scroll'],
            ['Zoom the canvas', `${MOD}+scroll`],
            ['Actions', 'Right-click'],
            ['3D, Orbit mode', 'Drag turns the garment, scroll zooms, click selects artwork'],
            ['3D, Place mode', 'Drag artwork or a design area anywhere on the garment; scroll resizes, Shift+scroll rotates; right-drag turns the view'],
          ]}
        />
      </Section>
      <Section title="Trackpad">
        <Gestures
          rows={[
            ['Pan the canvas', 'Two-finger scroll'],
            ['Zoom the canvas', 'Pinch'],
            ['3D view', 'Two-finger scroll or pinch zooms; in Place mode they resize the selection'],
          ]}
        />
      </Section>
      <Section title="Touch and pen">
        <Gestures
          rows={[
            ['Select, move', 'Tap, drag'],
            ['Pan the canvas', 'One finger on empty canvas'],
            ['Zoom the canvas', 'Pinch with two fingers'],
            ['Actions', 'Long-press'],
            ['3D, Orbit mode', 'One finger turns the garment, pinch zooms'],
            ['3D, Place mode', 'Drag artwork or a design area; pinch resizes, twist rotates'],
          ]}
        />
      </Section>
    </div>
  );
}
