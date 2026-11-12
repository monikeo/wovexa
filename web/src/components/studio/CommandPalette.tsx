'use client';
/**
 * Command palette (Ctrl+K, ⌘K on a Mac, or the search button in the top bar): every studio action
 * by name. It lists what makes sense right now (selection actions only with something selected),
 * puts recent picks first, shows a colourway on the 3D garment while it is highlighted, and works
 * by keyboard, mouse or touch.
 */
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Box,
  BringToFront,
  Brush,
  Camera,
  Check,
  Circle,
  CircleDashed,
  Clapperboard,
  ClipboardPaste,
  Columns2,
  Component,
  Copy,
  CopyPlus,
  CornerLeftDown,
  Crop,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FileText,
  FlipHorizontal2,
  FlipVertical2,
  Focus,
  FolderOpen,
  GitCompare,
  Grid3x3,
  Grip,
  Group,
  Heart,
  Hexagon,
  History,
  Home,
  Image as ImageIcon,
  Images,
  Keyboard,
  Layers,
  Layers2,
  LayoutTemplate,
  Link2Off,
  ListChecks,
  Lock,
  LockOpen,
  Maximize,
  Minus,
  Moon,
  Move,
  Orbit,
  PaintBucket,
  Palette,
  Pencil,
  PenTool,
  Redo2,
  RotateCw,
  Rows3,
  Ruler,
  Save,
  Scissors,
  Search,
  SendToBack,
  Settings,
  Share2,
  Shirt,
  Sparkles,
  Spline,
  Shapes,
  Square,
  SquareDashed,
  SquaresExclude,
  SquaresIntersect,
  SquaresSubtract,
  SquaresUnite,
  Star,
  Sticker,
  Sun,
  SunDim,
  SunMoon,
  SwatchBook,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Ungroup,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { selectionUnits, type AlignMode } from '@/domain/arrange';
import { artboardOf, artboardSpec, designAreas } from '@/domain/areas';
import { searchCommands, type Searchable } from '@/domain/command-search';
import * as cmd from '@/domain/commands';
import { defaultExtrude } from '@/domain/extrude';
import { GARMENT_LIST, getGarment, partColor, sizeLabel } from '@/domain/garments';
import { GRAPHICS } from '@/domain/graphics';
import { lockupsOf } from '@/domain/lockups';
import { DRAPES, drapeOf, MOTIONS, motionOf, SCENE_PRESETS, sceneOf, STAGES, stageOf, toneOf, TONES } from '@/domain/scene';
import { MAX_SHELL_TRIANGLES, type LibraryModel } from '@/domain/model-library';
import { isAreaId, isLockupId, type AreaId, type ArtboardId, type DesignDocument, type LockupContent, type ShapeContent } from '@/domain/schema';
import { ACCEPTED_TYPES } from '@/lib/assets';
import { loadModelLibrary } from '@/lib/model-library';
import { setPreference, usePreference, type Preferences } from '@/lib/preferences';
import { toast, type LayoutMode } from '@/components/ui/primitives';
import { useLive, useStudio, type ViewMode } from '@/stores/studio-store';
import {
  addGraphic,
  addImages,
  addShape,
  addText,
  alignSelection,
  clearEffects,
  clipSelection,
  combineSelection,
  COMBINE_LABELS,
  copiedLayerCount,
  copySelection,
  deleteSelection,
  detachLockup,
  distributeSelection,
  duplicateSelection,
  editLockup,
  editPoints,
  hasEditablePoints,
  finishLockupEdit,
  flipSelection,
  groupSelection,
  makeLockupFromSelection,
  moveSelectionInStack,
  openCrop,
  openTrace,
  outlineOnlySelection,
  pasteLayers,
  placeLockup,
  placementsFor,
  placeSelection,
  putTextOnShape,
  repeatSelection,
  rotateSelection,
  setSelectionFlag,
  shadowSelection,
  startFreehand,
  startPen,
  outlineStroke,
  svgToShapes,
  startTextOnPath,
  styleSelection,
  switchArtboard,
  ungroupSelection,
  zoomToSelection,
} from './actions';
import { addDesignArea, bringAreaToView, deleteDesignArea, duplicateDesignArea } from './area-actions';
import { showColorwayIdeas } from './ColorwayIdeas';
import { chooseGarmentStyle, wearModel } from './GarmentPanel';
import { deleteProjection, duplicateProjection, moveProjectionBy, returnProjectionToZone, wrapSelectionAcrossSeams } from './projection-actions';
import { VIEW_PRESETS, viewerApi, type ViewPreset } from './viewer3d/stage';

/** Open the palette from anywhere: the top bar, the project menu, Ctrl+K. */
export const openCommandPalette = () => window.dispatchEvent(new CustomEvent('wovexa:palette'));

const noSubscribe = () => () => {};
/** The key that goes with K: ⌘ on Apple devices, Ctrl elsewhere (Ctrl while rendering on the server). */
export function useModKey() {
  return useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'),
    () => 'Ctrl',
  );
}

type Section = 'Selection' | 'Lockups' | 'Design area' | 'Add' | 'Go to' | 'View' | 'Garment' | 'Export' | 'Project' | 'Pages';
const SECTION_ORDER: Section[] = ['Selection', 'Lockups', 'Design area', 'Add', 'Go to', 'View', 'Garment', 'Export', 'Project', 'Pages'];

interface PaletteCommand extends Searchable {
  /** Stable across visits, for the recent list. */
  id: string;
  section: Section;
  icon: LucideIcon;
  /** Drawn in place of the icon: a graphic's outline, or a colourway's colour. */
  glyph?: { path: string } | { swatch: string };
  /** Its shortcut, keys joined by + ("Mod+D"). */
  keys?: string;
  /** Quiet words after the name: what Undo takes back, how many layers a zone has. */
  note?: string;
  /** Listed only when searching: long families such as graphics, models and sizes. */
  searchOnly?: boolean;
  /** A colourway shown on the 3D garment while this row is highlighted. */
  previewColorway?: string;
  run: () => void;
}

const SHAPES: { shape: ShapeContent['shape']; label: string; icon: LucideIcon; keywords: string }[] = [
  { shape: 'rect', label: 'Rectangle', icon: Square, keywords: 'box square rect block' },
  { shape: 'ellipse', label: 'Ellipse', icon: Circle, keywords: 'circle oval round dot' },
  { shape: 'triangle', label: 'Triangle', icon: Triangle, keywords: 'arrow point' },
  { shape: 'star', label: 'Star', icon: Star, keywords: 'badge' },
  { shape: 'polygon', label: 'Hexagon', icon: Hexagon, keywords: 'polygon six sides' },
  { shape: 'heart', label: 'Heart', icon: Heart, keywords: 'love' },
  { shape: 'line', label: 'Line', icon: Minus, keywords: 'rule stroke divider stripe' },
];

const ALIGN: { mode: AlignMode; label: string; icon: LucideIcon }[] = [
  { mode: 'left', label: 'Align left', icon: AlignStartVertical },
  { mode: 'hcenter', label: 'Centre horizontally', icon: AlignCenterVertical },
  { mode: 'right', label: 'Align right', icon: AlignEndVertical },
  { mode: 'top', label: 'Align top', icon: AlignStartHorizontal },
  { mode: 'vcenter', label: 'Centre vertically', icon: AlignCenterHorizontal },
  { mode: 'bottom', label: 'Align bottom', icon: AlignEndHorizontal },
];

const PAGES: { href: string; label: string; icon: LucideIcon; keywords: string }[] = [
  { href: '/dashboard', label: 'Home', icon: Home, keywords: 'dashboard start leave studio' },
  { href: '/projects', label: 'Projects', icon: FolderOpen, keywords: 'designs open another leave studio' },
  { href: '/assets', label: 'Assets', icon: Images, keywords: 'images uploads logos files' },
  { href: '/templates', label: 'Templates', icon: LayoutTemplate, keywords: 'starters' },
  { href: '/brands', label: 'Brand kits', icon: Palette, keywords: 'brand colours fonts logos' },
  { href: '/exports', label: 'Exports', icon: Share2, keywords: 'export history downloads files made' },
  { href: '/settings', label: 'Settings', icon: Settings, keywords: 'preferences account' },
];

/** The views shown without searching; the rest are a search away. */
const MAIN_VIEWS: ViewPreset[] = ['front', 'back', 'three_quarter'];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Context {
  doc: DesignDocument;
  activeZoneId: ArtboardId;
  selectedIds: string[];
  projectionId: string | null;
  viewMode: ViewMode;
  undoLabel?: string;
  redoLabel?: string;
  projectId: string | null;
  mode: LayoutMode;
  /** Whether the stage has room for split view (1024 px and wider). */
  wide: boolean;
  library: LibraryModel[];
  theme: Preferences['theme'];
  units: Preferences['units'];
  seamGuides: Preferences['seamGuides'];
  copied: number;
  mod: string;
  go: (href: string) => void;
  pickImage: () => void;
  openChecks: () => void;
}

/** Turn the 3D view to a preset, showing the 3D view first when only the 2D artboard is open. */
function showView(view: ViewPreset, threeShown: boolean, c: Context) {
  if (!threeShown) useStudio.getState().setViewMode(c.mode !== 'mobile' && c.wide ? 'split' : '3d');
  let tries = 0;
  const fly = () => {
    if (viewerApi.flyTo) viewerApi.flyTo({ kind: 'preset', view });
    else if (++tries < 60) setTimeout(fly, 100);
  };
  // A 3D view that is just opening frames the zone first; turn it once it is there.
  if (threeShown) fly();
  else setTimeout(fly, 150);
}

/** Copy or cut the selection: WOVEXA keeps the layers, the system clipboard their words. */
function copyLayers(cut: boolean, mod: string) {
  const text = copySelection(cut);
  if (text === null) return;
  void navigator.clipboard?.writeText(text).catch(() => {});
  const n = copiedLayerCount();
  toast(`${cut ? 'Cut' : 'Copied'} ${plural(n, 'layer')}. Paste into any print area or design area with ${mod}+V.`);
}

/** Every command that makes sense now, in section order, with the titles of the sections that need one. */
function buildCommands(c: Context): { commands: PaletteCommand[]; titles: Partial<Record<Section, string>> } {
  const s = useStudio.getState;
  const { doc, activeZoneId } = c;
  const model = getGarment(doc.garment.modelId);
  const zone = artboardOf(doc, activeZoneId);
  const commands: PaletteCommand[] = [];
  const titles: Partial<Record<Section, string>> = {};
  const add = (section: Section, list: Omit<PaletteCommand, 'section'>[]) => commands.push(...list.map((x) => ({ ...x, section })));
  const mobile = c.mode === 'mobile';
  const threeShown = mobile ? c.viewMode !== '2d' : c.viewMode === '3d' || (c.viewMode === 'split' && c.wide);
  const twoShown = mobile ? c.viewMode === '2d' : c.viewMode !== '3d';
  const area = isAreaId(activeZoneId) ? doc.areas?.items[activeZoneId] : undefined;

  // ---- What is selected ----
  const layers = zone ? c.selectedIds.map((id) => zone.layers[id]).filter(Boolean) : [];
  if (zone && layers.length) {
    titles.Selection = `Selected: ${layers.length === 1 ? layers[0].name : plural(layers.length, 'layer')}`;
    const units = selectionUnits(zone, c.selectedIds).length;
    const groups = new Set(layers.map((l) => l.groupId ?? `solo:${l.id}`));
    // One layer clips to the one under it; several clip to the lowest of them.
    const lowest = zone.orderedLayerIds.find((id) => c.selectedIds.includes(id));
    const clipTargets = layers.length > 1 ? layers.filter((l) => l.id !== lowest) : layers;
    const clipped = clipTargets.length > 0 && clipTargets.every((l) => l.clip);
    const canClip = clipped || layers.length > 1 || zone.orderedLayerIds.indexOf(layers[0].id) > 0;
    add('Selection', [
      { id: 'sel-duplicate', label: 'Duplicate', keywords: 'copy clone again repeat', icon: CopyPlus, keys: 'Mod+D', run: duplicateSelection },
      { id: 'sel-copy', label: 'Copy', keywords: 'clipboard', icon: Copy, keys: 'Mod+C', run: () => copyLayers(false, c.mod) },
      { id: 'sel-cut', label: 'Cut', keywords: 'clipboard move', icon: Scissors, keys: 'Mod+X', run: () => copyLayers(true, c.mod) },
      { id: 'sel-delete', label: 'Delete', keywords: 'remove erase trash', icon: Trash2, keys: 'Del', run: deleteSelection },
      { id: 'sel-forward', label: 'Bring forward', keywords: 'up raise order stack front arrange', icon: BringToFront, keys: ']', run: () => moveSelectionInStack(1) },
      { id: 'sel-backward', label: 'Send backward', keywords: 'down lower order stack back arrange', icon: SendToBack, keys: '[', run: () => moveSelectionInStack(-1) },
      ...(layers.length > 1 && groups.size > 1 ? [{ id: 'sel-group', label: 'Group', keywords: 'combine join together', icon: Group, keys: 'Mod+G', run: groupSelection }] : []),
      ...(layers.some((l) => l.groupId) ? [{ id: 'sel-ungroup', label: 'Ungroup', keywords: 'split apart separate', icon: Ungroup, keys: 'Mod+Shift+G', run: ungroupSelection }] : []),
      ...(canClip
        ? [
            clipped
              ? { id: 'sel-unclip', label: 'Release clipping', keywords: 'unclip clipping mask free', icon: CornerLeftDown, keys: 'Mod+Alt+G', run: () => clipSelection(false) }
              : { id: 'sel-clip', label: layers.length > 1 ? 'Clip into lowest layer' : 'Clip to layer below', keywords: 'clipping mask inside fill photo in text lettering knockout frame', icon: CornerLeftDown, keys: 'Mod+Alt+G', run: () => clipSelection(true) },
          ]
        : []),
      ...(layers.length > 1
        ? ([
            ['union', SquaresUnite, 'merge join add weld boolean pathfinder'],
            ['subtract', SquaresSubtract, 'minus cut out knock out punch hole boolean pathfinder'],
            ['intersect', SquaresIntersect, 'overlap common boolean pathfinder'],
            ['exclude', SquaresExclude, 'xor difference boolean pathfinder'],
          ] as const).map(([op, icon, keywords]) => ({ id: `combine-${op}`, label: COMBINE_LABELS[op], keywords: `combine shapes ${keywords}`, icon, run: () => void combineSelection(op) }))
        : []),
      ...(layers.length === 1 && layers[0].content.kind === 'shape' && !layers[0].locked
        ? [{ id: 'shape-points', label: 'Edit points', keywords: 'nodes anchors handles path bezier curve reshape vector pen', icon: Spline, run: editPoints }]
        : []),
      ...(layers.length === 1 && layers[0].content.kind === 'text' && hasEditablePoints(layers[0])
        ? [{ id: 'text-path-points', label: 'Edit the line the text follows', keywords: 'text on a path points nodes handles reshape curve bend line edit path', icon: Spline, run: editPoints }]
        : []),
      ...(layers.length === 1 && layers[0].content.kind === 'text' && !layers[0].locked && !layers[0].content.value.includes('\n')
        ? [{ id: 'text-path', label: 'Put text along a line you draw', keywords: 'text on a path curve arc follow line pen type along', icon: Spline, run: () => startTextOnPath(layers[0].id) }]
        : []),
      ...(!isLockupId(activeZoneId) && layers.every((l) => l.content.kind !== 'lockup' && !l.locked)
        ? [{ id: 'sel-lockup', label: 'Make a lockup', keywords: 'component symbol reuse reusable logo crest master instance linked edit once everywhere', icon: Component, run: makeLockupFromSelection }]
        : []),
      ...(layers.length === 1 && layers[0].content.kind === 'lockup'
        ? [
            { id: 'lockup-edit', label: `Edit lockup ${layers[0].content.name}`, keywords: 'component symbol master open board change everywhere', icon: Component, run: () => editLockup((layers[0].content as LockupContent).lockupId) },
            ...(!layers[0].locked ? [{ id: 'lockup-detach', label: 'Detach from lockup', keywords: 'component symbol unlink break apart separate layers', icon: Link2Off, run: detachLockup }] : []),
          ]
        : []),
      ...(layers.length === 2 && layers.some((l) => l.content.kind === 'shape') && layers.some((l) => l.content.kind === 'text' && !l.locked && !l.content.value.includes('\n'))
        ? [{ id: 'text-on-shape', label: 'Put the text on the shape’s outline', keywords: 'text on a path circle badge round around outline curve arc follow', icon: Spline, run: putTextOnShape }]
        : []),
      ...(layers.length === 1 && layers[0].content.kind === 'image'
        ? [
            { id: 'img-crop', label: 'Crop image', keywords: 'trim cut photo picture aspect square portrait', icon: Crop, run: () => openCrop('crop') },
            { id: 'img-frame', label: 'Move photo in frame', keywords: 'reframe pan zoom mask shape circle badge position inside', icon: Move, run: () => openCrop('frame') },
            ...(!layers[0].locked ? [{ id: 'img-trace', label: 'Trace image to vector shapes', keywords: 'vectorize vectorise trace convert svg logo shapes paths redraw colours outline', icon: Shapes, run: openTrace }] : []),
            ...(!layers[0].locked && layers[0].content.kind === 'image' && layers[0].content.mime === 'image/svg+xml'
              ? [{ id: 'img-svg-shapes', label: 'Make the SVG editable shapes', keywords: 'svg vector import paths edit points recolour ungroup expand illustrator', icon: Spline, run: () => void svgToShapes() }]
              : []),
          ]
        : []),
      { id: 'sel-flip-x', label: 'Flip horizontally', keywords: 'mirror reverse left right', icon: FlipHorizontal2, run: () => flipSelection('x') },
      { id: 'sel-flip-y', label: 'Flip vertically', keywords: 'mirror upside down', icon: FlipVertical2, run: () => flipSelection('y') },
      { id: 'sel-rotate', label: 'Rotate 90°', keywords: 'turn clockwise quarter', icon: RotateCw, run: () => rotateSelection(90) },
      ...(layers.some((l) => !l.locked)
        ? [{ id: 'sel-lock', label: 'Lock', keywords: 'freeze protect fix', icon: Lock, run: () => setSelectionFlag('locked', true) }]
        : [{ id: 'sel-unlock', label: 'Unlock', keywords: 'free edit', icon: LockOpen, run: () => setSelectionFlag('locked', false) }]),
      ...(layers.some((l) => l.visible)
        ? [{ id: 'sel-hide', label: 'Hide', keywords: 'invisible off', icon: EyeOff, run: () => setSelectionFlag('visible', false) }]
        : [{ id: 'sel-show', label: 'Show', keywords: 'visible on', icon: Eye, run: () => setSelectionFlag('visible', true) }]),
      ...(twoShown ? [{ id: 'sel-zoom', label: 'Zoom to selection', keywords: 'focus magnify close', icon: ZoomIn, keys: 'Shift+2', run: zoomToSelection }] : []),
      ...(!area ? [{ id: 'sel-wrap', label: 'Wrap across seams', keywords: 'garment 3d projection seam all over sublimation cut sew', icon: Spline, run: wrapSelectionAcrossSeams }] : []),
      // Effects, all of them printed.
      { id: 'fx-shadow', label: 'Drop shadow', keywords: 'effect shadow depth 3d', icon: Layers2, searchOnly: true, run: () => shadowSelection({ color: '#000000', offsetXmm: 1.5, offsetYmm: 2, blurMm: 1.5 }, 'Drop shadow') },
      {
        id: 'fx-glow',
        label: 'Glow',
        keywords: 'effect neon light halo shadow',
        icon: SunDim,
        searchOnly: true,
        run: () => {
          const c = layers[0].content;
          shadowSelection({ color: c.kind === 'text' || c.kind === 'shape' ? c.fill : '#FFFFFF', offsetXmm: 0, offsetYmm: 0, blurMm: 4 }, 'Glow');
        },
      },
      { id: 'fx-sticker', label: 'Sticker outline', keywords: 'effect border die cut contour double outline badge patch', icon: Sticker, searchOnly: true, run: () => styleSelection({ outline: { color: '#FFFFFF', widthMm: 3 } }, 'Sticker outline') },
      {
        id: 'fx-halftone',
        label: 'Halftone',
        keywords: 'effect dots screen print pop art comic retro',
        icon: Grip,
        searchOnly: true,
        run: () => styleSelection({ halftone: { cellMm: 1.5, angleDeg: 45, shape: 'dot', by: layers[0].content.kind === 'image' ? 'tone' : 'fade' } }, 'Halftone'),
      },
      { id: 'fx-extrude', label: '3D extrude', keywords: 'effect extrusion depth block retro 3d text letters solid', icon: Box, searchOnly: true, run: () => styleSelection({ extrude: defaultExtrude(layers[0]) }, '3D extrude') },
      ...(layers.some((l) => l.content.kind === 'text' || l.content.kind === 'shape')
        ? [
            layers.every((l) => (l.content.kind !== 'text' && l.content.kind !== 'shape') || l.content.hollow)
              ? { id: 'fx-filled', label: 'Filled', keywords: 'fill solid', icon: PaintBucket, searchOnly: true, run: () => outlineOnlySelection(false) }
              : { id: 'fx-hollow', label: 'Outline only', keywords: 'hollow lines stroke no fill', icon: CircleDashed, searchOnly: true, run: () => outlineOnlySelection(true) },
          ]
        : []),
      ...(layers.some((l) => l.content.kind === 'shape' && l.content.hollow)
        ? [{ id: 'outline-stroke', label: 'Outline stroke', keywords: 'expand stroke line into shape fill convert pencil cutter', icon: SquaresUnite, searchOnly: true, run: () => void outlineStroke() }]
        : []),
      ...(layers.some((l) => l.style.shadow || l.style.outline || l.style.halftone || l.style.extrude || (l.content.kind === 'text' && l.content.shadow))
        ? [{ id: 'fx-clear', label: 'Remove effects', keywords: 'clear plain shadow glow outline halftone extrude 3d', icon: Eraser, searchOnly: true, run: clearEffects }]
        : []),
      // Step and repeat.
      ...(layers.length === 1
        ? [
            {
              id: 'copies-circle',
              label: 'Copies round a circle',
              keywords: 'repeat radial ring step array duplicate',
              icon: Orbit,
              searchOnly: true,
              run: () => repeatSelection({ mode: 'circle', count: 6, gapMm: 5, radiusMm: Math.round(Math.max(20, Math.max(layers[0].transform.widthMm, layers[0].transform.heightMm) * 1.3)), turn: true }),
            },
            { id: 'copies-row', label: 'Copies in a row', keywords: 'repeat step array duplicate line', icon: Rows3, searchOnly: true, run: () => repeatSelection({ mode: 'row', count: 3, gapMm: 5, radiusMm: 0, turn: false }) },
            { id: 'copies-grid', label: 'Copies in a grid', keywords: 'repeat step array duplicate tile', icon: Grid3x3, searchOnly: true, run: () => repeatSelection({ mode: 'grid', count: 4, gapMm: 5, radiusMm: 0, turn: false }) },
          ]
        : []),
      ...ALIGN.map((a) => ({ id: `align:${a.mode}`, label: a.label, note: units === 1 ? 'on the print area' : undefined, keywords: 'align arrange line up position', icon: a.icon, searchOnly: true, run: () => alignSelection(a.mode) })),
      ...(units >= 3
        ? [
            { id: 'distribute:h', label: 'Distribute horizontally', keywords: 'space evenly spread arrange', icon: AlignHorizontalDistributeCenter, searchOnly: true, run: () => distributeSelection('horizontal') },
            { id: 'distribute:v', label: 'Distribute vertically', keywords: 'space evenly spread arrange', icon: AlignVerticalDistributeCenter, searchOnly: true, run: () => distributeSelection('vertical') },
          ]
        : []),
      ...placementsFor(artboardSpec(model, doc, activeZoneId)).map((p) => ({
        id: `place:${p.id}`,
        label: `Place: ${p.label}`,
        keywords: 'placement position standard fit move put',
        icon: Focus,
        searchOnly: true,
        run: () => placeSelection(p),
      })),
    ]);
  } else if (c.projectionId && doc.projections.layers[c.projectionId]) {
    const id = c.projectionId;
    titles.Selection = `Selected: ${doc.projections.layers[id].name}, across seams`;
    add('Selection', [
      { id: 'proj-duplicate', label: 'Duplicate', keywords: 'copy clone again', icon: CopyPlus, keys: 'Mod+D', run: () => duplicateProjection(id) },
      { id: 'proj-delete', label: 'Delete', keywords: 'remove erase trash', icon: Trash2, keys: 'Del', run: () => deleteProjection(id) },
      { id: 'proj-forward', label: 'Bring forward', keywords: 'up raise order stack', icon: BringToFront, keys: ']', run: () => moveProjectionBy(id, 1) },
      { id: 'proj-backward', label: 'Send backward', keywords: 'down lower order stack', icon: SendToBack, keys: '[', run: () => moveProjectionBy(id, -1) },
      { id: 'proj-return', label: 'Back onto the print zone', keywords: 'unwrap flat return zone dtg screen', icon: Square, run: () => returnProjectionToZone(id) },
    ]);
  }

  // ---- Lockups: place one, open one, or finish editing ----
  const lockups = lockupsOf(doc);
  if (lockups.length) {
    add('Lockups', [
      ...(isLockupId(activeZoneId) ? [{ id: 'lockup-done', label: 'Done editing the lockup', keywords: 'finish close back component symbol', icon: Check, run: finishLockupEdit }] : []),
      ...(!isLockupId(activeZoneId) ? lockups.map((l) => ({ id: `lockup-place:${l.id}`, label: `Place lockup ${l.name}`, keywords: 'component symbol add reuse logo crest instance', icon: Component, run: () => placeLockup(l.id) })) : []),
      ...lockups.filter((l) => l.id !== activeZoneId).map((l) => ({ id: `lockup-open:${l.id}`, label: `Edit lockup ${l.name}`, keywords: 'component symbol master open board change everywhere', icon: Component, searchOnly: true, run: () => editLockup(l.id) })),
    ]);
  }

  // ---- The design area being designed on ----
  if (area) {
    titles['Design area'] = area.name;
    add('Design area', [
      ...(threeShown ? [{ id: 'area-view', label: `Bring ${area.name} to view`, keywords: 'design area centre find here move camera', icon: Focus, run: () => bringAreaToView(area.id) }] : []),
      { id: 'area-duplicate', label: `Duplicate ${area.name}`, keywords: 'design area copy clone', icon: CopyPlus, run: () => duplicateDesignArea(area.id) },
      { id: 'area-delete', label: `Delete ${area.name}`, keywords: 'design area remove', icon: Trash2, run: () => deleteDesignArea(area.id) },
    ]);
  }

  // ---- Add ----
  add('Add', [
    { id: 'add-text', label: 'Add text', keywords: 'type words letters name number font title', icon: Type, keys: 'T', run: () => addText() },
    { id: 'add-image', label: 'Add an image', keywords: 'photo picture upload logo file png jpg svg webp', icon: ImageIcon, run: c.pickImage },
    ...SHAPES.map((x) => ({ id: `shape:${x.shape}`, label: `Add ${x.label.toLowerCase()}`, keywords: `shape ${x.keywords}`, icon: x.icon, run: () => addShape(x.shape) })),
    { id: 'add-pen', label: 'Draw your own shape', keywords: 'pen path vector bezier custom freeform outline', icon: PenTool, keys: 'P', run: startPen },
    { id: 'add-pencil', label: 'Pencil: draw freehand', keywords: 'freehand sketch line hand drawn scribble draw', icon: Pencil, keys: 'N', run: () => startFreehand('pencil') },
    { id: 'add-brush', label: 'Brush: paint strokes', keywords: 'freehand paint ink marker calligraphy stroke stylus pressure', icon: Brush, keys: 'B', run: () => startFreehand('brush') },
    { id: 'add-text-path', label: 'Add text on a path', keywords: 'type along line curve arc follow drawn path pen words', icon: Spline, run: () => startTextOnPath() },
    { id: 'add-area', label: 'Add a design area', keywords: 'new zone box anywhere hood panel seam artboard print area', icon: SquareDashed, run: addDesignArea },
    ...(c.copied ? [{ id: 'paste', label: `Paste ${plural(c.copied, 'layer')}`, keywords: 'clipboard', icon: ClipboardPaste, keys: 'Mod+V', run: () => void pasteLayers() }] : []),
    ...GRAPHICS.map((g) => ({
      id: `graphic:${g.id}`,
      label: `Graphic: ${g.name}`,
      keywords: `add graphic icon symbol clipart mark ${g.category}`,
      icon: Shirt,
      glyph: { path: g.path },
      searchOnly: true,
      run: () => addGraphic(g),
    })),
  ]);

  // ---- Go to: print zones and design areas ----
  add('Go to', [
    ...model.zoneOrder
      .filter((z) => z !== activeZoneId)
      .map((z) => {
        const n = doc.zones[z].orderedLayerIds.length;
        return { id: `zone:${z}`, label: model.zones[z]?.label ?? z, note: n ? plural(n, 'layer') : undefined, keywords: 'go to print zone area artboard side switch', icon: Square, run: () => s().setActiveZone(z) };
      }),
    ...designAreas(doc)
      .filter((a) => a.id !== activeZoneId)
      .map((a) => {
        const n = a.orderedLayerIds.length;
        return { id: `area:${a.id}`, label: a.name, note: n ? plural(n, 'layer') : 'design area', keywords: 'go to design area box artboard switch', icon: SquareDashed, run: () => s().setActiveZone(a.id as AreaId) };
      }),
    { id: 'zone-next', label: 'Next print area', keywords: 'zone forward switch', icon: Square, keys: 'PageDown', searchOnly: true, run: () => switchArtboard(1) },
    { id: 'zone-previous', label: 'Previous print area', keywords: 'zone back switch', icon: Square, keys: 'PageUp', searchOnly: true, run: () => switchArtboard(-1) },
    ...(c.mode !== 'desktop' ? [{ id: 'layers', label: 'Layers', keywords: 'stack list order panel', icon: Layers, run: () => (mobile ? s().setMobileSheet('layers') : s().setLayersOpen(true)) }] : []),
  ]);

  // ---- View ----
  const modes: { mode: ViewMode; label: string; icon: LucideIcon; keywords: string }[] = [
    { mode: '2d', label: 'Show the 2D artboard', icon: Square, keywords: 'view flat editor canvas 2d' },
    { mode: 'split', label: 'Show 2D and 3D side by side', icon: Columns2, keywords: 'view split both 2d 3d' },
    { mode: '3d', label: 'Show the 3D garment', icon: Box, keywords: 'view model preview 3d' },
  ];
  const current: ViewMode = mobile ? (c.viewMode === '2d' ? '2d' : '3d') : c.viewMode === 'split' && !c.wide ? '2d' : c.viewMode;
  const scene = sceneOf(doc);
  const setScene = (patch: Parameters<typeof cmd.updateScene>[1], label: string) => s().dispatch(cmd.updateScene(scene, patch, label));
  // A GLB shell keeps its own modelled folds.
  const ownFolds = doc.garment.shape?.kind === 'shell' && doc.garment.shape.modelId === doc.garment.modelId;
  add('View', [
    ...modes
      .filter((m) => m.mode !== current && (m.mode !== 'split' || (!mobile && c.wide)))
      .map((m) => ({ id: `view:${m.mode}`, label: m.label, keywords: m.keywords, icon: m.icon, run: () => s().setViewMode(m.mode) })),
    ...(twoShown ? [{ id: 'fit', label: 'Fit the print area', keywords: 'zoom reset whole view', icon: Maximize, keys: 'Shift+1', run: () => window.dispatchEvent(new CustomEvent('wovexa:fit')) }] : []),
    ...(zone
      ? [
          {
            id: 'guides-centre',
            label: 'Add centre guides',
            keywords: 'ruler guide line middle centre center snap align',
            icon: Ruler,
            searchOnly: true,
            run: () => {
              const spec = artboardSpec(model, doc, activeZoneId);
              const g = zone.guides ?? { x: [], y: [] };
              s().dispatch(cmd.setGuides(activeZoneId, { x: [...g.x.filter((x) => x !== spec.printableWidthMm / 2), spec.printableWidthMm / 2], y: [...g.y.filter((y) => y !== spec.printableHeightMm / 2), spec.printableHeightMm / 2] }, 'Add centre guides'));
            },
          },
          ...(zone.guides ? [{ id: 'guides-clear', label: 'Clear guides', keywords: 'ruler guide lines remove delete', icon: Ruler, searchOnly: true, run: () => s().dispatch(cmd.setGuides(activeZoneId, undefined, 'Clear guides')) }] : []),
        ]
      : []),
    ...(!area
      ? [
          {
            id: 'seam-guides',
            label: c.seamGuides === 'on' ? 'Hide seam clearance' : 'Show seam clearance',
            keywords: 'seams edges collar side hem keep away print safe margin',
            icon: Shirt,
            searchOnly: true,
            run: () => setPreference('seamGuides', c.seamGuides === 'on' ? 'off' : 'on'),
          },
        ]
      : []),
    ...(Object.keys(VIEW_PRESETS) as ViewPreset[]).map((v) => ({
      id: `camera:${v}`,
      label: `${VIEW_PRESETS[v].long} view`,
      keywords: '3d camera angle look turn orbit',
      icon: Camera,
      searchOnly: !MAIN_VIEWS.includes(v),
      run: () => showView(v, threeShown, c),
    })),
    // The 3D scene by name: lighting looks, colour tone, motion, drape and the floor shadow.
    ...SCENE_PRESETS.filter((p) => p.id !== scene.presetId).map((p) => ({
      id: `look:${p.id}`,
      label: `Lighting: ${p.label}`,
      keywords: `3d scene look light mood backdrop studio ${p.id}`,
      icon: Sun,
      searchOnly: true,
      run: () => setScene({ presetId: p.id, ...p.defaults }, `Scene: ${p.label}`),
    })),
    ...TONES.filter((t) => t.id !== toneOf(scene)).map((t) => ({ id: `tone:${t.id}`, label: `Colour: ${t.label}`, keywords: '3d tone mapping grade film colour color', icon: Palette, searchOnly: true, run: () => setScene({ tone: t.id }, `Tone: ${t.label.toLowerCase()}`) })),
    ...MOTIONS.filter((m) => m.id !== motionOf(scene).kind).map((m) => ({
      id: `motion:${m.id}`,
      label: `Motion: ${m.label}`,
      keywords: '3d animate move animation video',
      icon: Orbit,
      searchOnly: true,
      run: () => setScene({ motion: { ...motionOf(scene), kind: m.id } }, `Motion: ${m.label.toLowerCase()}`),
    })),
    ...(ownFolds ? [] : DRAPES.filter((d) => d.id !== drapeOf(scene))).map((d) => ({ id: `drape:${d.id}`, label: `Drape: ${d.label}`, keywords: '3d folds cloth wrinkles fabric', icon: Shirt, searchOnly: true, run: () => setScene({ drape: d.id }, `Drape: ${d.label.toLowerCase()}`) })),
    ...STAGES.filter((st) => st.id !== stageOf(scene)).map((st) => ({
      id: `stage:${st.id}`,
      label: `Stage: ${st.label}`,
      keywords: '3d scene set podium plinth pedestal display form table flat lay top down wood photo product',
      icon: Box,
      searchOnly: true,
      run: () => setScene({ stage: st.id === 'none' ? undefined : st.id }, `Stage: ${st.label.toLowerCase()}`),
    })),
    {
      id: 'floor-shadow',
      label: scene.shadows ? 'Hide the floor shadow' : 'Show the floor shadow',
      keywords: '3d scene ground contact shadow',
      icon: Layers2,
      searchOnly: true,
      run: () => setScene({ shadows: !scene.shadows }, scene.shadows ? 'Hide floor shadow' : 'Show floor shadow'),
    },
  ]);

  // ---- Garment: colourways first, then style, model, size and fabric ----
  const worn = doc.garment.shape?.kind === 'shell' ? doc.garment.shape.library : undefined;
  const openGarment = () => {
    s().select([]);
    s().selectProjection(null);
    if (c.mode === 'tablet') s().setInspectorOpen(true);
    if (mobile) s().setMobileSheet('garment');
  };
  add('Garment', [
    ...doc.colorways
      .filter((cw) => cw.id !== doc.activeColorwayId)
      .map((cw) => ({
        id: `colourway:${cw.id}`,
        label: `Colourway: ${cw.name}`,
        keywords: 'colourway colour color variant switch',
        icon: Palette,
        glyph: { swatch: partColor(cw, 'body') },
        previewColorway: cw.id,
        run: () => s().dispatch(cmd.setActiveColorway(cw.id)),
      })),
    { id: 'garment', label: 'Garment and colourways', keywords: 'style size fabric colour color print settings change', icon: Shirt, run: openGarment },
    {
      id: 'colourway-ideas',
      label: 'Colourway ideas',
      keywords: 'suggest harmony palette colour color complementary analogous triadic generate new',
      icon: Sparkles,
      run: () => {
        openGarment();
        showColorwayIdeas();
      },
    },
    ...GARMENT_LIST.filter((m) => m.id !== model.id).map((m) => ({
      id: `style:${m.id}`,
      label: `Style: ${m.name}`,
      keywords: `garment style change switch ${m.shortName} ${m.category}`,
      icon: Shirt,
      searchOnly: true,
      run: () => chooseGarmentStyle(m),
    })),
    ...c.library
      .filter((m) => m.triangles <= MAX_SHELL_TRIANGLES && !(worn === m.file && model.id === m.styleId))
      .map((m) => ({
        id: `model:${m.file}`,
        label: `3D model: ${m.name}`,
        keywords: `glb library wear model ${m.category} ${m.folder ?? ''}`,
        icon: Box,
        searchOnly: true,
        run: () => wearModel(m),
      })),
    ...model.sizes
      .filter((z) => z.code !== doc.garment.sizeCode)
      .map((z) => ({ id: `size:${z.code}`, label: `Size: ${sizeLabel(model, z)}`, keywords: 'size fit grade', icon: Ruler, searchOnly: true, run: () => s().dispatch(cmd.setGarmentSize(z.code)) })),
    ...model.fabricPresets
      .filter((f) => f.id !== doc.garment.fabricPresetId)
      .map((f) => ({ id: `fabric:${f.id}`, label: `Fabric: ${f.label}`, keywords: `fabric material cloth weight gsm ${f.surface}`, icon: SwatchBook, searchOnly: true, run: () => s().dispatch(cmd.setFabricPreset(f.id)) })),
  ]);

  // ---- Export ----
  add('Export', [
    { id: 'export', label: 'Export files', keywords: 'download print png pdf svg tiff vector package zip production proof team roster', icon: Download, run: () => (mobile ? s().setMobileSheet('export') : s().setExportOpen(true)) },
    { id: 'render', label: 'Wovexa Render', keywords: 'photo mockup picture image 4k 6k render turntable video shot', icon: Clapperboard, run: () => s().setPanel('render') },
    { id: 'checks', label: 'Print checks', keywords: 'preflight problems errors warnings dpi resolution', icon: ListChecks, run: c.openChecks },
    ...(c.projectId ? [{ id: 'techpack', label: 'Tech pack', keywords: 'production spec sheet factory measurements bom', icon: FileText, run: () => c.go(`/production/${c.projectId}`) }] : []),
  ]);

  // ---- Project ----
  const themes: { value: Preferences['theme']; label: string; icon: LucideIcon }[] = [
    { value: 'light', label: 'Light theme', icon: Sun },
    { value: 'dark', label: 'Dark theme', icon: Moon },
    { value: 'system', label: 'Theme to match this device', icon: SunMoon },
  ];
  add('Project', [
    ...(c.undoLabel !== undefined ? [{ id: 'undo', label: 'Undo', note: c.undoLabel, keywords: 'back revert', icon: Undo2, keys: 'Mod+Z', run: () => s().undo() }] : []),
    ...(c.redoLabel !== undefined ? [{ id: 'redo', label: 'Redo', note: c.redoLabel, keywords: 'again forward', icon: Redo2, keys: 'Mod+Shift+Z', run: () => s().redo() }] : []),
    {
      id: 'save',
      label: 'Save now',
      keywords: 'store keep',
      icon: Save,
      keys: 'Mod+S',
      run: () => void s().saveNow().then(() => (s().saveState === 'error' ? toast('Couldn’t save on this device. Try again.', 'error') : toast('Saved on this device.', 'success'))),
    },
    {
      id: 'rename',
      label: 'Rename project',
      keywords: 'title name',
      icon: Pencil,
      // After the palette has given focus back.
      run: () =>
        setTimeout(() => {
          const field = document.querySelector<HTMLInputElement>('input[aria-label="Project name"]');
          field?.focus();
          field?.select();
        }, 30),
    },
    { id: 'history', label: 'Versions and approval', keywords: 'history restore approve snapshot revision', icon: History, run: () => s().setPanel('history') },
    { id: 'compare', label: 'Compare colourways', keywords: 'side by side colours variants', icon: GitCompare, run: () => s().setPanel('compare') },
    { id: 'save-template', label: 'Save as template', keywords: 'reuse starter', icon: LayoutTemplate, run: () => s().setPanel('save-template') },
    { id: 'shortcuts', label: 'Keys and gestures', keywords: 'shortcuts keyboard help mouse trackpad touch', icon: Keyboard, keys: '?', run: () => window.dispatchEvent(new CustomEvent('wovexa:shortcuts')) },
    ...themes
      .filter((t) => t.value !== c.theme)
      .map((t) => ({ id: `theme:${t.value}`, label: t.label, keywords: 'appearance mode colour scheme dark light', icon: t.icon, searchOnly: true, run: () => setPreference('theme', t.value) })),
    c.units === 'mm'
      ? { id: 'units:in', label: 'Measure in inches', keywords: 'units imperial in', icon: Ruler, searchOnly: true, run: () => setPreference('units', 'in') }
      : { id: 'units:mm', label: 'Measure in millimetres', keywords: 'units metric mm', icon: Ruler, searchOnly: true, run: () => setPreference('units', 'mm') },
  ]);

  // ---- Other pages ----
  add(
    'Pages',
    PAGES.map((p) => ({ id: `page:${p.href}`, label: p.label, keywords: `page open go ${p.keywords}`, icon: p.icon, run: () => c.go(p.href) })),
  );

  return { commands, titles };
}

// ---- Recent picks, per device ----

const RECENT_KEY = 'wovexa.palette.recent';
const MAX_RECENT = 5;

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function remember(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, MAX_RECENT)));
  } catch {}
}

// ---- Rows ----

function KeyHint({ keys, mod }: { keys: string; mod: string }) {
  return (
    <span className="flex flex-none items-center gap-0.5" aria-hidden>
      {keys.split('+').map((k, i) => (
        <kbd key={i} className="min-w-5 rounded border border-line bg-panel px-1 py-px text-center font-sans text-[10.5px] font-medium text-fg-2">
          {k === 'Mod' ? mod : k}
        </kbd>
      ))}
    </span>
  );
}

function RowGlyph({ command, on }: { command: PaletteCommand; on: boolean }) {
  const g = command.glyph;
  if (g && 'swatch' in g) {
    return <span className="h-7 w-7 flex-none rounded-md border border-line" style={{ background: g.swatch }} aria-hidden />;
  }
  const Icon = command.icon;
  return (
    <span className={`grid h-7 w-7 flex-none place-items-center rounded-md transition-colors ${on ? 'bg-accent text-accent-fg' : 'bg-hover text-fg-2'}`} aria-hidden>
      {g ? (
        <svg viewBox="0 0 100 100" className="h-4 w-4" fill="currentColor" fillRule="evenodd">
          <path d={g.path} />
        </svg>
      ) : (
        <Icon size={15} />
      )}
    </span>
  );
}

// ---- The palette ----

function PaletteDialog({ mode, onClose, pickImage, openChecks }: { mode: LayoutMode; onClose: () => void; pickImage: () => void; openChecks: () => void }) {
  const router = useRouter();
  const doc = useStudio((s) => s.document);
  const activeZoneId = useStudio((s) => s.activeZoneId);
  const selectedIds = useStudio((s) => s.selectedLayerIds);
  const projectionId = useStudio((s) => s.selectedProjectionId);
  const viewMode = useStudio((s) => s.viewMode);
  const projectId = useStudio((s) => s.projectId);
  const undoLabel = useStudio((s) => s.history.past.at(-1)?.label);
  const redoLabel = useStudio((s) => s.history.future[0]?.label);
  const theme = usePreference('theme');
  const units = usePreference('units');
  const seamGuides = usePreference('seamGuides');
  const mod = useModKey();
  const [library, setLibrary] = useState<LibraryModel[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent] = useState(readRecent);
  const [copied] = useState(copiedLayerCount);
  const [wide] = useState(() => matchMedia('(min-width: 1024px)').matches);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  // The library's 3D models, so they can be worn by name.
  useEffect(() => {
    let alive = true;
    void loadModelLibrary().then((m) => alive && setLibrary(m));
    return () => {
      alive = false;
    };
  }, []);

  // Focus the search on open; give focus back to where it was on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const go = useCallback(
    (href: string) => {
      // Save first, so nothing is waiting when the studio closes.
      void useStudio
        .getState()
        .saveNow()
        .finally(() => router.push(href));
    },
    [router],
  );

  const { commands, titles } = useMemo(
    () =>
      doc
        ? buildCommands({ doc, activeZoneId, selectedIds, projectionId, viewMode, undoLabel, redoLabel, projectId, mode, wide, library, theme, units, seamGuides, copied, mod, go, pickImage, openChecks })
        : { commands: [], titles: {} },
    [doc, activeZoneId, selectedIds, projectionId, viewMode, undoLabel, redoLabel, projectId, mode, wide, library, theme, units, seamGuides, copied, mod, go, pickImage, openChecks],
  );

  const searching = query.trim().length > 0;
  const groups = useMemo(() => {
    if (searching) return [{ title: null as string | null, items: searchCommands(commands, query).slice(0, 50) }];
    const byId = new Map(commands.map((x) => [x.id, x]));
    const out: { title: string | null; items: PaletteCommand[] }[] = [];
    const recents = recent.map((id) => byId.get(id)).filter((x): x is PaletteCommand => !!x);
    if (recents.length) out.push({ title: 'Recent', items: recents });
    for (const section of SECTION_ORDER) {
      const items = commands.filter((x) => x.section === section && !x.searchOnly);
      if (items.length) out.push({ title: titles[section] ?? section, items });
    }
    return out;
  }, [commands, titles, query, searching, recent]);
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // Where each group's rows start in the one list the arrow keys move through.
  const starts = useMemo(() => {
    let n = 0;
    return groups.map((g) => {
      const start = n;
      n += g.items.length;
      return start;
    });
  }, [groups]);
  const current = Math.min(active, items.length - 1);
  const optionId = (i: number) => `${baseId}-option-${i}`;

  // A highlighted colourway shows on the 3D garment; it goes back when the palette closes.
  const previewId = items[current]?.previewColorway ?? null;
  useEffect(() => {
    useLive.getState().setColorwayOverride(previewId);
  }, [previewId]);
  useEffect(() => () => useLive.getState().setColorwayOverride(null), []);

  const highlight = (i: number) => {
    if (!items.length) return;
    setActive(i);
    const list = listRef.current;
    if (!list) return;
    // The first row brings its section title into view too.
    if (i === 0) list.scrollTop = 0;
    else list.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const run = (command: PaletteCommand) => {
    remember(command.id);
    onClose();
    command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Keys that pick a character in an input method (Khmer, Chinese) belong to it.
    if (e.nativeEvent.isComposing) return;
    const n = items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) highlight((current + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      if (n) highlight(Math.max(0, Math.min(n - 1, current + (e.key === 'PageDown' ? 8 : -8))));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[current]) run(items[current]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      // Nothing else in here takes focus: the list follows the arrow keys.
      e.preventDefault();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] px-4"
      style={{ background: 'color-mix(in srgb, var(--overlay-scrim) 55%, transparent)' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Find an action"
        className="palette-in mx-auto mt-[max(12px,env(safe-area-inset-top))] flex max-h-[min(560px,calc(100dvh-24px))] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-line bg-floating shadow-2xl sm:mt-[12vh] sm:max-h-[min(560px,76dvh)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-3.5">
          <Search size={17} className="flex-none text-fg-3" aria-hidden />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${baseId}-list`}
            aria-autocomplete="list"
            aria-activedescendant={items.length ? optionId(current) : undefined}
            aria-label="Find an action"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            className="h-[52px] min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-3 focus-visible:outline-none"
            placeholder={mode === 'mobile' ? 'Find an action' : 'Find an action, graphic, garment or colourway'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              if (listRef.current) listRef.current.scrollTop = 0;
            }}
            onKeyDown={onKeyDown}
          />
          <button className="flex-none rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-fg-2 hover:text-fg" onClick={onClose} aria-label="Close">
            {mode === 'mobile' ? 'Close' : 'Esc'}
          </button>
        </div>
        <div ref={listRef} id={`${baseId}-list`} role="listbox" aria-label="Actions" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium">Nothing called “{query.trim()}”</p>
              <p className="mt-1 text-[13px] text-fg-2">Try one word, like text, align, hoodie or export.</p>
            </div>
          ) : (
            groups.map((g, gi) => (
              <div key={`${g.title ?? 'results'}-${gi}`} role="group" aria-label={g.title ?? 'Results'} className={gi ? 'mt-1.5' : ''}>
                {g.title ? (
                  <div className="truncate px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-fg-3" aria-hidden>
                    {g.title}
                  </div>
                ) : null}
                {g.items.map((command, k) => {
                  const i = starts[gi] + k;
                  const on = i === current;
                  return (
                    <div
                      key={`${command.id}-${i}`}
                      id={optionId(i)}
                      data-index={i}
                      role="option"
                      aria-selected={on}
                      // Keep the caret in the search while clicking a row.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => {
                        if (!on) setActive(i);
                      }}
                      onClick={() => run(command)}
                      className={`flex min-h-10 cursor-pointer select-none items-center gap-3 rounded-lg px-2 py-1 text-sm ${on ? 'bg-selected' : ''}`}
                    >
                      <RowGlyph command={command} on={on} />
                      <span className="min-w-0 flex-1 truncate">
                        {command.label}
                        {command.note ? <span className="text-fg-3">{`  ${command.note}`}</span> : null}
                      </span>
                      {searching ? <span className="hidden flex-none text-[11px] text-fg-3 sm:inline">{command.section}</span> : null}
                      {command.keys && mode !== 'mobile' ? <KeyHint keys={command.keys} mod={mod} /> : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="hidden items-center gap-4 border-t border-line px-3.5 py-2 text-[11px] text-fg-3 sm:flex" aria-hidden>
          <span className="flex items-center gap-1.5">
            <KeyHint keys="↑+↓" mod={mod} /> choose
          </span>
          <span className="flex items-center gap-1.5">
            <KeyHint keys="Enter" mod={mod} /> run
          </span>
          <span className="flex items-center gap-1.5">
            <KeyHint keys="Esc" mod={mod} /> close
          </span>
          <span className="ml-auto">Colourways show on the garment as you pass them</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The palette and the file picker it opens for images. Mounted once in the studio; opened by
 * the `wovexa:palette` event (Ctrl+K, the top bar, the project menu).
 */
export function CommandPalette({ mode, onOpenChecks }: { mode: LayoutMode; onOpenChecks: () => void }) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('wovexa:palette', show);
    return () => window.removeEventListener('wovexa:palette', show);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  // Runs inside the click or key press that chose it, so the browser lets the file picker open.
  const pickImage = useCallback(() => fileRef.current?.click(), []);
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files?.length) void addImages(e.target.files);
          e.target.value = '';
        }}
      />
      {open ? <PaletteDialog mode={mode} onClose={close} pickImage={pickImage} openChecks={onOpenChecks} /> : null}
    </>
  );
}
