# WOVEXA web app

The WOVEXA apparel design studio: Next.js 16 (App Router, Cache Components), React 19, Three.js with React Three Fiber, Fabric.js 7, Zustand and Immer, Zod, IndexedDB, and optional Supabase.
The full product specification is `../WOVEXA_Product_Technical_Specification.md`. The brand kit is `../brand/`.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # domain unit tests (Vitest)
npm run lint
npm run build
```

No account or backend is needed. Without Supabase settings the app runs in **local mode**: projects and artwork are stored in the browser (IndexedDB), and accounts, sync and sharing stay off.

## What works today

| Area | Status |
|---|---|
| Marketing site | Home, plans |
| Workspace | Dashboard, projects (search, sort, rename, duplicate, archive, delete, approval status), asset library, templates (6 starters plus your own), brand kits, settings (units, theme, 3D quality, local data) |
| Wovexa Studio (2D) | Four print zones on a flat garment sketch at true scale; rulers in mm or inches; smart guides that snap to the print area and other layers; text with curves (11 open-licence fonts including Khmer and Chinese), images (PNG, JPEG, WebP, sanitized SVG), rectangles, ellipses, triangles; groups; align and distribute; zoom to selection; numeric inspector; layers (reorder, lock, hide, rename); undo and redo with gestures merged into single steps; keyboard shortcuts; drag-and-drop and paste |
| Brand kits | Approved logos, named palette and fonts; link a kit to a project to place logos and apply colours and fonts in one click |
| Wovexa 3D | Live garment preview with colourways, sizes S–2XL, five camera presets, turntable, click a zone on the shirt to edit it, low-power and WebGL-loss fallbacks |
| Wovexa Render | Mockup stills at 1600 × 2000 for five angles, for one colourway or all of them, on transparent, white or grey backgrounds; side-by-side colourway comparison |
| Wovexa Production | Print checks with exact fixes; version history with compare and restore; approval that is blocked while checks fail and frozen once given; tech pack with editable bill of materials, construction notes and QA checklist, plus a read-only copy for each approved version; true-size print PNGs; manifest with checksums, approval status and production data |
| Wovexa AI | Background removal for solid backgrounds, run on this device, keeping the original (no AI provider involved) |
| Platform | Document format v2 with automatic, backed-up upgrade from v1; autosave to IndexedDB; installable PWA; responsive layouts for desktop, tablet and phone |

Not built yet (see the spec for each): accounts in the UI and cloud sync, team roles and client review, export history, video, provider-based AI tools, and a calibrated garment model.

## Architecture

```
src/
  domain/        Canonical design document (Zod schema), commands, undo history, preflight, garment catalogue. No React.
  lib/           IndexedDB storage, safe file intake, the canonical Canvas renderer, thumbnails, Supabase clients.
  stores/        Studio state (Zustand). The document plus transient UI state; drag previews live in a separate store.
  components/
    studio/      Studio shell, panels, export, the Fabric adapter (editor2d) and the Three adapter (viewer3d).
    workspace/   Workspace shell and project cards.
  app/           Routes: (marketing), (workspace), studio/[projectId], production/[projectId], sign-in, api/.
supabase/migrations/  Postgres schema with row-level security.
```

Key rules from the spec that the code follows:

- **One source of truth.** Every edit is a command against the canonical JSON document. Fabric and Three only display it and report gestures back as commands.
- **One renderer.** `lib/render/zone-renderer.ts` draws layers for the 2D editor's bitmaps, the 3D textures, thumbnails and print exports, so they always match.
- **Physical units.** Layer transforms are millimetres from the top-left of the print area. The 3D textures are laid out by surface arc length, so placed artwork keeps its true size on the garment.
- **Versioned format.** Every stored document carries `schemaVersion`. `domain/schema.ts` holds the migrations; opening an older project upgrades it and keeps the original as a version.
- **Approval by content.** `domain/hash.ts` hashes design content (not the server revision), so a project shows as approved only while it matches the approved version exactly.

## The 3D garment

`components/studio/viewer3d/tee-geometry.ts` builds a procedural crew-neck tee from the catalogue measurements in `domain/garments.ts`. It is marked `calibrated: false` and labelled in the UI. Replace it with a calibrated GLB from a 3D artist (spec §28) and keep the zone contracts in `garments.ts`.

## Cloud sync with Supabase (optional)

1. Create a Supabase project, then apply `supabase/migrations/20261108000000_initial_schema.sql` (`supabase db push`, or paste it into the SQL editor).
2. Run the permission checks listed at the end of that file in a branch or local stack.
3. Add to `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
   ```

   Never put the service role key in a `NEXT_PUBLIC_` variable.

The migration, `/api/projects` and `/api/projects/[id]/document` (revision-checked saves returning 409 on conflict) are written but **have not been run against a live Supabase project yet**. The studio does not call them yet: the client sync coordinator is the next piece of work.

## Brand assets

`public/brand` and `public/icons` are generated from `../brand/logo`. After changing the logo:

```bash
node ../brand/scripts/build-logos.mjs
node scripts/build-icons.mjs
```
