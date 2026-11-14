"""Branch-and-bound horizon kernels (Numba).

For one observer and one azimuth the horizon is ``max`` over terrain points of the elevation angle

    e(theta, r) = atan2(r cos(theta) - r_o, r sin(theta))

where ``theta`` is the great-circle angle from the observer, ``r = R + h`` the terrain radius and
``r_o`` the observer radius.  ``e`` is increasing in ``r``; for fixed ``r`` it decreases with ``theta``
beyond the tangent angle ``acos(r/r_o)`` (and, for ``r >= r_o``, everywhere), so its supremum over an
interval of ``theta`` and a bound ``h <= h_up`` is attained at the clamped tangent angle (``up_elev``).

A *node* is a patch ``[theta_a, theta_b] x [delta_a, delta_b]`` of the wedge around the azimuth (``delta``
= azimuth offset).  It is covered by a spherical disc about its centre of radius

    rho = (theta_b - theta_a)/2 + 2 asin(sin(theta_max) sin((delta_b - delta_a)/4)),

(the second term bounds the distance between two points at equal ``theta`` that differ by at most
``delta_b - delta_a`` in azimuth), and the terrain-height bound over that disc comes from the pyramid
(``terrain._kernels.disc_height``).  Nodes whose elevation bound is within ``tol`` of the best terrain
sample found so far are retired; others are split along their longer side until the node is a fraction of
a pixel, where the bound is tight (Lipschitz bound from the bilinear cell gradients).
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit, prange

from lunarnav.terrain._kernels import composite_height_rc, disc_height

STACK_CAP = 1024
HALF_PI = 0.5 * math.pi


@njit(cache=True, inline="always")
def elev(r, th, ro):
    """Elevation (rad) of a point at radius ``r`` and angular distance ``th`` seen from radius ``ro``."""
    return math.atan2(r * math.cos(th) - ro, r * math.sin(th))


@njit(cache=True, inline="always")
def up_elev(r, th0, th1, ro):
    """Supremum of ``elev(r', th, ro)`` over ``r' <= r`` and ``th`` in ``[th0, th1]``."""
    if r >= ro:
        ths = th0
    else:
        ths = min(max(math.acos(r / ro), th0), th1)
    return elev(r, ths, ro)


@njit(cache=True)
def ray_seed(par, ptrs, shapes, o, n, e, ro, radius, alpha, th_start, th_max, n_seed):
    """Best elevation over ``n_seed`` log-spaced exact samples of the ray: a valid lower bound that lets
    the branch-and-bound prune from its first node.  Returns ``(elevation, theta)``; ``(-pi/2, nan)`` if none."""
    best = -HALF_PI
    best_th = np.nan
    if n_seed <= 0:
        return best, best_th
    ca = math.cos(alpha)
    sa = math.sin(alpha)
    ratio = (th_max / th_start) ** (1.0 / n_seed)
    th = th_start
    for _ in range(n_seed + 1):
        ct = math.cos(th)
        st = math.sin(th)
        vx = ct * o[0] + st * (ca * n[0] + sa * e[0])
        vy = ct * o[1] + st * (ca * n[1] + sa * e[1])
        vz = ct * o[2] + st * (ca * n[2] + sa * e[2])
        h, _s = composite_height_rc(par, ptrs, shapes, vx, vy, vz)
        if math.isfinite(h):
            el = elev(radius + h, th, ro)
            if el > best:
                best = el
                best_th = th
        th = min(th * ratio, th_max)
    return best, best_th


@njit(cache=True)
def solve_azimuth(par, ptrs, shapes, o, n, e, ro, radius, alpha, hw, th_start, th_max, tol, best0, best_th0, leaf_div):
    """Horizon for one azimuth.

    ``hw`` is the half width (rad) of the wedge; ``hw == 0`` solves the single ray.  Returns
    ``(best, best_theta, hi, nodes, nodata)``: the highest terrain sample elevation (rad; a valid lower
    bound of the horizon of that region), the angle at which it occurs, a rigorous upper bound of the
    horizon over the wedge, the number of nodes evaluated and the number of nodes with no terrain data.
    ``best0`` / ``best_th0`` seed the lower bound with a valid sample (elevation, angle) from the region.
    """
    buf = np.empty((STACK_CAP, 4))
    sp = 0
    edges = [th_start]
    while edges[-1] < th_max:
        edges.append(min(edges[-1] * 2.0, th_max))
    for q in range(len(edges) - 2, -1, -1):
        buf[sp, 0] = edges[q]
        buf[sp, 1] = edges[q + 1]
        buf[sp, 2] = -hw
        buf[sp, 3] = hw
        sp += 1
    best = best0
    best_th = best_th0
    hi_acc = -HALF_PI
    nodes = 0
    nodata = 0
    while sp > 0:
        sp -= 1
        a = buf[sp, 0]
        b = buf[sp, 1]
        da = buf[sp, 2]
        db = buf[sp, 3]
        nodes += 1
        thm = 0.5 * (a + b)
        dm = 0.5 * (da + db)
        ang = alpha + dm
        ca = math.cos(ang)
        sa = math.sin(ang)
        ct = math.cos(thm)
        st = math.sin(thm)
        vx = ct * o[0] + st * (ca * n[0] + sa * e[0])
        vy = ct * o[1] + st * (ca * n[1] + sa * e[1])
        vz = ct * o[2] + st * (ca * n[2] + sa * e[2])
        sin_max = math.sin(b) if b < HALF_PI else 1.0
        lateral = 2.0 * math.asin(min(1.0, sin_max * math.sin(0.25 * (db - da))))
        rho = 0.5 * (b - a) + lateral
        hc, hup, pxg = disc_height(par, ptrs, shapes, vx, vy, vz, rho)
        if math.isfinite(hc):
            ec = elev(radius + hc, thm, ro)
            if ec > best:
                best = ec
                best_th = thm
        if hup == -np.inf:
            nodata += 1
            continue
        u = up_elev(radius + hup, a, b, ro)
        if u <= best + tol:
            if u > hi_acc:
                hi_acc = u
            continue
        ext_r = (b - a) * radius
        ext_l = (db - da) * st * radius
        if max(ext_r, ext_l) * leaf_div <= pxg or sp > STACK_CAP - 3:
            if u > hi_acc:
                hi_acc = u
            continue
        if ext_r >= ext_l:
            buf[sp, 0] = thm
            buf[sp, 1] = b
            buf[sp, 2] = da
            buf[sp, 3] = db
            sp += 1
            buf[sp, 0] = a
            buf[sp, 1] = thm
            buf[sp, 2] = da
            buf[sp, 3] = db
            sp += 1
        else:
            buf[sp, 0] = a
            buf[sp, 1] = b
            buf[sp, 2] = dm
            buf[sp, 3] = db
            sp += 1
            buf[sp, 0] = a
            buf[sp, 1] = b
            buf[sp, 2] = da
            buf[sp, 3] = dm
            sp += 1
    hi = max(hi_acc, best)
    return best, best_th, hi, nodes, nodata


@njit(cache=True, parallel=True)
def solve_batch(par, ptrs, shapes, obs_o, obs_n, obs_e, ro, th_start, th_max, radius, az, hw, tol, tol_ray, leaf_div, n_seed,
                lo, ray_hi, hi, blk, nodes, nodata):  # fmt: skip
    """Fill ``(n_site, n_az)`` output arrays (radians; blocker = angle in rad, NaN if no data)."""
    ns, na = lo.shape
    for idx in prange(ns * na):
        i = idx // na
        k = idx % na
        alpha = az[i, k]
        s0, st0 = ray_seed(par, ptrs, shapes, obs_o[i], obs_n[i], obs_e[i], ro[i], radius, alpha, th_start[i], th_max[i], n_seed)
        b0, bt, rh, n1, nd1 = solve_azimuth(par, ptrs, shapes, obs_o[i], obs_n[i], obs_e[i], ro[i], radius, alpha, 0.0,
                                            th_start[i], th_max[i], tol_ray, s0, st0, leaf_div)  # fmt: skip
        lo[i, k] = b0
        ray_hi[i, k] = rh
        blk[i, k] = bt
        n2 = 0
        nd2 = 0
        if hw > 0.0:
            b1, bt1, h1, n2, nd2 = solve_azimuth(par, ptrs, shapes, obs_o[i], obs_n[i], obs_e[i], ro[i], radius, alpha, hw,
                                                 th_start[i], th_max[i], tol, b0, bt, leaf_div)  # fmt: skip
            hi[i, k] = max(h1, rh)
        else:
            hi[i, k] = rh
        nodes[i, k] = n1 + n2
        nodata[i, k] = nd1 + nd2
