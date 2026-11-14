# Decision 0002: a fixed, hash-pinned SPICE kernel set

**Status:** accepted. Recorded on 2026-11-14 from the code (`src/lunarnav/ephem/kernels.py`) and
`docs/validation/ephemeris.md`; there was no separate record before.

## What we decided

The kernels are a fixed list, `MANIFEST`: nine NAIF generic kernels, each with its expected size and SHA-256.
A download that does not match is rejected. When NAIF moves a superseded file into `a_old_versions/`, that
location is tried next, so a pinned file stays reachable.

The lunar frame is `MOON_ME` from the DE440 kernels (`moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`).
Earth orientation uses the historical pair `earth_620120_260806.bpc` plus the long-term predict
`earth_2026_260806_2126_predict.bpc`, **not** NAIF's daily `earth_latest_high_prec.bpc`.

## Why

Every number the app shows depends on the kernels. Pinning makes a result reproducible and lets the
validation figures hold for the exact files in use. The daily Earth kernel changes every day and cannot be
pinned. What the predict kernel costs (a UT1 error of order 0.1 s, under 0.002° of Earth rotation) is far
below the engine's other errors (`CLAUDE.md` §1, precision budget).

## What it costs

Earth orientation after 2026-08-06 is a prediction. Moving to newer kernels means changing `MANIFEST`,
rerunning the ephemeris validation and updating its document; that is a stop-and-ask item (`CLAUDE.md` §1).
