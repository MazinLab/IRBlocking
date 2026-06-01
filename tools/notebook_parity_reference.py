"""Reproduce the IRBlockandTrans-nounits notebook count rate as a parity fixture.

Uses the same SI-exact constants as js/physics.js. Writes test/fixtures/notebook_parity.json
with the emitter configuration on a 1 nm grid (1500-4000 nm) and the expected counts/sec.
Run from repo root with py313.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

H, C, KB = 6.62607015e-34, 2.99792458e8, 1.380649e-23


def photon_radiance(lam_m, T):
    x = (H * C) / (lam_m * KB * T)
    return np.where(x > 700, 0.0, (2 * C / lam_m**4) / np.expm1(np.minimum(x, 700)))


def curve(name):
    d = json.loads(Path(f"data/filters/{name}.json").read_text())
    return np.asarray(d["wavelength_nm"]), np.asarray(d["transmission"])


def main() -> None:
    grid_nm = np.arange(1500.0, 4000.0 + 1e-9, 1.0)
    bk7_wl, bk7_t = curve("n-bk7")
    dk_wl, dk_t = curve("darkness")
    f_bk7 = np.clip(np.interp(grid_nm, bk7_wl, bk7_t, left=bk7_t[0], right=bk7_t[-1]), 0, 1)
    f_dark = np.clip(np.interp(grid_nm, dk_wl, dk_t, left=dk_t[0], right=dk_t[-1]), 0, 1)
    # fDARK2: OD x8 in 2201-2774 nm  ==  T**8 there
    band = (grid_nm >= 2201) & (grid_nm <= 2774)
    f_dark2 = np.where(band, f_dark**8, f_dark)

    pixel_area_m2 = (60e-6) * (30e-6)
    qe = 0.4
    emitters = [
        {"T": 277.0, "omega": 0.15, "downstreamT": (f_bk7**3 * f_dark2**2)},
        {"T": 55.0, "omega": 0.20, "downstreamT": (f_bk7**2 * f_dark2)},
    ]
    grid_m = grid_nm * 1e-9
    total_per_m = np.zeros_like(grid_m)
    for em in emitters:
        total_per_m += pixel_area_m2 * qe * em["omega"] * em["downstreamT"] * photon_radiance(grid_m, em["T"])
    expected = float(np.trapezoid(total_per_m, grid_m))  # counts/sec

    fixture = {
        "description": "no-units notebook parity: 277K+55K, 60x30um, QE0.4, BK7^3*DARK2^2 / BK7^2*DARK2",
        "grid_nm": [round(float(x), 3) for x in grid_nm],
        "pixelArea_m2": pixel_area_m2,
        "qe": qe,
        "emitters": [
            {"T": em["T"], "omega": em["omega"], "downstreamT": [float(x) for x in em["downstreamT"]]}
            for em in emitters
        ],
        "expected_counts_per_sec": expected,
    }
    out = Path("test/fixtures/notebook_parity.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fixture))
    print(f"expected_counts_per_sec = {expected:.6e}  (grid {len(grid_nm)} pts)")


if __name__ == "__main__":
    main()
