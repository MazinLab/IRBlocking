// js/optics.js
// Optical element model. Works in nanometers. Transmission/reflection are fractions in [0,1].

/**
 * Linear interpolation of (srcWl, srcVal) onto an ascending queryWl grid.
 * Outside the source range, hold the nearest endpoint value (no extrapolation).
 * Results are clamped to [0,1]. srcWl must be ascending; queryWl must be ascending.
 */
export function interpolateHoldClamp(srcWl, srcVal, queryWl) {
  const n = srcWl.length;
  const out = new Float64Array(queryWl.length);
  let j = 0;
  for (let i = 0; i < queryWl.length; i++) {
    const x = queryWl[i];
    let v;
    if (x <= srcWl[0]) v = srcVal[0];
    else if (x >= srcWl[n - 1]) v = srcVal[n - 1];
    else {
      while (j < n - 2 && srcWl[j + 1] < x) j++;
      const t = (x - srcWl[j]) / (srcWl[j + 1] - srcWl[j]);
      v = srcVal[j] + t * (srcVal[j + 1] - srcVal[j]);
    }
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

/** A single measured/theoretical curve (substrate, coating, or mirror). */
export class CurveElement {
  constructor({ name, wavelength_nm, transmission, reflection = null }) {
    this.name = name;
    this._wl = Float64Array.from(wavelength_nm);
    this._t = Float64Array.from(transmission);
    this._r = reflection ? Float64Array.from(reflection) : null;
    this.coverageNm = [this._wl[0], this._wl[this._wl.length - 1]];
  }
  transmission(gridNm) {
    return interpolateHoldClamp(this._wl, this._t, gridNm);
  }
  reflection(gridNm) {
    if (!this._r) return new Float64Array(gridNm.length);
    return interpolateHoldClamp(this._wl, this._r, gridNm);
  }
  get hasReflection() {
    return this._r !== null;
  }
}

function ones(n) {
  const a = new Float64Array(n);
  a.fill(1);
  return a;
}

/**
 * A stage optic: substrate × coating in transmission. Any supplied reflectance is the EFFECTIVE
 * whole-stage reflectance (scalar in [0,1]) — substrate/coating reflectances are NOT composed.
 * emissivity = max(0, 1 − T − R).
 */
export class StageElement {
  constructor({ substrate = null, coating = null, reflectance = null } = {}) {
    this.substrate = substrate;
    this.coating = coating;
    this.reflectance = reflectance;
  }
  transmission(gridNm) {
    const ts = this.substrate ? this.substrate.transmission(gridNm) : ones(gridNm.length);
    const tc = this.coating ? this.coating.transmission(gridNm) : ones(gridNm.length);
    const out = new Float64Array(gridNm.length);
    for (let i = 0; i < out.length; i++) out[i] = ts[i] * tc[i];
    return out;
  }
  reflection(gridNm) {
    // Priority: (a) scalar whole-stage override beats everything;
    // (b) coating R curve (coating takes priority over substrate, no composition per spec §3.3);
    // (c) substrate R curve; (d) zeros.
    if (this.reflectance != null) {
      const out = new Float64Array(gridNm.length);
      out.fill(this.reflectance);
      return out;
    }
    // Duck-type on the element interface so any element exposing reflection (CurveElement with an
    // R curve, MaterialElement, MultilayerCoating) contributes; CustomCoating has hasReflection=false.
    if (this.coating && this.coating.hasReflection) return this.coating.reflection(gridNm);
    if (this.substrate && this.substrate.hasReflection) return this.substrate.reflection(gridNm);
    return new Float64Array(gridNm.length);
  }
  emissivity(gridNm) {
    const t = this.transmission(gridNm);
    const r = this.reflection(gridNm);
    const out = new Float64Array(gridNm.length);
    for (let i = 0; i < out.length; i++) {
      const e = 1 - t[i] - r[i];
      out[i] = e < 0 ? 0 : e;
    }
    return out;
  }
}

/**
 * Analytic top-hat coating: 100% transmission inside [startNm, stopNm], a constant out-of-band
 * transmission (outFraction, 0..1) everywhere else. No reflection data (hasReflection = false).
 */
export class CustomCoating {
  constructor({ startNm, stopNm, outFraction }) {
    this.startNm = startNm;
    this.stopNm = stopNm;
    this.outFraction = outFraction < 0 ? 0 : outFraction > 1 ? 1 : outFraction;
  }
  transmission(gridNm) {
    const out = new Float64Array(gridNm.length);
    for (let i = 0; i < gridNm.length; i++) {
      const x = gridNm[i];
      out[i] = x >= this.startNm && x <= this.stopNm ? 1 : this.outFraction;
    }
    return out;
  }
  reflection(gridNm) {
    return new Float64Array(gridNm.length);
  }
  get hasReflection() {
    return false;
  }
}

/**
 * Future transfer-matrix element behind the same interface (the v1 hook).
 * Construct with { layers: [{material, thickness_nm}], substrate, angle_deg }.
 * Implement transmission/reflection from n(λ),k(λ) dispersion when the n,k library lands.
 */
export class TMMElement {
  constructor({ layers = [], substrate = null, angle_deg = 0 } = {}) {
    this.layers = layers;
    this.substrate = substrate;
    this.angle_deg = angle_deg;
  }
  transmission() {
    throw new Error("TMMElement.transmission not yet implemented (v1 uses CurveElement)");
  }
  reflection() {
    throw new Error("TMMElement.reflection not yet implemented (v1 uses CurveElement)");
  }
}
