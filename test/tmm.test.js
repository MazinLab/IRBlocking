import { test } from "node:test";
import assert from "node:assert/strict";
import { coatingIndex, stackTRA, MultilayerCoating } from "../js/tmm.js";

test("coatingIndex matches reference refractive indices", () => {
  assert.ok(Math.abs(coatingIndex("Ta2O5", 550) - 2.157) < 0.01);
  assert.ok(Math.abs(coatingIndex("Ta2O5", 1000) - 2.099) < 0.01);
  assert.ok(Math.abs(coatingIndex("SiO2", 550) - 1.460) < 0.005);
  assert.ok(Math.abs(coatingIndex("SiO2", 1000) - 1.450) < 0.005);
});

test("bare stack (no layers) fully transmits", () => {
  const { T, R } = stackTRA([], Float64Array.from([500, 1000, 2000]));
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(T[i] - 1) < 1e-12);
    assert.ok(Math.abs(R[i]) < 1e-12);
  }
});

test("energy conserves (T+R+A=1) and is lossless (A≈0) for an arbitrary stack", () => {
  const layers = [
    { material: "Ta2O5", d_nm: 100 },
    { material: "SiO2", d_nm: 200 },
    { material: "Ta2O5", d_nm: 150 },
  ];
  const { T, R, A } = stackTRA(layers, Float64Array.from([400, 700, 1200, 2000]));
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(T[i] + R[i] + A[i] - 1) < 1e-9);
    assert.ok(Math.abs(A[i]) < 1e-9);
  }
});

test("a single quarter-wave high-index layer is a partial reflector at design λ", () => {
  // QWOT Ta2O5 at 1000 nm: d = λ0 / (4 n); at λ0, δ = π/2 exactly.
  const lam0 = 1000;
  const nH = coatingIndex("Ta2O5", lam0);
  const { T, R } = stackTRA([{ material: "Ta2O5", d_nm: lam0 / (4 * nH) }], Float64Array.from([lam0]));
  // single layer in air: R = ((1 - n²)/(1 + n²))² ; T = 1 - R
  const expR = ((1 - nH * nH) / (1 + nH * nH)) ** 2;
  assert.ok(Math.abs(R[0] - expR) < 1e-9, `R=${R[0]} exp=${expR}`);
  assert.ok(Math.abs(T[0] - (1 - expR)) < 1e-9);
});

test("quarter-wave Bragg mirror is a high reflector at the design wavelength", () => {
  const lam0 = 1000;
  const nH = coatingIndex("Ta2O5", lam0), nL = coatingIndex("SiO2", lam0);
  const layers = [];
  for (let i = 0; i < 15; i++) {
    layers.push({ material: "Ta2O5", d_nm: lam0 / (4 * nH) });
    layers.push({ material: "SiO2", d_nm: lam0 / (4 * nL) });
  }
  const { T, R } = stackTRA(layers, Float64Array.from([lam0]));
  assert.ok(R[0] > 0.999, `R=${R[0]}`);
  assert.ok(T[0] < 0.001, `T=${T[0]}`);
});

test("MultilayerCoating implements the element interface", () => {
  const c = new MultilayerCoating([
    { material: "Ta2O5", d_nm: 120 },
    { material: "SiO2", d_nm: 170 },
  ]);
  const g = Float64Array.from([1000]);
  assert.equal(c.transmission(g).length, 1);
  assert.equal(c.hasReflection, true);
  assert.ok(c.reflection(g)[0] >= 0 && c.reflection(g)[0] <= 1);
});

test("coatingIndex throws on an unknown material", () => {
  assert.throws(() => coatingIndex("Foo", 1000), RangeError);
});

test("MultilayerCoating drops invalid layers (bad material or non-positive/NaN thickness)", () => {
  const c = new MultilayerCoating([
    { material: "Ta2O5", d_nm: 120 },
    { material: "SiO2", d_nm: NaN },
    { material: "Foo", d_nm: 50 },
    { material: "SiO2", d_nm: -3 },
    { material: "SiO2", d_nm: 170 },
  ]);
  assert.equal(c.layers.length, 2); // only the two valid layers survive
  assert.ok(c.transmission(Float64Array.from([1000])).every(Number.isFinite));
});
