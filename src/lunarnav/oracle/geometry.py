from __future__ import annotations

import numpy as np


def unit_from_az_el(az_deg, el_deg) -> np.ndarray:
    az, el = np.radians(np.asarray(az_deg, float)), np.radians(np.asarray(el_deg, float))
    return np.stack([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)], axis=-1)


def unit_from_lat_lon(lat_deg, lon_deg) -> np.ndarray:
    lat, lon = np.radians(np.asarray(lat_deg, float)), np.radians(np.asarray(lon_deg, float))
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def lat_lon_from_unit(u: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return np.degrees(np.arcsin(np.clip(u[..., 2], -1.0, 1.0))), np.degrees(np.arctan2(u[..., 1], u[..., 0]))


def separation_deg(u1: np.ndarray, u2: np.ndarray) -> np.ndarray:
    cross = np.linalg.norm(np.cross(u1, u2), axis=-1)
    dot = np.sum(u1 * u2, axis=-1)
    return np.degrees(np.arctan2(cross, dot))


def fibonacci_sphere(n: int) -> np.ndarray:
    k = np.arange(n) + 0.5
    z = 1.0 - 2.0 * k / n
    phi = k * np.pi * (3.0 - np.sqrt(5.0))
    r = np.sqrt(1.0 - z * z)
    return np.stack([r * np.cos(phi), r * np.sin(phi), z], axis=-1)


def cap_points(centre: np.ndarray, radius_deg: float, step_deg: float) -> np.ndarray:
    c = centre / np.linalg.norm(centre)
    helper = np.array([0.0, 0.0, 1.0]) if abs(c[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    e1 = np.cross(helper, c)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(c, e1)
    pts = [c]
    for r in np.arange(step_deg, radius_deg + 1e-9, step_deg):
        n = max(8, int(round(2 * np.pi * r / step_deg)))
        th = np.arange(n) * 2 * np.pi / n
        rr = np.radians(r)
        pts.extend(np.cos(rr) * c + np.sin(rr) * (np.cos(t) * e1 + np.sin(t) * e2) for t in th)
    return np.array(pts)


def crossing(t: np.ndarray, g: np.ndarray, first: bool) -> float:
    neg = g < 0.0
    idx = np.flatnonzero(neg)
    if idx.size == 0 or idx.size == neg.size:
        return float("nan")
    i = idx[0] if first else idx[-1]
    j = i - 1 if first else i + 1
    if j < 0 or j >= t.size:
        return float("nan")
    return float(t[j] + (t[i] - t[j]) * (0.0 - g[j]) / (g[i] - g[j]))
