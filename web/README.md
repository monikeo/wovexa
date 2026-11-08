# WOVEXA web app

The WOVEXA apparel design studio: Next.js 16 (App Router, Cache Components), React 19, Three.js with React Three Fiber, Fabric.js 7, Zustand and Immer, Zod, IndexedDB, Mediabunny (WebCodecs video), and optional Supabase.
The full product specification is `../WOVEXA_Product_Technical_Specification.md`; `../FEATURE_STATUS.md` lists every feature ID in it with what this code ships. The brand kit is `../brand/`.

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
| Workspace | First-run welcome (use case, garment colour, sample artwork or blank); a garment picker for blank projects; dashboard, projects (search, sort, rename, duplicate, archive, delete, approval status), asset library, templates (starters for tees, hoodie, polo, jersey, long sleeve and the Taekwondo dobok, plus your own), brand kits, settings (units, theme, 3D quality, local data) |
| Garments | Eight styles: crew tee, oversized tee, long-sleeve tee, piqué polo, tank, pullover hoodie, V-neck jersey and Taekwondo dobok (top, pants and rank belt, Dan/Gup/Poom presets). Each has its own print zones (the dobok adds both legs), colour parts, fabrics and sizes; switch style at any time and artwork stays put. All-over fabric prints per part: gradient, eight patterns including camo, your own image as a tile, and dye effects (spiral and crumple tie-dye, acid wash, heather, dip-dye, marble) |
| Wovexa Studio (2D) | Print zones on a flat sketch of the actual garment at true scale; rulers in mm or inches; smart guides; text with arc and wave warps, outlines, drop shadows and gradient or pattern fills, nine one-tap text styles (varsity, college arch, athletic, retro, script, stencil, wave, Korean and Khmer display), in 67 open-licence fonts (including Khmer, Korean and Chinese) or your own uploaded fonts; images (PNG, JPEG, WebP, sanitized SVG) with non-destructive adjustments, crop shapes (circle, rounded, hexagon, shield, star, heart), background removal, colour extraction and repeat patterns; shapes and a library of 19 vector graphics; standard placements (left chest, full front, below collar, upper back, leg and sleeve); finishes (flat, puff, embroidery, metallic, distressed); groups; align and distribute; layers; undo and redo; full mouse, trackpad, touch, pen and keyboard support |
| Brand kits | Approved logos, named palette and fonts; link a kit to a project to place logos and apply colours and fonts in one click |
| Wovexa 3D | Every garment in 3D, built from its pattern: necklines, armholes and V collar bands end in clean edges, trims and rib bands follow the real cut, prints keep true size. Orbit and Place modes (drag, resize and rotate artwork on the garment); motion presets (wind through the fabric, float, knit reveal from the hem up) with speed; five lighting looks, exposure, light angle, floor shadow; transparent, colour, gradient or photo backdrops; lens and saved views; framing that fits wide and tall garments; adaptive resolution; WebGL-loss and low-power fallbacks |
| Wovexa Render | Stills from any view at 1:1, 4:5, 9:16 and 16:9 as PNG, JPEG or WebP, for one colourway or all, in real time or photoreal (GPU path tracing with softbox light, raised ink, depth of field and denoising); turntable and motion video (walk, wind, hanger, float, knit) as MP4 or WebM, frame-accurate |
| Export | One production ZIP: true-size print PNGs with their dpi written into the file, screen-print films (one per ink, white underbase, registration marks), team files from a pasted roster ({name}, {number}, size totals), placement drawings per colourway, product images, a two-page client proof PDF, an HTML tech sheet, cut-and-sew panels for all-over sublimation (every pattern piece with bleed and cut line), a GLB 3D model, a colour CSV with RGB and approximate CMYK, and a manifest with SHA-256 for every file. Also on their own: print files, the client proof, GLB and USDZ (AR Quick Look). File-name templates and an export history that flags outdated files |
| Wovexa Production | Print checks with exact fixes; version history with compare and restore; approval that is blocked while checks fail and frozen once given; tech pack with editable bill of materials, construction notes and QA checklist |
| Wovexa AI | Background removal for solid backgrounds, run on this device, keeping the original (no AI provider involved) |
| Platform | Document format v3 with automatic, backed-up upgrades from v1 and v2; autosave to IndexedDB (projects, versions, assets, fonts, saved looks, export history); installable PWA; responsive layouts for desktop, tablet and phone |

Not built yet (see `../FEATURE_STATUS.md` for every item): accounts in the UI and cloud sync, team roles and client review, provider-based AI tools, vector path editing, ICC-managed CMYK output, and calibrated garment models.

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
- **One renderer.** `lib/render/zone-renderer.ts` draws layers for the 2D editor's bitmaps, the 3D textures, thumbnails and print exports, so they always match. Effects that print (outlines, shadows, fills, adjustments, repeats, distress) are deterministic; finish simulation (puff, embroidery, metallic) is preview-only and never reaches print files.
- **3D placement through the same mapping.** `viewer3d/uv-mapping.ts` converts a surface hit to zone millimetres with the exact inverse of how textures are laid out, so picking and dragging on the shirt land where the 2D editor would put them.
- **Physical units.** Layer transforms are millimetres from the top-left of the print area. The 3D textures are laid out by surface arc length, so placed artwork keeps its true size on the garment.
- **Versioned format.** Every stored document carries `schemaVersion`. `domain/schema.ts` holds the migrations; opening an older project upgrades it and keeps the original as a version.
- **Approval by content.** `domain/hash.ts` hashes design content (not the server revision), so a project shows as approved only while it matches the approved version exactly.

## The 3D garment

`components/studio/viewer3d/garment-geometry.ts` builds every garment procedurally from the catalogue measurements in `domain/garments.ts`: torso panels whose top rows follow the neckline and armholes exactly, sleeves, hoods, plackets, pockets, the dobok's pants and belt, per-vertex motion weights, and the pattern pieces used for cut-and-sew export. `garment-textures.ts` paints each part's fabric and artwork; `motion.ts` adds wind, float and knit in the shaders. The models are marked `calibrated: false` and labelled in the UI. Replace them with calibrated GLBs from a 3D artist (spec §28) and keep the zone contracts in `garments.ts`.

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
