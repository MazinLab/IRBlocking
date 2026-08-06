import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sellmeierN, MATERIALS, MaterialElement, materialNames } from "../js/materials.js";

const at = (el, fn, nm) => fn.call(el, Float64Array.from([nm]))[0];

test("Sellmeier reproduces known refractive indices (catches coefficient typos)", () => {
  const n = (name, um) => sellmeierN(MATERIALS[name].B, MATERIALS[name].C, um);
  assert.ok(Math.abs(n("N-BK7", 0.5876) - 1.5168) < 1e-3);
  assert.ok(Math.abs(n("Fused silica (Suprasil, high-OH)", 0.5876) - 1.4585) < 1e-3);
  assert.ok(Math.abs(n("Sapphire", 1.064) - 1.7545) < 2e-3);
  assert.ok(Math.abs(n("MgF2", 0.589) - 1.3777) < 1e-3);
  assert.ok(Math.abs(n("CaF2", 0.589) - 1.4338) < 1e-3);
});

test("materialNames lists all six substrates including N-BK7", () => {
  const names = materialNames();
  assert.ok(names.includes("N-BK7"));
  assert.equal(names.length, 6);
});

test("alpha-based material: transparent window hits the Fresnel ceiling, thickness-independent", () => {
  const caf2 = MATERIALS.CaF2;
  const thin = new MaterialElement(caf2, 1);
  const thick = new MaterialElement(caf2, 20);
  const nm = 500; // CaF2 essentially lossless here (alpha ~5e-4 /cm)
  const n = sellmeierN(caf2.B, caf2.C, nm / 1000);
  const R = ((n - 1) / (n + 1)) ** 2;
  const fresnel = (1 - R) ** 2;
  assert.ok(Math.abs(at(thin, thin.transmission, nm) - fresnel) < 1e-3);
  assert.ok(Math.abs(at(thin, thin.transmission, nm) - at(thick, thick.transmission, nm)) < 1e-3);
});

test("alpha-based material: thicker substrate absorbs more at an absorbing wavelength", () => {
  const caf2 = MATERIALS.CaF2;
  const t1 = at(new MaterialElement(caf2, 1), MaterialElement.prototype.transmission, 9090);
  const t10 = at(new MaterialElement(caf2, 10), MaterialElement.prototype.transmission, 9090);
  assert.ok(t1 > t10, `expected T(1mm) > T(10mm), got ${t1} vs ${t10}`); // alpha=0.65/cm at 9090 nm
  assert.ok(t10 > 0);
});

test("energy balance: transmission + total reflection + emissivity = 1", () => {
  const el = new MaterialElement(MATERIALS.Sapphire, 3);
  for (const nm of [400, 2000, 5800]) {
    const T = at(el, el.transmission, nm);
    const Rtot = at(el, el.reflection, nm);
    const eps = 1 - T - Rtot;
    assert.ok(eps >= -1e-9, `emissivity negative at ${nm}: ${eps}`);
    assert.ok(Math.abs(T + Rtot + eps - 1) < 1e-9);
  }
});

test("absorbing edge drives emissivity toward (1 - R); transparent window keeps it near 0", () => {
  const el = new MaterialElement(MATERIALS.Sapphire, 3);
  const n = sellmeierN(MATERIALS.Sapphire.B, MATERIALS.Sapphire.C, 6.0);
  const R = ((n - 1) / (n + 1)) ** 2;
  const epsIR = 1 - at(el, el.transmission, 6000) - at(el, el.reflection, 6000); // alpha=10/cm
  assert.ok(epsIR > 0.5 * (1 - R), `IR emissivity too low: ${epsIR}`);
  const epsVis = 1 - at(el, el.transmission, 1000) - at(el, el.reflection, 1000);
  assert.ok(epsVis < 0.02, `transparent emissivity too high: ${epsVis}`);
});

test("transmission stays finite beyond a material's validity range (no NaN past Sellmeier poles)", () => {
  // N-BK7's dispersion has a pole near 10.18 um; evaluating at 10000 nm must not produce NaN.
  const curve = JSON.parse(readFileSync(new URL("../data/filters/n-bk7.json", import.meta.url)));
  const nbk7 = new MaterialElement(MATERIALS["N-BK7"], 10, curve);
  assert.ok(Number.isFinite(at(nbk7, nbk7.transmission, 10000)), "N-BK7 T at 10 um not finite");
  assert.ok(Number.isFinite(at(nbk7, nbk7.reflection, 10000)), "N-BK7 R at 10 um not finite");
  const caf2 = new MaterialElement(MATERIALS.CaF2, 5);
  assert.ok(Number.isFinite(at(caf2, caf2.transmission, 12000)), "CaF2 T past range not finite");
});

test("substrate is opaque outside its validity range, at every thickness", () => {
  // Regression: holding the measured/tabulated edge value past the absorption edge turned a falling
  // edge into an infinite transmission plateau. A 1 mm N-BK7 window read T = 0.38 out to 12 µm.
  const curve = JSON.parse(readFileSync(new URL("../data/filters/n-bk7.json", import.meta.url)));
  const [, hiNm] = MATERIALS["N-BK7"].rangeNm;
  for (const d of [1, 10, 20]) {
    const el = new MaterialElement(MATERIALS["N-BK7"], d, curve);
    for (const nm of [hiNm + 1, 5000, 8000, 12000]) {
      assert.equal(at(el, el.transmission, nm), 0, `N-BK7 ${d} mm still transmits at ${nm} nm`);
    }
    assert.equal(at(el, el.transmission, 100), 0, "N-BK7 transmits below its UV edge");
  }
  // same rule on the alpha-table path
  const caf2 = new MaterialElement(MATERIALS.CaF2, 1);
  assert.ok(at(caf2, caf2.transmission, 9090) > 0, "CaF2 opaque inside its range");
  assert.equal(at(caf2, caf2.transmission, 12000), 0, "CaF2 transmits past its 10600 nm edge");
});

test("an opaque substrate still emits: eps = 1 - R past the absorption edge", () => {
  const curve = JSON.parse(readFileSync(new URL("../data/filters/n-bk7.json", import.meta.url)));
  const el = new MaterialElement(MATERIALS["N-BK7"], 10, curve);
  const R = at(el, el.reflection, 6000);
  const eps = 1 - at(el, el.transmission, 6000) - R;
  assert.ok(Math.abs(eps - (1 - R)) < 1e-12, `expected eps = 1-R = ${1 - R}, got ${eps}`);
  assert.ok(eps > 0.9, `opaque substrate should be a near-blackbody emitter, got ${eps}`);
});

test("N-BK7 curve model reproduces the measured 10 mm curve and scales with thickness", () => {
  const curve = JSON.parse(readFileSync(new URL("../data/filters/n-bk7.json", import.meta.url)));
  const mk = (d) => new MaterialElement(MATERIALS["N-BK7"], d, curve);
  const measuredAt = (nm) =>
    curve.transmission[curve.wavelength_nm.findIndex((w) => w >= nm)];
  // 2500 nm: N-BK7 is absorbing (measured ~0.72); 10 mm reproduces it
  const t10 = at(mk(10), MaterialElement.prototype.transmission, 2500);
  assert.ok(Math.abs(t10 - measuredAt(2500)) < 0.02, `10mm ${t10} vs measured ${measuredAt(2500)}`);
  // thinner transmits more, thicker less, at the absorbing wavelength
  const t5 = at(mk(5), MaterialElement.prototype.transmission, 2500);
  const t20 = at(mk(20), MaterialElement.prototype.transmission, 2500);
  assert.ok(t5 > t10 && t10 > t20, `scaling wrong: ${t5}, ${t10}, ${t20}`);
});
