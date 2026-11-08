# APPAREL STUDIO
## Complete Product Requirements, Feature Catalogue, Responsive UX Specification & Technical Development Blueprint

**Working product name:** Apparel Studio (replaceable brand name)  
**Document version:** 1.0 — expanded specification  
**Prepared:** 22 October 2026  
**Status:** Implementation blueprint / proposed scope, not a claim of implemented functionality  
**Source basis:** User-supplied *Technical Architecture & Development Specification: 2D/3D Apparel Design & Mockup Studio*, expanded with clearly identified recommendations and architecture corrections.

> **Product vision.** A premium, browser-based, installable design-to-production platform where a creator designs once, sees the result immediately on a realistic 3D garment, generates retail-ready content, obtains approvals, and produces traceable manufacturer-ready artwork and specifications from the same versioned design.

## How to read this specification

- **[BASE]** Preserves and elaborates an idea present in the supplied document.
- **[NEW]** Recommended additional product capability not explicitly specified in the supplied document.
- **[REVISED]** A technical adjustment or caveat necessary for implementation reliability.
- **P0** = essential initial release; **P1** = strong second release; **P2** = commercial/advanced roadmap.
- **AC** = acceptance criteria, measurable evidence that a requirement works.
- All durations and performance budgets are proposed engineering targets, **not current platform benchmarks or guarantees**.

---

# PART I — PRODUCT STRATEGY & OPERATIONAL MODEL

## 1. Executive summary

### 1.1 What the product solves

Conventional mockup tools often separate artwork design, visual product mockups, production instructions, and customer approval. That split causes lost measurements, artwork inconsistency, extra manual exports, and mistakes at manufacturing handoff. Apparel Studio combines these steps through one version-controlled project, one canonical editable layer graph, and multiple synchronized views: a precise 2D print layout, an interactive 3D product visualization, and a technical production/export view.

### 1.2 Product principles

1. **One canonical design, many outputs.** All previews and packages must derive from a validated, versioned document.
2. **Physical accuracy where it matters.** Print dimensions are in millimeters; print method, size, artwork quality, safe areas, and production constraints are visible.
3. **Realistic visuals without dishonest promises.** Simulated cloth, ink, embroidery, lighting, and AI scenes are labeled as previews until factory proofing.
4. **Device-native interaction.** Desktop, tablet, and phone share project compatibility but use purpose-built interaction patterns.
5. **Fast under ordinary hardware.** Lightweight 2D always works; 3D progressively scales with GPU and memory capacity.
6. **Secure by design.** Private artwork and brand assets remain private by default; sharing is explicit and access controlled.
7. **Offline-safe editing.** The PWA protects drafts from connection loss; it does not imply all cloud or AI functions work offline.
8. **Extensible features.** Garment types, print methods, template packs, languages, exporters, and commercial integrations are modular.

### 1.3 Target user types

| User | Primary job | Must-have experience |
|---|---|---|
| Independent clothing designer | Create one-off shirts and mockups | Quick upload, drag/drop, 3D previews, download |
| Clothing brand / startup | Produce consistent collections | Colorways, brand kit, variants, approvals, production files |
| Print shop | Verify and prepare orders | DPI, safe zones, print-method constraints, file handoff |
| Manufacturer / sample maker | Interpret construction instructions | Tech pack, measurements, BOM, versions, comments |
| Agency / content studio | Create catalog imagery and video | Scene presets, batch exports, shareable review |
| Teamwear / sportswear maker **[NEW]** | Personalize uniforms or club apparel | Roster import, name/number mapping, placement templates |
| Workspace administrator | Control people, assets, governance | Roles, quotas, billing, audit trails |

### 1.4 Primary success journeys

**Journey A — first mockup:** Sign in or explore demo → select garment → select color → upload transparent art → position on chest in 2D → inspect rotating 3D → check print warnings → export four-angle social images.

**Journey B — commercial production:** Create brand workspace → build colorway collection → add printing/embroidery → review artwork dimensions → request client approval → freeze approved design version → generate print outputs, tech pack, and BOM → send signed access to manufacturer.

**Journey C — mobile quick change:** Launch installed PWA → open recently edited project → change garment color or text → inspect 3D in mobile focus mode → save offline if needed → sync on reconnection → request export.

**Journey D — team customization [NEW]:** Load sports jersey template → import participant names/numbers → preview placement and length exceptions → generate one variant per team member → batch export individual print sheets and a consolidated production manifest.

## 2. System boundaries, terminology, and product packages

### 2.1 Core product surfaces

- **Public website:** marketing, features, pricing, help, searchable public gallery, template discovery.
- **Authenticated dashboard:** home, recents, projects, collections, templates, asset library, brands, activity.
- **Main design studio:** 2D artwork editor, live 3D viewer, scene studio, print validation, export tools.
- **Review portal:** permission-controlled comments, annotated viewpoints, compare versions, approval status.
- **Production center:** factory tech packs, version-locked artwork packages, spec sheets, manufacturing logs.
- **Admin workspace:** garment/catalog administration, template QA, operational analytics, jobs and abuse review.
- **Embeddable viewer [P2]:** bounded, read-only 3D product experience for external ecommerce sites.

### 2.2 Vocabulary and data constraints

- **Garment template:** immutable or versioned 3D mesh and editable-zone specifications.
- **Garment instance:** garment chosen by a project, including size, fabric, colorway and hardware configuration.
- **Zone:** designable surface such as front, back, left sleeve, right sleeve, neck tag or all-over print region.
- **Artwork layer:** editable image, vector, text, pattern or procedurally generated element.
- **Colorway:** named complete fabric/hardware palette for a design, not merely an RGB background.
- **Print method:** DTG, DTF [NEW], screen print, embroidery, puff, sublimation, heat transfer [NEW] or other configuration with explicit capabilities.
- **Draft version:** editable working revision; **approved version:** frozen revision referencing immutable asset versions.
- **Export profile:** set of format, resolution, color-management, quality and naming rules.
- **Render:** simulated product visualization; **production artwork:** garment-free file sized for actual decoration.

### 2.3 Non-goals for initial release

Do **not** promise browser-native full cloth physics, perfect fit simulation, unrestricted 4K mobile recording, guaranteed Pantone matching from hex values, one-click professional embroidery machine files, or lossless color-accurate CMYK output from a simple browser PNG. These are different production disciplines and need separate validation, specialist libraries, proofing or partners.

## 3. Feature priority and release definitions

| Release | Definition | Release gate |
|---|---|---|
| **MVP / P0** | Sign-in, projects, one validated T-shirt mesh, 2D editing, live 3D, essential layers, four zones, save/recover, accessible responsive shells, still exports, print checks, installable PWA | Complete a full design → inspect → save → reopen → export cycle on desktop, tablet and mobile |
| **Professional / P1** | Multiple garment types, multi-colorways, advanced text and patterns, shader finishes, client review, tech packs, brand kits, basic batch outputs, offline drafts, team workspaces | Pilot with designers and at least one production operator |
| **Commercial / P2** | High-volume cloud rendering, animation/video packs, AI studio, production integrations, ecommerce embed, teamwear personalization, automated pricing and enterprise controls | Verified operational capacity, legal terms, rendering unit economics |

## 4. Product architecture at a glance

```text
                          WEBSITE / DASHBOARD / PWA
                                     |
                       Next.js App Router + TypeScript
                                     |
                     Shared domain models + permissions
                                     |
        +----------------------------+------------------------+
        |                            |                        |
   Fabric-based 2D             R3F / Three.js         Production & Exports
   editor adapter              3D scene adapter         Render / PDF / ZIP
        |                            |                        |
        +----------- Canonical Design Document --------------+
                                     |
                       Commands / events / versioning
                                     |
                   Local draft cache + sync coordinator
                                     |
                Supabase Auth / Postgres / Storage / RLS
                                     |
                   Optional export orchestration layer
                         |                       |
                    DB jobs                Heavy render worker
                    (initial)             (future GPU + FFmpeg)
```

**[REVISED]** The canonical project JSON—not a Fabric canvas element and not the 3D scene—is the source of truth. Fabric and Three are editing/rendering adapters. This prevents engine-specific state from corrupting saved documents and makes migration and alternate device experiences practical.

---

# PART II — DETAILED FEATURE & FUNCTION CATALOGUE

## 5. Identity, onboarding and user accounts

- **ACC-01 [P0] Authentication:** Supabase email/password or email magic link; protect editor and API resources server-side; support safe session expiration and refresh.
- **ACC-02 [P1] Social sign-in:** configurable Google/Apple/OIDC where appropriate; account linking must not merge identities without verified ownership.
- **ACC-03 [P0] First-run onboarding:** 3-step choice of use case, garment and sample artwork; offer non-destructive guided tooltips and a dismissible walkthrough.
- **ACC-04 [P0] User preferences:** measurement units (mm/in), interface theme, default export profile, reduced motion, 3D quality preference, language.
- **ACC-05 [P1] Workspace invitation:** invite people by verified email; show pending/expired invitations and prevent unauthorized workspace access.
- **ACC-06 [P1] Profile / security:** connected identities, sign-out other sessions, MFA where enabled, password change, deletion/export request.
- **ACC-07 [P1] Activity notifications:** save conflicts, comment mentions, approval state, export success/failure, quota information; in-app inbox.
- **ACC-08 [P2] Organization identity:** SSO and SCIM only after enterprise demand; configurable policies and ownership transfer.

**AC:** Unauthorized visitors cannot read private project metadata/assets; first-time users can reach a usable canvas without a mandatory tutorial; expired sessions cannot submit protected edits.

## 6. Dashboard, projects, search and organization

- **PRJ-01 [P0] Create projects:** start blank or from approved template; choose garment and default fabric/colorway; validate name and ownership.
- **PRJ-02 [P0] Project cards:** accurate thumbnail, garment type, last edited date, version status, owner; fast skeleton loading.
- **PRJ-03 [P0] CRUD:** rename, duplicate, archive, soft-delete and restore within retention period; prevent accidental destructive operations.
- **PRJ-04 [P0] Autosave / status:** display `Saved`, `Saving`, `Offline`, `Sync conflict`, `Failed`, with retry actions and last synced revision.
- **PRJ-05 [P1] Collections / folders:** organize seasonal collections, clients, campaigns and garment ranges; reordering without changing ownership.
- **PRJ-06 [P1] Search and filtering:** title, garment category, tags, project status, collaborator, creation/modify date, colorway and template.
- **PRJ-07 [P1] Project tags / notes:** independent project-level descriptions, internal tags, optional style references, source-of-truth notes.
- **PRJ-08 [P1] Project version timeline:** meaningful named snapshots, restore as **new** editable version, compare artwork/garment changes.
- **PRJ-09 [P1] Bulk actions:** duplicate/archive/export selected eligible projects; confirmations and transaction status.
- **PRJ-10 [P2] Branching:** alternate design directions and merges with explicit conflict handling; never silently merge 3D transforms.

**AC:** Reopen a project on a second device and reproduce all layers and colorways with no layout drift; restore a version without destroying the currently approved revision.

## 7. Garment catalogue and product configuration

- **GAR-01 [P0] Starter garment:** technically validated regular/oversized crewneck T-shirt with real physical measurements, calibrated UV mapping, print masks, fold normals and rotation controls.
- **GAR-02 [P1] Garment types:** short/long-sleeve tees, polo, hoodie, sweatshirt, tank, jacket, jersey, shorts and track wear; each model requires asset acceptance tests.
- **GAR-03 [P0] Garment zones:** front, back, left/right sleeve, collar/neck area; zones reflect actual printability, not only mesh names.
- **GAR-04 [P1] Construction variants:** fits (slim/regular/boxy/oversized), sleeves, neckline, hood, cuffs, ribbing, hem, zipper and pockets where model supports them.
- **GAR-05 [P0] Per-zone color:** body, sleeves, collar, ribbing, stitching, hardware; locked or linked colors allowed for uniform colorways.
- **GAR-06 [P1] Fabric presets:** cotton jersey, French terry, polyester mesh, performance knit, fleece, blended fabrics; surface response paired with documented GSM values.
- **GAR-07 [P1] Size variants:** XS–3XL or configurable size charts; print boundaries and measurement tolerances are per garment model and size.
- **GAR-08 [P1] Tag customization:** neck print, sewn label, hem tag, care label, brand tag and hangtag mockups, subject to garment capabilities.
- **GAR-09 [P1] Colorway manager:** create, duplicate, rename, reorder and compare named palettes; use HEX for screen representation plus optional verified print references.
- **GAR-10 [P2] Material library [NEW]:** admin-managed fabrics with swatches, description, GSM, stretch, surface normal, shine, and print compatibility matrix.
- **GAR-11 [P2] Custom garment intake:** customer upload of GLB/GLTF plus mapping wizard; require validation of zones, units, UVs, texture bounds, orientation and licenses.
- **GAR-12 [P1] Garment compatibility warnings:** prohibit unsupported print methods or geometrically impossible locations for chosen blank garment.

**AC:** Garment switching must warn about out-of-bounds artwork, remap compatible zones deterministically, and never silently distort print scale; variants preserve original asset lineage.

## 8. Professional 2D design editor

- **ED2-01 [P0] Zoomable artboard:** pan, fit, zoom to selection, explicit scale, origin guide, rulers and dimensions in mm/in.
- **ED2-02 [P0] Zone artboards:** front/back/sleeves/neck; switching zones preserves selections and positions and updates the linked 3D view.
- **ED2-03 [P0] Upload and place:** PNG, JPEG, WebP, SVG (sanitized), supported vectors and approved font types; show unsupported formats clearly.
- **ED2-04 [P0] Transform objects:** move, resize, rotate, flip, center, align, nudge, reset and duplicate; use precise numeric coordinates.
- **ED2-05 [P0] Layer stack:** selection, reorder, lock, hide, rename, opacity, duplicate, multi-select and groups.
- **ED2-06 [P0] Core text:** text layers, font, line height, kerning/letter spacing, alignment, fill/stroke, styles and text editing.
- **ED2-07 [P1] Advanced typography:** text on curve, outlines, warp presets, multilingual shaping review, custom licensed font uploads, auto-fit text boxes.
- **ED2-08 [P0] Align tools:** center horizontally/vertically, distribute, snap to artboard, layer edges, midpoints, grid and print-safe guide.
- **ED2-09 [P1] Vector drawing:** shapes, path editing, fills, strokes, boolean operations and vector import/export with explicit limitations.
- **ED2-10 [P1] Image adjustments:** crop, mask, brightness, contrast, hue/saturation, sharpen, threshold, remove background integration.
- **ED2-11 [P1] Pattern tool:** repeat tile, mirror, half-drop, rotate, offset and scale; restrict patterned art to masked zones.
- **ED2-12 [P1] Reusable components:** saved logo groups, sleeve accents, label components and brand layouts.
- **ED2-13 [P1] Guides and constraints:** draggable reference guides, margin lock, seam clearance and placement templates.
- **ED2-14 [P0] Undo/redo:** a reversible semantic command history for user actions, not a raw snapshot on every pointer movement.
- **ED2-15 [P1] Shortcuts / commands:** configurable keyboard map, command palette, context menu and history inspector.
- **ED2-16 [P1] Color sampling:** eyedropper sampled from artwork and palettes, with accessible input and numeric color entry.
- **ED2-17 [P2] Bulk replacement [NEW]:** replace a team logo or sponsor mark across all compatible colorways and templates while retaining zone placement.
- **ED2-18 [P2] Dynamic data text [NEW]:** per-variant personalized name, number, date or campaign line driven by structured data.

**AC:** Every layer transformation survives serialization/reload exactly within numeric tolerance; Undo/Redo behaves consistently across 2D and 3D editing actions; numeric physical sizes match output specs.

## 9. Live 3D garment editor and visualization

- **ED3-01 [P0] Interactive garment:** rotate, orbit, zoom and reset with bounded controls; view front/back/left/right in one tap.
- **ED3-02 [P0] Live artwork projection:** update garment preview promptly after 2D edits; preserve garment fabric, folds and alpha transparency.
- **ED3-03 [P0] Inspect vs edit modes:** explicit separation between orbit/pan and manipulating artwork, reinforced by cursor/touch affordances.
- **ED3-04 [P1] Surface selection:** raycast to intersect mesh, resolve hit triangle/UV/zone, select corresponding layer where unambiguous.
- **ED3-05 [P1] Direct surface editing:** drag, rotate and scale artwork in supported UV zones; snap to production-safe geometry.
- **ED3-06 [P0] View presets:** front, back, side, quarter, top/angled; camera bookmarks persist with project scene state.
- **ED3-07 [P1] Material realism:** normal/roughness/AO maps, calibrated lighting, fabric folds, stitching and shadow continuity.
- **ED3-08 [P1] Surface finish previews:** flat ink, puff print, stylized embroidery, metallic, reflective and distressed/cracked overlays.
- **ED3-09 [P1] Studio light controls:** environment map selection, key/fill settings, rotation, exposure and optional shadows.
- **ED3-10 [P1] Background / stage:** transparent, solid, gradient, preset studio scenes, simple podium/floor shadow.
- **ED3-11 [P1] Position aids:** show garment zone outlines, design boundary and alignment guide, toggleable before export.
- **ED3-12 [P1] 2D/3D split view:** synchronized camera and artboard focus with draggable divider on supported screen sizes.
- **ED3-13 [P1] Animation presets:** idle turntable and selected pre-baked hanger, fold, ghost mannequin or soft breeze states.
- **ED3-14 [P2] Cross-seam artwork:** explicit projected-decal workflow with seam-aware warnings and UV baking validation.
- **ED3-15 [P2] Side-by-side comparison [NEW]:** compare two colorways / versions with linked camera positions.
- **ED3-16 [P0] Capability fallback:** on poor GPU/no WebGL/low memory, maintain fully functional 2D with static preview and clear messaging.

**AC:** Switching views never mutates artwork; surface movement stays inside defined UV region; alpha-blended artwork never paints transparent areas as solid black/white; loss of WebGL does not lose design changes.

## 10. Print methods, physical accuracy and quality assurance

- **PRT-01 [P0] Physical-unit geometry:** each print zone has a tested 2D millimeter coordinate system anchored to garment construction landmarks. Preserve width and height independently.
- **PRT-02 [P0] DPI resolution audit:** display horizontal and vertical effective pixels-per-inch from original source resolution divided by printed inch dimensions.
- **PRT-03 [P0] Safe/bleed/no-print boundaries:** visualize per-template, per-size, per-method polygons; warn on clipped graphic bounds and risky seams.
- **PRT-04 [P1] Print method selector:** DTG, DTF, screen print, sublimation, embroidery, heat transfer, puff; show validated supported methods per product and location.
- **PRT-05 [P1] Live preflight panel:** missing assets, low resolution, unsupported method, fine detail, edge/trim proximity, text not converted, excessive color count.
- **PRT-06 [P1] Ink color estimation:** pixel cluster/spot color approximations, manual merge, underbase white simulation and separations preview; not a replacement for print-shop RIP/ICC proofing.
- **PRT-07 [P1] Embroidery feasibility:** estimate sew area, minimum text height, fine-line risk, stitch-density proxy, expected color count; actual digitizing is separate.
- **PRT-08 [P1] Print placement presets:** chest left, center chest, oversized back, sleeve cuff, collar, hem; measurement anchors configurable by garment model.
- **PRT-09 [P1] Method-dependent artwork rule sets:** supported finishes, minimum line thickness, required bleed, spacing, maximum areas; admin versioned.
- **PRT-10 [P1] Warnings vs hard blockers:** a production profile decides whether a failed preflight is informational, overridden by privileged users, or blocks approval/export.
- **PRT-11 [P1] Proof sheet:** printable overview with every placement dimension, template size, colorway and included artwork hashes.
- **PRT-12 [P2] Vendor printer profiles [NEW]:** named print-shop settings with target color space, underbase strategy, minimum sizes, output format and reconciliation notes.

**Print DPI specification:** `effectiveDpiX = sourceWidthPixels / (placedWidthMm / 25.4)` and equivalent Y. When an image is cropped, use actual pixels available in the cropped area. A vector layer can be resolution-independent until raster effects are applied. The source document's 250/150 DPI warning levels may be provided as configurable default heuristics, **not universal print standards**; acceptance depends on image content and printing process.

**AC:** The same exact placed physical dimensions appear in the editor, print sheet and production bundle; engineering tests detect out-of-zone overlap and preserve method-specific warning severity.

## 11. Image, SVG, font and asset management

- **AST-01 [P0] Private asset library:** upload, filter, sort, preview and reuse source artwork across authorized projects.
- **AST-02 [P0] Safe file intake:** MIME verification, file signature check, type/size/pixel-count limits, antivirus or equivalent content scanning appropriate to risk, SVG sanitization.
- **AST-03 [P0] Original + proxy:** store immutable original and separately optimized thumbnails/preview textures; exports reference original bytes.
- **AST-04 [P1] Upload progress and recovery:** resumable large uploads, retry, duplicate detection and integrity verification.
- **AST-05 [P1] Image operations:** background removal, transparent trim, crop, rotate, color isolation, saturation and grayscale with non-destructive history.
- **AST-06 [P1] Vector cleanup:** simplify paths, trace background, inspect SVG dimensions and warn on unsupported effects/fonts.
- **AST-07 [P1] Font vault:** permitted OTF/TTF/WOFF2 with licensing confirmation; glyph availability and embedding/export policy.
- **AST-08 [P1] Palette extraction:** derive suggested dominant colors without asserting manufacturing-ready color matches.
- **AST-09 [P1] Asset metadata:** pixel dimensions, original filename, licensing note, uploader, tags, checksum, source version and usage locations.
- **AST-10 [P2] Smart asset suggestions [NEW]:** retrieve previously used logos or layouts using descriptive metadata; protect organization isolation.
- **AST-11 [P2] Vector-to-stitch service [NEW]:** outsourced or integrated embroidery digitization workflow with expert verification.

**AC:** Removing a preview proxy never deletes its original source; SVG cannot execute scripts on upload/render; unauthorized users cannot enumerate private asset paths.

## 12. Typography, patterns and visual effects

- **TYP-01 [P0] Editable text objects:** correct text content retained in canonical schema, independent of rasterized texture caches.
- **TYP-02 [P1] Curved and circular text:** positive/negative path radius with a predictable printed outline; warn on unsupported script shaping.
- **TYP-03 [P1] Text styles:** fill/stroke, shadow, arch, outline, transform and consistent line height.
- **TYP-04 [P1] Text legibility validation:** estimate small-text risk relative to physical print scale and chosen method.
- **TYP-05 [P1] Repeat design patterns:** scale, offset, rotate, stagger and clip-to-region while preserving repeat parameters for editability.
- **TYP-06 [P1] Print finish simulation:** visual-only procedural puff, embroidery thread directional shading, faux foil and cracked ink.
- **TYP-07 [P2] Variable design tokens [NEW]:** brand palette/typography/token links; changes show preview and optional propagate-to-variants operation.
- **TYP-08 [P2] Distress controls [NEW]:** non-destructive abrasion masks, opacity/probability, physical scale and seed for deterministic regeneration.

**AC:** Changing text does not destroy editability, text runs do not unexpectedly reflow between devices, and all output styles are explicit in the document schema.

## 13. Colorways, variants and product collections

- **VAR-01 [P0] Product color editor:** select body/sleeve/collar/stitch color with live 3D visualization.
- **VAR-02 [P1] Named colorway presets:** white/black/high-contrast examples; clone, edit, rename and compare.
- **VAR-03 [P1] Variant matrices:** garment style × size × colorway × print-method options; enforce meaningful combinations.
- **VAR-04 [P1] Consistency rules:** artwork placement may be shared or overridden per colorway; visible indicator marks overrides.
- **VAR-05 [P1] Swatch previews:** consistent thumbnail lighting with same camera so color differences are judgeable.
- **VAR-06 [P2] Collection builder [NEW]:** combine tops, bottoms, hoodie and accessories into a lookbook/export group.
- **VAR-07 [P2] Cost / lead-time estimator [NEW]:** vendor-entered rates, quantity tiers, setup fees, manual overrides and clearly dated estimates.
- **VAR-08 [P2] Size/fit data [NEW]:** variant chart display and production measurement validation (not consumer body-fit prediction).

**AC:** Batch renders cover only valid variant configurations and include stable variant identifiers in file naming and manifest.

## 14. Mockup scene, lighting and media studio

- **MED-01 [P0] Four-angle images:** front, back, left, right and optional three-quarter angle; choose PNG/JPEG/WebP.
- **MED-02 [P1] Scene presets:** softbox, minimalist paper, dark studio, ecommerce white, outdoor-style illustration, podium, ghost mannequin.
- **MED-03 [P1] Camera controls:** focal length / field of view, bookmarks, orbit bounds, product orientation and auto framing.
- **MED-04 [P1] Background options:** transparent when supported, color, gradient, static photo and HDR environment; confirm license provenance.
- **MED-05 [P1] Still render settings:** aspect ratio 1:1, 4:5, 9:16, 16:9; safe crop; quality and pixel output size.
- **MED-06 [P1] Turntable clip:** selectable rotation angle, duration, output resolution and background.
- **MED-07 [P1] Scene template saving:** save reusable camera/light/background combinations across a brand workspace.
- **MED-08 [P2] Keyframe timeline:** rotation, zoom, lighting changes, text overlays and transitions; previews follow source version.
- **MED-09 [P2] Batch gallery generator:** front/back/sides for every colorway, with naming and social aspect ratios.
- **MED-10 [P2] Lifestyle model images:** AI-generated context separated from design-truth render; watermark or indicate generated content where appropriate.
- **MED-11 [P2] 3D animation states:** static, hanger, retail fold, mannequin and pre-baked movement; model-specific constraints.
- **MED-12 [P2] Campaign storyboard [NEW]:** arrange multiple product scenes into carousel/ad layout with consistent brand treatment.

**AC:** Every render job stores project version and configuration; video frame duration is deterministic; downstream exports never depend on the user's current unsaved editor state.

## 15. Export and production package center

- **EXP-01 [P0] Immediate screen image:** generate a preview screenshot at device-safe resolution and save to local storage/download with success/failure feedback.
- **EXP-02 [P0] Export preset:** common social aspect ratios and ecommerce 4-angle product images.
- **EXP-03 [P1] High-resolution image output:** tile or controlled offscreen render based on tested GPU limits; fall back to supported remote workers when necessary.
- **EXP-04 [P1] Isolated print artwork:** transparent background (where format allows), flattened/vector output and explicit zone physical dimensions.
- **EXP-05 [P1] Production ZIP:** `manifest.json`, approved design reference, individual artwork, technical PDF, image mockups and checksum list.
- **EXP-06 [P1] Tech pack PDF:** bill of materials, visual callouts, mm/in measurements, decoration methods, sizes, color palette and sign-off fields.
- **EXP-07 [P1] Export history:** queued/running/completed/failed/cancelled, timestamps, retry, expiry and user-visible diagnostic summary.
- **EXP-08 [P1] Naming templates:** project, collection, garment, colorway, zone, size, method, version and output date.
- **EXP-09 [P2] Commercial video:** MP4/H.264, WebM or other supported codecs with reproducible settings and server-side pipeline for high loads.
- **EXP-10 [P2] Professional color outputs:** PDF/X or TIFF with specified printer ICC profile through a verified professional conversion pipeline; do not call transparent PNG 'CMYK'.
- **EXP-11 [P2] One-click client media kit [NEW]:** social product crops, thumbnails, campaign carousel and QR-to-viewer assembled in one archive.
- **EXP-12 [P2] Export API [NEW]:** machine-requested renders and webhook completion for authorized workspaces.

**AC:** Print images contain no shadows, shirt fabric, or studio background; output files identify their exact approved source revision; failures are recoverable and do not charge duplicate jobs.

## 16. Factory tech packs, bill of materials and workflow

- **FAC-01 [P1] Product description:** garment type, fit, fabric, GSM, colorway, size and factory contact field.
- **FAC-02 [P1] Front/back flat schematic:** placement drawings with dimensional callouts that originate from the design placement data.
- **FAC-03 [P1] Decoration schedule:** zone, method, design reference, image filename, width × height and handling notes.
- **FAC-04 [P1] Component BOM:** fabric, trim, labels, packaging, buttons, zips and thread options entered or selected from approved catalog.
- **FAC-05 [P1] Construction instructions:** editable human-authored notes, seam, collar, finish and tolerance requirements; not inferred as fact from mesh alone.
- **FAC-06 [P1] Revision tracking:** approved version ID, change description, date and responsible person.
- **FAC-07 [P1] Sample QA checklist:** construction, placement, color, dimensions, print feel, care label and size chart acceptance.
- **FAC-08 [P2] Manufacturer guest review:** signed approval link, access expiry, selective file availability, audit log.
- **FAC-09 [P2] Supplier quote comparison [NEW]:** unit cost, MOQ, setup charges, turnaround, shipping and notes; quotes retain original document.
- **FAC-10 [P2] Production status workflow [NEW]:** quoted → approved → sampling → revision → production → inspected → delivered, with optional milestones.

**AC:** Factory PDF contains either verified values or clearly labeled blank fields requiring manual confirmation; approved tech pack remains immutable after sign-off.

## 17. AI-assisted editing and concept studio

- **AI-01 [P1] Background removal:** non-destructive mask with manual cleanup, preview and original recovery.
- **AI-02 [P2] Raster upscaling:** show artifact risk, model choice and estimated effective pixel gain; never imply generated pixels restore original detail.
- **AI-03 [P2] Design variation suggestions:** layout alternatives derived from user assets with clear replace/keep choice.
- **AI-04 [P2] Color palette assistant:** propose palettes based on references, garments and practical contrast.
- **AI-05 [P2] Lifestyle scene assistant:** create surroundings/mock models but preserve or compare against original visual layer; disclose possible deviations.
- **AI-06 [P2] Smart layout critique [NEW]:** inspect balance, negative space, visual hierarchy, print size and optional readability problems.
- **AI-07 [P2] Prompt-to-pattern [NEW]:** generate seamless pattern tile, allow recolor/scale and maintain provenance.
- **AI-08 [P2] Trademark/brand usage reminder [NEW]:** permission checklist for uploaded logos; no false legal clearance guarantee.
- **AI-09 [P2] Accessibility-aware suggestions [NEW]:** contrast warnings for public marketing mockups and alt text drafting.

**Implementation rule:** External AI providers require explicit user consent and cost controls, private assets are never used for provider training unless independently authorized, and all outputs can be rejected/rolled back.

## 18. Brand kits, reusable templates and marketplace

- **BRD-01 [P1] Brand profile:** logo, name, primary/secondary colors, preferred font set, visual notes and document templates.
- **BRD-02 [P1] Shared brand assets:** reusable vectors, sponsor marks, approved logo variants and safe-area guides.
- **BRD-03 [P1] Template save / apply:** save garment + layer configuration as template with locked/editable elements.
- **BRD-04 [P1] Template metadata:** preview, tags, supported garment families, use case, source creator and license.
- **BRD-05 [P1] Team approval of assets:** editable draft vs organization-approved variants to avoid wrong logo use.
- **BRD-06 [P2] Template marketplace [NEW]:** licensed creator templates with moderation, revenue rules and refund/dispute policy.
- **BRD-07 [P2] Style collections [NEW]:** campaign-level tokens for layouts, photographic scenes and export presets.
- **BRD-08 [P2] Workspace asset quotas:** usage reporting, archive suggestions and billing-aware thresholds.

**AC:** Template application cannot expose other organizations' private media; variant and template licenses accompany exported manifests where required.

## 19. Collaboration, approvals, comments and sharing

- **COL-01 [P1] Roles:** owner, admin, designer/editor, reviewer, production manager and read-only guest; exact permission matrix defined in backend.
- **COL-02 [P1] Share links:** explicit authenticated or token-based sharing, optional password/expiry, role limitation and revoke action.
- **COL-03 [P1] Review mode:** comment on named view / coordinates / garment zone, optionally attach annotated snapshot.
- **COL-04 [P1] Approval states:** draft → in review → changes requested → approved → superseded/archived; record approver and version.
- **COL-05 [P1] Version comparison:** visual and structured difference in layer placements, text, garment configuration and colorways.
- **COL-06 [P1] Activity log:** who changed what, when, with security-sensitive actions retained server-side.
- **COL-07 [P2] Live presence:** avatar/cursor/selected zone, with clear multi-editor conflict semantics.
- **COL-08 [P2] Real-time coediting:** per-object edit leases or structured CRDT/OT transformations only after consistency testing.
- **COL-09 [P2] External approval collection [NEW]:** client can select accepted colorway and request changes with in-context references.
- **COL-10 [P2] Brand approval gates [NEW]:** require authorized sign-off before factory downloads.

**AC:** A shared URL never grants more than the server-authorized role; signed approval references one immutable version; simultaneous editing never silently overwrites another person's design.

## 20. Sportswear, uniform and personalization extension [NEW]

This optional module creates a meaningful vertical specialization for clubs, teamwear and performance apparel without making the core editor sports-only.

- **SPT-01 [P2] Team kit templates:** jersey, training tee, polo, warm-up jacket, tracksuit and club uniform accessories.
- **SPT-02 [P2] Team roster import:** CSV import with name, display name, jersey number, size, role/team, notes; preview and validation.
- **SPT-03 [P2] Dynamic name/number placement:** controlled font, arc, width fit, spacing and truncation/manual overrides.
- **SPT-04 [P2] Sponsor placement grid:** approved sponsor logos for front/back/sleeves with placement priority constraints.
- **SPT-05 [P2] Uniform consistency rule:** lock core brand elements while allowing player-specific text.
- **SPT-06 [P2] Production matrix:** per person → garment size → colorway → file → print method; export as CSV and manifest.
- **SPT-07 [P2] Bulk name previews:** generate contact sheet to spot overflow, duplicates and wrong numbers before production.
- **SPT-08 [P2] Club shop collection [NEW]:** publish approved apparel with read-only previews and optional external checkout integration.

**AC:** Imported names with Khmer, Chinese or other scripts render correctly if licensed font coverage exists; a failed row does not contaminate other personalized exports.

---

# PART III — NATIVE-FEELING RESPONSIVE EXPERIENCE

## 21. Cross-device product philosophy

**Mandatory requirement:** The application is fully responsive and usable on a native-sized desktop, iPad/tablet, and mobile viewport; it must not be a desktop editor merely squeezed into a phone. Each device shares the same project schema and visual design system while exposing device-appropriate layouts, gesture semantics, modal behaviors, performance profiles, and information priority.

The term **native** in this document means *native-feeling responsive web/PWA UX*. It does not imply Swift/Kotlin code, App Store distribution, full native operating-system API parity, or guaranteed support for all browser APIs.

### 21.1 Responsive design breakpoints (initial design tokens; validate empirically)

| Class | CSS viewport width | Layout strategy | Priority |
|---|---:|---|---|
| Compact mobile | 320–389 px | One focus surface, bottom action rail, full-screen sheets | P0 |
| Standard/wide mobile | 390–599 px | Single focus pane, larger stage, adaptive bottom controls | P0 |
| Small tablet / large phone | 600–767 px | One primary view + collapsible side/overlay panel | P0 |
| Tablet portrait | 768–1023 px | Main canvas + contextual slide-in inspector; switchable 2D/3D | P0 |
| Tablet landscape / small desktop | 1024–1279 px | Compact 2-column workbench, side drawers, optional split | P0 |
| Desktop | 1280–1599 px | Persistent left tool rail, center viewport, right inspector | P0 |
| Wide desktop | ≥1600 px | Full workspace, 2D/3D split, resizable panels, floating auxiliary views | P1 |

Do not use only width to detect device capability. Account for pointer type (`coarse`/`fine`), hover availability, orientation, reduced motion, high DPI, keyboard presence, viewport height, safe-area insets and GPU tier. A desktop browser narrowed to 400 px should remain usable, while an iPad with trackpad should support mouse precision.

### 21.2 Desktop-native workspace (≥1280 px)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Brand / Project  • Save status    Undo ↶ ↷   [2D | Split | 3D]   Export  User │
├────┬─────────────────┬──────────────────────────────────┬──────────────────┤
│Tool│ Assets / Layers │                                  │ Inspector        │
│rail│ Templates       │       Primary 2D / 3D stage      │ Selection        │
│    │ Text / Shapes   │       3D preview or split        │ Transform        │
│    │ Upload          │                                  │ Print / Material │
│    │  ~280 px        │           Flexible               │ ~300–340 px      │
├────┴─────────────────┴──────────────────────────────────┴──────────────────┤
│ Garment zone tabs • View controls • Print warnings • Quality • Zoom/status  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **DSK-01:** keyboard-first professional workflow with semantic tool shortcuts, Space-to-pan only when focus is not in a text input, Escape to exit modes, and command search.
- **DSK-02:** resizable/dockable sidebars, split-view divider, remembered panel widths and focus mode.
- **DSK-03:** right-click context menu, hover hints, precision numeric edit, drag/drop files and multi-selection.
- **DSK-04:** fixed, discoverable primary export; visible project name, save/conflict state, selected zone, scale and print warnings.
- **DSK-05:** handle ultrawide aspect ratios without stretching controls; bounded inspector widths and maximum text line width.
- **DSK-06:** support keyboard-only equivalent for all important tools; tooltips are supplementary, not required to use UI.

### 21.3 iPad and tablet-native workspace

```text
┌─────────────────────────────────────────────────────────────────┐
│ Back • Project ▾           [2D | 3D | Split*]        Save / Export│
├───────────┬────────────────────────────────────┬────────────────┤
│ Tool rail │            Design stage            │ Context panel* │
│ icons     │  Touch-friendly gesture handling   │ collapsible    │
│           │                                    │                │
├───────────┴────────────────────────────────────┴────────────────┤
│ Zones  •  Layers  •  Style  •  Adjust  •  Preview  •  More         │
└─────────────────────────────────────────────────────────────────┘
*Available when width and orientation permit.
```

- **TAB-01:** touch/stylus-first interaction; mouse/trackpad and keyboard support remain available.
- **TAB-02:** pen-friendly transformation handles, optional drawing gestures, stylus hover/pressure only when API/browser actually supports them.
- **TAB-03:** side panels present as docked inspectors in landscape or layered sheets/drawers in portrait.
- **TAB-04:** two-finger pinch to zoom viewport; two-finger pan artboard; one-finger drag selected object only in edit mode.
- **TAB-05:** separate 3D orbit and object manipulation controls to prevent accidental moves from touch gestures.
- **TAB-06:** keyboard shortcuts when a hardware keyboard is present; do not rely on modifier keys for tablet-only tasks.
- **TAB-07:** support orientation change without dropping selection or unsaved state.
- **TAB-08:** contextual toolbars relocate above the on-screen keyboard instead of being covered by it.

### 21.4 Mobile-native workspace (320–599 px)

```text
┌────────────────────────────┐
│ ‹  Project name    Save · ⋯ │
├────────────────────────────┤
│    Zone: Front      2D/3D │
│                            │
│                            │
│    FULL-WIDTH FOCUS       │
│       ARTBOARD /          │
│      GARMENT VIEW         │
│                            │
│                            │
├────────────────────────────┤
│ Tool settings / Bottom     │
│ sheet, only when requested │
├────────────────────────────┤
│ +Add   Layers   Color 3D  ↑ │
└────────────────────────────┘
```

- **MOB-01:** one principal focus mode at a time (2D or 3D); no forced simultaneous 50/50 view on narrow phones.
- **MOB-02:** fixed bottom primary rail with 4–5 high-frequency actions, a More menu, and a dominant visible selection state.
- **MOB-03:** bottom sheets for color, text, uploads, layers, dimensions and export settings; snap points and swipe-to-close only if safe.
- **MOB-04:** minimum touch target ~44 × 44 CSS px (or more where practical), spaced to prevent accidental edits.
- **MOB-05:** pinch zoom and precise zoom slider; long-press menu alternatives; never require hover or double-click.
- **MOB-06:** single-finger object move occurs only after selecting tool/object; separate `Orbit` and `Place` toggles in 3D.
- **MOB-07:** simplified layers list with large reorder handles and lock visibility; tap opens focused property sheet.
- **MOB-08:** compact property editor for exact width, height, position, rotation, angle, opacity, alignment and undo.
- **MOB-09:** use native keyboard input types, numeric keypad for measurements, scroll-safe focus and proper viewport resizing.
- **MOB-10:** in-device file picker, camera/photo library input where available, ability to accept shared images when supported.
- **MOB-11:** explicit low/medium/high 3D quality with default automatic mode; suspend rendering when hidden or inactive.
- **MOB-12:** advanced options may be nested but are not silently absent; large jobs route to supported remote export.

### 21.5 Feature parity policy

| Capability | Desktop | Tablet | Mobile |
|---|---|---|---|
| Design / inspect garment | Full controls | Full controls, touch optimized | Focused controls, touch optimized |
| Add/edit text and image | Full | Full | Full via bottom sheet |
| Layer reorder and group | Direct full tree | Drawer / full tree | Focused sheet / multi-select mode |
| Precise physical positioning | Inspector + shortcuts | Inspector + pen/touch | Numeric sheet + snap |
| 2D/3D synchronization | Live | Live when GPU capable | Live at adaptive resolution |
| Split 2D/3D | Yes | Landscape and sufficient width | Replaced with one-tap mode switch |
| Complex per-object editing | Yes | Yes | Yes, progressive disclosure |
| Batch 4K video | Queue submission | Queue submission | Queue submission; remote processing |
| Offline drafts | Yes | Yes | Yes, within storage policy |
| Install PWA | If supported | If supported | If supported |
| Custom browser/device APIs | Capability checked | Capability checked | Capability checked |

### 21.6 Safe-area, accessibility, and interaction rules

1. Use CSS `env(safe-area-inset-*)` and `100dvh`/fallbacks for bottom bars, not fixed 100vh assumptions.
2. Maintain visible selection and focus rings in light/dark themes. Support screen-reader labels, logical focus order and keyboard alternatives.
3. Provide color contrast and do not rely on a red/green-only preflight state; use text/icons.
4. Respect reduced-motion preference in transitions, auto-rotation and tutorial motion. Do not animate while a precision transform is in progress.
5. Use roving focus/accessible keyboard patterns for toolbars, menus, sliders and layer trees.
6. Support landscape and portrait; test browser zoom up to 200% and dynamic font scaling without clipped controls.
7. iOS/Android PWA installation, file APIs and push notifications have varying platform constraints—always capability-detect and provide alternative paths.

## 22. Premium visual and interaction design system

### 22.1 Design direction

**Aesthetic:** premium minimalist studio; neutral work surfaces; limited purple/indigo or another chosen accent for active tools only; crisp technical grid; monochrome chrome surrounding a full-color garment. Avoid overusing glass effects, glow, gradients or high-motion UI that compete with artwork.

**Typography:** one humanist sans family for chrome with strong small-size legibility; technical values use tabular numbers and, optionally, a monospaced accent. Font selection must support international text and extended glyph ranges with planned fallbacks.

**Spacing:** 4px foundation, 8/12/16/24/32px rhythm; 1px subtle borders; 8–12px control radius; larger radius for mobile sheets only; generous spacing around critical numeric fields.

**Components:** shadcn/ui primitives customized via semantic tokens, not scattered hard-coded color classes. Accessible popovers and modal/dialog focus handling are mandatory.

### 22.2 Required design tokens

- `--surface-canvas`, `--surface-panel`, `--surface-floating`, `--surface-hover`, `--surface-selected`.
- `--text-primary`, `--text-secondary`, `--text-muted`, `--border`, `--border-strong`, `--focus-ring`.
- `--accent`, `--accent-foreground`, `--warning`, `--danger`, `--success`, with independent icons/labels.
- `--toolbar-height`, `--inspector-width`, `--toolrail-width`, `--touch-target`, `--sheet-radius`.
- `--motion-fast` (80–140ms), `--motion-normal` (140–220ms) and reduced-motion override.
- Semantic opacity/overlay tokens for guides, zones, print masks and active selections.

### 22.3 Animation and scroll policy

Transitions support hierarchy and state comprehension, not decoration: use short opacity/transform transitions for panel changes, spring-free motion for precise art edits, and avoid layout animation that shifts the canvas under the pointer. Viewport canvases own wheel/pinch gestures only when hovered/focused; ordinary pages keep normal scrolling. Use inertial scroll for long asset lists; virtualize large layer/asset lists; retain scroll position when switching panels.

**AC:** No horizontal scrolling in standard mobile views, no overlap with notch/home indicator/keyboard, no gesture collisions on iPad, and all essential actions remain available at 320px.

---

# PART IV — PWA, OFFLINE, SYNC & PERFORMANCE

## 23. Progressive Web App (PWA) specification

### 23.1 Installability [P0]

- Valid `app/manifest.ts` or manifest JSON containing name, short name, start URL, scope, icon set, standalone display and theme/background colors.
- HTTPS in production; documented service worker lifecycle; appropriate maskable/adaptive icon artwork and launch images where supported.
- Support installation prompts where available; show platform-specific manual instructions otherwise; avoid repeatedly nagging the user.
- Test install/update/open-in-standalone modes on Chrome/Edge desktop, Android, and Safari/iOS/iPadOS supported versions.
- Preserve deep-link project launch in authenticated state; after login return to originally requested project and route.

### 23.2 Offline editing and resilience [P1]

**Offline-supported:** Previously opened project metadata, locally stored canonical design, cached low/medium garment models, selected fonts/assets, 2D edits, UI preferences, saved templates and changes queued for sync (within storage limits). 3D editing can function offline only if all required verified assets are cached and GPU support remains available.

**Online-only by default:** account authentication refresh when required, new asset uploads, access-controlled sharing, live collaboration, server-side renders, external AI, printing integration, purchase, official approval and cross-device sync.

- **PWA-01:** cache application shell and versioned static assets with stale-while-revalidate or cache-first policies suitable to type.
- **PWA-02:** never indiscriminately cache private API requests, tokens, signed URLs, or customer artwork in shared HTTP caches.
- **PWA-03:** store unsynced document draft and command log in IndexedDB, separate from service-worker asset caches.
- **PWA-04:** create stable local draft IDs and map them to server project IDs once authenticated/online.
- **PWA-05:** explicit offline status, unsynced operation count, available storage warning and retry controls.
- **PWA-06:** sync queue retries with backoff/idempotency; use browser background sync only when supported; otherwise sync on foreground reconnect.
- **PWA-07:** define clear conflict resolution: if server version diverges, offer keep local copy, open remote, or compare; never blindly overwrite.
- **PWA-08:** service worker updates should activate safely after current edits checkpoint and show non-disruptive refresh notice.
- **PWA-09:** graceful quota-exceeded behavior and selective cache cleanup; never evict unsynced changes automatically.
- **PWA-10:** installation, push, share-target, clipboard and file APIs guarded by feature tests and user consent.
- **PWA-11 [P2]:** opt-in reminders for approval requests or completed render jobs where permissions/platform support exist.
- **PWA-12 [P2]:** device-to-device open via QR/deep link to last-saved server version, respecting permissions.

### 23.3 Offline data security caveat

Browser-managed local data is not inherently an encrypted vault. Document the offline privacy model, use device-level protections when available, limit persistence of sensitive media, isolate accounts in local storage, clear user-specific caches at sign-out per security policy, and warn when user-initiated browser data clearing may delete unsynced drafts.

**AC:** Edit a pre-cached project in airplane mode, reload the installed app, preserve local changes, reconnect, and either sync cleanly or offer an explicit, lossless conflict path.

## 24. Performance and resource engineering

### 24.1 Performance service-level objectives (proposed)

| Metric / test | P0 target | Measurement context |
|---|---|---|
| Public site LCP | ≤2.5s (75th percentile) | Segmented mobile/desktop field data |
| Public site INP | ≤200ms (75th percentile) | Real user monitoring |
| Public site CLS | ≤0.1 (75th percentile) | Real user monitoring |
| Editor initial interactive shell | ≤3s target on reference broadband device | Excludes heavy first garment model download; measured lab |
| Basic edit response | Perceived immediate; 95th percentile target <100ms | Insert/select/nudge under representative layer load |
| 2D pointer interaction | 60fps target on reference devices | Layer drag/zoom scenarios |
| 3D view | 60fps target higher-tier desktop; 30fps floor on reference mid-tier mobile | Standardized model and quality tiers |
| Garment initial preview | Progressive loading with visible placeholder | Measured for asset-weight budget by network |
| Autosave status | Show locally committed quickly; sync asynchronously | Logged from command acceptance to local durability |
| Crash recovery | 100% of local committed commands recover in defined test | Fault injection / reload tests |

Performance targets must be benchmarked on named hardware, scene complexity, network and test fixtures. Device/browser behavior varies. Do not claim universal 60fps or unlimited 4K mobile export.

### 24.2 Rendering memory budgets [REVISED]

A single uncompressed 4096×4096 RGBA texture is about **64 MiB** before mipmaps and rendering overhead. Uploading it to the GPU repeatedly during every drag is wasteful, especially on phones. Adopt adaptive, separate resolutions:

- Small mobile viewport: initial dynamic artwork texture generally 512–1024 px per active region when acceptable.
- Tablet: commonly 1024–2048 px, adaptive to view and device memory.
- Desktop: commonly 2048 px active preview with 4096 px reserved for zoomed/quality modes where supported.
- Exports: generate from original vector/high-res sources at the required physical size; do not reuse low-resolution preview raster as authoritative output.
- Use region dirty flags, coalesced updates (`requestAnimationFrame` at most), idle regeneration of inactive zones, resource disposal and texture atlases only when they demonstrably help.
- Target careful heap/GPU profiling for all four garment material zones. Texture budgets are per scene, not solely per image.

### 24.3 Adaptive 3D profiles

| Profile | Typical device | Suggested controls |
|---|---|---|
| Economy | Low-memory phone / unsupported GPU features | Lower devicePixelRatio, basic light, reduced shadow, lower LOD, 2D fallback |
| Balanced | Modern phone / mid-tablet | Moderate texture, limited lights, modest antialiasing, animation on interaction |
| High | Desktop/tablet with strong GPU | High texture, shadow, AO, richer materials, optional postprocessing |
| Export | Browser offscreen or controlled render worker | Explicit pixel/frame budget, quality preset, separate GPU memory checks |

### 24.4 Loading, network and execution

- Lazy-load 3D runtime only on editor routes and only when needed; avoid shipping all three.js or AI models to landing pages.
- Store `.glb` optimized geometry, use glTF compression (Draco or Meshopt as chosen), KTX2/Basis-compressed textures if pipeline supports them, and LODs where worthwhile.
- Precompute garment zone masks, collision polygons, bake maps, thumbnails and placeholder renders during catalogue ingestion.
- Use Suspense/streaming for dashboard metadata but keep canvas operations client-side with controlled scheduling.
- Offload image processing, parsing, preview generation and optional WASM to workers; cap concurrency based on device.
- Debounce cloud autosave while making local draft durability immediate; never perform large JSON serialization on every frame.
- Virtualize large asset lists; memoize expensive inspectors; avoid putting high-frequency drag coordinates through React-wide state updates.
- Use Content Delivery Network caching for immutable public garment asset versions and signed private asset URLs with safe TTL handling.
- Limit background network traffic on cellular connections and expose manual download / full-quality options.

### 24.5 Monitoring and profiling

Measure web vitals, route timings, first garment render, interactive latency, FPS frame-time percentiles, GPU context loss, JS heap pressure, sync backlog, export duration, render queue wait, error rates and failure categories. Report by anonymized device/GPU tier and browser version, avoiding unnecessary collection of private design content.

**AC:** Editor remains usable with a 50-layer fixture at validated design size; hidden tabs stop unnecessary frame loops; 3D context loss triggers recover or 2D fallback without losing the design.

---

# PART V — IMPLEMENTATION ARCHITECTURE & INTEGRATION CONTRACTS

## 25. Recommended technology stack and responsibilities

| Layer | Recommended option | Responsibilities / design rule |
|---|---|---|
| Frontend application | Next.js App Router + TypeScript | Public SSR/SEO, authenticated routes, backend-for-frontend endpoints, studio shell; use exact supported stable release at implementation |
| Design system | Tailwind CSS + shadcn/ui (Radix-based primitives) | Semantic tokens, accessible dialogs, sheets, forms, toolbars, responsive components |
| Runtime state | Zustand + Immer; command-based undo integration | Selected tool, document commands, transient UI state, time-travel semantics; avoid unnecessary broad subscribers |
| 2D editor | Fabric.js adapter | Interactive objects, snapping, scene composition and canvas texture generation; pin tested version and use adapter abstractions |
| 3D renderer | Three.js + React Three Fiber + Drei, WebGL2 baseline | GLB loading, raycasting, UV sampling, lighting, PBR previews and view controls |
| 3D future option | WebGPU behind feature check | Experimental performance path only; not required for initial delivery |
| Persistence | Supabase Postgres + Auth + Storage | Users, orgs, projects, versions, jobs, signed assets and permission enforcement |
| Typed inputs | Zod or equivalent schema validation | Validate client and server commands; version migration and compatibility |
| Client local data | IndexedDB + durable sync coordinator | Offline working draft and selected assets; handle quota and conflicts |
| Image processing | Browser Canvas / OffscreenCanvas + optional WASM | Background removal, posterization, masks, asset preview proxies, bounded performance |
| PDFs | React-PDF or controlled PDF generation pipeline | Deterministic spec sheets/tech packs; embeds fonts, validates page boundaries |
| Browser video | Capability-tested WebCodecs/MediaRecorder/FFmpeg.wasm | Short clips where memory and browser APIs support them |
| Heavy render jobs | Dedicated worker containers + FFmpeg + controlled GPU rendering | High-resolution video, batch colorways, pro color conversions; introduced when actual demand warrants |
| Scheduling/queue | Initially Postgres job table and leased worker; optional BullMQ+Redis | Reliability, retries, progress and rate limits; Redis is not required for first release |
| CI and observability | GitHub Actions or equivalent, Playwright, Vitest, Sentry-compatible tools | Type/test gates, visual tests, web vitals, audits and error triage |

**Infrastructure decision [REVISED]:** The supplied design proposes BullMQ/Redis and GPU render workers from the outset. This is appropriate at commercial render volume, but is not required for the first usable release. Start with browser exports + a durable Postgres job table and separately operated worker only for jobs that need it. Moving to BullMQ/Redis can follow volume and SLA requirements. Next.js serverless execution alone is not a reliable long-running video encoder.

**Version policy:** Do not hard-code a now-stale Fabric.js v6 assumption; official docs at review time list a newer major line. Pin and test a known compatible version of Fabric, React, R3F, Three, Next.js and WASM tools, and protect engine integration behind tested adapters.

## 26. Core domain data model (canonical document)

### 26.1 Design for stable serialization

Persist only deterministic document data: garment/version references, unit-bearing editable layers, zone transform, palettes, rules and camera/scene presets. Keep GPU textures, `FabricObject`, `THREE.Mesh`, pointer drags, asset blobs, active hover and ephemeral editor selection **outside** the JSON document. Project snapshots must refer to immutable asset IDs, not volatile signed URLs. The backend resolves scoped URLs for runtime access.

### 26.2 Proposed TypeScript schema

```typescript
export type UUID = string;
export type Unit = 'mm' | 'in';
export type PrintMethod =
  | 'DTG' | 'DTF' | 'SCREEN_PRINT' | 'EMBROIDERY'
  | 'PUFF_PRINT' | 'SUBLIMATION' | 'HEAT_TRANSFER';
export type LayerType =
  | 'raster' | 'svg' | 'text' | 'shape' | 'path'
  | 'pattern' | 'group' | 'smart_component';

export interface ApparelDesignDocument {
  schemaVersion: 3;
  id: UUID;
  projectId: UUID;
  title: string;
  revision: number; // optimistic concurrency; bumped on accepted save
  garment: {
    catalogModelId: UUID;
    catalogAssetVersion: string;
    sizeCode: string;
    fabricPresetId: string;
    constructionVariantId?: string;
    baseColorwayId: UUID;
  };
  colorways: Colorway[];
  zones: Record<string, ZoneDesign>;
  scenePresets: ScenePreset[];
  notes?: string;
  customMetadata?: Record<string, string | number | boolean>;
}

export interface Colorway {
  id: UUID;
  name: string;
  parts: Record<string, {
    hex: string; // display preview, NOT verified print match
    validatedColorRef?: string;
    roughnessOverride?: number;
  }>;
  layerOverrides?: Record<UUID, Partial<LayerStyle>>;
}

export interface ZoneDesign {
  zoneId: string;
  printableGeometryVersion: string;
  physicalBoundsMm: { width: number; height: number };
  orderedLayerIds: UUID[];
  layers: Record<UUID, ArtworkLayer>;
  printMethod: PrintMethod;
  printProfileId?: UUID;
}

export interface ArtworkLayer {
  id: UUID;
  name: string;
  type: LayerType;
  parentId?: UUID;
  visible: boolean;
  locked: boolean;
  transform: {
    centerXmm: number;
    centerYmm: number;
    widthMm: number;
    heightMm: number;
    rotationDeg: number;
    flipX?: boolean;
    flipY?: boolean;
  };
  style: LayerStyle;
  content:
    | { kind: 'asset'; assetId: UUID; crop?: [number, number, number, number] }
    | { kind: 'text'; value: string; fontAssetId?: UUID; fontKey: string;
        fontSizePt: number; align: 'left' | 'center' | 'right';
        trackingPt?: number; lineHeight?: number; path?: string }
    | { kind: 'procedural'; generator: string; params: Record<string, unknown> };
}

export interface LayerStyle {
  opacity: number;
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay';
  finish: 'flat_ink' | 'puff' | 'embroidery' | 'metallic' | 'distressed';
  fills?: string[];
  strokes?: Array<{ color: string; widthMm: number }>;
  effectParams?: Record<string, number | string | boolean>;
}

export interface ScenePreset {
  id: UUID;
  name: string;
  environmentId: string;
  exposure: number;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fovDeg: number;
  };
  backdrop: { kind: 'transparent' | 'solid' | 'gradient' | 'scene'; value: string };
}
```

### 26.3 Transient editor state (must not pollute shared JSON)

`activeTool`, `activeZoneId`, `selectedLayerIds`, `hoveredLayerId`, `panelLayout`, `mode`, `gestureState`, `pointerPosition`, `cameraDuringDrag`, `textureDirtyZones`, `lastRenderedRevision`, `frameStats` and download progress are runtime state. A per-user UI preference may persist separately, but should never be incorrectly treated as shared design content.

### 26.4 Schema evolution

- Every persisted document carries `schemaVersion` and immutable `catalogAssetVersion`.
- Add tested `migrateV1toV2`, `migrateV2toV3` functions; preserve unknown safe extension keys if required.
- All migrations are deterministic and repeatable; record success/failure and back up prior document for recovery.
- Assets and garment templates cannot be silently replaced with incompatible UV geometry after users have saved projects.
- Run server-side Zod validation, maximum object/layer counts, numeric bounds and Unicode string limits.

## 27. 2D ↔ 3D synchronization design

### 27.1 Data flow

```text
Pointer / keyboard / stylus input
         ↓
Normalized command with input validation (e.g. MoveLayer)
         ↓
Optimistic canonical document update (local durability)
         ↓
2D adapter reconciliation + layer hit region updates
         ↓
Mark corresponding zone preview texture dirty
         ↓
Re-render dirty region in Fabric / OffscreenCanvas
         ↓
Upload a coalesced CanvasTexture to Three.js
         ↓
3D material alpha blends against true garment PBR
         ↓
Debounced save to Supabase with revision precondition
```

### 27.2 Bidirectional interaction rules

1. A gesture begins in either viewport and creates the **same domain command** (`MoveLayer`, `ResizeLayer`, `RotateLayer`, `SetText`, etc.).
2. In the 3D view, raycast the garment mesh and resolve triangle hit, barycentric coordinates, UV and garment zone.
3. Translate UV hit into the zone's own normalized coordinate system and then into physical millimeters using **the garment authoring mapping**, not a naive global constant.
4. Hit-test artwork in the canonical zone layer order via the 2D adapter's public or version-isolated APIs; avoid reliance on undocumented `findTarget()` behavior.
5. Suppress camera orbit only during intentional artwork manipulation. Support pointer capture/cancel for drag ending outside viewport.
6. End drag with a single Undo command while rendering previews smoothly at intermediate positions.
7. Report UV seams, discontinuities and ambiguous multizone crossing; route complex seam decals to a specialist bake tool.

### 27.3 Material compositing

Base PBR material is not replaced by the raw canvas texture. Sample artist-controlled alpha and mask; combine in **consistent linear/sRGB color spaces**, then evaluate cloth normals, roughness, occlusion and lighting. A simplistic fragment example conveys intent:

```glsl
vec4 art = texture2D(uArtwork, vUv);
float visibleInk = clamp(art.a * texture2D(uPrintMask, vUv).r, 0.0, 1.0);
vec3 surfaceColor = mix(baseFabricColor, art.rgb, visibleInk);
// Continue with the actual renderer's physically based lighting pipeline.
```

**Caveat:** `onBeforeCompile` patching can be renderer-version-sensitive; use a tested material adapter and visual regression tests, or a maintained custom shader approach. Preserve transparent pixels, normal/roughness maps and color management. RGBA opacity handling is distinct from simulated ink coverage.

### 27.4 Validation fixtures

- 1 px thin line, semitransparent art, light artwork on white fabric, black art on black fabric.
- Mixed vector/raster layers and grouped transforms.
- Front/back/sleeve UV islands with different orientations.
- Curved seam/collar collision and texture continuity.
- Imported SVG with nested transforms and small paths.
- Different color spaces and alpha-premultiplication paths.

**AC:** Dragging in 3D changes the same physical-layer coordinates as moving the 2D counterpart; renderer consistency is assessed by golden-image thresholds for all fixtures.

## 28. Garment 3D asset pipeline and acceptance specification

### 28.1 Master model requirements

1. Author at realistic units in Blender or approved garment software; store physical size and an explicit scale-to-meters mapping.
2. Separate semantic material zones: front torso, back torso, left/right sleeve, collar/rib, trims, seams, tags and optional hardware.
3. Provide consistent mesh orientation, transform origin, normal direction, correct tangent space and UV convention.
4. Author UV islands for each printable region with documented atlas rect, orientation, mm mapping, seam and safety margin.
5. Do not rely on a global master UV square automatically representing uniform physical lengths on curved surfaces. Provide calibration samples and per-size mapping metadata.
6. Bake or supply tested PBR maps: base color mask, normal, AO, roughness, and print mask; provide suitable color-space metadata.
7. Use optimized GLB/glTF, compression/LOD/texture encoding where supported; never ship raw high-poly garment CAD as default web asset.
8. Provide thumbnail/still fallback and explicit copyright/license metadata.
9. Produce fixed camera views, reference size, validated seam and print boundaries, and at least one reference art overlay test.
10. Run automatic pipeline validation before publishing to the catalogue and prevent removal of in-use versions.

### 28.2 Garment asset package

```text
garment-assets/{model-id}/{version}/
  model.glb
  model-preview-low.glb
  poster-front.webp
  poster-back.webp
  pbr/base_mask.ktx2
  pbr/normal.ktx2
  pbr/roughness.ktx2
  pbr/ao.ktx2
  pbr/print_masks.ktx2
  zones.json
  sizes.json
  material-presets.json
  rights.json
  qa/golden-front.png
  qa/golden-back.png
```

### 28.3 `zones.json` minimum fields

`zoneId`, `meshNames`, `uvSet`, `uvPolygon`, `uvOrientation`, `printablePolygonMm`, `safePolygonMm`, `seamPathsMm`, `landmarksMm`, `widthMm`, `heightMm`, `recommendedDecorationMethods`, `sizeOverrides`, `calibrationErrorMm`, `metadataVersion`.

**AC:** A calibrated ruler texture measuring 100 mm in each direction renders within chosen production tolerance in the intended printable area for every supported garment size.

## 29. Supabase data architecture

### 29.1 Tables and purposes

| Table | Key fields | Purpose |
|---|---|---|
| `profiles` | user_id, display_name, preferences | User information separate from Supabase Auth |
| `organizations` | id, name, slug, owner_id, billing_plan | Workspace tenancy |
| `organization_members` | org_id, user_id, role, status | Membership authorization |
| `brand_kits` | id, org_id, palette, typography_refs, metadata | Brand consistency |
| `garment_models` | id, slug, category, status | Catalogue record |
| `garment_asset_versions` | id, model_id, version, storage_keys, zones_json | Immutable geometry/material packages |
| `garment_variants` | id, model_id, size, construction_json | Compatible product and size definitions |
| `projects` | id, org_id, created_by, title, current_revision, status | Project registry |
| `project_documents` | project_id, revision, schema_version, design_state_jsonb | Current validated canonical document |
| `project_versions` | id, project_id, revision, state_hash, snapshot_jsonb, created_by | Immutable snapshots/restore |
| `assets` | id, org_id, user_id, storage_key, mime, hash, metadata | Original user/organization media |
| `asset_proxies` | id, source_asset_id, transform_key, storage_key | Derived previews |
| `templates` | id, org_id, title, source_project_revision, visibility | Reuse / marketplace |
| `collections` | id, org_id, name, metadata | Collection grouping |
| `project_collection_items` | project_id, collection_id | Membership |
| `reviews` | id, project_id, revision, state, requested_by | Approval flow |
| `review_comments` | id, review_id, author_id, zone_id, annotation_json | Structured comments |
| `approvals` | id, review_id, approved_revision, approver_id | Immutable sign-off |
| `export_jobs` | id, org_id, project_id, revision, type, state, lease, attempts | Async execution control |
| `export_artifacts` | id, job_id, output_storage_key, checksum, expires_at | Outputs and downloads |
| `production_packs` | id, project_id, approved_revision, manifest_asset_id | Factory handoff |
| `notifications` | id, user_id, event_type, state, payload | In-app events |
| `audit_logs` | id, org_id, actor_id, action, target, metadata | Security and provenance |
| `usage_events` | id, org_id, meter, quantity, idempotency_key | Quotas and billing |
| `subscriptions` [P2] | org_id, provider_id, plan, status | Optional commercial subscription |

### 29.2 Required constraints and indexing

- Foreign keys on org/project/document/assets; unique membership by (`org_id`,`user_id`).
- Unique document revision by (`project_id`,`revision`); prohibit modifying approved versions.
- Index org_id, project_id and timestamps on tenant-scoped reads; appropriate full-text index for search.
- Uniqueness of job idempotency key per project/revision/type/config hash; immutable asset object keys.
- Suitable retention and cascade policies; **do not cascade-delete exports or immutable approvals if legal/audit retention applies** without product-policy review.
- Use check constraints for valid states, quantity bounds and non-null ownership.

### 29.3 RLS and service boundaries

**Every user-facing tenant table requires RLS.** Authenticated users can access resources only via verified membership or explicitly authorized sharing. `service_role` never appears in client bundles, PWA caches or local settings. Database policies guard ordinary reads/writes while privileged workers additionally verify authorization context and ownership; client-side permission checks are only UX.

Example *illustrative* tenant read pattern (adapt actual table and role design):

```sql
create policy "members read projects"
on public.projects for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.org_id = projects.org_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  )
);
```

Security review must ensure users cannot self-escalate membership, modify `org_id` after insertion, impersonate reviewers, or write privileged project states. Add equivalent `INSERT ... WITH CHECK`, `UPDATE ... USING + WITH CHECK` and explicit DELETE policies according to role. Separate RPC / server action validates approved transitions atomically.

### 29.4 Storage buckets and object keys

- `garment-catalog-public`: public immutable model versions, optimized cache headers.
- `workspace-assets-private`: private user artwork/fonts with scoped access policies and short-lived signed reads.
- `workspace-proxies-private`: derived thumbnails/preview textures, same tenant isolation.
- `project-exports-private`: protected version-locked outputs and expiring download access.
- `public-gallery-assets`: only voluntarily published, safe public images; publishing creates distinct asset derivatives.

Key pattern: `{organization_id}/{asset_id}/{immutable-version}/{filename}` or content-addressed IDs. Sanitize displayed file names separately from paths. Implement lifecycle cleanup respecting active projects/approved packages.

### 29.5 Save and conflict protocol

1. Editor receives `project_id`, `revision`, document and project permissions.
2. User command mutates local canonical draft and creates an idempotent local operation.
3. IndexedDB checkpoints accepted changes; UI shows `Locally saved` when durable.
4. Debounced server save submits the complete validated delta/snapshot with expected `revision`.
5. Database transaction checks current revision and owner permission, accepts new version or returns typed `409_conflict` with server metadata.
6. On conflict, offer recover/compare/duplicate; never silently discard local changes.
7. Approval creates a frozen content hash and immutable revision; further modifications become a new draft revision.

**AC:** Two tabs saving the same project cannot lose edits silently, and protected asset URLs cannot be used after revocation beyond documented expiry behavior.

## 30. API routes and internal service contracts

| Route / action | Method | Role | Notes |
|---|---|---|---|
| `/api/projects` | GET / POST | Authenticated | Paginated list/create with tenant context |
| `/api/projects/:id` | GET / PATCH / DELETE | Authorized | Summary, metadata, archive/delete |
| `/api/projects/:id/document` | GET / PUT | Editor | Validated document, expected revision required on PUT |
| `/api/projects/:id/versions` | GET / POST | Reviewer/editor | Named snapshot, restore as new draft |
| `/api/garments` | GET | Signed-in/public subset | Filter validated catalogue and size compatibility |
| `/api/assets/upload-intent` | POST | Editor | MIME/size/quota validation, scoped signed upload intent |
| `/api/assets/:id` | GET / DELETE | Authorized | Metadata / safe removal checks |
| `/api/templates` | GET / POST | Authorized | Search/create versioned templates |
| `/api/preflight/:projectId` | POST | Editor/production | Version-scoped validation, warnings and blockers |
| `/api/exports` | POST | Authorized | Idempotent job enqueue, quota/accounting |
| `/api/exports/:id` | GET / DELETE | Authorized | Job status / cancellation when possible |
| `/api/exports/:id/download` | GET | Authorized | Expiring download URL with auditing |
| `/api/reviews` | POST | Editor/manager | Request review on immutable revision |
| `/api/reviews/:id/comments` | GET / POST | Invited reviewer | Validation and annotation scoping |
| `/api/reviews/:id/decision` | POST | Approver | Atomic approve/reject transaction |
| `/api/webhooks/render` | POST | Worker-only | Signed callback with nonce/replay protection |
| `/api/organizations/:id/members` | GET / POST / PATCH | Workspace admin | Invitation / role changes |
| `/api/health` | GET | Operations | Minimal no-secret health/readiness |

**Implementation notes:** Paths are illustrative, not a promise of final routing. Use CSRF mitigation where cookies and state-changing endpoints require it, server-side rate limits, authorization on every request, schema validation, object quotas and structured error codes. Do not trust the browser-supplied `user_id`, `org_id`, cost or render dimensions.

## 31. Rendering and export infrastructure: three execution tiers

### Tier A — lightweight browser output [P0]

Use a limited still-render path: clone validated render configuration; render in separate offscreen target or controlled temporary viewport resize; capture Blob and restore state in `finally`; validate max texture/renderbuffer dimension and estimated memory **before** allocation. Avoid toggling `preserveDrawingBuffer` at runtime as an all-purpose export solution. For 2D print art, export from the canonical layer composition or server renderer using source assets at physical pixel dimensions, not a screenshot of the T-shirt model.

### Tier B — medium browser media [P1]

Short previews may use `MediaRecorder`, WebCodecs or a carefully benchmarked FFmpeg.wasm pipeline depending on browser/device feature support. Note that `canvas.captureStream()` captures frames according to browser scheduling; by itself it does not guarantee an exact deterministic per-frame export. Deterministic output requires a supported frame encoder pipeline or server-controlled capture and timestamping. Show quality/time/memory estimates and a cancel button. Avoid huge in-memory raw RGBA sequences on mobile.

### Tier C — professional cloud workers [P2]

For high-resolution video, heavy render batches, complex AI or professional color conversion:

1. User submits a validated **immutable project revision** and export profile.
2. Server checks auth, plan quota, config bounds, expected cost, asset availability and idempotency key.
3. Insert a durable export job and an accounting reservation/usage event as appropriate.
4. A worker claims the job with a lease, renews heartbeat and records progress/errors.
5. Worker downloads authorized project assets through service-to-service access and verifies hashes.
6. Render in controlled environment with pinned dependency/model versions, stable lighting and camera motion.
7. Encode with native FFmpeg and verify dimensions, duration, format and output file integrity.
8. Upload into private export bucket; record artifact checksum and expiration policy.
9. Mark complete atomically and notify via status polling/realtime where supported.
10. On failure, safely retry bounded transient errors, produce diagnostic ID and reconcile quota/idempotency.

**Queue selection:** Postgres-based worker leases can serve early needs and keep the stack small. BullMQ plus Redis becomes worthwhile for high throughput, complex schedules and specialized retries. Rendering still needs actual appropriate compute (a GPU-capable container/VM if 3D hardware acceleration is required). A generic Supabase Edge Function is an orchestrator, not a guaranteed 4K video rendering machine.

### 31.1 Render lifecycle states

`draft_request → validating → queued → leased → rendering → encoding → uploading → completed`, with terminal `failed`, `cancelled` and `expired`. Persist `attempts`, `priority`, `leased_until`, `progress`, `step`, `error_code`, `worker_version`, `artifact_hashes` and billing reconciliation status.

### 31.2 Export manifest example

```json
{
  "packageVersion": 1,
  "projectId": "uuid",
  "approvedRevision": 18,
  "garmentAssetVersion": "tee-boxy-2.3",
  "colorwayId": "uuid",
  "printProfileId": "uuid",
  "units": "mm",
  "outputs": [
    {
      "zone": "front",
      "filename": "front_print.svg",
      "format": "svg",
      "physicalWidthMm": 280,
      "physicalHeightMm": 340,
      "sha256": "..."
    }
  ],
  "warningsAcknowledged": [],
  "generatedAt": "ISO-8601"
}
```

## 32. Security, privacy, IP and legal requirements

### 32.1 Security controls [P0/P1]

- **SEC-01:** Supabase RLS on private data plus direct authorization checks on routes and workers.
- **SEC-02:** Do not expose service role, privileged tokens, renderer credentials or AI-provider secrets in client bundles.
- **SEC-03:** Treat SVGs, PDFs, uploaded fonts and 3D models as untrusted; sanitize, scan and constrain parsing resources to prevent script execution/decompression bombs.
- **SEC-04:** Validate file type by content sniffing/signature as appropriate, not filename alone. Set `Content-Disposition` and CSP safe for downloaded untrusted files.
- **SEC-05:** Use signed URLs with limited scope and expiration for private files, and encrypt transport via HTTPS; avoid private cache leaks.
- **SEC-06:** Rate-limit logins, invitations, export starts, AI requests, large asset uploads and public share link attempts.
- **SEC-07:** Object/bucket quotas, max layers, max uploaded image megapixels, max vector nodes, max garment texture size and maximum export frames.
- **SEC-08:** Worker egress policies and sandboxing; never let user-provided GLTF/SVG parameters turn into arbitrary server file paths or SSRF requests.
- **SEC-09:** CSRF mitigation, secure cookies/session settings, strong CSP and dependency scans for all deployed components.
- **SEC-10:** Audit important events: membership change, asset/share publication, approval, approved export, role elevation, account deletion.
- **SEC-11:** Backups and restore drills for Postgres and documented artifact retention; test point-in-time recovery with version consistency.
- **SEC-12:** Project-specific permissions for comments, export, approve and delete; least-privilege team membership.

### 32.2 Privacy / IP and commercial requirements

- A user uploading a logo affirms they have rights to use it; platform terms and takedown workflow are needed if accepting public templates.
- AI services must explain data routing, retention, opt-out where available and generated content caveats.
- User asset ownership/usage license, export retention, template licensing, public gallery rights and organization data portability require written policy before paid launch.
- GDPR/other applicable data-rights processes depend on operating jurisdictions; obtain legal review rather than claiming automatic compliance.
- Public template/user image moderation and abuse reporting is required if opening a marketplace or public gallery.
- Encryption at rest, key management and access logging are separate from RLS; use supported platform mechanisms and validate provider controls.

### 32.3 Threat scenarios to test

Cross-tenant project ID guessing; expired share link replay; manipulated job revision; malicious SVG with embedded script; image decompression bomb; excessively large GLB; leaked signed asset URL; undo/restore referencing deleted asset; concurrent approval and document edit; worker webhook forgery; a malformed font triggering parser crash; injected AI prompt trying to expose other tenant content.

## 33. Reliability, collaboration and incident recovery

- **REL-01:** local-first optimistic commands with bounded history; persist draft within a deliberate durability interval.
- **REL-02:** autosave error handling and visible conflict recovery; never hide failed writes under a green save icon.
- **REL-03:** periodic named snapshots and on-demand restore, separate from frequent local Undo stack.
- **REL-04:** request idempotency across upload intents, exports, payments and version approval.
- **REL-05:** job lease expiration and retry with poison-job dead-letter state; bounded worker concurrency.
- **REL-06:** WebGL `contextlost/contextrestored` handling and resource disposal when route changes.
- **REL-07:** graceful degradation when Supabase unavailable: preserved local draft, read-only known-cached assets and transparent sync status.
- **REL-08:** monitoring alerts on elevated render failures, authentication incidents, slow database queries and storage usage growth.
- **REL-09:** deployment migrations executed before incompatible feature rollout; feature flags for risky 3D/export changes.
- **REL-10:** user-initiated account deletion or organization closure respects documented retention and unpaid balance/legal obligations.

**AC:** Simulate server disconnection during continuous 2D edits; recover without loss of locally committed commands and without duplicating projects after reconnect.

## 34. Internationalization, accessibility and localization [NEW]

Even if the initial launch is English-only, design the application for international users and multilingual artwork from the start. Recommended interface options are **English, Khmer and Simplified Chinese**, with other languages added through isolated translation resources.

- **I18N-01:** locale dictionaries by feature namespace; all UI copy and validation messages use translation keys, never duplicated strings in components.
- **I18N-02:** localized number, date, filesize and currency formats while canonical physical measurements remain locale-independent.
- **I18N-03:** bundled/tested font fallback across English/Khmer/Chinese in controls, text-editor canvas and exported PDFs.
- **I18N-04:** preserve original Unicode graphemes and proper text shaping (Khmer combining marks, CJK punctuation); test IME composition.
- **I18N-05:** support mixed-language artwork without unintended font substitution on another device; embed or outline where licensing permits.
- **I18N-06:** keyboard, screen reader labels, touch and contrast aligned with WCAG 2.2 AA where applicable; audit canvas alternatives.
- **I18N-07:** localization-ready project metadata, template categories and help center; avoid hardcoding English content in database enums as display labels.
- **I18N-08:** printer package filenames use safe normalized slugs plus clear human-readable display labels; preserve original text content in manifest.

**AC:** A Khmer/Chinese mixed text design reopens on desktop and mobile without lost graphemes and appears correctly in tech-pack PDF when the selected licensed font supports the characters.

## 35. Telemetry, billing and business operations [NEW]

### 35.1 Product metrics

Activation = first saveable design with at least one graphic/text layer; first-value = first successfully downloaded visual export. Measure completed onboarding, projects created, edit duration (aggregated), export success, print-preflight overrides, crash recovery, offline sync rate, performance tier distributions, shared reviews and conversion to paid plans.

### 35.2 Commercial controls

- **BIZ-01 [P1]:** per-plan storage quota, project count and eligible output presets (feature flags, not hidden broken buttons).
- **BIZ-02 [P2]:** subscription billing and invoices via selected payment provider, not card collection in the app.
- **BIZ-03 [P2]:** measurable export credits/compute usage with pre-execution estimate and cancellation/refund policy.
- **BIZ-04 [P2]:** workspace seat management, permissioned purchase approvals and usage dashboard.
- **BIZ-05 [P2]:** vendor/product pricing engine with visible source of rates and quote expiry.
- **BIZ-06 [P2]:** abuse/fraud controls on trial GPU/AI usage.
- **BIZ-07 [P2]:** organization-specific export branding and white-label review pages.

### 35.3 Proposed packaging (no prices assumed)

**Starter:** core P0 editor + low-cost exports + limited asset library.  
**Creator:** advanced templates, colorways, larger media outputs, additional versions.  
**Studio:** team space, approvals, tech packs, more exports.  
**Enterprise:** SSO, custom retention, controlled data residency where feasible, audit APIs and dedicated rendering agreements.

---

# PART VI — FRONTEND INFORMATION ARCHITECTURE & ENGINEERING PRACTICES

## 36. Route map, navigation and component ownership

```text
src/
├─ app/
│  ├─ (marketing)/
│  │  ├─ page.tsx                       # Home
│  │  ├─ features/page.tsx
│  │  ├─ pricing/page.tsx
│  │  └─ gallery/page.tsx
│  ├─ (auth)/sign-in/page.tsx
│  ├─ (workspace)/
│  │  ├─ dashboard/page.tsx
│  │  ├─ projects/page.tsx
│  │  ├─ assets/page.tsx
│  │  ├─ brands/page.tsx
│  │  ├─ templates/page.tsx
│  │  ├─ exports/page.tsx
│  │  ├─ team/page.tsx
│  │  └─ settings/page.tsx
│  ├─ studio/[projectId]/page.tsx
│  ├─ review/[shareId]/page.tsx
│  ├─ production/[projectId]/page.tsx
│  ├─ api/                              # Auth-bound BFF routes
│  └─ manifest.ts
├─ components/
│  ├─ ui/                               # shadcn based primitives
│  ├─ shell/                            # desktop/tablet/mobile navigation
│  ├─ dashboard/
│  ├─ studio/
│  │  ├─ StudioShell.tsx
│  │  ├─ StudioTopbar.tsx
│  │  ├─ ToolRail.tsx
│  │  ├─ ZoneSwitcher.tsx
│  │  ├─ LayerPanel.tsx
│  │  ├─ PropertiesInspector.tsx
│  │  ├─ MobileToolSheet.tsx
│  │  ├─ TabletInspectorDrawer.tsx
│  │  ├─ EditorViewport.tsx
│  │  ├─ editor2d/
│  │  ├─ viewer3d/
│  │  └─ export/
│  └─ review/
├─ domain/
│  ├─ schema/                           # Versioned canonical types + Zod
│  ├─ commands/                         # Editable atomic operations
│  ├─ validation/                       # Physical units and print rules
│  ├─ geometry/                         # UV ↔ zone ↔ mm mapping
│  ├─ variants/                         # Colorway and apparel settings
│  └─ migration/                        # JSON format migrations
├─ adapters/
│  ├─ fabric/                           # Version-pinned API bridge
│  ├─ three/                            # Scene/material/texture bridge
│  ├─ supabase/                         # Storage, auth, database access
│  ├─ exports/                          # Browser / server dispatch
│  └─ local-drafts/                     # IndexedDB persistence
├─ stores/
│  ├─ useStudioDocumentStore.ts
│  ├─ useStudioUiStore.ts
│  ├─ useSyncStore.ts
│  └─ useExportStore.ts
├─ workers/                             # Web workers/WASM wrappers
├─ styles/                              # Design tokens/themes
├─ i18n/                                # Locales and dictionaries
├─ tests/                               # Unit, E2E, visual, stress fixtures
└─ lib/                                 # Shared utility services

services/
├─ export-worker/                       # Separate deployable if adopted
├─ garment-asset-validator/             # Authoring QA pipeline
└─ professional-color-export/          # Optional verified pro pipeline
```

### 36.1 Separation of responsibilities

- `domain` contains no React or engine-specific imports.
- `adapters/fabric` can rebuild any scene from a canonical document and report user changes as commands.
- `adapters/three` loads verified garment assets and renders read-only state, optionally initiating normalized commands.
- The 3D stage should not make database calls directly; requests go through app services and sync coordinator.
- Components subscribe to narrow state slices; huge arrays/layers should not invalidate unrelated UI on each mouse move.
- Use shared type schemas for API responses, worker inputs and persisted versions to prevent serialization drift.

## 37. UX workflow screens and their required states

| Screen | Required elements | Required alternate states |
|---|---|---|
| Home | value proposition, try demo, showcase, device benefits | loading, signed-in CTA |
| Projects | recents, folders, create, search, sort | no projects, network error, archived, quota |
| Template picker | category, preview, garment fit, use-case filters | empty search, unavailable garment |
| Studio 2D | canvas, layer list, tools, print boundaries, save state | offline, font missing, unsupported file, selection, loading |
| Studio 3D | garment, camera, zone select, quality controls | WebGL failure, model loading, context lost, mobile reduced quality |
| Colorway manager | editable swatches and named palettes | locked palette, invalid combinations |
| Export | profiles, size, job status, destination/download | quota, device limit, worker failed, retry |
| Review | pinned version, comments, approve/reject | expired link, revoked access, superseded version |
| Production | tech pack, BOM, validation, manufacturing downloads | missing required fields, pending approval |
| Team/settings | roles, invitations, tokens/preferences | lack of permission, invalid invite |

### 37.1 Essential user notifications

- Save state changes must be textual and accessible.
- Print problems show action-oriented resolution (`Move 8 mm down`, `Use higher-resolution source`, `Switch print method`) only when mathematically justified.
- Render job result links display expiration, file size and filename.
- When a feature is device-limited, offer an equivalent alternate mode or cloud process, not a silent disappearing button.

## 38. Code quality, maintainability and development conventions

- TypeScript strict mode; no unchecked `any` in domain, API or serialization layers.
- ESLint/Prettier with consistent import ordering, typed errors and package boundaries; no duplicated coordinate conversion formulas.
- Feature-based code ownership and documented ADRs (architectural decision records) for renderer, storage, offline and collaboration decisions.
- Every complicated material shader has a versioned golden-image baseline; every core command has property/invariant tests.
- Do not bury proprietary business rules in UI components. Use domain validation with exposed test fixtures.
- Use guarded optional features, feature flags and migration-safe deployments.
- Avoid overly generic abstractions prematurely; isolate engine adapters, asset lifecycle and rendering jobs first.
- Require loading/empty/error/retry states for each async component.
- Use design tokens, not random Tailwind values, for reusable shell components.
- Document external source/license provenance for every garment model, HDR environment, texture, font and icon.

## 39. Test plan and quality gates

### 39.1 Functional and geometry tests

| Test suite | Representative cases | Exit criteria |
|---|---|---|
| Design command unit | add/delete/duplicate/move/scale/rotate/group/undo | deterministic serialization and reversible history |
| Zone geometry unit | mm ↔ UV ↔ screen, negative rotation, flipped island | round-trip within defined per-model tolerance |
| Layer fidelity | SVG, fonts, alpha, blending, nested transforms | visual regression approved per fixture |
| Material visual | white-on-white, transparent art, embroidery/puff | no alpha bleed or shader regression |
| Print rules | 100/150/300 DPI, safe zone, seam, sizes | correct warnings, documented printer profile |
| Sync / conflict | simultaneous tabs, offline edit, version collision | zero silent data loss |
| Export fidelity | dimension, file bytes, vector scaling, manifest | reproducible artifacts tied to revision |
| Permission tests | cross-org project/asset/export enumeration | no unauthorized access |
| PWA tests | install, offline, reload, update, quota failure | local draft recoverable |
| Device interaction | rotate, drag, keyboard, pen, touchscreen | no gesture overlap or obscured controls |

### 39.2 E2E matrix

- **Desktop:** latest supported Chrome, Edge, Firefox, Safari on representative operating systems; standard and high-DPI displays.
- **Tablet:** iPadOS Safari in portrait/landscape; Chrome Android tablet; with and without physical keyboard/trackpad where feasible.
- **Mobile:** 320px compact Android, mainstream Android Chrome, iPhone Safari and supported installed PWA mode; landscape and portrait.
- **Connectivity:** fast connection, moderate cellular, high latency, intermittent connection and fully offline after pre-cache.
- **Capability:** weak GPU / context-loss simulation, no WebGL, reduced motion, 200% zoom, screen reader and keyboard-only flows.
- **Assets:** large SVG, high-res raster, malicious SVG fixture, missing fonts, mixed-script typography, heavy GLB, duplicate uploads.

### 39.3 CI quality gates

1. Build and TypeScript strict checks pass.
2. Unit/schema migrations and permission tests pass.
3. P0 E2E workflows pass on test suite browsers.
4. Visual regression has reviewed baseline changes.
5. Bundle-size/performance budgets must not regress without documented exception.
6. Accessibility audit shows no critical blockers in core flows.
7. Security scan and secrets scan pass.
8. Supabase migration and RLS tests pass in isolated environment.
9. User documentation/release notes updated for feature or schema changes.

### 39.4 P0 acceptance scenario: full multi-device handoff

1. Sign in on desktop and create regular T-shirt.
2. Upload a 2000×2000 PNG and text; place artwork at exact physical dimensions.
3. Change garment/body/sleeve colors; see accurate 3D projection.
4. Save and reopen, verify all layers and zoom/camera-independent coordinates.
5. Open same project on tablet and adjust selected layer by 5 mm using stylus/touch or numeric input.
6. Open on phone, preview front/back, update text via sheet, verify no hidden controls.
7. Take phone offline and edit; force quit/relaunch PWA, confirm change retained.
8. Reconnect and sync; resolve conflict explicitly if generated.
9. Export four-angle preview; validate filenames, print preflight and exact saved project revision.
10. Attempt cross-tenant access to project and assets and confirm rejection.

**Release blocker:** A P0 path that is impossible on mobile does not meet the stated fully responsive requirement, even if the desktop version works.

---

# PART VII — ROADMAP, BUSINESS CASE, DELIVERY PLAN & NEXT FEATURES

## 40. Implementation roadmap with dependencies

The source proposed four four-week phases. That outline is useful for sequencing, but **a production-grade, cross-device 2D/3D editor, calibrated garments, offline PWA and reliable exporter cannot be responsibly guaranteed in 16 weeks without knowing team size, prebuilt assets and acceptance quality**. Use capability-based gates and estimate after a technical proof of concept.

| Phase | Scope | Exit gate | Depends on |
|---|---|---|---|
| **0: Discovery & prototyping** | UX information architecture, canonical schema, Fabric/Three compatibility spike, one high-quality garment asset, browser/device benchmarks | Verified 2D art on 3D model, physical placement feasibility, performance baseline | Approved requirements, garment asset rights |
| **1: P0 infrastructure** | Next.js shell, auth, Supabase RLS, garment catalogue, projects, assets, design tokens, shared commands, local draft storage | Secure project lifecycle and schema migrations | Phase 0 decisions |
| **2: P0 editing bridge** | Fabric 2D artboard, layers/text/images, front/back/sleeves, CanvasTexture previews, camera controls, basic preflight | Repeatable saved and reopened design with reliable visual fidelity | Phase 1 and calibrated UV asset |
| **3: P0 responsive + export** | Desktop/tablet/mobile optimized UI, safe areas, gestures, basic still export, PWA install, offline draft proof | End-to-end multi-device P0 scenario passes | Phase 2 |
| **4: Professional creation** | Garment family expansion, print materials, advanced text/patterns, colorways, print profiles, tech packs | Pilot operator can deliver factory-ready package with manual proofing | Calibrated garment pipeline |
| **5: Collaboration & media** | Reviews, comments, version approval, batches, animation presets, browser short video | Version-locked approval and media outputs meet quality targets | Phase 4 |
| **6: Scale & specialization** | Heavy render worker, AI-assisted tools, sportswear roster, ecommerce viewer, metering | Proven unit economics, security and cross-browser quality | Demand and financial justification |

### 40.1 Suggested development milestones and deliverables

**Milestone M0 — measurable feasibility:** A single 3D T-shirt model with front/back/sleeves; six sample artworks; an accurate millimeter ruler print; a basic 2D edit causing 3D update; low/mid/high hardware performance measurement; evidence of render fallbacks.

**Milestone M1 — durable project:** Create/open/rename/revision/save/restore/auth/RLS, local crash recovery, verified private uploads and image proxy generation.

**Milestone M2 — usable editor:** Layer panel, text and images, guides, snapping, physical sizing, undo, import and front/back/sleeve placement, inspect controls.

**Milestone M3 — device-ready MVP:** three explicit shells, mobile sheets, tablet stylus/touch interactions, PWA install/offline, image exports, print preflight, complete E2E matrix.

**Milestone M4 — production workflows:** garment QA ingestion, advanced material preview, colorway matrix, physical print package, tech pack PDF, sample QA.

**Milestone M5 — commercial capability:** permissioned approval, studio collaboration, video and batch export, analytics, usage management.

### 40.2 Team roles / practical responsibility

- **Product / UX lead:** workflows, device-specific prototypes, acceptance tests, copy, information hierarchy.
- **Frontend lead:** Next.js shell, shadcn system, state architecture, accessible editor controls.
- **Graphics engineer:** Fabric/Three integration, UV mapping, shaders, visual accuracy and GPU profiling.
- **3D technical artist:** reliable garment meshes, material maps, semantic zones, LOD and calibrated assets.
- **Backend engineer:** Supabase tenancy, RLS, storage lifecycle, versioning, job orchestration and permissions.
- **QA/automation:** Playwright device interactions, golden images, security regressions, offline fault testing.
- **Production advisor/print professional:** physical constraints, tolerances, print proofing and factory outputs.
- **DevOps/render engineer (later):** heavy encoder workers, isolation, observability, cost accounting.

With one developer assisted by AI, narrow first-release scope to one garment model and still exports; treat complex shaders, AI, real-time coediting and high-resolution video as optional later phases.

## 41. Risk register and design decisions

| Risk | Probability / impact | Mitigation / required decision |
|---|---|---|
| UV mapping produces wrong physical placement | High / critical | Calibrated garment metadata per size, test grid and print tolerances |
| Massive texture upload stalls mobile GPU | High / high | Adaptive resolution, dirty-zone updates, profile-based quality |
| Fabric/Three version mismatch | Medium / high | Adapter isolation, pin tested versions, golden tests |
| Complex web font/script output differs across devices | Medium / high | Font vault, coverage, shaping tests, outline/embedding policy |
| Incorrect printed color | High / high | Separate screen preview from vendor ICC proof; manual sign-off |
| Offline changes overwritten | Medium / critical | Revision preconditions, IndexedDB durability, explicit conflict UI |
| Browser 4K rendering crashes | High / medium | Memory admission check; cloud fallback; capped resolutions |
| User-supplied assets exploit parsers | Medium / critical | Sanitization, quotas, sandboxing, malware scanning |
| Unauthorized tenant asset access | Medium / critical | RLS plus API checks, private buckets, security tests |
| AI lifestyle image alters logo inaccurately | High / high | Original garment fidelity comparison, labeled synthetic previews |
| Cloud GPU costs exceed pricing | Medium / high | Job metering, quotas, batch policy, per-render unit economics |
| 'Factory ready' files require professional correction | High / high | Pilot with print shops, export profile contracts, explicit limitations |
| Feature scope delays MVP | High / high | P0/P1/P2 gates and cut line; dependency-based roadmap |

## 42. Prioritized new feature ideas beyond the original document

The following are **proposed additions**, not existing product capabilities or verified user requirements. They are selected for practical differentiation and sequencing.

| Rank | Idea | Customer value | Complexity | Suggested phase |
|---:|---|---|---|---|
| 1 | **Brand kit + locked logos** | Keeps identity consistent across garments | Low–medium | P1 |
| 2 | **Client review with visual annotations** | Reduces messy image/email feedback loops | Medium | P1 |
| 3 | **Design preflight checklist** | Prevents avoidable production errors | Medium | P0/P1 |
| 4 | **Offline local draft & conflict recovery** | Protects time spent designing | Medium–high | P0/P1 |
| 5 | **Colorway / variant compare** | Speeds brand collection decisions | Medium | P1 |
| 6 | **Teamwear name/number CSV personalization** | Adds tangible B2B volume workflow | Medium–high | P2 |
| 7 | **Automated manufacturer version lock** | Reduces 'wrong final file' incidents | Medium | P1 |
| 8 | **Reusable scene and campaign presets** | Accelerates ecommerce content generation | Medium | P1 |
| 9 | **Manufacturer print-profile library** | Bridges mockup to specific print processes | High | P1/P2 |
| 10 | **Precise production pricing estimator** | Helps commercial users quote clients | High, supplier-dependent | P2 |
| 11 | **Short-form launch kit exporter** | Gives creators ready-made social assets | Medium–high | P2 |
| 12 | **Bulk sponsor/logo replace** | Saves time for clubs and brands | Medium | P2 |
| 13 | **Embeddable 3D shop viewer** | Converts editor output into ecommerce value | High | P2 |
| 14 | **Template licensing / marketplace** | Monetization and ecosystem | Very high | P2+ |
| 15 | **AI layout quality critique** | Fast guidance without fully automated design | High, model-dependent | P2 |
| 16 | **Material sustainability metadata** | Inform better product choices with documented sources | Medium, supplier-dependent | P2 |
| 17 | **Size-specific print placement warnings** | Prevents scale inconsistencies across XS–3XL | High | P1 |
| 18 | **Digital sample review archive** | Factory iteration / audit history | Medium | P1/P2 |
| 19 | **QR-linked interactive tech pack** | Visual verification for factories | Medium | P2 |
| 20 | **Public portfolio/shareable collection** | Creator discovery and presentation | Medium | P2 |

**Highest near-term product opportunity:** Build the credible 2D ↔ 3D editor first; then add a **production preflight + version-locked tech pack + brand kit + approval workflow**. That combination creates clear professional value without requiring speculative AI capabilities.

## 43. Cost and scaling strategy

### 43.1 Low-cost first deployment

- Next.js hosted on a service compatible with its server/runtime requirements.
- Supabase handles managed Postgres/Auth/Storage and tenant-secured metadata.
- Render previews in client browser; rely on preoptimized garment models and texture maps.
- Initial still-image export and PDF generator run on client/limited API runtime only within bounded memory/time budget.
- For early async tasks, start with Postgres job records and a small worker process when necessary; no Redis service required.
- Use asset lifecycle rules and quotas before adding expensive AI/GPU operations.

### 43.2 Costs to model before paid launch

Supabase storage (originals + preview derivatives + outputs), storage egress, bandwidth for GLB/KTX2, 3D asset authoring/licensing, database writes and version snapshots, renderer GPU-minutes, encoding time, AI vendor inference, error/telemetry retention, email delivery, payment fees and customer support. Calculate expected cost per active user, per project and per rendered artifact; add explicit quota guards before unlocking large batch exports.

### 43.3 Storage sizing example (illustrative, not a forecast)

If a project has 12 MB original artwork, 4 MB previews and 20 MB final exported images, each such project can occupy around 36 MB before version snapshots and additional source media. At 10,000 projects, that illustrative mix implies about 360 GB of data. Actual footprint depends heavily on file types, deduplication, retention and video usage. Videos can dominate costs quickly.

## 44. Definition of done for 'production-ready'

A capability is not complete merely because the happy-path UI looks functional. Require:

1. Working desktop, iPad/tablet and mobile UX where feature is designated available.
2. Accessible keyboard/touch operation, loading/error/retry/empty states.
3. Durable canonical serialization and schema-version support.
4. Tenant authorization and private-asset isolation.
5. Unit/integration/E2E tests and visual baselines for renderer-affecting features.
6. Crash recovery and non-destructive Undo where applicable.
7. FPS/memory/bundle measurements against reference fixtures.
8. Documented print-method assumptions and user warnings for physical production functions.
9. Observability and rollback/feature flag strategy.
10. Updated help copy, acceptance criteria and internal support instructions.

---

# PART VIII — TECHNICAL CORRECTIONS, DECISIONS & RESEARCH

## 45. Original specification review: what was retained and what changed

| Original proposal | Decision | Rationale |
|---|---|---|
| Next.js + Tailwind + shadcn + Supabase | **Retain** | Cohesive product/application stack, with clear client/server boundaries |
| Zustand + Immer + Zundo | **Retain with adapter** | Good UI state composition; use semantic command history and avoid frame-by-frame snapshots |
| Fabric.js v6 preferred | **Revise version assumption** | Use compatible pinned stable version; Fabric officially presents a newer major release at review time |
| Three.js + R3F + Drei | **Retain** | Appropriate primary client 3D integration |
| 4096² Fabric texture refreshed every interaction | **Revise** | Excessive GPU upload/memory cost; use adaptive dirty-region previews |
| Fabric canvas as the single source of truth | **Revise** | Canonical versioned design schema must be authority; Fabric is a 2D engine adapter |
| Raycast `event.uv` straight into global mm | **Revise** | Requires per-zone atlas geometry, orientation, physical scale and seam handling |
| Direct alpha overlay into cloth color | **Retain with caveats** | Correct idea; requires color-space, transparency and shader integration tests |
| `onBeforeCompile` custom shader patch | **Conditional** | Version-sensitive path requiring maintained adapter and golden images |
| DPI threshold of 250/150 | **Make configurable** | Useful heuristic but print process and image content determine acceptability |
| 300 DPI transparent PNG automatically called CMYK | **Correct** | Most common PNG workflow is RGB/RGBA; use verified TIFF/PDF-X/ICC for professional CMYK |
| Browser 4K capture guaranteed by viewport resize | **Correct** | Limited by GPU max texture/renderbuffer size and device memory; require checks/fallback |
| `captureStream` deterministic MP4 frame stepping | **Correct** | Browser recording timing varies; deterministic frame export needs controlled encoder architecture |
| All AI background removal entirely client-side | **Conditional** | WASM may be heavy or unsupported on weak devices; optional remote path and privacy controls |
| GPU workers described as serverless | **Revise** | Long-running GPU render/FFmpeg typically needs dedicated compatible infrastructure |
| Redis/BullMQ from day one | **Defer** | Durable DB jobs or browser exports can precede advanced queue stack |
| AI lifestyle garment pixels 100% locked | **Qualify** | AI composition may still introduce seam/artifact differences; must be evaluated, not guaranteed |
| Pre-baked garment poses | **Retain conditionally** | Valid technique if animation topology/UV behavior and material alignment are confirmed |
| Tech pack from physical measurements | **Retain + manual verification** | Mesh alone does not prove factory construction, size grading or tolerances |

## 46. Decisions required before engineering kickoff

| Decision | Recommended default | Owner / validation |
|---|---|---|
| First garment | High-quality regular/boxy tee, 4 printing zones | Product + 3D artist |
| First print processes | DTG-like flat ink plus print-independent art; full printer profiles later | Product + print advisor |
| Canonical layer model | Physical-mm transforms + versioned asset IDs | Graphics lead |
| Offline capability | Pre-cached project and 2D edits; 3D when fully cached | Frontend/security |
| 3D baseline | WebGL2; WebGPU optional experiment | Graphics lead |
| First exporting | Four-angle still, simple transparent artwork, review sheet | Export lead |
| First localization | English UI, architecture for Khmer/Chinese | Product + localization QA |
| Live coedit | No, start with review+version locks | Product/backend |
| AI scope | Background removal after core editing; other AI P2 | Product and unit economics |
| Server worker | None at first unless needed; Postgres job worker later | Backend/ops |
| Public sharing | Signed/revocable read-only versioned links | Security/product |

## 47. Reference documentation (verified public sources)

The supplied document is the primary source for the original product concept. The external references below support selected implementation and compatibility recommendations; they do **not** establish that the proposed product is already built or that any package will remain unchanged.

1. **Next.js official guide — Progressive Web Applications** (manifest, service workers, installation, progressive enhancement): https://nextjs.org/docs/app/guides/progressive-web-apps
2. **Next.js official App Router guide** (application architecture): https://nextjs.org/docs/app
3. **Fabric.js official website** (current public feature set and newer major release family): https://fabricjs.com/
4. **Three/WebGL compatibility — MDN WebGL**: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API
5. **WebGPU limited browser baseline — MDN**: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
6. **Supabase Storage documentation** (storage access, image delivery, supported upload protocols): https://supabase.com/docs/guides/storage
7. **Supabase resumable uploads documentation** (TUS large uploads/recovery): https://supabase.com/docs/guides/storage/uploads/resumable-uploads
8. **Google web.dev Core Web Vitals guidance** (LCP, INP, CLS): https://web.dev/articles/vitals
9. **MDN Progressive Web Apps** (offline caches, service worker APIs and platform limits): https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps

## 48. Recommended initial implementation tickets / first sprint backlog

- **INIT-001:** create Next.js+TypeScript repository, lint/type/test scaffolding, shadcn theme and responsive shell tokens.
- **INIT-002:** create organization/project/document schema, Supabase migration and tested RLS policies.
- **INIT-003:** formalize versioned canonical document schema with Zod and sample fixtures.
- **INIT-004:** build garment authoring checklist, validated T-shirt GLB and physical zone metadata.
- **INIT-005:** implement `StudioDocumentStore` with semantic commands and Undo/Redo tests.
- **INIT-006:** build Fabric adapter for single-zone text, raster and vector with physical sizing.
- **INIT-007:** implement Three garment viewer with base material and safe camera controls.
- **INIT-008:** implement live dirty-zone preview texture bridge and test alpha/color correctness.
- **INIT-009:** build desktop 2D/3D design shell with save indicator and front/back zone selector.
- **INIT-010:** prototype tablet/mobile sheets, gestures and 320px constraint tests immediately, not after desktop is finished.
- **INIT-011:** implement IndexedDB local snapshot and startup crash recovery.
- **INIT-012:** implement still image export and print preflight with physically measured fixture.
- **INIT-013:** add 3-device E2E project creation/edit/reopen tests and GPU economy fallback.
- **INIT-014:** integrate web vitals/editor frame metrics and production error monitoring.

## 49. Final product recommendation

Release **a dependable, calibrated, device-native editor** before building a complex AI clothing-generation service. The core differentiator should be **one edit → synchronized 2D/3D result → true physical print sizing → version-locked approved output**. Make the initial garment models visually exceptional and accurately measured. A poor-quality or inaccurate garment mesh will undermine every downstream feature regardless of how polished the UI is.

The optimal near-term product sequence is: **editor credibility → production credibility → team collaboration → commercial media automation → vertical customization → AI and advanced integrations**.

---

**End of specification · Version 1.0**  
**Document type:** Product requirements + architecture + functional catalog + QA and phased delivery blueprint.  
**Reminder:** All [NEW] ideas are recommendations, and all P0/P1/P2 capabilities are planned requirements until implemented and verified.
