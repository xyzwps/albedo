# Albedo

**English** | [简体中文](README.zh-CN.md)

Albedo is a single-file SVG workbench that runs in the browser. Build the source into `svg-editor.html`, then double-click it to draw, import existing SVGs, adjust layers, and export clean files — no installation, sign-in, or backend required.

## Features

- **Shapes**: rectangles, ellipses, circles, polygons, lines, paths, and text.
- **SVG import**: keeps element types, coordinates, original markup, and untouched content; imported artwork becomes regular editable layers.
- **Editing and layout**: select, multi-select, marquee, move, resize, path commands and anchors, boolean operations, align and distribute.
- **Layers and canvas**: layer ordering, canvas size, grid, snapping, reference image.
- **Text**: uses local fonts and converts text to outlines on export, so files do not depend on the recipient having the same fonts.
- **Export**: download an SVG file or copy the SVG source.
- **UI languages**: Simplified Chinese / English.

You can use it as a lightweight SVG sketchpad, to organize icons, or to assemble simple vector compositions and export them into another project.

## Quick start

### Build and open

The repository does not include the build artifact. Install dependencies and build first:

```bash
npm install
npm run build
```

The built `svg-editor.html` is in the project root. Double-click to open it, or share it with someone else. **Do not edit it directly**; the next build overwrites it.

> Chrome is recommended. Text layers use local fonts and require Chrome's local-font permission.

### Common controls

- Click to select; `Shift` / `Cmd` / `Ctrl`-click to add or remove; drag on empty canvas to marquee-select.
- `R` rectangle, `O` ellipse, `C` circle, `G` polygon, `L` line, `P` path, `T` text.
- Drag a selected shape to move it; with multiple shapes selected, drag the selection frame's edges or corners to resize the group.
- `Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z` undo/redo, `Cmd/Ctrl+D` duplicate, `Backspace` delete.
- The top bar imports SVGs, copies the source, or exports a file; the canvas toolbar toggles the grid, snapping, and reference image.

## Development

Node.js and npm are required.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). The dev server watches the source directory, rebuilds the bundle when `editor.js` changes, and picks up changes after a refresh. Use `npm run build` for the production single file.

### Project layout

| Path | Contents |
| --- | --- |
| `index.html` | Development entry; loads CSS and the bundle externally |
| `editor.js` | Editor logic |
| `editor.css` | All UI styles |
| `lib/` | Standalone modules for paths, import, snapping, alignment, fonts, zoom, and more |
| `build.mjs` / `dev.mjs` | Single-file build and dev server |
| `test/` | Vitest unit tests and Playwright E2E |
| `docs/` | Behavior specs, design notes, and project docs |

See [`AGENTS.md`](AGENTS.md) for module responsibilities, implementation constraints, and test details.

### Tests

```bash
npm run test:unit   # Vitest
npm run test:e2e    # build first, then Playwright + local Chrome
npm test            # spec check + unit tests + E2E
```

E2E uses the system Chrome; no additional Playwright browser download is needed.

## Documentation

- [AGENTS.md](AGENTS.md): collaboration rules, source map, implementation notes, and testing details.
- [docs/specs/](docs/specs/): user-visible behavior specs.
- [docs/notes/](docs/notes/): design notes, persistence details, and known limitations.

## License

[MIT](LICENSE). Bundled third-party dependencies (Paper.js and opentype.js) are also MIT-licensed.