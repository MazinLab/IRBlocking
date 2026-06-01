// js/physics.js
// Blackbody radiometry and flux assembly. SI units throughout (meters, kelvin, seconds).

export const H = 6.62607015e-34;   // J s
export const C = 2.99792458e8;     // m s^-1
export const KB = 1.380649e-23;    // J K^-1
export const SIGMA = 5.670374419e-8; // W m^-2 K^-4

const X_OVERFLOW = 700; // exp(700) is near double-precision overflow

/** Photon spectral radiance [photons s^-1 m^-2 sr^-1 m^-1]. lambda in meters. */
export function photonRadiance(lambda_m, T) {
  if (T <= 0 || lambda_m <= 0) return 0;
  const x = (H * C) / (lambda_m * KB * T);
  if (x > X_OVERFLOW) return 0;
  return (2 * C / lambda_m ** 4) / Math.expm1(x);
}

/** Energy spectral radiance [W m^-2 sr^-1 m^-1]. lambda in meters. (Validation/reference.) */
export function energyRadiance(lambda_m, T) {
  if (T <= 0 || lambda_m <= 0) return 0;
  const x = (H * C) / (lambda_m * KB * T);
  if (x > X_OVERFLOW) return 0;
  return (2 * H * C * C / lambda_m ** 5) / Math.expm1(x);
}

/** Projected (Lambertian) solid angle of a circular aperture [sr]. D, d in meters. */
export function apertureSolidAngle(D_m, d_m) {
  const r = D_m / 2;
  const sin2 = (r * r) / (r * r + d_m * d_m);
  return Math.PI * sin2;
}

/**
 * Limiting (cold-stop) solid angle for radiation originating at axial distance
 * emitter_d, given all apertures [{D, d}] in meters: the minimum aperture solid
 * angle among apertures between the pixel and the emitter (d <= emitter_d).
 */
export function coldStopOmega(emitter_d, apertures) {
  let omega = Infinity;
  for (const ap of apertures) {
    if (ap.d <= emitter_d + 1e-12) omega = Math.min(omega, apertureSolidAngle(ap.D, ap.d));
  }
  return omega;
}

/**
 * Assemble spectral photon flux onto the pixel [photons s^-1 m^-1] for each emitter and the total.
 * grid_m: Float64Array wavelengths (m). emitters: [{T, omega, emissivity, downstreamT}].
 * emissivity & downstreamT are Float64Array aligned with grid_m. qe is a scalar.
 */
export function assembleFlux({ grid_m, emitters, pixelArea_m2, qe }) {
  const n = grid_m.length;
  const total = new Float64Array(n);
  const perEmitter = emitters.map(() => new Float64Array(n));
  for (let e = 0; e < emitters.length; e++) {
    const { T, omega, emissivity, downstreamT } = emitters[e];
    const out = perEmitter[e];
    const k = pixelArea_m2 * qe * omega;
    for (let i = 0; i < n; i++) {
      const val = k * emissivity[i] * downstreamT[i] * photonRadiance(grid_m[i], T);
      out[i] = val;
      total[i] += val;
    }
  }
  return { total, perEmitter };
}

/** Trapezoidal integral of values (per-x) over an ascending grid. */
export function integrateTrapezoid(grid, values) {
  let sum = 0;
  for (let i = 1; i < grid.length; i++) {
    sum += 0.5 * (values[i] + values[i - 1]) * (grid[i] - grid[i - 1]);
  }
  return sum;
}

/** Convert a per-meter spectrum to per-nanometer (1 m^-1 = 1e-9 nm^-1). */
export function toPerNm(values_per_m) {
  const out = new Float64Array(values_per_m.length);
  for (let i = 0; i < out.length; i++) out[i] = values_per_m[i] / 1e9;
  return out;
}
