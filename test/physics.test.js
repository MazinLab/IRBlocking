// test/physics.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { photonRadiance, energyRadiance, SIGMA } from "../js/physics.js";

// Integrate radiance over wavelength on a log grid, return hemispherical exitance (× π).
function exitance(fn, T) {
  const lo = -7, hi = -2; // 1e-7 m (100 nm) .. 1e-2 m (10 mm), log10
  const N = 200000;
  let prev = fn(10 ** lo, T), prevL = 10 ** lo, sum = 0;
  for (let i = 1; i <= N; i++) {
    const lam = 10 ** (lo + (hi - lo) * (i / N));
    const cur = fn(lam, T);
    sum += 0.5 * (cur + prev) * (lam - prevL);
    prev = cur; prevL = lam;
  }
  return Math.PI * sum;
}

test("energy radiance integrates to Stefan-Boltzmann exitance", () => {
  const T = 300;
  const got = exitance(energyRadiance, T);
  const want = SIGMA * T ** 4; // W m^-2
  assert.ok(Math.abs(got - want) / want < 0.01, `got ${got} want ${want}`);
});

test("photon radiance integrates to total photon exitance 1.5205e15 T^3", () => {
  const T = 300;
  const got = exitance(photonRadiance, T);
  const want = 1.5205e15 * T ** 3; // photons s^-1 m^-2
  assert.ok(Math.abs(got - want) / want < 0.01, `got ${got} want ${want}`);
});

test("radiance is zero for non-positive T or lambda, and finite deep in Wien tail", () => {
  assert.equal(photonRadiance(1e-6, 0), 0);
  assert.equal(photonRadiance(0, 300), 0);
  assert.ok(Number.isFinite(photonRadiance(50e-9, 4))); // huge x -> guarded to 0
  assert.equal(photonRadiance(50e-9, 4), 0);
});

// append to test/physics.test.js
import { apertureSolidAngle, coldStopOmega } from "../js/physics.js";

test("aperture solid angle approaches pi D^2 / (4 d^2) in the small-angle limit", () => {
  const D = 0.001, d = 1.0; // 1 mm aperture at 1 m
  const got = apertureSolidAngle(D, d);
  const approx = Math.PI * D * D / (4 * d * d);
  assert.ok(Math.abs(got - approx) / approx < 1e-3, `got ${got} approx ${approx}`);
});

test("cold-stop omega picks the most restrictive aperture between pixel and emitter", () => {
  // apertures (D m, d m): stage3 near+small-angle big, stage2 = the stop, source far
  const aps = [
    { D: 0.020, d: 0.030 }, // stage3
    { D: 0.030, d: 0.100 }, // stage2 (smallest angular radius -> the stop)
    { D: 0.060, d: 0.200 }, // stage1
    { D: 0.080, d: 0.300 }, // source
  ];
  const wStop = Math.min(...aps.map((a) => apertureSolidAngle(a.D, a.d)));
  // emitter at the source distance sees the stop
  assert.equal(coldStopOmega(0.300, aps), wStop);
  // emitter at stage3 distance only sees stage3 (nothing closer)
  assert.equal(coldStopOmega(0.030, aps), apertureSolidAngle(0.020, 0.030));
});

// append to test/physics.test.js
import { assembleFlux, integrateTrapezoid, toPerNm, photonRadiance as Lph } from "../js/physics.js";

test("integrateTrapezoid is exact on a linear integrand", () => {
  // ∫_0^1 (1 + 2x) dx = 2
  const N = 1001;
  const x = new Float64Array(N), y = new Float64Array(N);
  for (let i = 0; i < N; i++) { x[i] = i / (N - 1); y[i] = 1 + 2 * x[i]; }
  assert.ok(Math.abs(integrateTrapezoid(x, y) - 2) < 1e-9);
});

test("assembleFlux with emissivity 1, omega/area/qe = 1, T=1 equals photonRadiance", () => {
  const grid = new Float64Array([1e-6, 2e-6, 3e-6]);
  const ones = new Float64Array([1, 1, 1]);
  const { total, perEmitter } = assembleFlux({
    grid_m: grid,
    emitters: [{ T: 300, omega: 1, emissivity: ones, downstreamT: ones }],
    pixelArea_m2: 1, qe: 1,
  });
  for (let i = 0; i < grid.length; i++) {
    assert.ok(Math.abs(total[i] - Lph(grid[i], 300)) / Lph(grid[i], 300) < 1e-12);
    assert.equal(perEmitter[0][i], total[i]);
  }
});

test("downstream transmission and emissivity scale the emitter term; totals sum", () => {
  const grid = new Float64Array([2e-6, 2.5e-6]);
  const eps = new Float64Array([0.5, 0.5]);
  const dT = new Float64Array([0.1, 0.2]);
  const ones = new Float64Array([1, 1]);
  const { total, perEmitter } = assembleFlux({
    grid_m: grid,
    emitters: [
      { T: 300, omega: 2, emissivity: eps, downstreamT: dT },
      { T: 100, omega: 3, emissivity: ones, downstreamT: ones },
    ],
    pixelArea_m2: 4, qe: 0.5,
  });
  for (let i = 0; i < grid.length; i++) {
    const e0 = 4 * 0.5 * 2 * eps[i] * dT[i] * Lph(grid[i], 300);
    const e1 = 4 * 0.5 * 3 * 1 * 1 * Lph(grid[i], 100);
    assert.ok(Math.abs(perEmitter[0][i] - e0) <= 1e-30 + 1e-9 * Math.abs(e0));
    assert.ok(Math.abs(total[i] - (e0 + e1)) <= 1e-30 + 1e-9 * Math.abs(e0 + e1));
  }
});

test("toPerNm multiplies a per-meter spectrum by 1e-9", () => {
  const v = new Float64Array([1, 2, 3]);
  const out = toPerNm(v);
  assert.deepEqual(Array.from(out), [1e-9, 2e-9, 3e-9]);
});

// append to test/physics.test.js
import { readFileSync } from "node:fs";

test("notebook parity: assembleFlux + integrate matches the numpy reference within 1%", () => {
  const fx = JSON.parse(readFileSync(new URL("./fixtures/notebook_parity.json", import.meta.url)));
  const grid_m = Float64Array.from(fx.grid_nm, (nm) => nm * 1e-9);
  const ones = new Float64Array(grid_m.length).fill(1);
  const emitters = fx.emitters.map((em) => ({
    T: em.T, omega: em.omega,
    emissivity: ones, // blackbody sources: epsilon = 1
    downstreamT: Float64Array.from(em.downstreamT),
  }));
  const { total } = assembleFlux({ grid_m, emitters, pixelArea_m2: fx.pixelArea_m2, qe: fx.qe });
  const got = integrateTrapezoid(grid_m, total);
  const want = fx.expected_counts_per_sec;
  assert.ok(Math.abs(got - want) / want < 0.01, `got ${got} want ${want}`);
});
