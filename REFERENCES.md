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
| NASA GSFC lunar eclipse figures 2024–2035 (Espenak), contact times transcribed in `src/lunarnav/oracle/reference/eclipses.yaml` | https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html (figures linked from the catalogue) | NASA GSFC public | oracle: eclipse contact times |
| Apollo Lunar Surface Journal, Sun and Earth altitude and azimuth at the Apollo sites (Scotti), copy in `src/lunarnav/oracle/reference/apollo_scotti_altaz.txt` | https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt | NASA public | oracle: Sun direction at the Apollo sites |
| LOLA illumination rasters, north pole 240 m (`AVGVISIB_65N_240M_201608`, Sun and Earth) | https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/ | NASA public data; cite Mazarico et al. 2011 | oracle: north-pole illumination and Earth visibility |
| Barker et al. 2023 simulated NAC frames and the matching 20 m NAC mosaics (`M*_20MPP_MODEL.TIF`, `M*LE/RE_20MPP.TIF`) | https://pgda.gsfc.nasa.gov/products/90 | NASA GSFC PGDA public data; cite the paper | oracle: shadows at one instant against a simulation and against real photographs |
| INPOP21a planetary and lunar ephemeris, SPICE files | https://ftp.imcce.fr/pub/ephem/planets/inpop21a/ · Fienga et al. 2021 (INPOP21a) | IMCCE, Observatoire de Paris, public | oracle: independent ephemeris |
| Lunar laser ranging normal points, Grasse 2009–2024 and Matera 2003–2024 (`OGRA0924.DAT`, `OMAT0324.DAT`) | http://polac.obspm.fr/llrdatae.html | Paris Observatory Lunar Analysis Center, public; observations by OCA Grasse and ASI Matera through the ILRS | oracle: measured station-to-reflector distance |
| ILRS station coordinates `SLRF2014_POS+VEL_2030.0_200428.snx` | https://ilrs.gsfc.nasa.gov/docs/2020/SLRF2014_POS+VEL_2030.0_200428.snx | ILRS public product | oracle: laser station positions and velocities |
| Lunar retroreflector coordinates, DE440 principal-axis frame | Park et al. 2021, AJ 161:105, Table 1, https://doi.org/10.3847/1538-3881/abd414 | published paper (open access) | oracle: reflector positions, terrain heights |
| Mission records for Blue Ghost Mission 1, SLIM and Chandrayaan-3 (times in `src/lunarnav/oracle/reference/missions.yaml`, each with its source) | Firefly Aerospace, JAXA and ISRO public statements | public statements | oracle: eclipse, sunset and local-time checks at real landing sites |
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

## Explorer walk: fact cards

The fact cards in the Explorer Walk view (`web/src/learn/walk/facts.ts`) paraphrase these pages, each read 2026-11-14.
The 3D hardware is built from simple shapes by this repo; its layout at Apollo 11 follows the NSSDCA page (EASEP about
17 m south of the LM, the laser reflector about 5 m NNW of it) and the flag article (flag about 8.2 m from the LM).

| Card | Source | License / terms |
| --- | --- | --- |
| Eagle's descent stage, moonquake detector | NASA NSSDCA, Apollo 11 Lunar Module / EASEP (1969-059C), https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-059C | US Government work, public domain |
| The Apollo 11 flag | Wikipedia, Lunar Flag Assembly, https://en.wikipedia.org/wiki/Lunar_Flag_Assembly | CC BY-SA 4.0 |
| Laser mirror | Wikipedia, Lunar Laser Ranging experiments, https://en.wikipedia.org/wiki/Lunar_Laser_Ranging_experiments | CC BY-SA 4.0 |
| Chang'e 4 lander, Yutu-2 rover | The Planetary Society, Chang'e-4, https://www.planetary.org/space-missions/change-4 | facts paraphrased |
| Blue Ghost lander | Firefly Aerospace, Blue Ghost Mission 1, https://fireflyspace.com/missions/blue-ghost-mission-1/ | facts paraphrased |
| Shackleton crater | Wikipedia, Shackleton (crater), https://en.wikipedia.org/wiki/Shackleton_(crater) | CC BY-SA 4.0 |

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

## Explorer walk: rover missions

The five playable missions in the walk view (`web/src/learn/walk/missions.ts`) follow the last five rovers that
worked on the Moon's surface as of November 2026. IM-2's MAPP was never deployed after Athena tipped over, ispace's
Tenacious was lost with its lander in 2025, and Chang'e 7 slipped to 2027.

- Yutu (Chang'e 3): Wikipedia, "Yutu (rover)", https://en.wikipedia.org/wiki/Yutu_(rover); Spaceflight101 on the
  end of mobility, https://spaceflight101.com/?p=19833
- Yutu-2 (Chang'e 4): Wikipedia, "Yutu-2", https://en.wikipedia.org/wiki/Yutu-2
- Pragyan (Chandrayaan-3): Spectroscopy, LIBS and APXS results,
  https://www.spectroscopyonline.com/view/new-discoveries-from-india-s-chandrayaan-3-rover-at-the-lunar-south-pole-using-libs-and-apxs-spectroscopy;
  Wikipedia, "Chandrayaan-3", https://en.wikipedia.org/wiki/Chandrayaan-3
- SORA-Q / LEV-2 (SLIM): Live Science,
  https://www.livescience.com/space/space-exploration/see-the-crawling-ball-shaped-rover-that-rolled-around-the-moon-during-japans-historic-first-landing
- Jinchan (Chang'e 6): Space.com, https://www.space.com/china-change-6-moon-far-side-minirover
- Chang'e 7 delay: CNN, https://www.cnn.com/2026/08/23/science/change-7-china-moon-mission-launch-postponed

## Explorer: "About" cards for each place

The "About" card for each Explorer place (`web/src/learn/siteStories.ts`) paraphrases these pages, read 2026-11-15.
Quotes are the crew's own words and the text of the Apollo 11 plaque.

- Apollo 11: NASA, "Apollo 11 Mission Overview", https://www.nasa.gov/missions/apollo/apollo-11-mission-overview/;
  Wikipedia, "Apollo 11", https://en.wikipedia.org/wiki/Apollo_11
- Blue Ghost Mission 1: Firefly Aerospace,
  https://fireflyspace.com/news/firefly-aerospace-becomes-first-commercial-company-to-successfully-land-on-the-moon/;
  SpacePolicyOnline, https://spacepolicyonline.com/news/fireflys-dazzling-images-of-earth-eclipsing-the-sun/;
  CBS News, https://www.cbsnews.com/news/sunset-on-the-moon-blue-ghost-lander-firefly-aerospace-nasa
- Shackleton crater: Scientific American, https://www.scientificamerican.com/article/new-nasa-image-of-the-moons-shackleton-crater/;
  Wikipedia, "Shackleton (crater)", https://en.wikipedia.org/wiki/Shackleton_(crater)
- Chang'e 4: Wikipedia, "Chang'e 4", https://en.wikipedia.org/wiki/Chang%27e_4; Science News Explores,
  https://www.snexplores.org/?p=3892
