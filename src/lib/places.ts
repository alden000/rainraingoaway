/**
 * A tiny offline gazetteer so we can label a location ("near Bishan")
 * without ever sending the user's position to a third-party geocoder.
 */
import { distanceKm, type LatLon } from './geo';

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
  ['Nongsa, Batam', 1.19, 104.1], ['Gelang Patah', 1.45, 103.59]
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
  if (bestD > 4.5) return { name: p.lat < 1.24 ? 'Singapore Strait' : 'Open water', distanceKm: bestD };
  return { name: best[0], distanceKm: bestD };
}
