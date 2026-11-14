"""Numba kernels of the regional layer.

Horizon geometry is that of ``lunarnav.horizon._march``: for an observer at radius ``ro`` and a terrain point
at radius ``r = R + h`` and great-circle angle ``theta`` the elevation is
``atan2(r cos(theta) - ro, r sin(theta))``, so ``tan(elevation) = cot(theta) - ro / (r sin(theta))`` is *linear
in the observer radius*.  Rays are exact great circles from the observer
(``v = cos(theta) o + sin(theta) (cos(az) n + sin(az) e)``).

Unlike the exact engine (branch and bound to 1/256 pixel with rigorous bounds), a regional ray is *sampled*:
on a distance ladder whose step is ``max(floor, d / kappa)``, reading the terrain from the pyramid level whose
pixel does not exceed that step (bilinear ``mean`` statistic).  The ladder of a *tier* is evaluated once per
node of a node grid and shared between the cells around it (see ``horizons.py``).  Errors of both
approximations are measured against the exact engine, not assumed (docs/validation/illumination.md).
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit, prange

from lunarnav.terrain._kernels import (
    P_COSR,
    P_CX,
    P_CY,
    P_CZ,
    P_ML,
    P_NLEV,
    P_PERIODIC,
    P_SINR,
    bilinear,
    f32_array,
    vec_to_rc,
)
from lunarnav.visibility.disc import _flux_fraction, _visible_area

NAN = np.nan
NEG_RAD = -0.5 * math.pi


@njit(cache=True, inline="always")
def sample_height(par, ptrs, shapes, pxs, vx, vy, vz, preq):
    """Mean height at a unit vector from the finest store with valid data, read at the coarsest pyramid
    level whose ground pixel does not exceed ``preq`` metres; NaN where no store has data."""
    for s in range(par.shape[0]):
        if par[s, P_SINR] >= 0.0:
            if par[s, P_CX] * vx + par[s, P_CY] * vy + par[s, P_CZ] * vz < par[s, P_COSR]:
                continue
        row, col = vec_to_rc(par, s, vx, vy, vz)
        if not (math.isfinite(row) and math.isfinite(col)):
            continue
        level = 0
        px = pxs[s]
        if preq >= 2.0 * px:
            level = min(int(math.log2(preq / px)), int(par[s, P_NLEV]) - 1)
        ml = int(par[s, P_ML])
        z = f32_array(ptrs, shapes, s * ml + level, 0)
        if level > 0:
            b = float(1 << level)
            off = 0.5 * (b - 1.0)
            h = bilinear(z, par[s, P_PERIODIC] != 0.0, (row - off) / b, (col - off) / b)
        else:
            h = bilinear(z, par[s, P_PERIODIC] != 0.0, row, col)
        if math.isfinite(h):
            return h
    return NAN


@njit(cache=True, parallel=True)
def ground_store(par, ptrs, shapes, pxs, vec):
    """Index (in the packed view) of the store whose level-0 composite height is used at each unit vector
    of ``vec`` (n, 3), -1 where no store has data.  Same selection rule as ``sample_height``."""
    n = vec.shape[0]
    out = np.full(n, -1, np.int32)
    for i in prange(n):
        vx, vy, vz = vec[i, 0], vec[i, 1], vec[i, 2]
        for s in range(par.shape[0]):
            if par[s, P_SINR] >= 0.0:
                if par[s, P_CX] * vx + par[s, P_CY] * vy + par[s, P_CZ] * vz < par[s, P_COSR]:
                    continue
            row, col = vec_to_rc(par, s, vx, vy, vz)
            if not (math.isfinite(row) and math.isfinite(col)):
                continue
            ml = int(par[s, P_ML])
            z = f32_array(ptrs, shapes, s * ml, 0)
            if math.isfinite(bilinear(z, par[s, P_PERIODIC] != 0.0, row, col)):
                out[i] = s
                break
    return out


@njit(cache=True, parallel=True)
def heights(par, ptrs, shapes, pxs, vec):
    """Level-0 composite heights (m) at the unit vectors ``vec`` (n, 3)."""
    n = vec.shape[0]
    out = np.empty(n)
    for i in prange(n):
        out[i] = sample_height(par, ptrs, shapes, pxs, vec[i, 0], vec[i, 1], vec[i, 2], 0.0)
    return out


REFINE_WINDOW_RAD = math.radians(1.0)
REFINE_ITERATIONS = 14
GOLDEN = 0.6180339887498949


@njit(cache=True, inline="always")
def _tan_elev(par, ptrs, shapes, pxs, up, dx, dy, dz, i, th, preq, radius, ro):
    """``tan(elevation)`` at ground angle ``th`` along one ray for observer radius ``ro`` (-inf without terrain)."""
    c = math.cos(th)
    sn = math.sin(th)
    vx = c * up[i, 0] + sn * dx
    vy = c * up[i, 1] + sn * dy
    vz = c * up[i, 2] + sn * dz
    h = sample_height(par, ptrs, shapes, pxs, vx, vy, vz, preq)
    if not math.isfinite(h):
        return -np.inf
    return c / sn - ro / ((radius + h) * sn)


@njit(cache=True, parallel=True)
def march(par, ptrs, shapes, pxs, up, north, east, ro, caz, saz, ct, st, preq, radius, out):
    """Horizon elevation (rad) along the distance ladder ``(ct, st, preq)`` for every observer and azimuth.

    ``up/north/east`` (n, 3) observer frames, ``ro`` (n, K) observer radii (the same rays are evaluated for K
    radii), ``caz/saz`` cos/sin of the azimuths, ``out`` (n, K, n_az); -pi/2 where no sample has terrain.

    The ladder alone steps over a crest that lies between two samples (a post line of the terrain grid is a
    kink of the bilinear surface and the horizon is the value *at* it).  Every ladder sample that is a local
    maximum of the elevation and within ``REFINE_WINDOW_RAD`` of the best is therefore refined by a
    golden-section search of the elevation between its two neighbours.
    """
    n, nk, na = out.shape
    ns = ct.size
    th_s = np.arctan2(st, ct)
    for idx in prange(n * na):
        i = idx // na
        k = idx % na
        dx = caz[k] * north[i, 0] + saz[k] * east[i, 0]
        dy = caz[k] * north[i, 1] + saz[k] * east[i, 1]
        dz = caz[k] * north[i, 2] + saz[k] * east[i, 2]
        best = np.full(nk, -np.inf)
        tt = np.full((nk, ns), -np.inf)
        for j in range(ns):
            vx = ct[j] * up[i, 0] + st[j] * dx
            vy = ct[j] * up[i, 1] + st[j] * dy
            vz = ct[j] * up[i, 2] + st[j] * dz
            h = sample_height(par, ptrs, shapes, pxs, vx, vy, vz, preq[j])
            if not math.isfinite(h):
                continue
            inv = 1.0 / ((radius + h) * st[j])
            cot = ct[j] / st[j]
            for q in range(nk):
                t = cot - ro[i, q] * inv
                tt[q, j] = t
                if t > best[q]:
                    best[q] = t
        for q in range(nk):
            if best[q] == -np.inf:
                continue
            thr = math.tan(max(math.atan(best[q]) - REFINE_WINDOW_RAD, -1.5))
            top = best[q]
            for j in range(ns):
                tj = tt[q, j]
                if tj < thr or tj == -np.inf:
                    continue
                if j > 0 and tt[q, j - 1] > tj:
                    continue
                if j < ns - 1 and tt[q, j + 1] > tj:
                    continue
                a = th_s[j - 1] if j > 0 else th_s[j]
                b = th_s[j + 1] if j < ns - 1 else th_s[j]
                if b <= a:
                    continue
                c1 = b - GOLDEN * (b - a)
                c2 = a + GOLDEN * (b - a)
                f1 = _tan_elev(par, ptrs, shapes, pxs, up, dx, dy, dz, i, c1, preq[j], radius, ro[i, q])
                f2 = _tan_elev(par, ptrs, shapes, pxs, up, dx, dy, dz, i, c2, preq[j], radius, ro[i, q])
                for _ in range(REFINE_ITERATIONS):
                    if f1 > top:
                        top = f1
                    if f2 > top:
                        top = f2
                    if f1 >= f2:
                        b = c2
                        c2 = c1
                        f2 = f1
                        c1 = b - GOLDEN * (b - a)
                        f1 = _tan_elev(par, ptrs, shapes, pxs, up, dx, dy, dz, i, c1, preq[j], radius, ro[i, q])
                    else:
                        a = c1
                        c1 = c2
                        f1 = f2
                        c2 = a + GOLDEN * (b - a)
                        f2 = _tan_elev(par, ptrs, shapes, pxs, up, dx, dy, dz, i, c2, preq[j], radius, ro[i, q])
                if f1 > top:
                    top = f1
                if f2 > top:
                    top = f2
            best[q] = top
        for q in range(nk):
            out[i, q, k] = math.atan(best[q]) if best[q] > -np.inf else NEG_RAD


@njit(cache=True, inline="always")
def _interp_az(prof, a_deg):
    """Linear interpolation of a profile on the uniform azimuth grid at ``a_deg`` (wraps)."""
    n = prof.size
    u = (a_deg % 360.0) * n / 360.0
    i = int(math.floor(u))
    f = u - i
    i0 = i % n
    return prof[i0] * (1.0 - f) + prof[(i0 + 1) % n] * f


@njit(cache=True, parallel=True)
def merge_tier(out, far, node_ro, cell_ro, cell_gamma, node_gamma, nidx, wgt):
    """``out[c, k] = max(out[c, k], tier horizon at cell c)`` (degrees).

    ``far`` (n_node, K, n_az) degrees on node azimuths; ``node_ro`` (n_node, K) ascending radii; ``nidx``
    (n_cell, 4) node indices with bilinear weights ``wgt`` (n_cell, 4).  The node azimuth with the same
    map direction as cell azimuth ``a`` is ``a + gamma_cell - gamma_node`` (conformal map); the value is
    interpolated linearly in the observer radius.
    """
    nc, na = out.shape
    nk = far.shape[1]
    for c in prange(nc):
        for k in range(na):
            a = k * 360.0 / na
            acc = 0.0
            for q in range(4):
                w = wgt[c, q]
                if w == 0.0:
                    continue
                nd = nidx[c, q]
                an = a + cell_gamma[c] - node_gamma[nd]
                ro = cell_ro[c]
                if nk == 1 or ro <= node_ro[nd, 0]:
                    v = _interp_az(far[nd, 0], an)
                elif ro >= node_ro[nd, nk - 1]:
                    v = _interp_az(far[nd, nk - 1], an)
                else:
                    m = 0
                    while m < nk - 2 and ro > node_ro[nd, m + 1]:
                        m += 1
                    t = (ro - node_ro[nd, m]) / (node_ro[nd, m + 1] - node_ro[nd, m])
                    v = (1.0 - t) * _interp_az(far[nd, m], an) + t * _interp_az(far[nd, m + 1], an)
                acc += w * v
            if acc > out[c, k]:
                out[c, k] = acc


@njit(cache=True, inline="always")
def _horizon_range(grid, a0, half):
    """Min and max of the piecewise-linear horizon over the azimuths ``[a0 - half, a0 + half]``."""
    n = grid.size
    step = 360.0 / n
    am = a0 % 360.0
    k_lo = int(math.floor((am - half) / step))
    k_hi = int(math.ceil((am + half) / step))
    lo = np.inf
    hi = -np.inf
    for k in range(k_lo, k_hi + 1):
        v = grid[k % n]
        if v < lo:
            lo = v
        if v > hi:
            hi = v
    return lo, hi


@njit(cache=True)
def disc_fractions(grid, a0, e0, s, alpha, inv, gn, gw, want_flux):
    """(area fraction, limb-darkened flux fraction) of a disc against ``grid`` (degrees, 360/N spacing).

    Same exact piecewise-linear integration as ``visibility.disc`` with a cheap bracket test first.
    """
    cosel = max(math.cos(math.radians(e0)), 1e-6)
    lo, hi = _horizon_range(grid, a0, s / cosel + 360.0 / grid.size)
    if e0 - s >= hi:
        return 1.0, 1.0
    if e0 + s <= lo:
        return 0.0, 0.0
    area = _visible_area(a0, e0, s, grid, lo, hi)
    fa = area / (math.pi * s * s)
    if not want_flux or fa <= 0.0 or fa >= 1.0 or alpha <= 0.0:
        return fa, fa
    return fa, _flux_fraction(a0, e0, s, grid, lo, hi, alpha, inv, gn, gw)


@njit(cache=True, inline="always")
def _longest(flag, value):
    """Longest run of ``flag == value``: (length, run touches the first or last sample)."""
    n = flag.size
    best = 0
    cens = False
    run = 0
    for t in range(n):
        if flag[t] == value:
            run += 1
            touch = (t - run + 1 == 0) or (t == n - 1)
            if run > best:
                best = run
                cens = touch
            elif run == best and touch:
                cens = True
        else:
            run = 0
    return best, cens


@njit(cache=True, inline="always")
def _target_track(pos, dlt, rkm, sx, sy, sz, ux, uy, uz, ex, ey, ez, nx, ny, nz, t):
    """Apparent azimuth, elevation and angular radius (deg) of a target at epoch ``t`` seen from ``s``."""
    dx = pos[t, 0] - sx
    dy = pos[t, 1] - sy
    dz = pos[t, 2] - sz
    rng = math.sqrt(dx * dx + dy * dy + dz * dz)
    px = dx / rng + dlt[t, 0]
    py = dy / rng + dlt[t, 1]
    pz = dz / rng + dlt[t, 2]
    nrm = math.sqrt(px * px + py * py + pz * pz)
    px /= nrm
    py /= nrm
    pz /= nrm
    el = math.degrees(math.asin(min(1.0, max(-1.0, px * ux + py * uy + pz * uz))))
    az = math.degrees(math.atan2(px * ex + py * ey + pz * ez, px * nx + py * ny + pz * nz)) % 360.0
    return az, el, math.degrees(math.asin(min(1.0, rkm / rng)))


@njit(cache=True, parallel=True)
def series_stats(hz, offsets, up, east, north, spos, sun_pos, sun_d, r_sun, e_pos, e_d, r_earth, do_earth,
                 sun_rule, earth_rule, earth_margin, alpha, gn, gw, out_f, out_i):  # fmt: skip
    """Per-cell visibility statistics over an epoch grid.

    ``hz`` (n_cell, n_az) horizon (deg, true azimuth); ``offsets`` (n_b,) horizon shifts (deg) giving the bracket
    variants; ``up/east/north`` (n_cell, 3) observer frames; ``spos`` (n_cell, 3) observer positions (km, ME);
    ``*_pos`` (n_t, 3) target positions (km, ME, light-time corrected), ``*_d`` (n_t, 3) the aberration shift of
    the apparent direction (uniform over the region), ``r_*`` target radii (km).
    ``sun_rule`` 0: sunlit when any part of the disc is visible, 1: when the limb-darkened flux fraction >= 1/2.
    ``earth_rule`` 0: visible when the centre clears the horizon by ``earth_margin`` deg, 1: any part.
    ``out_f[c, b, :]``: mean area fraction, mean flux fraction, any-part fraction, sunlit fraction (by
    ``sun_rule``), Earth-visible fraction.  ``out_i[c, b, :]``: longest sunlit run, longest shadow run, longest
    Earth outage (samples), censoring flags (bit 0 sunlit run, 1 shadow run, 2 outage touch an end).
    """
    nc = hz.shape[0]
    nb = offsets.size
    nt = sun_pos.shape[0]
    inv = 2.0 / alpha if alpha > 0.0 else 0.0
    for c in prange(nc):
        if not math.isfinite(hz[c, 0]):
            out_f[c, :, :] = NAN
            out_i[c, :, :] = -1
            continue
        sa = np.empty(nt)
        se = np.empty(nt)
        sr = np.empty(nt)
        ea = np.empty(nt)
        ee = np.empty(nt)
        er = np.empty(nt)
        for t in range(nt):
            sa[t], se[t], sr[t] = _target_track(
                sun_pos, sun_d, r_sun, spos[c, 0], spos[c, 1], spos[c, 2], up[c, 0], up[c, 1], up[c, 2],
                east[c, 0], east[c, 1], east[c, 2], north[c, 0], north[c, 1], north[c, 2], t)
            if do_earth:
                ea[t], ee[t], er[t] = _target_track(
                    e_pos, e_d, r_earth, spos[c, 0], spos[c, 1], spos[c, 2], up[c, 0], up[c, 1], up[c, 2],
                    east[c, 0], east[c, 1], east[c, 2], north[c, 0], north[c, 1], north[c, 2], t)
        g = np.empty(hz.shape[1])
        lit = np.empty(nt, np.bool_)
        evis = np.empty(nt, np.bool_)
        for b in range(nb):
            for k in range(hz.shape[1]):
                g[k] = hz[c, k] + offsets[b]
            sum_a = 0.0
            sum_f = 0.0
            n_any = 0
            n_lit = 0
            n_earth = 0
            for t in range(nt):
                fa, ff = disc_fractions(g, sa[t], se[t], sr[t], alpha, inv, gn, gw, True)
                sum_a += fa
                sum_f += ff
                if fa > 0.0:
                    n_any += 1
                lit[t] = (fa > 0.0) if sun_rule == 0 else (ff >= 0.5)
                if lit[t]:
                    n_lit += 1
                if do_earth:
                    if earth_rule == 0:
                        n = g.size
                        u = (ea[t] % 360.0) * n / 360.0
                        i0 = int(math.floor(u))
                        f = u - i0
                        hh = g[i0 % n] * (1.0 - f) + g[(i0 + 1) % n] * f
                        evis[t] = ee[t] - earth_margin >= hh
                    else:
                        fe, _ = disc_fractions(g, ea[t], ee[t], er[t], 0.0, 0.0, gn, gw, False)
                        evis[t] = fe > 0.0
                    if evis[t]:
                        n_earth += 1
            l1, c1 = _longest(lit, True)
            l2, c2 = _longest(lit, False)
            flags = (1 if c1 else 0) | (2 if c2 else 0)
            l3 = 0
            if do_earth:
                l3, c3 = _longest(evis, False)
                flags |= 4 if c3 else 0
            out_f[c, b, 0] = sum_a / nt
            out_f[c, b, 1] = sum_f / nt
            out_f[c, b, 2] = n_any / nt
            out_f[c, b, 3] = n_lit / nt
            out_f[c, b, 4] = n_earth / nt if do_earth else NAN
            out_i[c, b, 0] = l1
            out_i[c, b, 1] = l2
            out_i[c, b, 2] = l3
            out_i[c, b, 3] = flags
