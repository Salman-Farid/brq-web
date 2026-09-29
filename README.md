# BRQ DocScan

Premium web-based document scanner. Batch photo → auto-crop → perspective-correct → JPG under 400 KB, then auto-download.

## Features

- **Multi-image intake** — file picker, drag-and-drop, or mobile camera (`capture=environment`)
- **Automatic document detection** — Canny-style edge pipeline + contour/quad extraction, with intensity-region fallback
- **Perspective correction** — homography warp with bilinear sampling; natural aspect ratio preserved
- **Strict 400 KB ceiling** — binary-search JPEG quality at highest clarity; progressive downscale only if needed
- **Batch processing** — bounded concurrency (device-aware), live per-image status
- **Auto-download** — one ZIP of all completed JPGs after each processing wave
- **100% client-side** — images never leave the browser

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS
- Canvas 2D CV pipeline (no OpenCV/WASM)
- JSZip for bulk export

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Smoke test

```bash
# requires test-fixtures/ (synthetic document photos)
node scripts/smoke.mjs
```

## Deploy

Static output in `dist/`. Deployed on Vercel (`vercel.json` handles SPA rewrites).
