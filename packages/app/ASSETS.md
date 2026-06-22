# App assets (logo & icons)

Drop your logo files here and they're picked up everywhere automatically.

## In-app logo (sidebar, headers)

- **`public/logo.svg`** — preferred (crisp at any size). An SVG is ideal.
- Or **`public/logo.png`** — if you use PNG, also update the `src` in
  `src/components/Logo.tsx` from `/logo.svg` to `/logo.png`.

The renderer serves everything in `public/` at the web root, so the file is
available at `/logo.svg`. Until you add it, the sidebar shows a Lucide
fallback glyph (no broken image).

## Desktop app icon (dock / taskbar / installer)

electron-builder reads icons from the `build/` directory by default:

- **`build/icon.png`** — a single 1024×1024 PNG is enough; electron-builder
  generates the per-platform `.icns` (macOS) and `.ico` (Windows) at package
  time.
- Optionally provide `build/icon.icns` and `build/icon.ico` directly to skip
  generation.

The Electron window also uses `build/icon.png` as its window icon in dev when
present (see `electron/main.ts`).
