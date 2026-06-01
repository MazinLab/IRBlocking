// js/materials.js
// Thickness-scalable substrate materials. External transmittance is computed from first
// principles: surface Fresnel reflection from the Sellmeier refractive index n(λ), and bulk
// absorption via Beer–Lambert. The bulk internal transmittance τ comes from either a tabulated
// absorption coefficient α(λ) (the crystalline/fused materials) or a measured external curve at a
// known reference thickness (N-BK7), divided by the Fresnel surface term.
//
// Single-pass, two-surface model (no etalon, per design spec §3.5):
//   R(λ)       = ((n−1)/(n+1))²                 single-surface Fresnel, normal incidence
//   τ(λ,d)     = internal transmittance at thickness d
//   T(λ,d)     = (1−R)² · τ                      external transmittance
//   R_tot(λ,d) = R · (1 + (1−R)·τ)               total two-surface reflectance
//   ε(λ,d)     = (1−R)·(1−τ) = 1 − T − R_tot     absorptance = graybody emissivity
//
// This is a SINGLE-PASS approximation: it omits multiple internal reflections, so it is not the
// rigorous incoherent-slab result (T = (1−R)²τ/(1−R²τ²), etc.). The difference is O(R²τ²) ≈ 0.5% for
// these low-index substrates — below the α-table / measured-curve data uncertainty — and the model is
// self-consistent (R+T+ε balance to 1; ε→0 when transparent, →1−R when opaque). Upgrade to the full
// incoherent formulas if sub-percent substrate accuracy ever matters (note the curve-based N-BK7 path
// would then need a nonlinear τ₀ inversion).
//
// Sellmeier form (all materials, λ in µm, C in µm²):  n² = 1 + Σ Bᵢ λ²/(λ² − Cᵢ)
//
// Sources (verified against tabulated n): fused silica Malitson 1965; sapphire (o-ray)
// Malitson–Dodge 1972/1986; MgF2 (o-ray) Dodge 1984; CaF2 Malitson 1963; N-BK7 Schott datasheet.
// α tables compiled from Crystran/Heraeus/ISP/UQG datasheets + Kischkat 2012; values in the
// transparent plateau are ~0 (loss is Fresnel-dominated) and rise at the UV and IR absorption
// edges. IR-edge α for fused silica and MgF2 are approximate (±factor ~2) — see PROVENANCE.

import { interpolateHoldClamp } from "./optics.js";

const MM_PER_CM = 10;

/** Refractive index from Sellmeier coefficients. lambdaUm in µm. */
export function sellmeierN(B, C, lambdaUm) {
  const l2 = lambdaUm * lambdaUm;
  let s = 1;
  for (let i = 0; i < B.length; i++) s += (B[i] * l2) / (l2 - C[i]);
  return s > 1 ? Math.sqrt(s) : 1; // guard: radicand can go <1 near/past a dispersion pole
}

/** Linear interpolation of an α(λ) table [cm⁻¹]; holds endpoints, floors at 0. nm ascending. */
function interpAlpha(tableNm, tableA, gridNm) {
  const n = tableNm.length;
  const out = new Float64Array(gridNm.length);
  let j = 0;
  for (let i = 0; i < gridNm.length; i++) {
    const x = gridNm[i];
    let v;
    if (x <= tableNm[0]) v = tableA[0];
    else if (x >= tableNm[n - 1]) v = tableA[n - 1];
    else {
      while (j < n - 2 && tableNm[j + 1] < x) j++;
      const t = (x - tableNm[j]) / (tableNm[j + 1] - tableNm[j]);
      v = tableA[j] + t * (tableA[j + 1] - tableA[j]);
    }
    out[i] = v < 0 ? 0 : v;
  }
  return out;
}

// --- Material definitions ---------------------------------------------------
// bulk.kind "alpha": { nm:[...ascending], alpha:[...cm⁻¹] }
// bulk.kind "curve": measured external T at d0_mm; the measured curve is supplied at runtime.
export const MATERIALS = {
  "N-BK7": {
    B: [1.03961212, 0.231792344, 1.01046945],
    C: [0.00600069867, 0.0200179144, 103.560653],
    rangeNm: [219, 4001],
    bulk: { kind: "curve", d0_mm: 10, curveName: "N-BK7" },
  },
  "Fused silica (Suprasil, high-OH)": {
    B: [0.6961663, 0.4079426, 0.8974794],
    C: [0.00467914826, 0.0135120631, 97.9340025],
    rangeNm: [185, 5000],
    bulk: {
      kind: "alpha",
      nm: [170, 185, 200, 250, 300, 2000, 2200, 2400, 2600, 2720, 2800, 2900, 3000, 3200, 3500, 4000, 4500, 5000],
      alpha: [5, 0.5, 0.05, 0.005, 0.001, 0.01, 0.05, 0.3, 3, 30, 8, 3, 5, 6.7, 8, 11, 14.5, 19],
    },
  },
  "Fused silica (Infrasil, low-OH)": {
    B: [0.6961663, 0.4079426, 0.8974794],
    C: [0.00467914826, 0.0135120631, 97.9340025],
    rangeNm: [220, 4400],
    bulk: {
      kind: "alpha",
      nm: [200, 220, 250, 300, 2000, 2720, 2800, 3000, 3300, 3500, 3800, 4000, 4350],
      alpha: [5, 0.5, 0.02, 0.005, 0.001, 0.5, 0.1, 1, 3, 8, 20, 30, 80],
    },
  },
  Sapphire: {
    B: [1.4313493, 0.65054713, 5.3414021],
    C: [0.00527992771, 0.0142382647, 325.017834],
    rangeNm: [200, 6000],
    bulk: {
      kind: "alpha",
      nm: [180, 200, 230, 260, 300, 2400, 4500, 5000, 5500, 6000, 6500],
      alpha: [10, 1, 0.1, 0.01, 0.001, 0.0003, 0.01, 0.1, 1, 10, 50],
    },
  },
  MgF2: {
    B: [0.48755108, 0.39875031, 2.3120353],
    C: [0.00188218243, 0.00895188901, 566.135647],
    rangeNm: [130, 7500],
    bulk: {
      kind: "alpha",
      nm: [130, 150, 200, 300, 500, 2700, 5000, 6000, 7000, 7500],
      alpha: [5, 0.5, 0.07, 0.01, 0.01, 0.04, 0.02, 0.09, 0.62, 3],
    },
  },
  CaF2: {
    B: [0.5675888, 0.4710914, 3.8484723],
    C: [0.00252642944, 0.0100783328, 1200.55610],
    rangeNm: [150, 10600],
    bulk: {
      kind: "alpha",
      nm: [150, 180, 200, 300, 500, 2700, 6250, 7690, 8690, 9090, 10600],
      alpha: [5, 0.5, 0.1, 0.001, 0.0005, 0.00078, 0.0035, 0.11, 0.48, 0.65, 3.5],
    },
  },
};

export function materialNames() {
  return Object.keys(MATERIALS);
}

/**
 * A thickness-scaled substrate optic. Implements the OpticalElement interface
 * (transmission/reflection over an nm grid) so it drops into StageElement as a substrate.
 *
 * @param material    one of MATERIALS
 * @param thickness_mm physical thickness in millimetres
 * @param measuredCurve {wavelength_nm, transmission} required when bulk.kind === "curve"
 */
export class MaterialElement {
  constructor(material, thickness_mm, measuredCurve = null) {
    this.material = material;
    this.thickness_mm = thickness_mm;
    this.measuredCurve = measuredCurve;
    this.coverageNm = material.rangeNm;
  }
  get hasReflection() {
    return true;
  }
  _R(gridNm) {
    const { B, C, rangeNm } = this.material;
    // Clamp the index evaluation to the material's validity range: the Sellmeier fit diverges
    // past its poles (e.g. N-BK7 near 10.18 µm). Outside the transparent window the bulk term
    // already drives T→0, so holding n at the edge is both safe and physically adequate.
    const loUm = rangeNm[0] / 1000, hiUm = rangeNm[1] / 1000;
    const out = new Float64Array(gridNm.length);
    for (let i = 0; i < gridNm.length; i++) {
      let um = gridNm[i] / 1000;
      if (um < loUm) um = loUm;
      else if (um > hiUm) um = hiUm;
      const n = sellmeierN(B, C, um);
      const r = (n - 1) / (n + 1);
      out[i] = r * r;
    }
    return out;
  }
  /** Internal (bulk) transmittance at this thickness, on the grid. */
  _tau(gridNm, R) {
    const bulk = this.material.bulk;
    const out = new Float64Array(gridNm.length);
    if (bulk.kind === "alpha") {
      const a = interpAlpha(bulk.nm, bulk.alpha, gridNm);
      const d_cm = this.thickness_mm / MM_PER_CM;
      for (let i = 0; i < out.length; i++) out[i] = Math.exp(-a[i] * d_cm);
    } else {
      // curve: divide measured external T by the Fresnel surface term to get τ at d0, then scale.
      const wl = this.measuredCurve.wavelength_nm;
      const t = this.measuredCurve.transmission;
      const Tmeas = interpolateHoldClamp(wl, t, gridNm);
      const exp = this.thickness_mm / bulk.d0_mm;
      for (let i = 0; i < out.length; i++) {
        const surf = (1 - R[i]) * (1 - R[i]);
        let tau0 = surf > 0 ? Tmeas[i] / surf : 0;
        if (tau0 < 0) tau0 = 0;
        else if (tau0 > 1) tau0 = 1;
        out[i] = Math.pow(tau0, exp);
      }
    }
    return out;
  }
  transmission(gridNm) {
    const R = this._R(gridNm);
    const tau = this._tau(gridNm, R);
    const out = new Float64Array(gridNm.length);
    for (let i = 0; i < out.length; i++) out[i] = (1 - R[i]) * (1 - R[i]) * tau[i];
    return out;
  }
  reflection(gridNm) {
    const R = this._R(gridNm);
    const tau = this._tau(gridNm, R);
    const out = new Float64Array(gridNm.length);
    for (let i = 0; i < out.length; i++) out[i] = R[i] * (1 + (1 - R[i]) * tau[i]);
    return out;
  }
}
