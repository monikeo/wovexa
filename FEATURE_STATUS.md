# WOVEXA feature status

Every feature ID in [WOVEXA_Product_Technical_Specification.md](WOVEXA_Product_Technical_Specification.md), with what this branch actually ships. Reviewed against the code, not the plan. The original [Apparel Studio specification](Apparel_Studio_Full_Product_Technical_Specification.md) has the same 261 IDs, so this list covers both.

- **Done**: the behaviour the spec describes works in the app today.
- **Partial**: a real, working subset; the note says what is missing.
- **Not started**: nothing user-facing yet.

Nothing here has been run against a live Supabase project: the app works fully in local mode (IndexedDB), and server-side items (sync, RLS, workers, sharing) are marked accordingly.

## Summary

| Priority | Features | Done | Partial | Not started |
| --- | ---: | ---: | ---: | ---: |
| P0 | 34 | 26 | 8 | 0 |
| P1 | 88 | 39 | 31 | 18 |
| P2 | 59 | 4 | 12 | 43 |
| Platform requirements (no priority) | 80 | 41 | 22 | 17 |
| **All** | 261 | 110 | 73 | 78 |

## Accounts and onboarding

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| ACC-01 | P0 | Authentication | Partial | Supabase sign-in page and session proxy exist; runs in local mode until a Supabase project is configured. Not exercised against a live project. |
| ACC-02 | P1 | Social sign-in | Not started |  |
| ACC-03 | P0 | First-run onboarding | Done | Dashboard welcome in three steps (use case, garment colour, sample artwork or blank), then a three-tip studio walkthrough. Both skippable and shown once per device. |
| ACC-04 | P0 | User preferences | Partial | Settings: units, theme, 3D quality (per device). Default export profile, reduced-motion toggle and language not yet. |
| ACC-05 | P1 | Workspace invitation | Not started | Team page is a placeholder. |
| ACC-06 | P1 | Profile / security | Not started |  |
| ACC-07 | P1 | Activity notifications | Partial | In-app toasts for save errors, approvals and exports; no inbox. |
| ACC-08 | P2 | Organization identity | Not started |  |

## Projects

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| PRJ-01 | P0 | Create projects | Done | Blank project or from built-in/user templates; garment and colourway chosen at creation. |
| PRJ-02 | P0 | Project cards | Done | Cards with rendered thumbnail, garment, last edited and approval status. |
| PRJ-03 | P0 | CRUD | Partial | Rename, duplicate, archive/restore and confirmed delete. Delete is permanent (no retention bin). |
| PRJ-04 | P0 | Autosave / status | Partial | Saved / Saving / Unsaved / Offline / Failed-with-retry. "Sync conflict" waits for server sync. |
| PRJ-05 | P1 | Collections / folders | Not started |  |
| PRJ-06 | P1 | Search and filtering | Partial | Title search and sort. No tag, collaborator or date filters yet. |
| PRJ-07 | P1 | Project tags / notes | Not started |  |
| PRJ-08 | P1 | Project version timeline | Done | Named snapshots, restore as a new edit with a backup, structured diff between versions. |
| PRJ-09 | P1 | Bulk actions | Not started |  |
| PRJ-10 | P2 | Branching | Not started |  |

## Garments

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| GAR-01 | P0 | Starter garment | Partial | Eleven procedural garments built from pattern measurements: arc-length UVs, edge-conforming necklines and armholes, drape folds, GPU-baked AO. Every style downloads as a garment template GLB (named parts, print-layout UVs, print areas drawn on); a shape reshaped from it in Blender, Clo3D or Marvelous Designer loads back in place of the built-in one, with prints, shading, motion and renders following it. Any other garment GLB loads as a shell (Basic mode): stood upright and turned to face front, sized by girth to the chosen size, its sleeves' pose matched, and every point given the pattern's print coordinates from the nearest point of the pressed pattern, so print areas, cross-seam artwork, Place mode, motion and photoreal work on it whatever its own UVs (or none). Cloth past the pattern (a hood on a tee, a layer over the body) has no zone print but wears the colourway's fabric print, takes design areas and can be picked and dragged on; the file's credit (title, author, licence, source) shows with it. Print files still come from the pattern. No validated, calibrated GLBs ship with the app (marked uncalibrated in the UI). |
| GAR-02 | P1 | Garment types | Partial | Crew tee, oversized tee, cropped tee, long-sleeve tee, piqué polo, tank, pullover hoodie, crewneck sweatshirt, V-neck jersey, basketball jersey and Taekwondo dobok (top, pants and rank belt). No jacket, shorts or track wear yet. |
| GAR-03 | P0 | Garment zones | Done | Front, back, sleeves and, on the dobok, both legs; each garment lists only the zones it really has. Beyond them, up to 24 design areas per design, each a print area of its own size placed anywhere on the 3D garment (neck, hood, side panel, across a seam), moved, resized and turned there, designed in 2D like a zone, checked and exported with its placement in words. |
| GAR-04 | P1 | Construction variants | Partial | Per model: fit, sleeve length and cuff, neckline (crew, V, scoop, polo, hood, dobok), rib or slit hems, hood, kangaroo pocket, placket, drawcords. Not mixable per project. |
| GAR-05 | P0 | Per-zone color | Done | Per-garment colour parts (body, sleeves, collar, stitching, pants, belt with rank colours), live in 2D and 3D. |
| GAR-06 | P1 | Fabric presets | Partial | Fabric presets per garment with GSM and their own surface (jersey, piqué, fleece, mesh, rib, diamond weave). All-over fabric prints: gradient, 8 patterns, image tiles and dye effects (spiral and crumple tie-dye, acid wash, heather, dip-dye, marble). |
| GAR-07 | P1 | Size variants | Partial | Sizes from real charts (shirts K2 to 8XL, singlets, dobok 100 to 210) grade chest, length, sleeve and pants separately; a custom shape grades with them. Print areas are fixed per model, not per size. |
| GAR-08 | P1 | Tag customization | Not started |  |
| GAR-09 | P1 | Colorway manager | Partial | Create from presets, custom or colourway ideas, rename, recolour, delete, compare, switch from the command palette with a live preview. No reorder or duplicate. |
| GAR-10 | P2 | Material library (new) | Not started |  |
| GAR-11 | P2 | Custom garment intake | Partial | A brand's own garment GLB loads over a style as a shell for the look; its pattern, sizes and print areas stay the style's. The 3D model library is the app's `3d_models` folder: every GLB in it (and two levels of subfolders) is listed by file name as soon as it is added, grouped by subfolder or by the garment its name says, with its credit, and wearable from the Garment panel or as a new project. Each model shows front and back 2D views drawn from the model itself (saved beside it as Name.front.png and Name.back.png, or the designer's own flats). No intake of new patterns or zones. |
| GAR-12 | P1 | Garment compatibility warnings | Done | Preflight blocks print methods a zone does not support. |

## 2D editor (Wovexa Studio)

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| ED2-01 | P0 | Zoomable artboard | Done | Pan, fit, zoom to selection, zoom steps, rulers in mm/in, print-area outline. |
| ED2-02 | P0 | Zone artboards | Done | Four zone artboards plus any design areas; switching (tabs, Page Up/Down) keeps per-artboard layers and moves the 3D camera. |
| ED2-03 | P0 | Upload and place | Done | PNG, JPEG, WebP and sanitized SVG, checked by file signature, size and pixel count. |
| ED2-04 | P0 | Transform objects | Done | Move, resize, rotate, flip, align, nudge, duplicate; numeric fields in mm or in. |
| ED2-05 | P0 | Layer stack | Done | Select, reorder, lock, hide, rename, opacity, duplicate, multi-select, groups. |
| ED2-06 | P0 | Core text | Done | Text layers with font, weight, italic, spacing, leading, alignment, fill, outline. |
| ED2-07 | P1 | Advanced typography | Done | Arc and wave warps, outlines, shadows, 61 catalogue fonts incl. Khmer and Chinese, uploaded fonts with licence confirmation, auto-fit boxes. Shaping is the browser’s; no shaping review step. |
| ED2-08 | P0 | Align tools | Done | Align to print area or selection, distribute, snapping to artboard, centre lines and layer edges. |
| ED2-09 | P1 | Vector drawing | Partial | Rectangle, ellipse, triangle, star, polygon, heart, line, plus a library of 19 vector graphics (badges, sport, symbols, nature) with solid, gradient or pattern fills and outlines. A pen (P) draws shapes of your own: corners and dragged-out curves, closed into a shape that prints and exports as vector. No node editing after drawing, no boolean operations. |
| ED2-10 | P1 | Image adjustments | Partial | Brightness, contrast, saturation, hue, greyscale, invert, threshold (non-destructive), background removal, and crop shapes (circle, rounded, hexagon, shield, star, heart). No free crop or sharpen. |
| ED2-11 | P1 | Pattern tool | Done | Image repeat: grid, half-drop, brick, mirror; tile size, gap, angle, offset; clipped to the layer box; DPI checked per tile. |
| ED2-12 | P1 | Reusable components | Partial | Brand kit logos, user templates, graphics library and standard placements (left chest, centre chest, full front, below collar, upper back, leg and sleeve positions). No reusable component library. |
| ED2-13 | P1 | Guides and constraints | Partial | Safe-margin checks and centre snapping. No draggable guides or seam clearance. |
| ED2-14 | P0 | Undo/redo | Done | Semantic command history with merged drags and slider gestures. |
| ED2-15 | P1 | Shortcuts / commands | Partial | Command palette (Ctrl+K or ⌘K, the top bar, or the project menu on phones): every studio action by name with forgiving search, only what makes sense for the selection, recent picks first, shortcut hints, colourways previewed on the 3D garment as you move through them. Shortcuts (copy, cut and paste layers between zones and design areas, Tab through layers, rotate with comma and period, pen, artboard switching), a "Keys and gestures" reference (?), right-click/long-press/keyboard context menu, labelled undo. Keys can't be remapped. |
| ED2-16 | P1 | Color sampling | Done | Screen eyedropper (EyeDropper API, Chromium), brand swatches, hex entry, image palette extraction. |
| ED2-17 | P2 | Bulk replacement (new) | Not started |  |
| ED2-18 | P2 | Dynamic data text (new) | Not started |  |

## 3D (Wovexa 3D)

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| ED3-01 | P0 | Interactive garment | Done | Full 360° orbit, over the top and underneath, zoom, seven view presets, keyboard orbit, Safari trackpad pinch. |
| ED3-02 | P0 | Live artwork projection | Done | Per-zone canvas textures redrawn from the canonical renderer within a frame of each edit, including live drags. |
| ED3-03 | P0 | Inspect vs edit modes | Done | Orbit and Place modes with distinct pointer, touch and cursor behaviour. |
| ED3-04 | P1 | Surface selection | Done | Raycast → UV → zone millimetres → topmost layer (groups expand); switches zone when needed. |
| ED3-05 | P1 | Direct surface editing | Done | Drag across the surface, scroll/pinch to resize, Shift+scroll/twist to rotate, centre-line snap, centre kept on the print area. One undo step per gesture. |
| ED3-06 | P0 | View presets | Done | Front, back, sides, ¾, top (into the neck) and underneath (up through the hem); saved views stored in the project scene. |
| ED3-07 | P1 | Material realism | Partial | Fabric normal maps per surface, sheen, ambient occlusion baked on the GPU from the garment's real shape for every style, size and drape (outside, and the inside darkening away from the neck, hem and cuffs), soft key-light shadows that follow motion, faint cotton dye mottle, stitched and rib hems, trims drawn along the real neckline. Drape builds real folds into the mesh (pressed, natural, relaxed): hanging folds toward the hem, a waved hem, underarm gathers, sleeve twist and cuff stacking, seams kept closed. Photoreal view (toolbar) path traces the viewport in place whenever it is left still (light bounces, softbox shadows, raised ink), denoised every frame and resting at 320 samples; any interaction returns to real time. Needs WebGL 2 with float render targets. Not calibrated against a scanned garment. |
| ED3-08 | P1 | Surface finish previews | Done | Flat, puff, embroidery, metallic, distressed and cracked ink. A print-surface map per part gives real relief (bump), gloss and metal per print method; in photoreal renders each print becomes a raised ink layer with true relief. |
| ED3-09 | P1 | Studio light controls | Done | Seven lighting looks (key/fill/rim rigs, including golden hour and neon), tone (true colour, filmic AgX, cinematic ACES), exposure, light rotation, floor shadow. |
| ED3-10 | P1 | Background / stage | Done | Transparent, solid, gradient or uploaded-image backdrop; preset scenes; contact floor shadow. |
| ED3-11 | P1 | Position aids | Done | Print-area outlines and selection box on the garment; never in renders. |
| ED3-12 | P1 | 2D/3D split view | Partial | Split view; the 2D editor follows 3D drags live. No draggable divider. |
| ED3-13 | P1 | Animation presets | Partial | Motion presets: turntable, walk (an invisible walker: body bob and turn, sleeves and uniform legs swing from shoulder and hip), wind in gusts (pinned at the shoulders), hanger sway from the neck on a wooden hanger, float, and a knit reveal, with speed; all play in video, frame-exact. Procedural, not baked cloth simulation; no retail fold state. |
| ED3-14 | P2 | Cross-seam artwork | Done | Text, images and shapes projected straight onto the 3D garment, like a texture painter's decal: wrap any zone layer across seams, then drag it over the shoulder or round a side seam in Place mode (or click the garment to place it), resize and turn it like other layers, all undoable. Back faces and cloth hidden behind nearer cloth are skipped; the print fades where the cloth turns edge-on. Painted on the pressed garment so it folds with the drape, and split at each seam in the cut-and-sew panels with real bleed. Preflight says it needs sublimation or cut-and-sew. |
| ED3-15 | P2 | Side-by-side comparison (new) | Partial | Colourway comparison and batch renders use one camera. No live side-by-side 3D. |
| ED3-16 | P0 | Capability fallback | Done | No-WebGL and context-loss fallbacks keep 2D editing and print export working. |

## Print and preflight

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| PRT-01 | P0 | Physical-unit geometry | Done | Zones in millimetres from the print-area corner; tested UV mapping. |
| PRT-02 | P0 | DPI resolution audit | Done | Horizontal/vertical effective DPI from source pixels; per tile for repeats. |
| PRT-03 | P0 | Safe/bleed/no-print boundaries | Partial | Print area and safe margin per zone. No per-size polygons or seam warnings. |
| PRT-04 | P1 | Print method selector | Done | Per-zone method with only supported methods offered. |
| PRT-05 | P1 | Live preflight panel | Done | Live checks: bounds, safe margin, DPI, small text, unsupported method, raster embroidery. |
| PRT-06 | P1 | Ink color estimation | Not started | Palette extraction exists; no separations or underbase preview. |
| PRT-07 | P1 | Embroidery feasibility | Partial | Minimum text height and raster warning for embroidery; no stitch estimates. |
| PRT-08 | P1 | Print placement presets | Partial | Built-in templates for left chest, centre chest and back placements; no anchor presets per garment. |
| PRT-09 | P1 | Method-dependent artwork rule sets | Partial | Minimum text height per method; no admin rule sets. |
| PRT-10 | P1 | Warnings vs hard blockers | Partial | Errors vs warnings; exports allowed with a clear notice. No production profiles or overrides. |
| PRT-11 | P1 | Proof sheet | Done | Tech pack page with placement drawings, dimensions, colourway, content hash and sign-off; prints to PDF. Design areas appear with their artwork, method and placement in words, in the tech pack, client proof and decoration schedule. |
| PRT-12 | P2 | Vendor printer profiles (new) | Not started |  |

## Assets

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| AST-01 | P0 | Private asset library | Done | Asset library page: preview, reuse, delete only when unused. |
| AST-02 | P0 | Safe file intake | Partial | Signature sniffing, size and megapixel limits, SVG sanitization, font validation by loading. No antivirus scanning (no server yet). |
| AST-03 | P0 | Original + proxy | Partial | Originals are immutable and kept when derived copies are made. No separate proxy textures. |
| AST-04 | P1 | Upload progress and recovery | Not started | Local storage only so far. |
| AST-05 | P1 | Image operations | Partial | Background removal, adjustments and greyscale non-destructively. No trim or crop. |
| AST-06 | P1 | Vector cleanup | Not started |  |
| AST-07 | P1 | Font vault | Partial | Upload TTF/OTF/WOFF/WOFF2 with a licence statement; stored on this device; fonts and licences listed in the manifest. No glyph coverage check. |
| AST-08 | P1 | Palette extraction | Done | Dominant colours from an image, copyable, labelled as suggestions. |
| AST-09 | P1 | Asset metadata | Partial | Dimensions, file name, SHA-256 and usage locations. No licensing note or tags. |
| AST-10 | P2 | Smart asset suggestions (new) | Not started |  |
| AST-11 | P2 | Vector-to-stitch service (new) | Not started |  |

## Typography and effects

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| TYP-01 | P0 | Editable text objects | Done | Text stays editable text in the document; textures are caches. |
| TYP-02 | P1 | Curved and circular text | Done | Positive and negative arcs, grapheme-safe for Khmer combining marks. |
| TYP-03 | P1 | Text styles | Done | Fill (solid, gradient, pattern), outline, shadow, arch and wave, transforms, line height, and one-tap styles (varsity, college arch, athletic, retro, script, stencil, wave, Korean and Khmer display). |
| TYP-04 | P1 | Text legibility validation | Done | Small-text warning per print method. |
| TYP-05 | P1 | Repeat design patterns | Done | Image repeat patterns plus procedural pattern fills; parameters stay editable. |
| TYP-06 | P1 | Print finish simulation | Done | Puff relief, satin-stitch embroidery rows, foil and vinyl gloss, plastisol and DTF ink edges, and cracked vintage ink (the cracks also print). Lit in real time and path traced in photoreal renders. |
| TYP-07 | P2 | Variable design tokens (new) | Partial | Brand kit colours and fonts can be applied; no linked tokens that propagate. |
| TYP-08 | P2 | Distress controls (new) | Done | Seeded distress mask: amount, physical grain size, reseed; identical in 2D, 3D and print. |

## Variants and colourways

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| VAR-01 | P0 | Product color editor | Done | Body, sleeve, collar and stitch colours with live 3D. |
| VAR-02 | P1 | Named colorway presets | Done | Named presets, custom colourways, rename, compare. |
| VAR-03 | P1 | Variant matrices | Not started |  |
| VAR-04 | P1 | Consistency rules | Not started | Placement is shared by all colourways. |
| VAR-05 | P1 | Swatch previews | Done | Colourway comparison and batch renders use identical camera and lighting. |
| VAR-06 | P2 | Collection builder (new) | Not started |  |
| VAR-07 | P2 | Cost / lead-time estimator (new) | Not started |  |
| VAR-08 | P2 | Size/fit data (new) | Partial | Real size charts: shirts XS to 8XL and kids K2 to K14, singlets, and the dobok by height 100 to 210 (jacket, chest, sleeve, waist, pants). The 3D garment follows each measurement separately; size guide in the Garment panel; graded measurements table with tolerances and ordered quantities in the tech sheet. No fit adjustments or customer body measurements yet. |

## Media and scenes (Wovexa Render)

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| MED-01 | P0 | Four-angle images | Done | Front, back, sides and ¾ (plus saved views) as PNG, JPEG, WebP, AVIF (where the browser encodes it), TIFF or PDF. |
| MED-02 | P1 | Scene presets | Partial | Studio, shop white, daylight, dark studio, golden hour, neon, flat, each with a tone curve. No podium or ghost-mannequin scenes. |
| MED-03 | P1 | Camera controls | Done | Lens (field of view), saved views, orbit bounds, auto framing for tall frames. |
| MED-04 | P1 | Background options | Done | Transparent, colour, gradient and uploaded photo backdrops, in the view and in every render. |
| MED-05 | P1 | Still render settings | Done | 1:1, 4:5, 9:16, 16:9 at seven qualities (Low 720, Social 1080, High 1600, then 2K, 4K, 5K and 6K on the long side); the frame is outlined on the live view; quality for the lossy formats; GPU-limit checks. Real time or Photoreal (GPU path tracing, three-gpu-pathtracer): Draft, Studio and Final quality, depth of field, grain removal, progress and cancel. |
| MED-06 | P1 | Turntable clip | Done | Turntable and motion video (walk, wind, hanger, float, knit): length, turn, size, frame rate, start view, backdrop; motion plays on the video clock, frame-accurate. |
| MED-07 | P1 | Scene template saving | Partial | Saved looks (lighting, backdrop, lens) reusable across projects on this device; not shared with a workspace yet. |
| MED-08 | P2 | Keyframe timeline | Not started |  |
| MED-09 | P2 | Batch gallery generator | Done | Every colourway × every chosen view, named files or one contact sheet. |
| MED-10 | P2 | Lifestyle model images | Not started |  |
| MED-11 | P2 | 3D animation states | Partial | Static, walk, wind, hanger, float and knit states for every garment, with pressed, natural or relaxed drape. No retail fold or visible mannequin. |
| MED-12 | P2 | Campaign storyboard (new) | Not started |  |

## Export

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| EXP-01 | P0 | Immediate screen image | Done | Snapshot button saves the current view at up to twice the stage size. |
| EXP-02 | P0 | Export preset | Done | Quick front/back 4:5 export and social aspect presets in Wovexa Render. |
| EXP-03 | P1 | High-resolution image output | Done | Up to 6K (6144 px on the long side). Real-time renders in one offscreen pass up to the GPU's limit and past it in tiles of one camera, joined seamlessly. Photoreal renders in overlapping tiles, so GPU memory stays bounded; it stops at the device's largest render size. No remote fallback. |
| EXP-04 | P1 | Isolated print artwork | Done | Transparent PNG per zone and design area at true physical size and chosen DPI; finish simulation excluded. The same prints as SVG at true size (1 unit = 1 mm): text stays live text, shapes and graphics are paths, gradients stay gradients, photos and raster effects are placed images, for screen-print films, vinyl and embroidery. |
| EXP-05 | P1 | Production ZIP | Done | One production ZIP: print files (zones and design areas, optionally also as SVG) with dpi written in, screen films, team files, placement drawings, product images, client proof PDF, tech sheet, cut-and-sew panels, 3D model, colour CSV and a manifest with SHA-256 for every file. |
| EXP-06 | P1 | Tech pack PDF | Done | Two-page client proof PDF (product per colourway with colour values, then placements with sizes and methods) and a self-contained HTML tech sheet in the package. |
| EXP-07 | P1 | Export history | Partial | Export history per project in the export panel, and the Exports page for every project on the device: grouped by day, filtered by kind, searchable, with the design version, files, size, a "design changed since" flag, a link to the project and removal of a record. Exports run on the device as you wait, so there are no queued, failed or retry states and no expiry. |
| EXP-08 | P1 | Naming templates | Done | File-name templates with tokens (project, zone, colourway, size, method, size in mm, dpi, design version, date, name, number), Unicode-safe. |
| EXP-09 | P2 | Commercial video | Partial | MP4 (H.264) or WebM in the browser via WebCodecs, frame-accurate. No server pipeline. |
| EXP-10 | P2 | Professional color outputs | Partial | Screen-print colour separations (one film per ink, white underbase for dark garments, registration marks), vector SVG print files, TIFF renders (300 dpi, with transparency) and approximate CMYK in the colour CSV. No ICC-managed PDF/X or CMYK TIFF. |
| EXP-11 | P2 | One-click client media kit (new) | Partial | Package includes product images per colourway, proof PDF and a 3D model (GLB); USDZ for AR Quick Look on its own. No social crops, carousel or QR viewer yet. |
| EXP-12 | P2 | Export API (new) | Not started |  |

## Factory handoff (Wovexa Production)

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| FAC-01 | P1 | Product description | Done | Tech pack: garment, fit, fabric, GSM, colourway, size, factory contact. |
| FAC-02 | P1 | Front/back flat schematic | Done | Front/back flat drawings with placement dimensions from the document. |
| FAC-03 | P1 | Decoration schedule | Done | Zone, method, artwork, size and notes per placement. |
| FAC-04 | P1 | Component BOM | Done | Editable bill of materials; unconfirmed rows flagged. |
| FAC-05 | P1 | Construction instructions | Done | Human-written construction notes. |
| FAC-06 | P1 | Revision tracking | Done | Approved version, approver, date and content hash. |
| FAC-07 | P1 | Sample QA checklist | Done | Editable sample QA checklist. |
| FAC-08 | P2 | Manufacturer guest review | Not started |  |
| FAC-09 | P2 | Supplier quote comparison (new) | Not started |  |
| FAC-10 | P2 | Production status workflow (new) | Not started |  |

## AI (Wovexa AI)

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| AI-01 | P1 | Background removal | Partial | On-device background removal with tolerance, preview and original recovery. No manual mask cleanup. |
| AI-02 | P2 | Raster upscaling | Not started |  |
| AI-03 | P2 | Design variation suggestions | Not started |  |
| AI-04 | P2 | Color palette assistant | Done | Colourway ideas in the garment panel (or "Colourway ideas" in the command palette): tonal, complementary, analogous, triadic, split complementary and two-tone colourways in real fabric colours, built around a reference photo's colours, the garment's colour, the artwork's main ink or the brand kit. Each is scored for practical contrast: every artwork layer is checked against the fabric under it (a bold outline counts), with a tip when no one colour suits every ink. Hover to see one on the 3D garment, click to add it. Worked out on the device; the photo isn't kept. |
| AI-05 | P2 | Lifestyle scene assistant | Not started |  |
| AI-06 | P2 | Smart layout critique (new) | Not started |  |
| AI-07 | P2 | Prompt-to-pattern (new) | Not started |  |
| AI-08 | P2 | Trademark/brand usage reminder (new) | Not started |  |
| AI-09 | P2 | Accessibility-aware suggestions (new) | Not started |  |

## Brand and templates

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| BRD-01 | P1 | Brand profile | Done | Brand kits: name, colours, fonts, logos, notes; linked to projects. |
| BRD-02 | P1 | Shared brand assets | Partial | Logos in brand kits. No safe-area guides or variants. |
| BRD-03 | P1 | Template save / apply | Partial | Save and apply templates; no locked/editable element rules. |
| BRD-04 | P1 | Template metadata | Partial | Preview, name and description; no tags or licence fields. |
| BRD-05 | P1 | Team approval of assets | Not started |  |
| BRD-06 | P2 | Template marketplace (new) | Not started |  |
| BRD-07 | P2 | Style collections (new) | Not started |  |
| BRD-08 | P2 | Workspace asset quotas | Not started |  |

## Collaboration

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| COL-01 | P1 | Roles | Not started |  |
| COL-02 | P1 | Share links | Not started |  |
| COL-03 | P1 | Review mode | Not started |  |
| COL-04 | P1 | Approval states | Partial | Draft, approved and changed-since-approval with approver and version. No review or changes-requested states. |
| COL-05 | P1 | Version comparison | Partial | Structured diff of layers, text, garment, colourways and design areas (added, moved on the garment, resized, turned) between versions; no visual overlay. |
| COL-06 | P1 | Activity log | Not started |  |
| COL-07 | P2 | Live presence | Not started |  |
| COL-08 | P2 | Real-time coediting | Not started |  |
| COL-09 | P2 | External approval collection (new) | Not started |  |
| COL-10 | P2 | Brand approval gates (new) | Not started |  |

## Sports and teams

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| SPT-01 | P2 | Team kit templates | Partial | Team tee, V-neck jersey with name and number, and Dojang uniform templates; no kit system. |
| SPT-02 | P2 | Team roster import | Partial | Paste a roster (tab, comma or semicolon; header detected or columns inferred): name, number, size and any extra column. Preview count and size totals; no per-row validation UI. |
| SPT-03 | P2 | Dynamic name/number placement | Partial | {name}, {number} or any {column} in text layers, in zones or design areas (a name on the hood gets its own file per person); each person keeps the designed letter height and natural proportions, shrinking to fit the box. No manual per-person overrides. |
| SPT-04 | P2 | Sponsor placement grid | Not started |  |
| SPT-05 | P2 | Uniform consistency rule | Not started |  |
| SPT-06 | P2 | Production matrix | Partial | Per person: a folder of print files; roster.csv lists files per row and sizes.csv totals sizes. Not split by colourway or method. |
| SPT-07 | P2 | Bulk name previews | Not started |  |
| SPT-08 | P2 | Club shop collection (new) | Not started |  |

## Desktop

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| DSK-01 | – | keyboard-first professional workflow with semantic tool shortcuts, Space-to-pan only wh… | Partial | Tool shortcuts, Space-to-pan outside fields, Escape, undo/redo, zoom and arrange keys, copy/cut/paste of layers, Tab through layers, keyboard rotation, the pen, and a Keys and gestures reference (?). No command search. |
| DSK-02 | – | resizable/dockable sidebars, split-view divider, remembered panel widths and focus mode | Partial | Split view. Panels are fixed width; no resizing, docking or focus mode. |
| DSK-03 | – | right-click context menu, hover hints, precision numeric edit, drag/drop files and mult… | Done | Context menu, hover hints, numeric fields, drag-and-drop and paste of images (pasted text becomes a text layer), copy and paste of layers, multi-select. |
| DSK-04 | – | fixed, discoverable primary export | Done | Export button, project name, save state, zone tabs, zoom and preflight badge are always visible. |
| DSK-05 | – | handle ultrawide aspect ratios without stretching controls | Done | Bounded panel widths; stages fill the rest. |
| DSK-06 | – | support keyboard-only equivalent for all important tools | Done | Keyboard equivalents for 2D and 3D, including a keyboard context menu and 3D orbit/placement. |

## Tablet

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| TAB-01 | – | touch/stylus-first interaction | Done | Touch and pen first, with mouse, trackpad and keyboard alongside. |
| TAB-02 | – | pen-friendly transformation handles, optional drawing gestures, stylus hover/pressure o… | Partial | Larger touch handles. No pressure or hover features. |
| TAB-03 | – | side panels present as docked inspectors in landscape or layered sheets/drawers in port… | Done | Layers and properties as side drawers on tablets. |
| TAB-04 | – | two-finger pinch to zoom viewport | Done | Pinch zoom, two-finger pan, one-finger drag of the selected object. |
| TAB-05 | – | separate 3D orbit and object manipulation controls to prevent accidental moves from tou… | Done | Orbit and Place modes in 3D. |
| TAB-06 | – | keyboard shortcuts when a hardware keyboard is present | Done | Shortcuts work with a hardware keyboard; nothing needs a modifier on touch. |
| TAB-07 | – | support orientation change without dropping selection or unsaved state | Done | Layout responds to orientation without losing selection or edits. |
| TAB-08 | – | contextual toolbars relocate above the on-screen keyboard instead of being covered by it | Partial | Bottom sheets move above the on-screen keyboard; toolbars do not relocate. |

## Phone

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| MOB-01 | – | one principal focus mode at a time (2D or 3D) | Done | One stage at a time on phones (2D or 3D). |
| MOB-02 | – | fixed bottom primary rail with 4–5 high-frequency actions, a More menu, and a dominant… | Done | Bottom rail: Add, Layers, Edit/Style, Garment, Checks; More menu. |
| MOB-03 | – | bottom sheets for color, text, uploads, layers, dimensions and export settings | Done | Bottom sheets with swipe-to-close. |
| MOB-04 | – | minimum touch target ~44 × 44 CSS px (or more where practical), spaced to prevent accid… | Done | 44 px minimum targets on coarse pointers. |
| MOB-05 | – | pinch zoom and precise zoom slider | Done | Pinch zoom, zoom buttons, long-press menus; nothing needs hover or double-click. |
| MOB-06 | – | single-finger object move occurs only after selecting tool/object | Done | Orbit and Place toggle in 3D; one finger moves art only in Place mode. |
| MOB-07 | – | simplified layers list with large reorder handles and lock visibility | Partial | Simplified layer list with reorder buttons and lock/visibility; no drag handles. |
| MOB-08 | – | compact property editor for exact width, height, position, rotation, angle, opacity, al… | Done | Compact property sheet with exact position, size, rotation, opacity, alignment and undo. |
| MOB-09 | – | use native keyboard input types, numeric keypad for measurements, scroll-safe focus and… | Done | Decimal keypad for measurements, viewport resizes for the keyboard. |
| MOB-10 | – | in-device file picker, camera/photo library input where available, ability to accept sh… | Partial | Device file picker (offers camera and library on phones); no share-target. |
| MOB-11 | – | explicit low/medium/high 3D quality with default automatic mode | Done | Auto, low, medium and high 3D quality; renders only on change (demand frame loop). |
| MOB-12 | – | advanced options may be nested but are not silently absent | Partial | Advanced options stay reachable in sheets; no remote export routing. |

## Offline and PWA

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| PWA-01 | – | cache application shell and versioned static assets with stale-while-revalidate or cach… | Done | Service worker: cache-first static assets, network-first pages. |
| PWA-02 | – | never indiscriminately cache private API requests, tokens, signed URLs, or customer art… | Done | Never caches API, auth, cross-origin or non-GET requests. |
| PWA-03 | – | store unsynced document draft and command log in IndexedDB, separate from service-worke… | Done | Documents, versions, assets and fonts in IndexedDB, separate from caches. |
| PWA-04 | – | create stable local draft IDs and map them to server project IDs once authenticated/online | Partial | Stable local IDs; server mapping waits for sync. |
| PWA-05 | – | explicit offline status, unsynced operation count, available storage warning and retry… | Partial | Offline status and storage usage shown; no unsynced-operation count yet. |
| PWA-06 | – | sync queue retries with backoff/idempotency | Not started |  |
| PWA-07 | – | define clear conflict resolution: if server version diverges, offer keep local copy, op… | Not started |  |
| PWA-08 | – | service worker updates should activate safely after current edits checkpoint and show n… | Done | New service worker activates only when the page asks. |
| PWA-09 | – | graceful quota-exceeded behavior and selective cache cleanup | Partial | Save errors surface with retry; no selective cleanup UI. |
| PWA-10 | – | installation, push, share-target, clipboard and file APIs guarded by feature tests and… | Partial | Install, clipboard, EyeDropper and file APIs are feature-tested; no push or share-target. |
| PWA-11 | P2 | opt-in reminders for approval requests or completed render jobs where permissions/platf… | Not started |  |
| PWA-12 | P2 | device-to-device open via QR/deep link to last-saved server version, respecting permiss… | Not started |  |

## Security

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| SEC-01 | – | Supabase RLS on private data plus direct authorization checks on routes and workers | Partial | RLS migration and route checks written; not yet run against a live Supabase project. |
| SEC-02 | – | Do not expose service role, privileged tokens, renderer credentials or AI-provider secr… | Done | Only the publishable key reaches the client. |
| SEC-03 | – | Treat SVGs, PDFs, uploaded fonts and 3D models as untrusted | Partial | SVGs sanitized, fonts validated by loading, size limits. No server-side scanning yet. |
| SEC-04 | – | Validate file type by content sniffing/signature as appropriate, not filename alone | Partial | Uploads checked by content signature. No CSP headers yet. |
| SEC-05 | – | Use signed URLs with limited scope and expiration for private files, and encrypt transp… | Not started | No server storage yet. |
| SEC-06 | – | Rate-limit logins, invitations, export starts, AI requests, large asset uploads and pub… | Not started |  |
| SEC-07 | – | Object/bucket quotas, max layers, max uploaded image megapixels, max vector nodes, max… | Partial | Megapixel, file size, layer count, texture and export size limits; video length capped by the UI. |
| SEC-08 | – | Worker egress policies and sandboxing | Not started | No workers yet. |
| SEC-09 | – | CSRF mitigation, secure cookies/session settings, strong CSP and dependency scans for a… | Not started | No CSP, CSRF or dependency scanning configured yet. |
| SEC-10 | – | Audit important events: membership change, asset/share publication, approval, approved… | Not started |  |
| SEC-11 | – | Backups and restore drills for Postgres and documented artifact retention | Not started |  |
| SEC-12 | – | Project-specific permissions for comments, export, approve and delete | Not started |  |

## Reliability

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| REL-01 | – | local-first optimistic commands with bounded history | Done | Local-first commands, bounded history, debounced autosave and flush on hide. |
| REL-02 | – | autosave error handling and visible conflict recovery | Done | Failed saves show an error with retry; never shown as saved. |
| REL-03 | – | periodic named snapshots and on-demand restore, separate from frequent local Undo stack | Done | Named snapshots separate from undo, with restore. |
| REL-04 | – | request idempotency across upload intents, exports, payments and version approval | Not started |  |
| REL-05 | – | job lease expiration and retry with poison-job dead-letter state | Not started |  |
| REL-06 | – | WebGL `contextlost/contextrestored` handling and resource disposal when route changes | Done | WebGL context loss shows a restart; textures and geometry are disposed. |
| REL-07 | – | graceful degradation when Supabase unavailable: preserved local draft, read-only known-… | Done | Everything works without Supabase in local mode. |
| REL-08 | – | monitoring alerts on elevated render failures, authentication incidents, slow database… | Not started |  |
| REL-09 | – | deployment migrations executed before incompatible feature rollout | Partial | Versioned document migrations with a backup before upgrade; no feature flags. |
| REL-10 | – | user-initiated account deletion or organization closure respects documented retention a… | Not started |  |

## Language and accessibility

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| I18N-01 | – | locale dictionaries by feature namespace | Not started | Interface copy is English in components. |
| I18N-02 | – | localized number, date, filesize and currency formats while canonical physical measurem… | Partial | Measurements are locale-independent; number formats are not localized. |
| I18N-03 | – | bundled/tested font fallback across English/Khmer/Chinese in controls, text-editor canv… | Done | Khmer and Chinese fallbacks in the UI, editor canvas and renders. |
| I18N-04 | – | preserve original Unicode graphemes and proper text shaping (Khmer combining marks, CJK… | Done | Text kept as Unicode; curves and waves split by grapheme so Khmer marks stay attached. |
| I18N-05 | – | support mixed-language artwork without unintended font substitution on another device | Partial | Catalogue fonts load everywhere; uploaded fonts are device-local. No outlining. |
| I18N-06 | – | keyboard, screen reader labels, touch and contrast aligned with WCAG 2.2 AA where appli… | Partial | Labels, focus management and keyboard paths; no formal WCAG audit yet. |
| I18N-07 | – | localization-ready project metadata, template categories and help center | Not started |  |
| I18N-08 | – | printer package filenames use safe normalized slugs plus clear human-readable display l… | Done | Slugged ASCII file names; original text kept in the manifest. |

## Business

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| BIZ-01 | P1 | per-plan storage quota, project count and eligible output presets (feature flags, not h… | Not started | Pricing page is static. |
| BIZ-02 | P2 | subscription billing and invoices via selected payment provider, not card collection in… | Not started |  |
| BIZ-03 | P2 | measurable export credits/compute usage with pre-execution estimate and cancellation/re… | Not started |  |
| BIZ-04 | P2 | workspace seat management, permissioned purchase approvals and usage dashboard | Not started |  |
| BIZ-05 | P2 | vendor/product pricing engine with visible source of rates and quote expiry | Not started |  |
| BIZ-06 | P2 | abuse/fraud controls on trial GPU/AI usage | Not started |  |
| BIZ-07 | P2 | organization-specific export branding and white-label review pages | Not started |  |

## Initial delivery backlog

| ID | Priority | Feature | Status | Notes |
| --- | --- | --- | --- | --- |
| INIT-001 | – | create Next.js+TypeScript repository, lint/type/test scaffolding, shadcn theme and resp… | Done | Next.js 16 + TypeScript, ESLint, tsc and Vitest; brand tokens. |
| INIT-002 | – | create organization/project/document schema, Supabase migration and tested RLS policies | Partial | Schema, migration and RLS written; RLS not tested against a live project. |
| INIT-003 | – | formalize versioned canonical document schema with Zod and sample fixtures | Done | Zod schema, version 2, migrations and fixtures in tests. |
| INIT-004 | – | build garment authoring checklist, validated T-shirt GLB and physical zone metadata | Partial | Physical zone metadata, procedural garments, and a garment template GLB per style with the authoring rules inside it (keep part names and UVs, trims as trim_*, metres; Meshopt or uncompressed, not Draco); custom shapes are checked on load. No validated GLB authored yet. |
| INIT-005 | – | implement `StudioDocumentStore` with semantic commands and Undo/Redo tests | Done | Studio store with semantic commands and tested undo/redo. |
| INIT-006 | – | build Fabric adapter for single-zone text, raster and vector with physical sizing | Done | Fabric adapter for text, raster, vector and shapes at physical size. |
| INIT-007 | – | implement Three garment viewer with base material and safe camera controls | Done | Three.js viewer with fabric material and bounded camera. |
| INIT-008 | – | implement live dirty-zone preview texture bridge and test alpha/color correctness | Partial | Per-zone texture bridge; mapping tested, colour/alpha checked by hand. |
| INIT-009 | – | build desktop 2D/3D design shell with save indicator and front/back zone selector | Done | Desktop 2D/3D shell with save state and zone tabs. |
| INIT-010 | – | prototype tablet/mobile sheets, gestures and 320px constraint tests immediately, not af… | Done | Tablet drawers, phone sheets and gestures. |
| INIT-011 | – | implement IndexedDB local snapshot and startup crash recovery | Done | IndexedDB storage, autosave and flush on hide. |
| INIT-012 | – | implement still image export and print preflight with physically measured fixture | Done | Still images and preflight. |
| INIT-013 | – | add 3-device E2E project creation/edit/reopen tests and GPU economy fallback | Not started | No end-to-end device tests yet. |
| INIT-014 | – | integrate web vitals/editor frame metrics and production error monitoring | Not started |  |

