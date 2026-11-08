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
| Workspace | Dashboard, projects (search, sort, rename, duplicate, archive, delete), asset library, settings (units, theme, 3D quality, local data) |
| Wovexa Studio (2D) | Four print zones on a flat garment sketch at true scale; text (11 open-licence fonts including Khmer and Chinese), images (PNG, JPEG, WebP, sanitized SVG), rectangles, ellipses, triangles; move, scale, rotate, snap to centre; numeric inspector in mm or inches; layers (reorder, lock, hide, rename); undo and redo; keyboard shortcuts; drag-and-drop and paste |
| Wovexa 3D | Live garment preview with colourways, sizes S–2XL, five camera presets, turntable, click a zone on the shirt to edit it, low-power and WebGL-loss fallbacks |
| Wovexa Render | Mockup stills at 1600 × 2000 for five angles, on transparent, white or grey backgrounds |
| Wovexa Production | Print checks (bounds, safe margin, resolution, small text, method compatibility) with exact fixes; true-size transparent print PNGs at 150 or 300 dpi; JSON manifest with SHA-256 checksums; printable tech pack |
| Platform | Autosave to IndexedDB with visible save state; installable PWA with offline page cache; responsive layouts for desktop, tablet and phone |

Not built yet (see the spec for each): accounts in the UI and cloud sync, templates, brand kits, team roles and review, export history, video, AI tools, and a calibrated garment model.

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
