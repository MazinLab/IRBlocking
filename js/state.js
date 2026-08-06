// js/state.js
// Calculator state: defaults, boundary validation, and wavelength-grid construction.

export const N_MAX = 20000;

export function defaultState() {
  return {
    source: { T: 300, D_mm: 50, d_mm: 200 },
    stages: [
      { name: "Stage 1", T: 65, D_mm: 50, d_mm: 150, substrate: "N-BK7", thickness_mm: 10, coating: "ASAHI YSC1100" },
      { name: "Stage 2", T: 3.5, D_mm: 50, d_mm: 100, substrate: "N-BK7", thickness_mm: 20, coating: "ASAHI YSC1100" },
      { name: "Stage 3", T: 0.8, D_mm: 25, d_mm: 50, substrate: "(none)", thickness_mm: 1, coating: "(none)" },
    ],
    pixel: { w_um: 150, h_um: 150 },
    qe: 0.4,
    lambdaMinNm: 400,
    lambdaMaxNm: 5000,
    resolutionNm: 1,
    includeStageEmission: true,
    // "Custom" coating: ideal top-hat OR a designed Ta2O5/SiO2 multilayer (TMM)
    custom: { startNm: 950, stopNm: 1450, outPct: 0.1, mode: "ideal", layers: [], synthLayers: 60 },
    // "Custom 2": vendor-style Tavg bounds per band. Later rows win; uncovered λ transmit fully.
    custom2: {
      rows: [
        { startNm: 950, stopNm: 1400, op: ">=", tPct: 90 },
        { startNm: 1450, stopNm: 2350, op: "<=", tPct: 0.5 },
        { startNm: 2350, stopNm: 2800, op: "<=", tPct: 0.1 },
        { startNm: 2800, stopNm: 3400, op: "<=", tPct: 0.5 },
      ],
    },
  };
}

/** Validate at the boundary. Returns {valid, errors:{field:message}}. */
export function validate(s) {
  const errors = {};
  const planes = [["source", s.source], ...s.stages.map((st, i) => [`stage${i + 1}`, st])];
  for (const [k, ap] of planes) {
    if (!(Number.isFinite(ap.T) && ap.T >= 0)) errors[`${k}_T`] = "Temperature must be a finite value ≥ 0";
    if (!(ap.D_mm > 0)) errors[`${k}_D`] = "Aperture diameter must be > 0";
    if (!(ap.d_mm > 0)) errors[`${k}_d`] = "Distance must be > 0";
  }
  const [dS, d1, d2, d3] = [s.source.d_mm, s.stages[0].d_mm, s.stages[1].d_mm, s.stages[2].d_mm];
  if (!(dS > d1 && d1 > d2 && d2 > d3 && d3 > 0)) {
    errors.ordering = "Distances must satisfy d_source > d1 > d2 > d3 > 0";
  }
  s.stages.forEach((st, i) => {
    if (st.substrate && st.substrate !== "(none)" && !(st.thickness_mm > 0)) {
      errors[`stage${i + 1}_thk`] = "Substrate thickness must be > 0";
    }
  });
  if (!(s.pixel.w_um > 0)) errors.pixel_w = "Pixel width must be > 0";
  if (!(s.pixel.h_um > 0)) errors.pixel_h = "Pixel height must be > 0";
  if (!(s.qe >= 0 && s.qe <= 1)) errors.qe = "QE must be in [0, 1]";
  if (!(s.resolutionNm > 0)) errors.resolution = "Resolution must be > 0";
  if (!(s.lambdaMinNm > 0 && s.lambdaMaxNm > s.lambdaMinNm)) errors.range = "Require λmax > λmin > 0";
  // The passband only drives the result directly in ideal (top-hat) mode; in multilayer mode it is
  // just the synthesis seed, so don't block recompute on it there.
  if (s.stages.some((st) => st.coating === "Custom") && s.custom.mode === "ideal") {
    const c = s.custom;
    if (!(c.startNm > 0 && c.stopNm > c.startNm)) errors.custom = "Custom passband: need stop > start > 0";
    else if (!(c.outPct >= 0 && c.outPct <= 100)) errors.custom = "Out-of-band T must be 0–100%";
  }
  if (s.stages.some((st) => st.coating === "Custom 2")) {
    s.custom2.rows.forEach((r, i) => {
      if (!(r.startNm > 0 && r.stopNm > r.startNm)) errors[`custom2_${i}`] = "Need λ stop > λ start > 0";
      else if (!(r.tPct >= 0 && r.tPct <= 100)) errors[`custom2_${i}`] = "T must be 0–100%";
    });
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Build an inclusive ascending wavelength grid (nm), capping point count at nMax. */
export function buildGridNm(s, nMax = N_MAX) {
  let n = Math.round((s.lambdaMaxNm - s.lambdaMinNm) / s.resolutionNm) + 1;
  let coarsened = false;
  if (n > nMax) { n = nMax; coarsened = true; }
  if (n < 2) n = 2;
  const grid = new Float64Array(n);
  const step = (s.lambdaMaxNm - s.lambdaMinNm) / (n - 1);
  for (let i = 0; i < n; i++) grid[i] = s.lambdaMinNm + i * step;
  grid[n - 1] = s.lambdaMaxNm; // exact endpoint
  return { grid, coarsened };
}
