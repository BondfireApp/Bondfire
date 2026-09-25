# Studio canvas repair, September 2026

The goal is a practical, non-AI design editor for flyers, graphics, and layered artwork. The reference is Canva's core canvas workflow: place assets, edit text, crop and position layers, and download the result.

## Findings and changes

| Area | Finding | Result |
| --- | --- | --- |
| Transparency | The supplied screenshot shows a checkerboard inside a JPG layer. JPG cannot carry alpha. Studio provided no way to distinguish or repair this. | Image editor checks actual alpha. Click-to-remove color with connected/all-pixels modes, tolerance, erase/restore brushes, preview backgrounds, undo/redo, and PNG output. Original image retained for restoration. No AI or external image-processing service. |
| Image import | Every upload was forced into a 320×240 cover frame. | Natural proportions, page-relative size, multi-file uploads and drops, clipboard image paste, useful decode/read errors. |
| Fit and crop | Fit selector did not affect rendering; all images had rounded clipping. Moving with keyboard/numeric controls could separate crop frame and media. | Shared fit geometry for contain/cover/fill, matching preview/export, square image corners by default, optional radius, proportion lock, reset crop, replace image, consistent media translation. |
| Editing history | Inspector edits, flips and opacity changes did not create snapshots. Inline text editing was immediately cancelled by menu cleanup. | Property changes enter undo history with short typing groups. Inline text editing stays active; native text shortcuts remain available. |
| Multiple pages | Inspector callbacks could retain the previously active page. | Page changes now refresh editing and grouped-selection targets; the UI test edits page two and verifies page one is unchanged. |
| Clipboard | Internal copied layers interfered with external image paste. | Actual copy/cut payloads, unique pasted layer IDs, image-first paste, text paste, native text-input clipboard retained. |
| Position and layers | Layer controls were buried; only one-step forward/back was available. | Visible Position / Layers entry, full front/back movement, page alignment, equal spacing and group-aware positioning. Locked layers protected from edits/deletion. |
| Text | Formatting was mostly numeric; exports did not wrap. | Bold, italic, underline, wrapping, letter spacing and font readiness during export. |
| Export | Always filled the background; silently skipped failed images. | PNG with optional transparency and 1×/2×/3× size, JPG, existing print-to-PDF flow. Failed image loads stop export with an error. Output capped at 32 megapixels. |
| Persistence | Local quota errors could throw during an image edit. | Keep edits in memory, report local-save failure and retain shared-save processing. JSON backup remains available. |

## Validation

- `npm run test:studio:ui`: React interactions and native raster pixel tests. Verifies real transparent PNG output, scaled export, failed-image rejection, Inspector undo/redo, cleanup/restore, positioning, clipboard copy/image paste, and reload persistence. Uses happy-dom plus a native Canvas implementation; this is not a full Chrome visual test.
- `node scripts/studio-media-regression.mjs`: proportion and fit geometry, color removal, connected regions, group alignment, spacing, locked layers.
- Existing Studio state and encrypted-save regression suites.
- Production build.
- The broader product-reliability script reports existing FireChat Rust-storage and profile-navigation assertion failures. Those source files and assertions are unchanged by this repair.
- A cloud-browser local preview was unavailable; full desktop/mobile visual QA remains a limitation.

## Remaining product work

This is not complete Canva parity. Separate follow-up work includes advanced vector/path editing, reusable shape masks, rich mixed-style text, image adjustment filters, drag-to-reorder layers, a broader template library, version browsing, collaborative cursors, accessible keyboard alternatives to brush painting, print-grade/vector PDF export, and animation/video timelines. Current PDF export uses the browser's print workflow and rasterized pages.

The background cleanup tool removes selected colors, not semantic objects. Removing white/gray everywhere also removes matching colors inside artwork; restore brushes and undo let the user control that tradeoff. The uploaded screenshot was used for diagnosis; the user's original design was not modified by this code deployment.

## Canva reference sources

- https://www.canva.com/photo-editor/ — standard image upload, crop and adjustment workflow.
- https://www.canva.com/features/overlay-images/ — layered image composition.
- https://www.canva.com/help/resize/ — page size and aspect locking.
- https://www.canva.com/pro/transparent-images/ — transparent PNG export.
- https://www.canva.com/help/using-frames/ — reusable image frames (remaining work).
- https://www.canva.com/help/pixel-eraser/ — manual image erasing.
