// js/synthesis.js
// Phase-2 coating synthesis: turn a Custom passband target into a real Ta2O5/SiO2 stack.
// Approach: an analytic quarter-wave Fabry–Pérot bandpass starting design, then a bounded
// pattern-search refinement of the layer thicknesses toward an ASYMMETRIC target (see topHatCost):
// maximize in-band transmission, leave the short-wave side (λ < start) free — there's no IR
// background to block there — and suppress only the long-wave leakage from the passband stop out to
// the glass absorption cutoff (~3.4 µm), beyond which the substrate blocks anyway.
//
// This is demonstration-grade, not OptiLayer. A single-cavity Fabry–Pérot has a finite stopband,
// so a wide top-hat with deep blocking "everywhere outside" is not physically achievable from one
// stack — the synthesized filter is a bandpass approximation. Increase `pairs` for deeper, narrower
// blocking, or hand-tune the layer list afterward; the plotted throughput shows the real result.

import { coatingIndex, stackTRA } from "./tmm.js";

const H = "Ta2O5"; // high index
const L = "SiO2"; // low index

/**
 * Long-wave-blocking edge-filter starting design: a chirped quarter-wave H/L stack whose QWOT
 * design wavelength sweeps geometrically from the passband stop out to the glass cutoff. This
 * places a broad high-reflectance stopband over [stop, cutoff] while transmitting the short-wave
 * side (the passband and below) — a much better fit for the asymmetric target than a single-cavity
 * Fabry–Pérot, which can only make a narrow peaked passband. `layers` sets the stack depth (more
 * layers → deeper, broader blocking; the refinement then flattens the passband).
 */
export function startingDesign(target, opts = {}) {
  const hardIrNm = opts.hardIrNm ?? HARD_IR_NM;
  const N = opts.layers ?? 60;
  const blockLo = target.stopNm;
  const blockHi = Math.max(blockLo * 1.15, hardIrNm);
  const layers = [];
  for (let k = 0; k < N; k++) {
    const frac = N === 1 ? 0 : k / (N - 1);
    const lamK = blockLo * Math.pow(blockHi / blockLo, frac); // geometric chirp stop → cutoff
    const material = k % 2 === 0 ? H : L;
    layers.push({ material, d_nm: lamK / (4 * coatingIndex(material, lamK)) });
  }
  return layers;
}

// Beyond this wavelength the substrate glass (e.g. N-BK7/fused silica) absorbs, so the coating
// need not block there — we only suppress long-wave leakage from the passband stop out to here.
export const HARD_IR_NM = 3400;

/**
 * Asymmetric cost for the top-hat target:
 *  - in the passband [start, stop]: drive T → 1 (two-sided);
 *  - below the passband (λ < start): UNCONSTRAINED (no IR background to block there);
 *  - from stop out to hardIrNm: one-sided penalty only when T exceeds the out-of-band target
 *    (we want leakage below it; being further below is free);
 *  - beyond hardIrNm: unconstrained (glass absorption takes over).
 * Each region is averaged separately so the wide block band doesn't swamp the narrow passband.
 * T and grid are aligned arrays. Exported for testing.
 */
export function topHatCost(T, grid, target, { hardIrNm = HARD_IR_NM, wIn = 1, wBlock = 1 } = {}) {
  let sIn = 0, nIn = 0, sBlock = 0, nBlock = 0;
  for (let i = 0; i < grid.length; i++) {
    const lam = grid[i];
    if (lam >= target.startNm && lam <= target.stopNm) {
      const d = T[i] - 1;
      sIn += d * d;
      nIn++;
    } else if (lam > target.stopNm && lam <= hardIrNm) {
      const excess = T[i] - target.outFraction; // only leakage above the target costs
      if (excess > 0) sBlock += excess * excess;
      nBlock++;
    }
  }
  return wIn * (nIn ? sIn / nIn : 0) + wBlock * (nBlock ? sBlock / nBlock : 0);
}

function stackCost(layers, grid, target, opts) {
  return topHatCost(stackTRA(layers, grid).T, grid, target, opts);
}

/**
 * Bounded pattern-search refinement of layer thicknesses toward the asymmetric target (see
 * topHatCost). Only accepts improvements, so the returned cost is ≤ the starting cost.
 * Returns { layers, cost }.
 */
export function refine(layers, target, opts = {}) {
  const { points = 200, maxSweeps = 50, wIn = 4, wBlock = 1 } = opts;
  const hardIrNm = opts.hardIrNm ?? HARD_IR_NM;
  // Weight passband flatness above blocking depth so the optimizer does not ripple the passband to
  // over-block (the user prefers a flatter passband and more out-of-band transmission).
  const costOpts = { hardIrNm, wIn, wBlock };
  // grid spans the passband and the long-wave suppression band [stop, hardIrNm]
  const lo = target.startNm;
  const hi = Math.max(target.stopNm + 1, hardIrNm);
  const grid = new Float64Array(points);
  for (let i = 0; i < points; i++) grid[i] = lo + (hi - lo) * (i / (points - 1));

  let best = layers.map((l) => ({ ...l }));
  let bestCost = stackCost(best, grid, target, costOpts);
  let step = 0.12; // fractional thickness step
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let improved = false;
    for (let j = 0; j < best.length; j++) {
      for (const dir of [1, -1]) {
        const trial = best.map((l) => ({ ...l }));
        trial[j].d_nm = best[j].d_nm * (1 + dir * step);
        if (trial[j].d_nm < 5) continue;
        const c = stackCost(trial, grid, target, costOpts);
        if (c < bestCost - 1e-12) {
          best = trial;
          bestCost = c;
          improved = true;
        }
      }
    }
    if (!improved) {
      step *= 0.5;
      if (step < 0.005) break;
    }
  }
  return { layers: best, cost: bestCost };
}

/** Full synthesis: analytic starting design + bounded refinement. Returns the layer list. */
export function synthesizeStack(target, opts = {}) {
  return refine(startingDesign(target, opts), target, opts).layers;
}
