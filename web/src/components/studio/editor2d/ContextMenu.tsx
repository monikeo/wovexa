'use client';
/**
 * Editor context menu (spec DSK-03 right-click, MOB-05 long-press). One menu for every
 * input: opened by right-click, a long press, or Shift+F10 / the Menu key, and fully
 * operable with arrows, Enter and Escape.
 */
import {
  ArrowDownToLine,
  ArrowUpToLine,
  BringToFront,
  Copy,
  CornerLeftDown,
  Crop,
  Eye,
  Focus,
  Group,
  Image as ImageIcon,
  Lock,
  Maximize,
  MousePointerSquareDashed,
  Pencil,
  SendToBack,
  Square,
  Trash2,
  Type,
  Ungroup,
  Unlock,
  AlignCenter,
} from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import * as cmd from '@/domain/commands';
import { ACCEPTED_TYPES } from '@/lib/assets';
import { useMenuKeyboard } from '@/components/ui/primitives';
import { useActiveArtboard, useStudio } from '@/stores/studio-store';
import {
  addImages,
  addShape,
  addText,
  alignSelection,
  clipSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  moveSelectionInStack,
  openCrop,
  selectAll,
  ungroupSelection,
  zoomToSelection,
} from '../actions';

interface Item {
  label: string;
  icon: ReactNode;
  shortcut?: string;
  run: () => void;
}

const MENU_WIDTH = 232;
const ITEM_HEIGHT = 36;

export function EditorContextMenu({ x, y, onClose }: { x: number; y: number; onClose: (restoreFocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const zone = useActiveArtboard();
  const zoneId = useStudio((s) => s.activeZoneId);
  const selected = useStudio((s) => s.selectedLayerIds);
  const dispatch = useStudio((s) => s.dispatch);
  const close = useCallback((restore: boolean) => onClose(restore), [onClose]);
  useMenuKeyboard(ref, true, close);

  // Dismiss on outside press, scroll or resize.
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close(false);
    const dismiss = () => close(false);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [close]);

  const layers = zone ? selected.map((id) => zone.layers[id]).filter(Boolean) : [];
  const groups = new Set(layers.map((l) => l.groupId).filter(Boolean));
  const oneGroup = groups.size === 1 && layers.length > 1 && layers.every((l) => l.groupId);
  const allLocked = layers.length > 0 && layers.every((l) => l.locked);
  const single = layers.length === 1 ? layers[0] : null;
  // One layer clips to the one under it; several clip to the lowest of them.
  const clipTargets = layers.length > 1 && zone ? layers.filter((l) => l.id !== zone.orderedLayerIds.find((id) => selected.includes(id))) : layers;
  const clipped = clipTargets.length > 0 && clipTargets.every((l) => l.clip);
  const canClip = clipped || (single ? !!zone && zone.orderedLayerIds.indexOf(single.id) > 0 : layers.length > 1);

  const sections: Item[][] = layers.length
    ? [
        [
          ...(single?.content.kind === 'text'
            ? [{ label: 'Edit text', icon: <Pencil size={15} />, shortcut: 'Enter', run: () => window.dispatchEvent(new CustomEvent('wovexa:edit-layer', { detail: { layerId: single.id } })) }]
            : []),
          ...(single?.content.kind === 'image' ? [{ label: 'Crop…', icon: <Crop size={15} />, run: () => openCrop('crop') }] : []),
          { label: 'Duplicate', icon: <Copy size={15} />, shortcut: 'Ctrl+D', run: duplicateSelection },
          { label: 'Delete', icon: <Trash2 size={15} />, shortcut: 'Del', run: deleteSelection },
        ],
        [
          { label: 'Bring forward', icon: <BringToFront size={15} />, shortcut: ']', run: () => moveSelectionInStack(1) },
          { label: 'Send backward', icon: <SendToBack size={15} />, shortcut: '[', run: () => moveSelectionInStack(-1) },
          { label: 'Bring to front', icon: <ArrowUpToLine size={15} />, run: () => dispatch(cmd.reorderLayer(zoneId, layers[0].id, Number.MAX_SAFE_INTEGER)) },
          { label: 'Send to back', icon: <ArrowDownToLine size={15} />, run: () => dispatch(cmd.reorderLayer(zoneId, layers[0].id, 0)) },
        ],
        [
          ...(oneGroup
            ? [{ label: 'Ungroup', icon: <Ungroup size={15} />, shortcut: 'Ctrl+Shift+G', run: ungroupSelection }]
            : layers.length > 1
              ? [{ label: 'Group', icon: <Group size={15} />, shortcut: 'Ctrl+G', run: groupSelection }]
              : []),
          ...(canClip ? [{ label: clipped ? 'Release clipping' : layers.length > 1 ? 'Clip into lowest layer' : 'Clip to layer below', icon: <CornerLeftDown size={15} />, shortcut: 'Ctrl+Alt+G', run: () => clipSelection(!clipped) }] : []),
          { label: 'Centre on print area', icon: <AlignCenter size={15} />, run: () => (alignSelection('hcenter'), alignSelection('vcenter')) },
          {
            label: allLocked ? 'Unlock' : 'Lock',
            icon: allLocked ? <Unlock size={15} /> : <Lock size={15} />,
            run: () => layers.forEach((l) => dispatch(cmd.updateLayer(zoneId, l.id, { locked: !allLocked }, allLocked ? 'Unlock layer' : 'Lock layer'))),
          },
          { label: 'Hide', icon: <Eye size={15} />, run: () => layers.forEach((l) => dispatch(cmd.updateLayer(zoneId, l.id, { visible: false }, 'Hide layer'))) },
          { label: 'Zoom to selection', icon: <Focus size={15} />, shortcut: 'Shift+2', run: zoomToSelection },
        ],
      ]
    : [
        [
          { label: 'Add text', icon: <Type size={15} />, shortcut: 'T', run: () => addText() },
          // Opened from the click handler below, so the picker runs inside the user gesture.
          { label: 'Add image…', icon: <ImageIcon size={15} />, run: () => {} },
          { label: 'Add rectangle', icon: <Square size={15} />, run: () => addShape('rect') },
        ],
        [
          { label: 'Select all', icon: <MousePointerSquareDashed size={15} />, shortcut: 'Ctrl+A', run: selectAll },
          { label: 'Fit print area', icon: <Maximize size={15} />, shortcut: 'Shift+1', run: () => window.dispatchEvent(new CustomEvent('wovexa:fit')) },
        ],
      ];

  const count = sections.reduce((n, s) => n + s.length, 0);
  // Keep the menu inside the viewport.
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - count * ITEM_HEIGHT - sections.length * 9 - 16));

  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label="Layer actions"
        className="fixed z-[80] rounded-xl border border-line bg-floating p-1 shadow-2xl"
        style={{ left, top, width: MENU_WIDTH }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {sections.map((section, i) => (
          <div key={i} role="group" className={i ? 'mt-1 border-t border-line pt-1' : ''}>
            {section.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm hover:bg-hover focus:bg-hover focus:outline-none"
                onClick={() => {
                  // Let the file picker open from this click before the menu unmounts.
                  if (item.label === 'Add image…') fileRef.current?.click();
                  else {
                    close(true);
                    item.run();
                  }
                }}
              >
                <span className="text-fg-2">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.shortcut ? <kbd className="font-sans text-[11px] text-fg-3">{item.shortcut}</kbd> : null}
              </button>
            ))}
          </div>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.length) void addImages(e.target.files);
          close(true);
        }}
      />
    </>
  );
}
