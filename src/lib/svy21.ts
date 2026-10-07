/**
 * SVY21 — Singapore's national projected coordinate system (EPSG:3414).
 * Transverse Mercator on WGS84; the analysis grid is aligned to it so a
 * cell id such as "N38 745 · E28 000" is stable and nationally meaningful.
 */

const a = 6378137;
const f = 1 / 298.257223563;
const oLat = 1.366666;
const oLon = 103.833333;
const oN = 38744.572;
const oE = 28001.642;
const k = 1;

const b = a * (1 - f);
const e2 = 2 * f - f * f;
const e4 = e2 * e2;
const e6 = e4 * e2;
const A0 = 1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256;
const A2 = (3 / 8) * (e2 + e4 / 4 + (15 * e6) / 128);
const A4 = (15 / 256) * (e4 + (3 * e6) / 4);
const A6 = (35 * e6) / 3072;
const RAD = Math.PI / 180;

const calcM = (lat: number) => {
  const r = lat * RAD;
  return a * (A0 * r - A2 * Math.sin(2 * r) + A4 * Math.sin(4 * r) - A6 * Math.sin(6 * r));
};
const calcRho = (sin2: number) => (a * (1 - e2)) / Math.pow(1 - e2 * sin2, 1.5);
const calcV = (sin2: number) => a / Math.sqrt(1 - e2 * sin2);
const Mo = calcM(oLat);

export interface SVY21 {
  N: number;
  E: number;
}

export function toSVY21(lat: number, lon: number): SVY21 {
  const latR = lat * RAD;
  const sinLat = Math.sin(latR);
  const sin2Lat = sinLat * sinLat;
  const cosLat = Math.cos(latR);
  const cos2 = cosLat * cosLat;
  const cos3 = cos2 * cosLat;
  const cos4 = cos3 * cosLat;
  const cos5 = cos4 * cosLat;
  const cos6 = cos5 * cosLat;
  const cos7 = cos6 * cosLat;
  const rho = calcRho(sin2Lat);
  const v = calcV(sin2Lat);
  const psi = v / rho;
  const t = Math.tan(latR);
  const w = (lon - oLon) * RAD;
  const M = calcM(lat);

  const w2 = w * w, w4 = w2 * w2, w6 = w4 * w2, w8 = w6 * w2;
  const psi2 = psi * psi, psi3 = psi2 * psi, psi4 = psi3 * psi;
  const t2 = t * t, t4 = t2 * t2, t6 = t4 * t2;

  const n1 = (w2 / 2) * v * sinLat * cosLat;
  const n2 = (w4 / 24) * v * sinLat * cos3 * (4 * psi2 + psi - t2);
  const n3 =
    (w6 / 720) * v * sinLat * cos5 *
    (8 * psi4 * (11 - 24 * t2) - 28 * psi3 * (1 - 6 * t2) + psi2 * (1 - 32 * t2) - psi * 2 * t2 + t4);
  const n4 = (w8 / 40320) * v * sinLat * cos7 * (1385 - 3111 * t2 + 543 * t4 - t6);
  const N = oN + k * (M - Mo + n1 + n2 + n3 + n4);

  const e1 = (w2 / 6) * cos2 * (psi - t2);
  const eT2 = (w4 / 120) * cos4 * (4 * psi3 * (1 - 6 * t2) + psi2 * (1 + 8 * t2) - psi * 2 * t2 + t4);
  const eT3 = (w6 / 5040) * cos6 * (61 - 479 * t2 + 179 * t4 - t6);
  const E = oE + k * v * w * cosLat * (1 + e1 + eT2 + eT3);
  return { N, E };
}

export function fromSVY21(N: number, E: number): { lat: number; lon: number } {
  const Nprime = N - oN;
  const Mprime = Mo + Nprime / k;
  const n = (a - b) / (a + b);
  const n2 = n * n, n3 = n2 * n, n4 = n2 * n2;
  const G = a * (1 - n) * (1 - n2) * (1 + (9 * n2) / 4 + (225 * n4) / 64) * RAD;
  const sigma = (Mprime * Math.PI) / (180 * G);
  const latPrime =
    sigma +
    ((3 * n) / 2 - (27 * n3) / 32) * Math.sin(2 * sigma) +
    ((21 * n2) / 16 - (55 * n4) / 32) * Math.sin(4 * sigma) +
    ((151 * n3) / 96) * Math.sin(6 * sigma) +
    ((1097 * n4) / 512) * Math.sin(8 * sigma);

  const sinLP = Math.sin(latPrime);
  const sin2LP = sinLP * sinLP;
  const rhoP = calcRho(sin2LP);
  const vP = calcV(sin2LP);
  const psi = vP / rhoP;
  const psi2 = psi * psi, psi3 = psi2 * psi, psi4 = psi3 * psi;
  const secLP = 1 / Math.cos(latPrime);
  const t = Math.tan(latPrime);
  const t2 = t * t, t4 = t2 * t2, t6 = t4 * t2;
  const Ep = E - oE;
  const x = Ep / (k * vP);
  const x2 = x * x, x3 = x2 * x, x5 = x3 * x2, x7 = x5 * x2;

  const latFactor = t / (k * rhoP);
  const lt1 = latFactor * ((Ep * x) / 2);
  const lt2 = latFactor * ((Ep * x3) / 24) * (-4 * psi2 + 9 * psi * (1 - t2) + 12 * t2);
  const lt3 =
    latFactor * ((Ep * x5) / 720) *
    (8 * psi4 * (11 - 24 * t2) - 12 * psi3 * (21 - 71 * t2) + 15 * psi2 * (15 - 98 * t2 + 15 * t4) +
      180 * psi * (5 * t2 - 3 * t4) + 360 * t4);
  const lt4 = latFactor * ((Ep * x7) / 40320) * (1385 + 3633 * t2 + 4095 * t4 + 1575 * t6);
  const latR = latPrime - lt1 + lt2 - lt3 + lt4;

  const ln1 = x * secLP;
  const ln2 = ((x3 * secLP) / 6) * (psi + 2 * t2);
  const ln3 = ((x5 * secLP) / 120) * (-4 * psi3 * (1 - 6 * t2) + psi2 * (9 - 68 * t2) + 72 * psi * t2 + 24 * t4);
  const ln4 = ((x7 * secLP) / 5040) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);
  const lonR = oLon * RAD + ln1 - ln2 + ln3 - ln4;
  return { lat: latR / RAD, lon: lonR / RAD };
}

export interface GridCell {
  /** South-west corner in SVY21 metres. */
  N0: number;
  E0: number;
  size: number;
  /** Corner ring (lon/lat) for rendering, counter-clockwise from SW. */
  ring: Array<[number, number]>;
  center: { lat: number; lon: number };
  id: string;
}

export function cellAt(lat: number, lon: number, size: number): GridCell {
  const { N, E } = toSVY21(lat, lon);
  return cellFromSVY21(Math.floor(N / size) * size, Math.floor(E / size) * size, size);
}

export function cellFromSVY21(N0: number, E0: number, size: number): GridCell {
  const sw = fromSVY21(N0, E0);
  const se = fromSVY21(N0, E0 + size);
  const ne = fromSVY21(N0 + size, E0 + size);
  const nw = fromSVY21(N0 + size, E0);
  const center = fromSVY21(N0 + size / 2, E0 + size / 2);
  return {
    N0,
    E0,
    size,
    ring: [[sw.lon, sw.lat], [se.lon, se.lat], [ne.lon, ne.lat], [nw.lon, nw.lat], [sw.lon, sw.lat]],
    center,
    id: formatCellId(N0, E0)
  };
}

export function formatCellId(N0: number, E0: number): string {
  const fmt = (v: number) => {
    const s = Math.abs(Math.round(v)).toString().padStart(5, '0');
    return `${v < 0 ? '−' : ''}${s.slice(0, -3)} ${s.slice(-3)}`;
  };
  return `N${fmt(N0)} · E${fmt(E0)}`;
}
