// test/manifest.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("../data/filters/", import.meta.url);

function load(name) {
  return JSON.parse(readFileSync(new URL(name, DIR)));
}

test("index.json lists curves and each file exists", () => {
  const index = load("index.json");
  assert.ok(Array.isArray(index) && index.length >= 5);
  for (const e of index) assert.ok(readdirSync(DIR).includes(e.file), `missing ${e.file}`);
});

test("every curve has ascending λ, finite values, transmission/reflection in [0,1]", () => {
  for (const file of readdirSync(DIR)) {
    if (file === "index.json" || !file.endsWith(".json")) continue;
    const d = load(file);
    const wl = d.wavelength_nm, t = d.transmission;
    assert.ok(wl.length === t.length && wl.length > 1, `${file} length`);
    for (let i = 1; i < wl.length; i++) assert.ok(wl[i] > wl[i - 1], `${file} λ not ascending @${i}`);
    for (const x of t) assert.ok(Number.isFinite(x) && x >= 0 && x <= 1, `${file} T out of range`);
    if (d.reflection) {
      assert.equal(d.reflection.length, wl.length, `${file} R length`);
      for (let i = 0; i < d.reflection.length; i++) {
        const r = d.reflection[i];
        assert.ok(Number.isFinite(r) && r >= 0 && r <= 1, `${file} R out of range`);
        assert.ok(t[i] + r <= 1.0001, `${file} T+R>1 @${i}`);
      }
    }
  }
});
