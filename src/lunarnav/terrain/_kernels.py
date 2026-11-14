"""Numba kernels over a packed terrain stack: composite height and rigorous upper bounds over discs.

The packed stack is ``(par, ptrs, shapes)``:

* ``par``    float64 ``(S, 16)`` per-store parameters (``P_*`` indices), stores ordered finest first;
* ``ptrs``   int64 ``(S*ML, 3)`` addresses of the memory-mapped ``mean`` (float32), ``max`` (float32) and
  ``cov`` (uint8) arrays of store ``s`` at level ``k`` in row ``s*ML + k`` (``ML`` = max levels; 0 if absent);
* ``shapes`` int64 ``(S*ML, 2)`` their ``(rows, cols)``.

Arrays are rebuilt from raw addresses (``numba.carray``) instead of being passed as typed lists: list
items are reference counted, and the atomic increments on shared array meta-info serialise 16 threads.
The caller keeps the memory maps alive (``PackedStack.keepalive``).

Composite terrain: at a point, the height of the first store (in order) whose four surrounding pixel
centres are all valid.  The composite upper bound over a disc is the union of the cell maxima of every
store consulted until one covers the whole box with fully valid cells.
"""

from __future__ import annotations

import math

import numpy as np
from numba import carray, njit, types
from numba.extending import intrinsic

P_KIND, P_POLE, P_R, P_X0, P_Y0, P_DX, P_DY, P_NC, P_NR, P_PERIODIC, P_NLEV, P_ML = range(12)
P_CX, P_CY, P_CZ, P_COSR, P_SINR = range(12, 17)
N_PAR = 18
NAN = np.nan


@intrinsic
def _f32_ptr(typingctx, addr):
    sig = types.CPointer(types.float32)(types.intp)

    def codegen(context, builder, signature, args):
        return builder.inttoptr(args[0], context.get_value_type(signature.return_type))

    return sig, codegen


@intrinsic
def _u8_ptr(typingctx, addr):
    sig = types.CPointer(types.uint8)(types.intp)

    def codegen(context, builder, signature, args):
        return builder.inttoptr(args[0], context.get_value_type(signature.return_type))

    return sig, codegen


@njit(cache=True, inline="always")
def f32_array(ptrs, shapes, idx, which):
    """float32 2-D array of statistic ``which`` (0 mean, 1 max) at flat level index ``idx``."""
    return carray(_f32_ptr(ptrs[idx, which]), (shapes[idx, 0], shapes[idx, 1]))


@njit(cache=True, inline="always")
def u8_array(ptrs, shapes, idx):
    """uint8 coverage array at flat level index ``idx``."""
    return carray(_u8_ptr(ptrs[idx, 2]), (shapes[idx, 0], shapes[idx, 1]))


@njit(cache=True, inline="always")
def vec_to_rc(par, s, vx, vy, vz):
    """Unit vector in the ME frame -> continuous (row, col) in store ``s`` (NaN if unprojectable)."""
    if par[s, P_KIND] == 0.0:
        den = 1.0 + par[s, P_POLE] * vz
        if den < 1e-9:
            return NAN, NAN
        k = 2.0 * par[s, P_R] / den
        x = k * vy
        y = -par[s, P_POLE] * k * vx
        return (y - par[s, P_Y0]) / par[s, P_DY], (x - par[s, P_X0]) / par[s, P_DX]
    lat = math.degrees(math.asin(min(1.0, max(-1.0, vz))))
    lon = math.degrees(math.atan2(vy, vx))
    x = par[s, P_X0] + (lon - par[s, P_X0]) % 360.0
    col = (x - par[s, P_X0]) / par[s, P_DX]
    if par[s, P_PERIODIC] != 0.0:
        col = col % par[s, P_NC]
    return (lat - par[s, P_Y0]) / par[s, P_DY], col


@njit(cache=True, inline="always")
def bilinear(z, periodic, row, col):
    """Bilinear sample of ``z`` at continuous (row, col); NaN outside or next to missing data."""
    nr, nc = z.shape
    if not (row >= 0.0 and row <= nr - 1.0):
        return NAN
    if periodic:
        c0 = int(math.floor(col)) % nc
        c1 = (c0 + 1) % nc
        fc = col - math.floor(col)
    else:
        if not (col >= 0.0 and col <= nc - 1.0):
            return NAN
        c0 = min(int(col), nc - 2)
        c1 = c0 + 1
        fc = col - c0
    r0 = min(int(row), nr - 2)
    fr = row - r0
    z00 = z[r0, c0]
    z01 = z[r0, c1]
    z10 = z[r0 + 1, c0]
    z11 = z[r0 + 1, c1]
    h = (1.0 - fr) * ((1.0 - fc) * z00 + fc * z01) + fr * ((1.0 - fc) * z10 + fc * z11)
    if not math.isfinite(h):
        return NAN
    return h


@njit(cache=True)
def scan_box(par, ptrs, shapes, s, level, row, col, rr, rc):
    """Upper bound over the box ``[row-rr, row+rr] x [col-rc, col+rc]`` at pyramid ``level`` of store ``s``.

    Returns ``(hmax, full, grad_r, grad_c)``: ``hmax`` = max of the cell bounds (``-inf`` if no valid
    cell), ``full`` = the whole box lies in fully valid cells of this store, and (level 0 only) the
    largest per-pixel height difference along rows / columns over the cells in the box.
    """
    ml = int(par[s, P_ML])
    z = f32_array(ptrs, shapes, s * ml, 0)
    periodic = par[s, P_PERIODIC] != 0.0
    b = float(1 << level)
    i0 = int(math.floor((row - rr) / b))
    i1 = int(math.floor((row + rr) / b))
    j0 = int(math.floor((col - rc) / b))
    j1 = int(math.floor((col + rc) / b))
    hmax = -np.inf
    full = True
    gr = 0.0
    gc = 0.0
    if level == 0:
        nr, nc = z.shape
        if i0 < 0 or i1 > nr - 2:
            full = False
        if (not periodic) and (j0 < 0 or j1 > nc - 2):
            full = False
        for i in range(max(i0, 0), min(i1, nr - 2) + 1):
            for jj in range(j0, j1 + 1):
                if periodic:
                    j = jj % nc
                    j2 = (j + 1) % nc
                else:
                    if jj < 0 or jj > nc - 2:
                        continue
                    j = jj
                    j2 = j + 1
                a = z[i, j]
                bb = z[i, j2]
                c = z[i + 1, j]
                d = z[i + 1, j2]
                ok = math.isfinite(a) and math.isfinite(bb) and math.isfinite(c) and math.isfinite(d)
                if not ok:
                    full = False
                    if math.isfinite(a):
                        hmax = max(hmax, a)
                    if math.isfinite(bb):
                        hmax = max(hmax, bb)
                    if math.isfinite(c):
                        hmax = max(hmax, c)
                    if math.isfinite(d):
                        hmax = max(hmax, d)
                    continue
                hmax = max(hmax, max(max(a, bb), max(c, d)))
                gr = max(gr, max(abs(c - a), abs(d - bb)))
                gc = max(gc, max(abs(bb - a), abs(d - c)))
        return hmax, full, gr, gc
    zm = f32_array(ptrs, shapes, s * ml + level, 1)
    cv = u8_array(ptrs, shapes, s * ml + level)
    nr, nc = zm.shape
    if i0 < 0 or i1 > nr - 1:
        full = False
    if (not periodic) and (j0 < 0 or j1 > nc - 1):
        full = False
    for i in range(max(i0, 0), min(i1, nr - 1) + 1):
        for jj in range(j0, j1 + 1):
            if periodic:
                j = jj % nc
            else:
                if jj < 0 or jj > nc - 1:
                    continue
                j = jj
            if cv[i, j] != 2:
                full = False
            v = zm[i, j]
            if math.isfinite(v):
                hmax = max(hmax, v)
    return hmax, full, gr, gc


@njit(cache=True)
def disc_height(par, ptrs, shapes, vx, vy, vz, rho):
    """Composite height at a point and upper bound over the disc of angular radius ``rho`` around it.

    Returns ``(hc, hup, px_g)``: centre height (NaN if no store has valid data there), the bound
    (``-inf`` if no store has any valid data in the disc) and the ground pixel size (m) of the first
    store that provided data (0 if none).
    """
    nstore = par.shape[0]
    hc = NAN
    sample_store = -1
    acc = -np.inf
    px_g = 0.0
    c_n = math.acos(min(1.0, max(-1.0, vz)))
    c_s = math.pi - c_n
    kf_n = 1.0 / math.cos(min(c_n + rho, math.pi - 0.01) / 2.0) ** 2
    kf_s = 1.0 / math.cos(min(c_s + rho, math.pi - 0.01) / 2.0) ** 2
    kc_n = 1.0 / math.cos(c_n / 2.0) ** 2
    kc_s = 1.0 / math.cos(c_s / 2.0) ** 2
    cos_rho = math.cos(rho)
    sin_rho = math.sin(rho)
    for s in range(nstore):
        if par[s, P_SINR] >= 0.0:
            cr, sr = par[s, P_COSR], par[s, P_SINR]
            if cr * cos_rho - sr * sin_rho > -0.99 and par[s, P_CX] * vx + par[s, P_CY] * vy + par[s, P_CZ] * vz < cr * cos_rho - sr * sin_rho:
                continue
        row, col = vec_to_rc(par, s, vx, vy, vz)
        if not (math.isfinite(row) and math.isfinite(col)):
            continue
        R = par[s, P_R]
        if par[s, P_KIND] == 0.0:
            if par[s, P_POLE] > 0.0:
                kf = kf_n
                kc = kc_n
            else:
                kf = kf_s
                kc = kc_s
            rr = kf * R * rho / abs(par[s, P_DX])
            rc = rr
            pxg_s = abs(par[s, P_DX]) / kc
        else:
            lat = math.asin(min(1.0, max(-1.0, vz)))
            if abs(lat) + rho >= 1.5:
                continue
            rr = math.degrees(rho) / abs(par[s, P_DY])
            rc = math.degrees(math.asin(min(1.0, math.sin(rho) / math.cos(lat)))) / abs(par[s, P_DX])
            pxg_s = math.radians(abs(par[s, P_DY])) * R
        nr_s = par[s, P_NR]
        nc_s = par[s, P_NC]
        if row + rr < -1.0 or row - rr > nr_s:
            continue
        if par[s, P_PERIODIC] == 0.0 and (col + rc < -1.0 or col - rc > nc_s):
            continue
        rmax = max(max(rr, rc), 1.0)
        level = int(math.ceil(math.log2(rmax)))
        level = min(level, int(par[s, P_NLEV]) - 1)
        if rr > 1e7 or rc > 1e7:
            continue
        hmax, full, gr, gc = scan_box(par, ptrs, shapes, s, level, row, col, rr, rc)
        ml = int(par[s, P_ML])
        if sample_store < 0:
            h = bilinear(f32_array(ptrs, shapes, s * ml, 0), par[s, P_PERIODIC] != 0.0, row, col)
            if math.isfinite(h):
                hc = h
                sample_store = s
                px_g = pxg_s
            elif px_g == 0.0 and hmax > -np.inf:
                px_g = pxg_s
        if full and s == sample_store and level == 0:
            lip = hc + gr * rr + gc * rc
            if lip < hmax:
                hmax = lip
        if hmax > acc:
            acc = hmax
        if full:
            break
    return hc, acc, px_g


@njit(cache=True)
def composite_height_rc(par, ptrs, shapes, vx, vy, vz):
    """Composite bilinear height at a unit vector (NaN if no store has valid data); also the store index."""
    for s in range(par.shape[0]):
        row, col = vec_to_rc(par, s, vx, vy, vz)
        if math.isfinite(row) and math.isfinite(col):
            ml = int(par[s, P_ML])
            h = bilinear(f32_array(ptrs, shapes, s * ml, 0), par[s, P_PERIODIC] != 0.0, row, col)
            if math.isfinite(h):
                return h, s
    return NAN, -1
