// js/main.js
import { defaultState, validate, buildGridNm } from "./state.js";
import { loadLibrary, parseCurveText } from "./filters.js";
import { CurveElement, StageElement, CustomCoating, SpecCoating } from "./optics.js";
import { MATERIALS, MaterialElement, materialNames } from "./materials.js";
import { MultilayerCoating } from "./tmm.js";
import { synthesizeStack } from "./synthesis.js";

const CUSTOM_COLOR = "#5fd3bc"; // throughput-overlay color (distinct from total/emitters)
const CUSTOM2_COLOR = "#c78bff"; // Custom-2 throughput overlay
import { assembleFlux, integrateTrapezoid, toPerNm, coldStopOmega } from "./physics.js";
import { renderSchematic, fmtT, tempColor } from "./schematic.js";
import { drawSpectrum } from "./plot.js";

const MM = 1e-3, UM = 1e-6, NM = 1e-9;
let state = defaultState();
let lib = new Map();
let debounce = null;
let coverageTargets = []; // [{ stage, prop, cov }] for substrate/coating coverage badges

const el = (id) => document.getElementById(id);

function curveElement(name) {
  if (!name || name === "(none)") return null;
  const d = lib.get(name);
  return d ? new CurveElement(d) : null;
}
function substrateElement(stage) {
  if (!stage.substrate || stage.substrate === "(none)") return null;
  const mat = MATERIALS[stage.substrate];
  if (!mat) return null;
  let measured = null;
  if (mat.bulk.kind === "curve") {
    measured = lib.get(mat.bulk.curveName);
    if (!measured) return null; // required reference curve unavailable — skip rather than crash
  }
  return new MaterialElement(mat, stage.thickness_mm, measured);
}
function customMultilayerActive() {
  // Deliberately NOT gated on layers.length: an empty stack is a BARE element (TMM gives T = 1),
  // which is what the layer list actually describes. Falling back to the ideal top-hat when the
  // user deletes the last layer would silently report a perfect filter and understate the IR load.
  return state.custom.mode === "multilayer";
}
function coatingElement(stage) {
  if (stage.coating === "Custom") {
    if (customMultilayerActive()) return new MultilayerCoating(state.custom.layers);
    return new CustomCoating({
      startNm: state.custom.startNm,
      stopNm: state.custom.stopNm,
      outFraction: state.custom.outPct / 100,
    });
  }
  if (stage.coating === "Custom 2") return new SpecCoating(state.custom2.rows);
  return curveElement(stage.coating);
}
function stageElement(stage) {
  return new StageElement({
    substrate: substrateElement(stage),
    coating: coatingElement(stage),
    reflectance: stage.reflectance,
  });
}
function curvesByKind(...kinds) {
  return [...lib.values()].filter((d) => kinds.includes(d.kind)).map((d) => d.name);
}

// ---- field builders -------------------------------------------------------
function numField(col, label, value, onInput, key) {
  const f = document.createElement("div");
  f.className = "field"; f.dataset.key = key || "";
  f.innerHTML = `<label>${label}</label>`;
  const inp = document.createElement("input");
  inp.type = "number"; inp.value = value ?? "";
  inp.addEventListener("input", () => onInput(inp.value, f));
  f.appendChild(inp);
  col.appendChild(f);
  return f;
}
function selectField(col, label, options, value, onInput) {
  const f = document.createElement("div");
  f.className = "field";
  f.innerHTML = `<label>${label}</label>`;
  const sel = document.createElement("select");
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o; opt.textContent = o; if (o === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => onInput(sel.value));
  f.appendChild(sel);
  const cov = document.createElement("div"); cov.className = "coverage"; f.appendChild(cov);
  col.appendChild(f);
  return f;
}
function column(parent, title) {
  const c = document.createElement("div");
  c.className = "bench-col";
  c.innerHTML = `<h4>${title}</h4>`;
  parent.appendChild(c);
  return c;
}

function buildCustomPanel(cust) {
  // mode toggle: ideal top-hat vs designed multilayer
  const modeField = document.createElement("div");
  modeField.className = "field";
  modeField.innerHTML = `<label>Mode</label>`;
  const modeSel = document.createElement("select");
  for (const [val, lab] of [["ideal", "Ideal top-hat"], ["multilayer", "Multilayer (TMM)"]]) {
    const o = document.createElement("option");
    o.value = val; o.textContent = lab;
    if (val === state.custom.mode) o.selected = true;
    modeSel.appendChild(o);
  }
  modeSel.addEventListener("change", () => { state.custom.mode = modeSel.value; buildColumns(); recompute(); });
  modeField.appendChild(modeSel);
  cust.appendChild(modeField);

  // passband: the top-hat directly in ideal mode, and the synthesis target in multilayer mode
  numField(cust, "Passband start (nm)", state.custom.startNm, (v) => set(() => (state.custom.startNm = +v)), "custom");
  numField(cust, "Passband stop (nm)", state.custom.stopNm, (v) => set(() => (state.custom.stopNm = +v)), "custom");
  numField(cust, "Out-of-band T (%)", state.custom.outPct, (v) => set(() => (state.custom.outPct = +v)), "custom");

  numField(cust, "Layers (synthesis)", state.custom.synthLayers, (v) =>
    set(() => (state.custom.synthLayers = Math.max(4, Math.min(160, Math.round(+v) || 60)))), "synthlayers");

  const synthBtn = document.createElement("button");
  synthBtn.className = "synth-btn";
  synthBtn.textContent = "Synthesize Ta₂O₅/SiO₂";
  synthBtn.addEventListener("click", () => {
    const target = { startNm: state.custom.startNm, stopNm: state.custom.stopNm, outFraction: state.custom.outPct / 100 };
    if (!(target.startNm > 0 && target.stopNm > target.startNm)) {
      alert("Set a valid passband (stop > start > 0) before synthesizing.");
      return;
    }
    synthBtn.disabled = true;
    synthBtn.textContent = "Synthesizing…";
    setTimeout(() => {
      // Synthesize against the default ~3.4 µm cutoff (the fused-silica regime, where the substrate
      // absorbs beyond). Extending the block band to a far λmax is left out: a finite stack cannot
      // flatten the passband AND block a multi-octave IR band — doing so collapses the passband.
      try {
        state.custom.layers = synthesizeStack(target, { layers: state.custom.synthLayers });
        state.custom.mode = "multilayer";
      } catch (err) {
        alert(err.message); // passband stop at/beyond the substrate cutoff — nothing left to block
      } finally {
        buildColumns(); // rebuilds the button, clearing the disabled/"Synthesizing…" state
        recompute();
      }
    }, 20);
  });
  cust.appendChild(synthBtn);

  if (state.custom.mode !== "multilayer") return;

  // editable layer stack
  const layers = state.custom.layers;
  const info = document.createElement("div");
  info.className = "coverage";
  info.textContent = `${layers.length} layers · ${layers.reduce((s, l) => s + l.d_nm, 0).toFixed(0)} nm total`;
  cust.appendChild(info);

  const list = document.createElement("div");
  list.className = "layer-list";
  layers.forEach((ly, idx) => {
    const row = document.createElement("div");
    row.className = "layer-row";
    const ms = document.createElement("select");
    for (const [val, lab] of [["Ta2O5", "Ta₂O₅"], ["SiO2", "SiO₂"]]) {
      const o = document.createElement("option");
      o.value = val; o.textContent = lab;
      if (val === ly.material) o.selected = true;
      ms.appendChild(o);
    }
    ms.addEventListener("change", () => set(() => (ly.material = ms.value)));
    const ti = document.createElement("input");
    ti.type = "number"; ti.step = "1"; ti.min = "1"; ti.value = ly.d_nm.toFixed(1);
    ti.addEventListener("input", () => set(() => {
      const v = +ti.value;
      if (Number.isFinite(v) && v > 0) ly.d_nm = v; // ignore empty/garbage so the stack never gets NaN
    }));
    const rm = document.createElement("button");
    rm.className = "layer-rm"; rm.textContent = "×";
    rm.addEventListener("click", () => { layers.splice(idx, 1); buildColumns(); recompute(); });
    row.append(ms, ti, rm);
    list.appendChild(row);
  });
  cust.appendChild(list);

  const add = document.createElement("button");
  add.className = "synth-btn";
  add.textContent = "+ layer";
  add.addEventListener("click", () => { layers.push({ material: "Ta2O5", d_nm: 100 }); buildColumns(); recompute(); });
  cust.appendChild(add);
}

/** One spec row rendered in the vendor notation the rows were transcribed from. */
function specLine(r) {
  const op = r.op === ">=" ? "≥" : "≤";
  return `Tavg${op}${r.tPct}%  ${r.startNm}–${r.stopNm} nm`;
}

function buildCustom2Panel(col) {
  const rows = state.custom2.rows;

  const summary = document.createElement("div");
  summary.className = "spec-summary";
  const refreshSummary = () => {
    // Updated in place on every keystroke: rebuilding the panel here would steal input focus.
    summary.textContent = rows.length ? rows.map(specLine).join("\n") : "(no bands specified)";
  };
  refreshSummary();
  col.appendChild(summary);

  const note = document.createElement("div");
  note.className = "coverage";
  note.textContent = "later rows win · uncovered λ → T = 100%";
  col.appendChild(note);

  const hint = document.createElement("div");
  hint.className = "coverage";
  hint.textContent = "λ start · λ stop / bound · T%";
  col.appendChild(hint);

  const list = document.createElement("div");
  list.className = "layer-list spec-list";
  rows.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "field spec-row"; // .field so showErrors can flag it by data-key
    row.dataset.key = `custom2_${idx}`;

    const num = (area, value, title, assign) => {
      const inp = document.createElement("input");
      inp.type = "number"; inp.value = value; inp.title = title; inp.style.gridArea = area;
      inp.addEventListener("input", () => set(() => { assign(+inp.value); refreshSummary(); }));
      row.appendChild(inp);
    };
    num("lo", r.startNm, "λ start (nm)", (v) => (r.startNm = v));
    num("hi", r.stopNm, "λ stop (nm)", (v) => (r.stopNm = v));

    const op = document.createElement("select");
    op.style.gridArea = "op"; op.title = "spec bound";
    // Symbols only — the cell is ~56px wide and the summary above already spells out "Tavg≥90%".
    for (const [val, lab] of [[">=", "≥"], ["<=", "≤"]]) {
      const o = document.createElement("option");
      o.value = val; o.textContent = lab;
      if (val === r.op) o.selected = true;
      op.appendChild(o);
    }
    op.addEventListener("change", () => set(() => { r.op = op.value; refreshSummary(); }));
    row.appendChild(op);

    num("t", r.tPct, "transmission (%)", (v) => (r.tPct = v));

    const rm = document.createElement("button");
    rm.className = "layer-rm"; rm.textContent = "×"; rm.title = "remove band";
    rm.style.gridArea = "rm";
    rm.addEventListener("click", () => { rows.splice(idx, 1); buildColumns(); recompute(); });
    row.appendChild(rm);

    list.appendChild(row);
  });
  col.appendChild(list);

  const add = document.createElement("button");
  add.className = "synth-btn";
  add.textContent = "+ band";
  add.addEventListener("click", () => {
    const last = rows[rows.length - 1];
    // Continue from where the spec left off rather than dropping in a blank row.
    rows.push(last
      ? { startNm: last.stopNm, stopNm: last.stopNm + 500, op: "<=", tPct: 0.5 }
      : { startNm: 950, stopNm: 1400, op: ">=", tPct: 90 });
    buildColumns();
    recompute();
  });
  col.appendChild(add);
}

function buildColumns() {
  const root = el("bench-columns");
  root.innerHTML = "";
  coverageTargets = [];
  const subs = ["(none)", ...materialNames()];
  const coats = ["(none)", "Custom", "Custom 2", ...curvesByKind("coating", "mirror")];

  // Column 1: a stack holding the source panel with the import panel tucked beneath it.
  const col1 = document.createElement("div");
  col1.className = "bench-stack";
  root.appendChild(col1);

  const src = column(col1, "300 K Source");
  numField(src, "Temperature (K)", state.source.T, (v) => set(() => (state.source.T = +v)), "source_T");
  numField(src, "Aperture D (mm)", state.source.D_mm, (v) => set(() => (state.source.D_mm = +v)), "source_D");
  numField(src, "Distance d (mm)", state.source.d_mm, (v) => set(() => (state.source.d_mm = +v)), "source_d");

  state.stages.forEach((st, i) => {
    const c = column(root, st.name);
    numField(c, "Temperature", st.T, (v) => set(() => (st.T = +v)), `stage${i + 1}_T`);
    numField(c, "Aperture D (mm)", st.D_mm, (v) => set(() => (st.D_mm = +v)), `stage${i + 1}_D`);
    numField(c, "Distance d (mm)", st.d_mm, (v) => set(() => (st.d_mm = +v)), `stage${i + 1}_d`);
    const subField = selectField(c, "Substrate", subs, st.substrate, (v) => set(() => (st.substrate = v)));
    numField(c, "Thickness (mm)", st.thickness_mm, (v) => set(() => (st.thickness_mm = +v)), `stage${i + 1}_thk`);
    const coatField = selectField(c, "Coating", coats, st.coating, (v) => set(() => (st.coating = v)));
    coverageTargets.push({ stage: st, prop: "substrate", kind: "material", cov: subField.querySelector(".coverage") });
    coverageTargets.push({ stage: st, prop: "coating", kind: "curve", cov: coatField.querySelector(".coverage") });
  });

  // Detector column stacks the detector panel with the Custom-coating definition beneath it.
  const detStack = document.createElement("div");
  detStack.className = "bench-stack";
  root.appendChild(detStack);
  const pix = column(detStack, "Detector");
  numField(pix, "Pixel w (µm)", state.pixel.w_um, (v) => set(() => (state.pixel.w_um = +v)), "pixel_w");
  numField(pix, "Pixel h (µm)", state.pixel.h_um, (v) => set(() => (state.pixel.h_um = +v)), "pixel_h");
  numField(pix, "QE", state.qe, (v) => set(() => (state.qe = +v)), "qe");

  const cust = column(detStack, "Custom Coating");
  buildCustomPanel(cust);
  buildCustom2Panel(column(detStack, "Custom Coating 2"));

  const g = column(root, "Spectrum");
  numField(g, "λ min (nm)", state.lambdaMinNm, (v) => set(() => (state.lambdaMinNm = +v)), "range");
  numField(g, "λ max (nm)", state.lambdaMaxNm, (v) => set(() => (state.lambdaMaxNm = +v)), "range");
  numField(g, "Resolution (nm)", state.resolutionNm, (v) => set(() => (state.resolutionNm = +v)), "resolution");
  const ef = document.createElement("div"); ef.className = "field";
  ef.innerHTML = `<label>Cold-stage emission</label>`;
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = state.includeStageEmission;
  cb.addEventListener("change", () => set(() => (state.includeStageEmission = cb.checked)));
  ef.appendChild(cb); g.appendChild(ef);

  // import control — tucked under the source panel in column 1
  const imp = column(col1, "Import coating");
  imp.innerHTML += `<div class="field"><label>2-col file</label>
    <input type="file" id="impFile" accept=".csv,.txt"></div>
    <div class="field"><label>Units</label>
    <select id="impUnit"><option value="fraction">fraction</option><option value="percent">percent</option><option value="od">OD</option></select></div>`;
  el("impFile").addEventListener("change", onImport);
}

async function onImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const parsed = parseCurveText(text, el("impUnit").value);
  if (!parsed.wavelength_nm.length) { alert("No numeric rows parsed."); return; }
  const name = file.name.replace(/\.[^.]+$/, "");
  lib.set(name, { name, kind: "coating", ...parsed,
    wavelength_min_nm: parsed.wavelength_nm[0],
    wavelength_max_nm: parsed.wavelength_nm[parsed.wavelength_nm.length - 1] });
  buildColumns(); recompute();
}

// ---- recompute ------------------------------------------------------------
function set(mutate) {
  mutate();
  clearTimeout(debounce);
  debounce = setTimeout(recompute, 100);
}

function showErrors(errors) {
  document.querySelectorAll(".field").forEach((f) => {
    f.classList.remove("invalid");
    const e = f.querySelector(".err"); if (e) e.remove();
  });
  for (const key in errors) {
    // "ordering" maps to all distance fields so the user can see which values are wrong.
    const targets = key === "ordering"
      ? ["source_d", "stage1_d", "stage2_d", "stage3_d"]
      : [key];
    for (const target of targets) {
      document.querySelectorAll(`.field[data-key="${target}"]`).forEach((f) => {
        f.classList.add("invalid");
        // Only attach the error message once (first target = source_d).
        if (target === targets[0]) {
          const d = document.createElement("div"); d.className = "err"; d.textContent = errors[key];
          f.appendChild(d);
        }
      });
    }
  }
}

function recompute() {
  const { valid, errors } = validate(state);
  showErrors(errors);
  if (!valid) {
    // Don't leave the old total/plot looking current — mark the results stale until inputs are fixed.
    el("results").classList.add("stale");
    el("total").textContent = "—";
    return;
  }
  el("results").classList.remove("stale");
  renderSchematic(el("schematic"), state);

  const { grid, coarsened } = buildGridNm(state);
  const gridNm = grid;
  const grid_m = Float64Array.from(gridNm, (nm) => nm * NM);
  const n = gridNm.length;

  const stages = state.stages.map(stageElement);
  const stageT = stages.map((s) => s.transmission(gridNm));
  const stageEps = stages.map((s) => s.emissivity(gridNm));
  const apertures = [
    { D: state.source.D_mm * MM, d: state.source.d_mm * MM },
    ...state.stages.map((st) => ({ D: st.D_mm * MM, d: st.d_mm * MM })),
  ];
  const product = (idxs) => {
    const out = new Float64Array(n).fill(1);
    for (const j of idxs) for (let i = 0; i < n; i++) out[i] *= stageT[j][i];
    return out;
  };
  const ones = new Float64Array(n).fill(1);

  // source: downstream = all stages; stage k: downstream = colder stages (smaller d)
  const emitters = [{
    T: state.source.T, omega: coldStopOmega(state.source.d_mm * MM, apertures),
    emissivity: ones, downstreamT: product([0, 1, 2]),
  }];
  if (state.includeStageEmission) {
    state.stages.forEach((st, k) => {
      const downstream = state.stages.map((_, j) => j).filter((j) => state.stages[j].d_mm < st.d_mm);
      emitters.push({
        T: st.T, omega: coldStopOmega(st.d_mm * MM, apertures),
        emissivity: stageEps[k], downstreamT: product(downstream),
      });
    });
  }

  const pixelArea_m2 = state.pixel.w_um * UM * (state.pixel.h_um * UM);
  const { total, perEmitter } = assembleFlux({ grid_m, emitters, pixelArea_m2, qe: state.qe });
  const totalCounts = integrateTrapezoid(grid_m, total);

  el("total").textContent = totalCounts.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const notice = el("notice");
  if (coarsened) {
    notice.hidden = false;
    notice.textContent = `Grid capped at ${n} points: resolution coarsened from ${state.resolutionNm} nm `
      + `to ${(gridNm[1] - gridNm[0]).toPrecision(3)} nm.`;
  } else notice.hidden = true;

  const emitterMeta = [{ label: fmtT(state.source.T) + " source", color: tempColor(state.source.T) }];
  if (state.includeStageEmission) state.stages.forEach((st) => emitterMeta.push({ label: st.name + " " + fmtT(st.T), color: tempColor(st.T) }));
  // One right-axis overlay slot: the multilayer design preview keeps priority, so Custom 2 is
  // plotted whenever the Custom coating is not in multilayer mode.
  let overlay = null;
  if (customMultilayerActive()) {
    overlay = {
      values: new MultilayerCoating(state.custom.layers).transmission(gridNm),
      color: CUSTOM_COLOR,
      label: "custom throughput",
    };
  } else if (state.stages.some((st) => st.coating === "Custom 2")) {
    overlay = {
      values: new SpecCoating(state.custom2.rows).transmission(gridNm),
      color: CUSTOM2_COLOR,
      label: "custom 2 throughput",
    };
  }
  drawSpectrum(el("plot"), {
    gridNm, total: toPerNm(total), perEmitter: perEmitter.map(toPerNm), emitterMeta, overlay,
  }, { clampRegions: clampRegions() });

  el("legend").innerHTML =
    `<span><span class="swatch" style="background:#ff9900"></span>total</span>` +
    emitterMeta.map((m) => `<span><span class="swatch" style="background:${m.color}"></span>${m.label}</span>`).join("") +
    (overlay ? `<span><span class="swatch" style="background:${overlay.color}"></span>${overlay.label} (right axis)</span>` : "");

  updateCoverageBadges();
}

function selectedRanges() {
  const ranges = [];
  for (const st of state.stages) {
    if (st.substrate && st.substrate !== "(none)" && MATERIALS[st.substrate]) {
      ranges.push(MATERIALS[st.substrate].rangeNm);
    }
    if (st.coating && st.coating !== "(none)") {
      const d = lib.get(st.coating);
      if (d) ranges.push([d.wavelength_min_nm, d.wavelength_max_nm]);
    }
  }
  return ranges;
}
function clampRegions() {
  const rs = selectedRanges();
  if (!rs.length) return [];
  const lowCut = Math.max(...rs.map((r) => r[0]));
  const highCut = Math.min(...rs.map((r) => r[1]));
  const out = [];
  if (state.lambdaMinNm < lowCut) out.push([state.lambdaMinNm, lowCut]);
  if (state.lambdaMaxNm > highCut) out.push([highCut, state.lambdaMaxNm]);
  return out;
}
function updateCoverageBadges() {
  for (const { stage, prop, kind, cov } of coverageTargets) {
    if (!cov) continue;
    let lo, hi;
    if (kind === "material") {
      const m = MATERIALS[stage[prop]];
      if (!m) { cov.textContent = ""; cov.classList.remove("warn"); continue; }
      [lo, hi] = m.rangeNm;
    } else {
      const d = lib.get(stage[prop]);
      if (!d) { cov.textContent = ""; cov.classList.remove("warn"); continue; }
      lo = d.wavelength_min_nm; hi = d.wavelength_max_nm;
    }
    cov.textContent = `${Math.round(lo)}–${Math.round(hi)} nm`;
    cov.classList.toggle("warn", state.lambdaMinNm < lo || state.lambdaMaxNm > hi);
  }
}

// ---- boot -----------------------------------------------------------------
(async function init() {
  let libLoaded = true;
  try {
    lib = await loadLibrary();
  } catch (err) {
    libLoaded = false;
    el("notice").hidden = false;
    el("notice").textContent = "Could not load filter library (serve over HTTP, not file://). Calculation disabled.";
  }
  buildColumns();
  if (libLoaded) recompute(); // skip when the library failed — substrates need the curve data
})();
