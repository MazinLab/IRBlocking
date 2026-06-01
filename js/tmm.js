// js/tmm.js
// Thin-film multilayer optics via the transfer-matrix method (Macleod characteristic matrix),
// normal incidence. Coatings are evaluated standalone (air | stack | air) so they compose with the
// substrate exactly like a measured coating curve (T_stage = T_coat · T_substrate).
//
// Materials are treated as lossless dielectrics (k = 0) in the design band:
//   SiO2  — Malitson 1965 fused-silica Sellmeier (within ~0.5% of sputtered film), n ≈ 1.46
//   Ta2O5 — Cauchy fit to Gao 2012 (refractiveindex.info main/Ta2O5/Gao), n ≈ 2.1, valid 350-1800 nm
// k becomes non-negligible only below ~320 nm (Ta2O5 UV edge) and beyond the SiO2 IR edge (~3.5 um);
// add a k term here if those regions ever matter.

import { sellmeierN } from "./materials.js";

const SIO2_B = [0.6961663, 0.4079426, 0.8974794];
const SIO2_C = [0.00467914826, 0.0135120631, 97.9340025]; // c² (µm²)
const TA2O5 = { A: 2.076525, B: 0.021436, C: 0.000915 }; // Cauchy, λ in µm

export const COATING_MATERIALS = {
  SiO2: { label: "SiO₂ (low, n≈1.46)" },
  Ta2O5: { label: "Ta₂O₅ (high, n≈2.1)" },
};

/** Real refractive index of a coating material at a wavelength (nm). */
export function coatingIndex(material, lambdaNm) {
  const um = lambdaNm / 1000;
  if (material === "Ta2O5") {
    const l2 = um * um;
    return TA2O5.A + TA2O5.B / l2 + TA2O5.C / (l2 * l2);
  }
  if (material === "SiO2") return sellmeierN(SIO2_B, SIO2_C, um);
  throw new RangeError(`Unknown coating material: ${material}`);
}

// --- minimal complex arithmetic ---
const cMul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cAdd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
const cAbs2 = (a) => a.re * a.re + a.im * a.im;

/**
 * Transmittance/reflectance/absorptance of an air | layers | air stack at each grid wavelength.
 * layers: [{ material, d_nm }] ordered from the incident side. Normal incidence, lossless.
 * Returns { T, R, A } as Float64Arrays aligned with gridNm.
 */
export function stackTRA(layers, gridNm) {
  const n = gridNm.length;
  const T = new Float64Array(n);
  const R = new Float64Array(n);
  const A = new Float64Array(n);
  const eta0 = 1; // incident medium (vacuum/air)
  const etaSub = 1; // exit medium (vacuum/air)
  for (let i = 0; i < n; i++) {
    const lam = gridNm[i];
    // characteristic matrix product M = Π M_layer
    let m00 = { re: 1, im: 0 }, m01 = { re: 0, im: 0 };
    let m10 = { re: 0, im: 0 }, m11 = { re: 1, im: 0 };
    for (const layer of layers) {
      const nl = coatingIndex(layer.material, lam);
      const delta = (2 * Math.PI * nl * layer.d_nm) / lam;
      const cos = Math.cos(delta), sin = Math.sin(delta);
      // layer matrix: [[cos, i sin/η],[i η sin, cos]], η = nl (normal incidence)
      const l00 = { re: cos, im: 0 };
      const l01 = { re: 0, im: sin / nl };
      const l10 = { re: 0, im: nl * sin };
      const l11 = { re: cos, im: 0 };
      // M = M · L
      const n00 = cAdd(cMul(m00, l00), cMul(m01, l10));
      const n01 = cAdd(cMul(m00, l01), cMul(m01, l11));
      const n10 = cAdd(cMul(m10, l00), cMul(m11, l10));
      const n11 = cAdd(cMul(m10, l01), cMul(m11, l11));
      m00 = n00; m01 = n01; m10 = n10; m11 = n11;
    }
    // [B; C] = M · [1; etaSub]
    const B = cAdd(m00, { re: m01.re * etaSub, im: m01.im * etaSub });
    const C = cAdd(m10, { re: m11.re * etaSub, im: m11.im * etaSub });
    const eB = { re: eta0 * B.re, im: eta0 * B.im };
    const denom = cAbs2(cAdd(eB, C)); // |η0 B + C|²
    const num = cAdd(eB, { re: -C.re, im: -C.im }); // η0 B − C
    R[i] = cAbs2(num) / denom;
    T[i] = (4 * eta0 * etaSub) / denom;
    A[i] = Math.max(0, 1 - R[i] - T[i]);
  }
  return { T, R, A };
}

/** A designed multilayer coating as an OpticalElement (composes in StageElement). */
export class MultilayerCoating {
  constructor(layers) {
    // Validate before the TMM consumes them: drop layers with an unknown material or a
    // non-finite/non-positive thickness so a bad edit can't poison the stack with NaN.
    this.layers = (layers || []).filter(
      (l) => (l.material === "Ta2O5" || l.material === "SiO2") && Number.isFinite(l.d_nm) && l.d_nm > 0,
    );
    this._grid = null;
    this._tra = null;
  }
  _eval(gridNm) {
    if (this._grid !== gridNm) {
      this._tra = stackTRA(this.layers, gridNm);
      this._grid = gridNm;
    }
    return this._tra;
  }
  transmission(gridNm) {
    return this._eval(gridNm).T;
  }
  reflection(gridNm) {
    return this._eval(gridNm).R;
  }
  get hasReflection() {
    return true;
  }
}
