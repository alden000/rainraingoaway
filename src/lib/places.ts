/**
 * A tiny offline gazetteer so we can label a location ("near Bishan")
 * without ever sending the user's position to a third-party geocoder.
 */
import { bearingDeg, compassPoint, distanceKm, type LatLon } from './geo';

export const PLACES: Array<[string, number, number]> = [
  ['Ang Mo Kio', 1.3691, 103.8454], ['Bedok', 1.3236, 103.9273], ['Bishan', 1.3526, 103.8352],
  ['Boon Lay', 1.3386, 103.7058], ['Bukit Batok', 1.359, 103.7637], ['Bukit Merah', 1.2819, 103.8239],
  ['Bukit Panjang', 1.3774, 103.7719], ['Bukit Timah', 1.3294, 103.8021], ['Changi', 1.3644, 103.9915],
  ['Changi Airport', 1.3554, 103.9864], ['Choa Chu Kang', 1.384, 103.747], ['Clementi', 1.3162, 103.7649],
  ['Downtown Core', 1.2789, 103.8536], ['Marina Bay', 1.2834, 103.8607], ['Geylang', 1.3201, 103.8918],
  ['Hougang', 1.3612, 103.8863], ['Jurong East', 1.3329, 103.7436], ['Jurong West', 1.3404, 103.709],
  ['Kallang', 1.31, 103.8651], ['Lim Chu Kang', 1.4305, 103.7174], ['Mandai', 1.4043, 103.789],
  ['Marine Parade', 1.302, 103.8971], ['Novena', 1.3204, 103.8438], ['Orchard', 1.3048, 103.8318],
  ['Pasir Ris', 1.3721, 103.9474], ['Paya Lebar', 1.3576, 103.9146], ['Pioneer', 1.3153, 103.675],
  ['Punggol', 1.3984, 103.9072], ['Queenstown', 1.2942, 103.7861], ['River Valley', 1.2937, 103.836],
  ['Rochor', 1.3039, 103.8526], ['Seletar', 1.4041, 103.8693], ['Sembawang', 1.4491, 103.8185],
  ['Sengkang', 1.3868, 103.8914], ['Serangoon', 1.3554, 103.8679], ['Simpang', 1.44, 103.85],
  ['Sungei Kadut', 1.4134, 103.7494], ['Tampines', 1.3496, 103.9568], ['Tanglin', 1.3077, 103.8146],
  ['Tengah', 1.374, 103.726], ['Toa Payoh', 1.3343, 103.8563], ['Tuas', 1.2944, 103.636],
  ['Western Catchment', 1.405, 103.689], ['Woodlands', 1.4382, 103.789], ['Yishun', 1.4304, 103.8354],
  ['Outram', 1.2801, 103.839], ['Marina South', 1.2717, 103.8636], ['Sentosa', 1.2494, 103.8303],
  ['Pulau Ubin', 1.4044, 103.96], ['Pulau Tekong', 1.406, 104.045], ['Jurong Island', 1.266, 103.699],
  ['Newton', 1.3138, 103.838], ['Kranji', 1.425, 103.762], ['Holland Village', 1.311, 103.796],
  ['Dover', 1.303, 103.778], ['Katong', 1.305, 103.905], ['East Coast', 1.3008, 103.9122],
  ['Bukit Gombak', 1.3587, 103.7518], ['Thomson', 1.3417, 103.8335], ['Upper Bukit Timah', 1.3566, 103.7686],
  ['Kent Ridge', 1.2937, 103.7846], ['Tiong Bahru', 1.2858, 103.8274], ['HarbourFront', 1.2653, 103.8222],
  ['Southern Islands', 1.2213, 103.8456], ['Lentor', 1.3854, 103.8366], ['Loyang', 1.3726, 103.9733],
  ['Johor Bahru', 1.4655, 103.7578], ['Pasir Gudang', 1.4726, 103.878], ['Iskandar Puteri', 1.426, 103.64],
  ['Pengerang', 1.37, 104.1], ['Batam', 1.13, 104.03], ['Sekupang, Batam', 1.118, 103.952],
  ['Nongsa, Batam', 1.19, 104.1], ['Gelang Patah', 1.45, 103.59],
  // Region covered by the 240 km / 480 km radar images.
  ['Kuala Lumpur', 3.139, 101.687], ['Putrajaya', 2.926, 101.696], ['Shah Alam', 3.073, 101.518],
  ['Klang', 3.044, 101.445], ['Seremban', 2.726, 101.938], ['Port Dickson', 2.522, 101.796],
  ['Melaka', 2.189, 102.25], ['Muar', 2.044, 102.568], ['Batu Pahat', 1.854, 102.933],
  ['Kluang', 2.03, 103.318], ['Segamat', 2.503, 102.815], ['Mersing', 2.431, 103.836],
  ['Kota Tinggi', 1.738, 103.9], ['Desaru', 1.55, 104.25], ['Pontian', 1.487, 103.39],
  ['Kulai', 1.659, 103.6], ['Pulau Tioman', 2.79, 104.17], ['Kuantan', 3.807, 103.326],
  ['Pekan', 3.493, 103.39], ['Temerloh', 3.448, 102.418], ['Bentong', 3.522, 101.909],
  ['Genting Highlands', 3.424, 101.794], ['Raub', 3.79, 101.857], ['Kuala Terengganu', 5.33, 103.14],
  ['Dungun', 4.758, 103.418], ['Kemaman', 4.233, 103.42], ['Kota Bharu', 6.125, 102.238],
  ['Ipoh', 4.597, 101.09], ['Teluk Intan', 4.022, 101.02], ['Tanjung Malim', 3.685, 101.518],
  ['Tanjung Pinang', 0.918, 104.459], ['Bintan', 1.08, 104.5], ['Tanjung Balai Karimun', 1.0, 103.43],
  ['Lingga', -0.2, 104.6], ['Pekanbaru', 0.507, 101.448], ['Dumai', 1.665, 101.447],
  ['Bengkalis', 1.47, 102.1], ['Selat Panjang', 1.01, 102.71], ['Tembilahan', -0.32, 103.16],
  ['Rengat', -0.38, 102.55], ['Jambi', -1.61, 103.61], ['Kuala Tungkal', -0.82, 103.46],
  ['Muara Sabak', -1.13, 103.82], ['Pangkal Pinang', -2.13, 106.11], ['Muntok', -2.06, 105.16],
  ['Anambas Islands', 3.2, 106.25], ['Tambelan Islands', 1.0, 107.55], ['Natuna Islands', 3.9, 108.2],
  ['Belitung', -2.75, 107.65], ['Siak', 0.8, 102.05], ['Bagan Siapiapi', 2.16, 100.81],
  ['Kuala Selangor', 3.34, 101.25], ['Rawang', 3.32, 101.58], ['Mentakab', 3.48, 102.35]
];

export interface PlaceLabel {
  name: string;
  distanceKm: number;
}

export function nearestPlace(p: LatLon): PlaceLabel {
  let best = PLACES[0];
  let bestD = Infinity;
  for (const pl of PLACES) {
    const d = distanceKm(p, { lat: pl[1], lon: pl[2] });
    if (d < bestD) {
      bestD = d;
      best = pl;
    }
  }
  if (bestD <= 4.5) return { name: best[0], distanceKm: bestD };
  // Near Singapore, water is the likely answer; further out, describe relative to a town.
  const inSingapore = p.lat > 1.15 && p.lat < 1.48 && p.lon > 103.6 && p.lon < 104.1;
  if (inSingapore) return { name: p.lat < 1.24 ? 'Singapore Strait' : 'Open water', distanceKm: bestD };
  if (bestD <= 15) return { name: `Near ${best[0]}`, distanceKm: bestD };
  const dir = compassPoint(bearingDeg({ lat: best[1], lon: best[2] }, p));
  return { name: `${Math.round(bestD)} km ${dir} of ${best[0]}`, distanceKm: bestD };
}
