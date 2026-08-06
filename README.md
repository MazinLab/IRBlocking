# IR Blocking & Blackbody Flux Calculator

A static, browser-only [LCARS-themed](https://en.wikipedia.org/wiki/LCARS) calculator for the
blackbody photon flux landing on a detector pixel through a three-stage cryogenic filter stack.
A warm source (default 280 K) radiates through three cold stages (default 65 K / 3.5 K / 800 mK)
onto the pixel; the
tool plots **counts/nm vs wavelength** and reports the integrated **counts/sec**.

## Features

- **Reactive optical-bench schematic** with the controls laid out per stage (temperature, aperture
  diameter, axial distance, substrate + thickness, coating).
- **Full radiative model**: the warm source and each cold stage emit as graybodies, each attenuated
  by the colder downstream filters; cold-stop geometry sets the étendue onto the pixel.
- **Thickness-scaled substrate materials** computed from first principles: N-BK7, fused silica
  (Suprasil / Infrasil), sapphire, MgF₂, CaF₂.
- **Coatings** from a measured-curve library (DARKNESS, PICTURE-C, MEC Prime, ASAHI YSC1100,
  ASAHI YSC0750, ITO, M254C cold mirror), plus CSV import, a **Custom coating** (ideal top-hat
  *or* a designed Ta₂O₅/SiO₂ multilayer), and **Custom 2** — a vendor spec transcribed as
  `Tavg ≥/≤ x%` bounds per wavelength band.
- **Coating designer**: synthesize a real Ta₂O₅/SiO₂ stack from a passband target (transfer-matrix
  forward model + bounded refinement), edit the layer list by hand, and see the designed filter's
  throughput overlaid on the flux plot on a log right-hand axis.

## Run locally

The app **must be served over HTTP** — ES-module imports and `fetch()` of the filter JSON do not
work from `file://`.

```bash
python3 -m http.server 8000   # or: npm run serve
# open http://localhost:8000/
```

## Tests

```bash
npm test        # node --test over test/*.test.js
```

## The calculation

Photon spectral radiance `L_ph(λ,T) = (2c/λ⁴)/(exp(hc/λk_BT) − 1)`; each emitter `k` contributes
`A_pix · QE · Ω_k · ε_k(λ) · (∏ downstream T_j) · L_ph(λ,T_k)`, where `Ω_k` is the projected solid
angle of the limiting (cold-stop) aperture between plane `k` and the pixel. The per-nm spectrum is
integrated (trapezoid) to counts/sec. Units and assumptions are documented inline in `js/physics.js`.

## Optical model

Coatings and substrates share one swappable `OpticalElement` interface (`transmission`/`reflection`
over a wavelength grid), so the flux engine never cares how an element's curve was produced:

- **Substrates** (`js/materials.js`) are computed from physical thickness:
  `T = (1−R)²·τ(λ,d)`, `ε = (1−R)(1−τ)`, with `R` from the Sellmeier refractive index and bulk `τ`
  from either a tabulated absorption coefficient (fused silica, sapphire, MgF₂, CaF₂) or the measured
  N-BK7 curve scaled from its 10 mm reference (Beer–Lambert). Each stage has a Thickness (mm) input.
  Outside a material's validity range (`rangeNm`, bounded by its UV and multiphonon IR absorption
  edges) the substrate is **opaque** — `τ = 0`, `ε = 1 − R` — rather than holding the edge value,
  which would turn a falling absorption edge into an infinite transmission plateau.
- **Coatings** are measured `T(λ)` curves (`js/filters.js`), the analytic **Custom** top-hat
  (`CustomCoating`), a designed multilayer (`MultilayerCoating`), or **Custom 2** (`SpecCoating`) —
  piecewise `Tavg` bounds per band, where each row's stated bound *is* the transmission used (so the
  result is the worst case the spec permits), later rows override earlier ones on overlap, and
  wavelengths no band covers transmit fully. The editor keeps adjacent bands contiguous — editing
  either side of a boundary drags its partner, and removing a band closes over its span — so an
  open region has to be stated as a band at 100% rather than left implicit. Only λ outside the
  outermost bands falls through to the uncovered default.
- **Multilayer designer** (`js/tmm.js`, `js/synthesis.js`): a transfer-matrix forward model for
  Ta₂O₅/SiO₂ stacks, plus a synthesizer that builds a chirped long-wave-blocking edge filter from the
  Custom passband and refines the layer thicknesses (asymmetric objective: maximize in-band, suppress
  long-wave leakage out to the ~3.4 µm glass cutoff, leave the short side free). Layer count is
  adjustable; the result is demonstration-grade (see `js/synthesis.js` for the limits).

## Filter & material library

The bundled coating curves in `data/filters/*.json` are checked in and are all the app needs. They
were converted from raw manufacturer/measured source curves (kept outside this repo) with the py313
+ numpy scripts in `tools/`; `tools/notebook_parity_reference.py` regenerates the physics parity
fixture from the bundled curves. Substrate material data (Sellmeier coefficients + absorption tables,
with citations) lives inline in `js/materials.js`. You can also import your own coating/substrate
curve at runtime from a 2-column file (fraction / percent / OD).

## Deploy (GitHub Pages)

Settings → Pages → Deploy from branch → `main`, `/ (root)`. All files are static at the repo root;
no build step.
