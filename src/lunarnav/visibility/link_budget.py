"""Direct-to-Earth link budget in decibel form.

    FSPL      = 20 log10(4 pi d f / c)                                    [dB]
    Pt/N0     = EIRP + G/T - FSPL - sum(losses) - 10 log10(k)             [dB-Hz]
    Eb/N0     = Pt/N0 - 10 log10(R_b)                                     [dB]
    margin    = Eb/N0 - Eb/N0_required - implementation_loss              [dB]
    R_b,max   = 10 ** ((Pt/N0 - Eb/N0_required - implementation_loss - required_margin) / 10)   [bit/s]

with EIRP in dBW, G/T in dB/K, k = 1.380649e-23 J/K (so -10 log10 k = 228.599 dB). `losses_db` are positive
numbers (atmosphere, polarisation, pointing, modulation loss, ...). The input is the receive-side G/T, so
the caller applies the ground-station system noise temperature at the relevant elevation.

Published worked examples reproduced in the validation report: Kobayashi, Shihabi and Taylor,
"Mars Cube One Telecommunications Subsystem Design", JPL DESCANSO Design and Performance Summary
Series, Article 18 (Sept 2021), Table 5-4 "X-band downlink link budget" (HGA to a DSN 34 m and 70 m
station; the table takes the station gains from DSN 810-005).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

C_M_S = 299_792_458.0
BOLTZMANN_J_K = 1.380649e-23
"""SI-exact Boltzmann constant."""
BOLTZMANN_DBW_HZ_K = 10.0 * np.log10(BOLTZMANN_J_K)


def free_space_path_loss_db(range_km: np.ndarray | float, frequency_hz: float) -> np.ndarray:
    """Free-space path loss (positive dB) over `range_km` at `frequency_hz`."""
    d = np.asarray(range_km, dtype=np.float64) * 1e3
    return 20.0 * np.log10(4.0 * np.pi * d * frequency_hz / C_M_S)


@dataclass(frozen=True, slots=True)
class LinkBudget:
    """Downlink parameters. All gains/losses in dB; `losses_db` entries are positive."""

    eirp_dbw: float
    frequency_hz: float
    g_over_t_dbk: float
    required_ebn0_db: float
    data_rate_bps: float
    losses_db: tuple[float, ...] = ()
    implementation_loss_db: float = 0.0
    required_margin_db: float = 0.0


@dataclass(frozen=True, slots=True)
class LinkResult:
    """Link evaluation (arrays if the range was an array)."""

    fspl_db: np.ndarray
    pt_n0_dbhz: np.ndarray
    ebn0_db: np.ndarray
    margin_db: np.ndarray
    """Eb/N0 above the requirement (including implementation loss), at the budget data rate."""
    max_data_rate_bps: np.ndarray
    """Highest rate with `margin_db >= required_margin_db`."""
    closes: np.ndarray
    """`margin_db >= required_margin_db`."""


def evaluate_link(link: LinkBudget, range_km: np.ndarray | float) -> LinkResult:
    """Evaluate `link` at the (possibly time-varying) Earth-lander range."""
    fspl = free_space_path_loss_db(range_km, link.frequency_hz)
    pt_n0 = link.eirp_dbw + link.g_over_t_dbk - fspl - sum(link.losses_db) - BOLTZMANN_DBW_HZ_K
    ebn0 = pt_n0 - 10.0 * np.log10(link.data_rate_bps)
    margin = ebn0 - link.required_ebn0_db - link.implementation_loss_db
    max_rate = 10.0 ** (
        (pt_n0 - link.required_ebn0_db - link.implementation_loss_db - link.required_margin_db) / 10.0)
    return LinkResult(fspl, pt_n0, ebn0, margin, max_rate, margin >= link.required_margin_db)
