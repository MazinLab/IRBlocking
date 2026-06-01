"""One-off converter: Old/ reference curves -> data/filters/*.json (fractions, ascending nm).

Run from repo root with the py313 environment. Writes one JSON per curve plus index.json.
Each JSON: {name, kind, wavelength_nm, transmission, [reflection], wavelength_min_nm,
wavelength_max_nm, units_original, angle_deg, source_file}.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

OLD = Path("Old")
OUT = Path("data/filters")


def _clean(wl: np.ndarray, vals: list[np.ndarray]) -> tuple[np.ndarray, list[np.ndarray]]:
    """Sort ascending by wavelength and drop non-finite rows."""
    mask = np.isfinite(wl)
    for v in vals:
        mask &= np.isfinite(v)
    wl = wl[mask]
    vals = [v[mask] for v in vals]
    order = np.argsort(wl)
    return wl[order], [v[order] for v in vals]


def _write(name, kind, wl, transmission, *, reflection=None, units_original, source_file,
           angle_deg=0.0):
    transmission = np.clip(transmission, 0.0, 1.0)
    doc = {
        "name": name,
        "kind": kind,
        "wavelength_nm": [round(float(x), 4) for x in wl],
        "transmission": [float(x) for x in transmission],
        "wavelength_min_nm": float(wl[0]),
        "wavelength_max_nm": float(wl[-1]),
        "units_original": units_original,
        "angle_deg": angle_deg,
        "source_file": source_file,
    }
    if reflection is not None:
        # Measured T%+R% can exceed 100% by ~1% (calibration noise); cap R at 1-T so
        # absorptance/emissivity = 1-T-R stays >= 0 while preserving the trusted transmission.
        capped_reflection = np.minimum(np.clip(reflection, 0.0, 1.0), np.maximum(0.0, 1.0 - transmission))
        doc["reflection"] = [float(x) for x in capped_reflection]
    (OUT / f"{name_slug(name)}.json").write_text(json.dumps(doc))
    rng = f"{wl[0]:.1f}-{wl[-1]:.1f} nm"
    tmax = float(np.max(transmission))
    print(f"  {name:24s} {kind:9s} {len(wl):5d} pts  {rng:18s}  Tmax={tmax:.4f}")
    return {"file": f"{name_slug(name)}.json", "name": name, "kind": kind}


def name_slug(name: str) -> str:
    return name.lower().replace(" ", "-").replace("/", "-")


def load_csv(path: Path, usecols, skip: int, delimiter=",", encoding="utf-8"):
    arr = np.genfromtxt(path, delimiter=delimiter, skip_header=skip, usecols=usecols,
                        encoding=encoding)
    return arr


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    print("Converting curves:")

    # N-BK7 substrate: wl=col2, T%=col3, no header
    a = load_csv(OLD / "Uncoated_N-BK7_Transmission_4microns.csv", (2, 3), 0)
    wl, (t,) = _clean(a[:, 0], [a[:, 1] / 100.0])
    index.append(_write("N-BK7", "substrate", wl, t, units_original="percent",
                        source_file="Uncoated_N-BK7_Transmission_4microns.csv"))

    # DARKNESS coating: wl=col0, T%=col1, 1 header line
    a = load_csv(OLD / "10096C theoretical spectrum ver C.txt", (0, 1), 1)
    wl, (t,) = _clean(a[:, 0], [a[:, 1] / 100.0])
    index.append(_write("DARKNESS", "coating", wl, t, units_original="percent",
                        source_file="10096C theoretical spectrum ver C.txt"))

    # PICTURE-C coating: wl=col0, T%=col1, 1 header line
    a = load_csv(OLD / "10520C theoretical spectrum.txt", (0, 1), 1)
    wl, (t,) = _clean(a[:, 0], [a[:, 1] / 100.0])
    index.append(_write("PICTURE-C", "coating", wl, t, units_original="percent",
                        source_file="10520C theoretical spectrum.txt"))

    # ASAHI YSC1100 longpass: wl=col0, T%=col1, 2 header lines, descending
    a = load_csv(OLD / "YSC1100T.csv", (0, 1), 2)
    wl, (t,) = _clean(a[:, 0], [a[:, 1] / 100.0])
    index.append(_write("ASAHI YSC1100", "coating", wl, t, units_original="percent",
                        source_file="YSC1100T.csv"))

    # ASAHI YSC0750 shortpass ("supercold"): wl=col0, T%=col1, 2 header lines, descending
    a = load_csv(OLD / "asahi-ysc0750.csv", (0, 1), 2)
    wl, (t,) = _clean(a[:, 0], [a[:, 1] / 100.0])
    index.append(_write("ASAHI YSC0750", "coating", wl, t, units_original="percent",
                        source_file="asahi-ysc0750.csv"))

    # ITO coating: wl=col0, OD=col3, no header, descending; T = 10^-OD
    a = load_csv(OLD / "DARK_bandpass_filter_trans-20150709_footerCut.csv", (0, 3), 0)
    wl, (od,) = _clean(a[:, 0], [a[:, 1]])
    index.append(_write("ITO", "coating", wl, np.power(10.0, -od), units_original="OD",
                        source_file="DARK_bandpass_filter_trans-20150709_footerCut.csv"))

    # M254C cold mirror: wl=col2, R%=col3, T%=col4, BOM + 2 header lines; keep T and R
    a = load_csv(OLD / "M254C00_Cold_Mirror_E2.csv", (2, 3, 4), 2, encoding="utf-8-sig")
    wl, (r, t) = _clean(a[:, 0], [a[:, 1] / 100.0, a[:, 2] / 100.0])
    index.append(_write("M254C cold mirror", "mirror", wl, t, reflection=r,
                        units_original="percent", angle_deg=6.0,
                        source_file="M254C00_Cold_Mirror_E2.csv"))

    (OUT / "index.json").write_text(json.dumps(index, indent=2))
    print(f"Wrote {len(index)} curves + index.json to {OUT}/")


if __name__ == "__main__":
    main()
