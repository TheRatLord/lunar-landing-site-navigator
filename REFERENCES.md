# References

Every dataset, SPICE kernel, library and image used, with source and license/terms. Add entries as they
are used (not before). The validation and research documents cite many more papers; their full lists are in
[`docs/research/literature.md`](docs/research/literature.md) and
[`docs/research/terrain-error.md`](docs/research/terrain-error.md) §12.

## SPICE kernels

All from the NAIF generic kernels, https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ (NASA/JPL NAIF,
public). Pinned by size and SHA-256 in `src/lunarnav/ephem/kernels.py`.

| File (path under the base URL) | Used for |
| --- | --- |
| `lsk/naif0012.tls` | leap seconds |
| `pck/pck00011.tpc` | planetary constants (radii) |
| `spk/planets/de440.bsp` | DE440 planetary and lunar ephemeris (1550–2650) |
| `pck/moon_pa_de440_200625.bpc` | DE440 lunar principal-axis orientation |
| `fk/satellites/moon_de440_250416.tf` | lunar frames `MOON_PA`, `MOON_ME` |
| `pck/earth_620120_260806.bpc` | Earth orientation, history to 2026-08-06 |
| `pck/earth_2026_260806_2126_predict.bpc` | Earth orientation, predict to 2126 |
| `spk/stations/earthstns_itrf93_260814.bsp` | DSN station positions |
| `fk/stations/earth_topo_260814.tf` | DSN station topocentric frames |

## Terrain

| Name | URL | License / terms | Used for |
| --- | --- | --- | --- |
| LOLA GDR polar and global DEMs (`LDEM_64`, `LDEM_60S_240M` … `LDEM_875S_5M`, `LDEM_60N_240M` … `LDEM_85N_10M`) | https://imbrium.mit.edu/DATA/LOLA_GDR/ | NASA PDS public data | terrain stores; product list in `src/lunarnav/terrain/sources.py` |
| PGDA product 78, high-resolution LOLA topography for south pole sites (26 tiles at 5 m, `*_final_adj_5mpp_surf.tif` and `*_toterr.tif`) | https://pgda.gsfc.nasa.gov/products/78 · Barker et al. 2021, PSS 203, 105119, https://doi.org/10.1016/j.pss.2020.105119 | NASA GSFC PGDA public data; cite the paper | 5 m stores and their per-pixel height error |
| SLDEM2015 (LOLA + Kaguya TC, 512 ppd tiles) | https://imbrium.mit.edu/DATA/SLDEM2015/TILES/FLOAT_IMG/ · Barker et al. 2016, Icarus 273, 346–355 | NASA PDS public data; cite the paper | on-demand windows within ±60° latitude |
| LOLA GDR `LDEM_512` | https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/ | NASA PDS public data | on-demand windows beyond ±60° latitude |

## Validation data

| Name | URL | License / terms | Used for |
| --- | --- | --- | --- |
| JPL Horizons | https://ssd.jpl.nasa.gov/horizons/ | NASA/JPL public service | ephemeris cross-check (`docs/validation/ephemeris.md` §3) |
| Mazarico et al. 2011 illumination rasters (`AVGVISIB_85S_060M` and others) | https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/ · GeoTIFF copies https://pgda.gsfc.nasa.gov/data/MoonIllumination/ | NASA public data; cite the paper | illumination and Earth visibility comparison (`docs/validation/illumination.md` §3) |
| Barker et al. 2023 PSR map `LPSR_80S_20MPP_ADJ.TIF` | https://pgda.gsfc.nasa.gov/products/90 · https://doi.org/10.3847/PSJ/acf3e1 | NASA GSFC PGDA public data; cite the paper | permanent shadow comparison (`illumination.md` §4) |
| LROC WAC polar illumination `WAC_POLE_ILL_PCT_SOUTH_100M.IMG` | LROC, Arizona State University / NASA; see `illumination.md` §6 | NASA / LROC public data | rank agreement check |
| LRO NAC images and ASU NAC DTMs | product IDs per scene in `docs/validation/imagery.md` | NASA / LROC public data | shadow comparison on real images |
| DSN Telecommunications Link Design Handbook 810-005, Module 301 | https://deepspace.jpl.nasa.gov/dsndocs/810-005/ | NASA/JPL public document | station coordinates and elevation masks (`src/lunarnav/catalog/stations.yaml`) |
| NASA lunar eclipse of 2025-03-14 (Espenak) | https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2025Mar14T.pdf | NASA GSFC public | eclipse contact timing |
| ASTM G173-03 reference spectrum (pvlib copy) | https://raw.githubusercontent.com/pvlib/pvlib-python/main/pvlib/data/ASTMG173.csv | ASTM standard data as redistributed by pvlib (BSD-3-Clause) | limb-darkening exponent weighting |
| Hestroffer & Magnan 1998 limb-darkening exponents (HM98) | see `docs/validation/visibility.md` §1.1 | published paper | Sun limb darkening |
| Solar constant, 1361 W/m² | Kopp & Lean 2011, https://doi.org/10.1029/2010GL045777 | published paper | `SOLAR_CONSTANT_W_M2` |

## Catalogue

Sites, lander profiles and ground stations (`src/lunarnav/catalog/*.yaml`) cite their own sources per entry:
URL, title and locator (page, table or row), with a confidence. Don't add an entry without them.

Mission history (`missions.yaml`, 14 landing attempts) and launch-vehicle records (`launch_vehicles.yaml`, 12 vehicles)
cite the English Wikipedia article for each mission or vehicle (CC BY-SA 4.0), read 2026-11-14, confidence medium.
Causes and lessons are paraphrased facts, not copied text; the labels await team review
(`docs/superpowers/specs/2026-11-14-history-labels-review.md`).

## Images

| Name | Source | License / terms | Used for |
| --- | --- | --- | --- |
| `web/src/learn/scene/maps/moon.jpg`, `earth.jpg` | **Source file not recorded.** The README describes them as NASA imagery (public domain) | to confirm (`docs/OPEN_QUESTIONS.md` #11) | learn-mode globe textures |
| `web/docs/screenshots/*.png`, `docs/validation/img/*.png` | made by this repo (`bun run screenshots`; the validation scripts) | MIT, with this repo | README and validation figures; computed, not AI-generated |

## Libraries

Python versions and licenses as installed in `.venv` on 2026-11-14 (from each package's metadata). Web
versions are the ranges in `web/package.json`; their licenses are as published on npm and were not re-read from
installed packages.

| Library | Version | License |
| --- | --- | --- |
| numpy | 2.5.4 | BSD-3-Clause (and bundled 0BSD, MIT, Zlib, CC0-1.0) |
| scipy | 1.18.1 | BSD-3-Clause |
| numba | 0.68.1 | BSD |
| spiceypy | 8.4.0 | MIT |
| rasterio | 1.5.2 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| pydantic | 2.14.3 | MIT |
| fastapi | 0.162.5 | MIT |
| uvicorn | 0.54.0 | BSD-3-Clause |
| sse-starlette | 3.7.0 | BSD-3-Clause |
| orjson | 3.13.0 | MPL-2.0 AND (Apache-2.0 OR MIT) |
| typer | 0.29.1 | MIT |
| PyYAML | (in `uv.lock`) | MIT |
| matplotlib | 3.11.2 | Matplotlib license (PSF-based) |
| pillow | 13.0.0 | MIT-CMU |
| weasyprint | 70.0 | BSD |
| claude-agent-sdk | 0.2.180 | MIT |
| ruff (dev) | 0.17.4 | MIT |
| react, react-dom | ^19.3 | MIT |
| react-router-dom | ^7.18 | MIT |
| zustand | ^5.1 | MIT |
| three | ^0.187 | MIT |
| react-markdown, remark-gfm, rehype-slug | ^10.1, ^4.0, ^6.0 | MIT |
| github-slugger | ^2.0 | ISC |
| highlight.js | ^11.12 | BSD-3-Clause |
| @fontsource-variable/inter, @fontsource/ibm-plex-mono | ^5.3 | SIL Open Font License 1.1 |
| vite, @vitejs/plugin-react | ^8.3, ^6.3 | MIT |
| typescript | ~6.0 | Apache-2.0 |
| eslint, typescript-eslint and plugins | ^10.14, ^8.72 | MIT |
| openapi-typescript | ^7.13 | MIT |
| playwright | ^1.65 | Apache-2.0 |
| mcp (Python, MCP server) | 2.3.0 | MIT |
| @ai-sdk/mcp (evaluator) | 2.0.99 | Apache-2.0 |
| @modelcontextprotocol/sdk (evaluator) | 1.32.2 | MIT |
| zod (evaluator) | 4.6.7 | MIT |
| promptfoo (evaluator, dev) | 0.125.1 | MIT |
| Claude Code CLI (evaluator runs `claude -p`; not bundled) | 2.1.x | Anthropic commercial terms |
