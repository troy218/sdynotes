# Bundled PDF fallback fonts

Used lazily by `@font-face` in `sdynotes.css`; served by the existing Fastify asset handler at `/assets/fonts/<file>.woff2`. `apply.sh` already copies `server/`, so there is no additional deployment directory. No production npm or Python dependency was added.

| CSS alias / editor ID | Source | Intended match |
|---|---|---|
| `SDY Times` / `times` | Tinos, `@fontsource/tinos@5.3.0` | Times, Nimbus Roman, TeX Gyre Termes; generic serif fallback |
| `SDY Helvetica` / `arial` | Arimo, `@fontsource/arimo@5.3.0` | Arial, Helvetica, Nimbus Sans, TeX Gyre Heros |
| `SDY Computer Modern` / `cmroman` | Derived from CMU Serif WOFFs | Computer Modern / Latin Modern Roman |

Each family includes regular, italic, bold and bold italic. Tinos/Arimo include Latin and Greek subsets with their original Unicode ranges. CMU Serif has its original coverage. These are **fallbacks**, not extraction or redistribution of arbitrary embedded PDF font files; an unsupported proprietary face is not promised an exact match.

## Provenance and licenses

- Tinos and Arimo WOFF2 files are copied, unmodified, from the pinned Fontsource packages above. Upstream projects: <https://github.com/googlefonts/tinos>, <https://github.com/googlefonts/arimo>.
- CMU Serif WOFFs: <https://github.com/aaaakshat/cm-web-fonts/tree/master/font/Serif>.

  | Input | Git blob SHA |
  |---|---|
  | `cmunrm.woff` | `9efca1264afa69d5f0cd016b8c9f48f5144446f8` |
  | `cmunbx.woff` | `2b5444af7787ea7d00e4fcc9811d30dfbccbd3a8` |
  | `cmunti.woff` | `122340ad48803a8682b363cc83b0e99a00c80e24` |
  | `cmunbi.woff` | `e074aa650c359d42d5a7a4ca8e376c388d9f38ba` |

  `scripts/prepare-pdf-fonts.py` converts those WOFFs to WOFF2 using fontTools, and renames the derivatives internally to **SDY Academic Serif** to respect the upstream reserved family name. Glyph outlines, character maps, advances and metrics are unchanged. `SDY Computer Modern` is the CSS compatibility alias, not the upstream reserved family name. Packaging/renaming date: 2026-09-07.
- All three families are distributed under **SIL OFL 1.1**. The original copyright/license notices are retained beside the files and publicly served at the same `/assets/fonts/` prefix: `tinos-LICENSE.txt`, `arimo-LICENSE.txt`, `computer-modern-LICENSE.txt`.
- `checksums.json` records the distributed files' sizes and SHA-256 hashes.

The CSS normalizes ascent/descent/line gap to 80% / 20% / 0, without altering the fonts' outlines or point sizes. The editor still measures the actually loaded face and places each source baseline/advance independently, including during late-font loading or font failure.

## Rebuild

```sh
# Obtain the pinned Fontsource packages with npm pack, then copy their
# fonts/{tinos,arimo}-{latin,greek}-{400,700}-{normal,italic}.woff2 files
# and LICENSE files here without changing them.

# Download the four CMU WOFF blobs above to a scratch directory, then:
python -m pip install 'fonttools[woff]'
python scripts/prepare-pdf-fonts.py path/to/original-cmu-woffs
```

Review licenses and update `checksums.json` if changing a bundled font. URLs are served with immutable caching: use a new filename or versioned CSS URL when replacing a font in a future release. Browser builds, upstream archives and intermediate TTF/WOFF files must stay out of Git.
