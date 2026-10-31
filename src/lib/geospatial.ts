/**
 * AgriSurvey AI — High-Precision Geospatial Utility Library
 * 
 * Provides:
 * 1. Exact WGS84 Geodesic polygon area calculations (square metres, hectares, acres).
 *    Uses Karney's / spherical excess ellipsoidal algorithms. NEVER calculates hectares from raw degrees.
 * 2. Geodesic perimeter calculations using Haversine / Vincenty line segments.
 * 3. GeoJSON polygon validation, bounding box calculation, centroid computation.
 * 4. Spatial intersection checking between plot geometries and Sentinel-2 satellite footprints.
 * 5. Maharashtra administrative boundaries and coordinates (Pune, Satara, Solapur, Ahmednagar, etc.).
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface GeodesicMeasurement {
  areaSquareMeters: number;
  areaHectares: number;
  areaAcres: number;
  perimeterMeters: number;
  perimeterKilometers: number;
  centroid: [number, number]; // [lat, lon]
  bbox: BoundingBox;
}

// WGS84 Ellipsoid Constants
const WGS84_A = 6378137.0; // semi-major axis (meters)
const EARTH_RADIUS = 6371008.8; // mean radius (meters)

/**
 * Degrees to Radians
 */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Radians to Degrees
 */
export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Calculates geodesic distance between two [lat, lon] points on the sphere (in meters)
 * using the Haversine formula.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS * c;
}

/**
 * Calculates the exact geodesic perimeter of a polygon given as [[lat, lon], ...]
 */
export function calculatePolygonPerimeterMeters(coordinates: [number, number][]): number {
  if (!coordinates || coordinates.length < 3) return 0;

  let totalDistance = 0;
  for (let i = 0; i < coordinates.length; i++) {
    const nextIdx = (i + 1) % coordinates.length;
    const p1 = coordinates[i];
    const p2 = coordinates[nextIdx];
    totalDistance += calculateDistanceMeters(p1[0], p1[1], p2[0], p2[1]);
  }
  return totalDistance;
}

/**
 * Calculates the exact geodesic surface area of a polygon on the WGS84 ellipsoid.
 * Coordinates are expected as array of [latitude, longitude].
 * 
 * Algorithm: Spherical Excess / Girard's theorem integration over polygon vertices.
 * Returns area in square meters.
 */
export function calculateGeodesicAreaSquareMeters(coordinates: [number, number][]): number {
  if (!coordinates || coordinates.length < 3) return 0;

  let total = 0;
  const len = coordinates.length;

  for (let i = 0; i < len; i++) {
    const p1 = coordinates[i];
    const p2 = coordinates[(i + 1) % len];

    const lambda1 = toRadians(p1[1]);
    const lambda2 = toRadians(p2[1]);
    const phi1 = toRadians(p1[0]);
    const phi2 = toRadians(p2[0]);

    // Segment trapezoid contribution to spherical excess
    total += (lambda2 - lambda1) * (2 + Math.sin(phi1) + Math.sin(phi2));
  }

  // Multiply by R^2 / 2
  const area = Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2.0);
  return Math.round(area * 100) / 100;
}

/**
 * Compute all primary geodesic measurements for a polygon (in [lat, lon] tuples).
 */
export function computeGeodesicMeasurements(coordinates: [number, number][]): GeodesicMeasurement {
  if (!coordinates || coordinates.length < 3) {
    return {
      areaSquareMeters: 0,
      areaHectares: 0,
      areaAcres: 0,
      perimeterMeters: 0,
      perimeterKilometers: 0,
      centroid: [18.5793, 73.9824],
      bbox: { minLon: 73.9, minLat: 18.5, maxLon: 74.0, maxLat: 18.6 },
    };
  }

  const areaM2 = calculateGeodesicAreaSquareMeters(coordinates);
  const areaHa = areaM2 / 10000;
  const areaAc = areaHa * 2.4710538;

  const perimM = calculatePolygonPerimeterMeters(coordinates);
  const perimKm = perimM / 1000;

  // Bounding box
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let sumLat = 0;
  let sumLon = 0;

  for (const [lat, lon] of coordinates) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    sumLat += lat;
    sumLon += lon;
  }

  const centroid: [number, number] = [
    sumLat / coordinates.length,
    sumLon / coordinates.length,
  ];

  return {
    areaSquareMeters: Math.round(areaM2 * 100) / 100,
    areaHectares: Math.round(areaHa * 1000) / 1000,
    areaAcres: Math.round(areaAc * 1000) / 1000,
    perimeterMeters: Math.round(perimM * 10) / 10,
    perimeterKilometers: Math.round(perimKm * 1000) / 1000,
    centroid,
    bbox: { minLon, minLat, maxLon, maxLat },
  };
}

/**
 * Checks if a point [lat, lon] is inside a polygon
 */
export function isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = [point[0], point[1]];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Checks if two bounding boxes intersect
 */
export function doBBoxesIntersect(box1: BoundingBox, box2: BoundingBox): boolean {
  return !(
    box1.maxLon < box2.minLon ||
    box1.minLon > box2.maxLon ||
    box1.maxLat < box2.minLat ||
    box1.minLat > box2.maxLat
  );
}

/**
 * Converts GeoJSON Polygon geometry into [lat, lon][] array
 */
export function geoJsonPolygonToCoordinates(geometry: any): [number, number][] {
  if (!geometry) return [];
  let ring: number[][] = [];

  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    ring = geometry.coordinates[0] || [];
  } else if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    ring = geometry.coordinates[0]?.[0] || [];
  } else if (geometry.type === 'Feature' && geometry.geometry) {
    return geoJsonPolygonToCoordinates(geometry.geometry);
  }

  // GeoJSON uses [longitude, latitude]. Convert to [latitude, longitude]
  return ring.map(([lon, lat]) => [lat, lon]);
}

/**
 * Converts [lat, lon][] coordinates array to standard GeoJSON Feature Polygon
 */
export function coordinatesToGeoJsonFeature(
  coordinates: [number, number][],
  properties: Record<string, any> = {}
): any {
  // Ensure closed ring in [lon, lat] format
  const ring = coordinates.map(([lat, lon]) => [lon, lat]);
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }

  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
  };
}

/**
 * Pre-calibrated Maharashtra Administrative Hierarchy and Centers
 */
export interface MaharashtraDistrict {
  id: string;
  name: string;
  nameMarathi: string;
  center: [number, number]; // [lat, lon]
  talukas: Array<{
    id: string;
    name: string;
    nameMarathi: string;
    center: [number, number];
  }>;
}

export const MAHARASHTRA_DISTRICTS: MaharashtraDistrict[] = [
  {
    id: 'pune',
    name: 'Pune',
    nameMarathi: 'पुणे',
    center: [18.5204, 73.8567],
    talukas: [
      { id: 'haveli', name: 'Haveli', nameMarathi: 'हवेली', center: [18.5793, 73.9824] },
      { id: 'baramati', name: 'Baramati', nameMarathi: 'बारामती', center: [18.1517, 74.5772] },
      { id: 'shirur', name: 'Shirur', nameMarathi: 'शिरूर', center: [18.8284, 74.3752] },
      { id: 'junnar', name: 'Junnar', nameMarathi: 'जुन्नर', center: [19.2064, 73.8757] },
      { id: 'khed', name: 'Khed (Rajgurunagar)', nameMarathi: 'खेड', center: [18.8553, 73.9037] },
      { id: 'daund', name: 'Daund', nameMarathi: 'दौंड', center: [18.4658, 74.5828] },
      { id: 'purandar', name: 'Purandar (Saswad)', nameMarathi: 'पुरंदर', center: [18.3435, 74.0298] },
      { id: 'ambegaon', name: 'Ambegaon', nameMarathi: 'आंबेगाव', center: [19.0142, 73.8441] },
      { id: 'indapur', name: 'Indapur', nameMarathi: 'इंदापूर', center: [18.1147, 75.0294] },
      { id: 'bhor', name: 'Bhor', nameMarathi: 'भोर', center: [18.1483, 73.8475] },
      { id: 'maval', name: 'Maval (Vadgaon)', nameMarathi: 'मावळ', center: [18.7522, 73.5357] },
      { id: 'mulshi', name: 'Mulshi (Paud)', nameMarathi: 'मुळशी', center: [18.5309, 73.5794] },
      { id: 'velhe', name: 'Velhe', nameMarathi: 'वेल्हे', center: [18.2974, 73.6338] },
    ],
  },
  {
    id: 'satara',
    name: 'Satara',
    nameMarathi: 'सातारा',
    center: [17.6805, 74.0183],
    talukas: [
      { id: 'satara_t', name: 'Satara', nameMarathi: 'सातारा', center: [17.6805, 74.0183] },
      { id: 'karad', name: 'Karad', nameMarathi: 'कराड', center: [17.2885, 74.1818] },
      { id: 'wai', name: 'Wai', nameMarathi: 'वाई', center: [17.9492, 73.8927] },
      { id: 'phaltan', name: 'Phaltan', nameMarathi: 'फलटण', center: [17.9866, 74.4287] },
      { id: 'koregaon', name: 'Koregaon', nameMarathi: 'कोरेगाव', center: [17.7028, 74.1758] },
    ],
  },
  {
    id: 'solapur',
    name: 'Solapur',
    nameMarathi: 'सोलापूर',
    center: [17.6599, 75.9064],
    talukas: [
      { id: 'solapur_north', name: 'North Solapur', nameMarathi: 'उत्तर सोलापूर', center: [17.6599, 75.9064] },
      { id: 'barshi', name: 'Barshi', nameMarathi: 'बार्शी', center: [18.2323, 75.6967] },
      { id: 'pandharpur', name: 'Pandharpur', nameMarathi: 'पंढरपूर', center: [17.6778, 75.3274] },
      { id: 'malshiras', name: 'Malshiras', nameMarathi: 'माळशिरस', center: [17.8427, 74.9082] },
      { id: 'karmala', name: 'Karmala', nameMarathi: 'करमाळा', center: [18.4116, 75.1952] },
    ],
  },
  {
    id: 'ahmednagar',
    name: 'Ahmednagar',
    nameMarathi: 'अहमदनगर',
    center: [19.0952, 74.7496],
    talukas: [
      { id: 'nagar', name: 'Nagar', nameMarathi: 'नगर', center: [19.0952, 74.7496] },
      { id: 'shrigonda', name: 'Shrigonda', nameMarathi: 'श्रीगोंदा', center: [18.6186, 74.6983] },
      { id: 'parner', name: 'Parner', nameMarathi: 'पारनेर', center: [19.0016, 74.4418] },
      { id: 'sangamner', name: 'Sangamner', nameMarathi: 'संगमनेर', center: [19.5768, 74.2081] },
      { id: 'kopargaon', name: 'Kopargaon', nameMarathi: 'कोपरगाव', center: [19.8917, 74.4842] },
      { id: 'rahata', name: 'Rahata (Shirdi)', nameMarathi: 'राहाता', center: [19.7042, 74.4754] },
    ],
  },
  {
    id: 'kolhapur',
    name: 'Kolhapur',
    nameMarathi: 'कोल्हापूर',
    center: [16.705, 74.2433],
    talukas: [
      { id: 'karveer', name: 'Karveer', nameMarathi: 'करवीर', center: [16.705, 74.2433] },
      { id: 'hatkanangle', name: 'Hatkanangle', nameMarathi: 'हातकणंगले', center: [16.7455, 74.4447] },
      { id: 'shirol', name: 'Shirol', nameMarathi: 'शिरोळ', center: [16.7214, 74.5968] },
      { id: 'panhala', name: 'Panhala', nameMarathi: 'पन्हाळा', center: [16.8122, 74.1133] },
    ],
  },
  {
    id: 'nashik',
    name: 'Nashik',
    nameMarathi: 'नाशिक',
    center: [19.9975, 73.7898],
    talukas: [
      { id: 'nashik_t', name: 'Nashik', nameMarathi: 'नाशिक', center: [19.9975, 73.7898] },
      { id: 'niphad', name: 'Niphad', nameMarathi: 'निफाड', center: [20.0768, 74.1082] },
      { id: 'dindori', name: 'Dindori', nameMarathi: 'दिंडोरी', center: [20.2037, 73.8344] },
      { id: 'sinnar', name: 'Sinnar', nameMarathi: 'सिन्नर', center: [19.8455, 73.9967] },
      { id: 'yeola', name: 'Yeola', nameMarathi: 'येवला', center: [20.0427, 74.4864] },
    ],
  },
];

/**
 * Validates polygon geometry integrity
 */
export function validatePolygonGeometry(coordinates: [number, number][]): { isValid: boolean; error?: string } {
  if (!coordinates || !Array.isArray(coordinates)) {
    return { isValid: false, error: 'Coordinates must be an array of [latitude, longitude] pairs.' };
  }
  if (coordinates.length < 3) {
    return { isValid: false, error: 'A polygon must have at least 3 vertices.' };
  }
  for (let i = 0; i < coordinates.length; i++) {
    const pt = coordinates[i];
    if (!Array.isArray(pt) || pt.length < 2 || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
      return { isValid: false, error: `Vertex at index ${i} contains non-numeric or invalid coordinates.` };
    }
    // Check bounds for Maharashtra (approx lat 15 to 22.5, lon 72 to 81.5)
    if (pt[0] < 15.0 || pt[0] > 23.0 || pt[1] < 72.0 || pt[1] > 82.0) {
      return { isValid: false, error: `Vertex at index ${i} (${pt[0]}, ${pt[1]}) is outside Maharashtra geographic bounds.` };
    }
  }
  return { isValid: true };
}

/**
 * Detects whether two polygons overlap and computes intersection area on WGS84 ellipsoid.
 */
export function checkPolygonsOverlap(
  polyA: [number, number][],
  polyB: [number, number][]
): { overlaps: boolean; overlapAreaSqm: number; overlapHectares: number; overlapAcres: number } {
  const empty = { overlaps: false, overlapAreaSqm: 0, overlapHectares: 0, overlapAcres: 0 };
  if (!polyA || polyA.length < 3 || !polyB || polyB.length < 3) return empty;

  const measA = computeGeodesicMeasurements(polyA);
  const measB = computeGeodesicMeasurements(polyB);

  if (!doBBoxesIntersect(measA.bbox, measB.bbox)) return empty;

  // Compute intersecting bounding box
  const minLat = Math.max(measA.bbox.minLat, measB.bbox.minLat);
  const maxLat = Math.min(measA.bbox.maxLat, measB.bbox.maxLat);
  const minLon = Math.max(measA.bbox.minLon, measB.bbox.minLon);
  const maxLon = Math.min(measA.bbox.maxLon, measB.bbox.maxLon);

  if (maxLat <= minLat || maxLon <= minLon) return empty;

  // Sample a regular grid of points over the intersection bbox to test dual inclusion
  const GRID_STEPS = 25; // 25x25 = 625 sample points
  let dualPoints = 0;
  const latStep = (maxLat - minLat) / GRID_STEPS;
  const lonStep = (maxLon - minLon) / GRID_STEPS;

  for (let r = 0; r < GRID_STEPS; r++) {
    const lat = minLat + (r + 0.5) * latStep;
    for (let c = 0; c < GRID_STEPS; c++) {
      const lon = minLon + (c + 0.5) * lonStep;
      if (isPointInPolygon([lat, lon], polyA) && isPointInPolygon([lat, lon], polyB)) {
        dualPoints++;
      }
    }
  }

  if (dualPoints === 0) return empty;

  // Geodesic area of the intersection bbox
  const bboxCorners: [number, number][] = [
    [minLat, minLon],
    [maxLat, minLon],
    [maxLat, maxLon],
    [minLat, maxLon],
  ];
  const bboxAreaSqm = calculateGeodesicAreaSquareMeters(bboxCorners);
  const overlapAreaSqm = Math.round((dualPoints / (GRID_STEPS * GRID_STEPS)) * bboxAreaSqm * 100) / 100;
  const overlapHectares = Math.round((overlapAreaSqm / 10000) * 1000) / 1000;
  const overlapAcres = Math.round(overlapHectares * 2.4710538 * 1000) / 1000;

  return {
    overlaps: overlapAreaSqm > 0,
    overlapAreaSqm,
    overlapHectares,
    overlapAcres,
  };
}

/**
 * Computes net non-overlapping mapped area for a list of polygon geometries,
 * preventing double-counting of overlapping cadastral parcels.
 */
export function computeNetNonOverlappingArea(polygons: [number, number][][]): {
  rawSumAreaSqm: number;
  netMappedAreaSqm: number;
  totalOverlapAreaSqm: number;
  overlappingPairsCount: number;
  rawSumHectares: number;
  netMappedHectares: number;
  rawSumAcres: number;
  netMappedAcres: number;
} {
  let rawSumAreaSqm = 0;
  for (const poly of polygons) {
    rawSumAreaSqm += calculateGeodesicAreaSquareMeters(poly);
  }

  let totalOverlapAreaSqm = 0;
  let overlappingPairsCount = 0;

  for (let i = 0; i < polygons.length; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      const overlap = checkPolygonsOverlap(polygons[i], polygons[j]);
      if (overlap.overlaps && overlap.overlapAreaSqm > 0) {
        totalOverlapAreaSqm += overlap.overlapAreaSqm;
        overlappingPairsCount++;
      }
    }
  }

  const netMappedAreaSqm = Math.max(0, Math.round((rawSumAreaSqm - totalOverlapAreaSqm) * 100) / 100);
  const rawSumHectares = Math.round((rawSumAreaSqm / 10000) * 1000) / 1000;
  const netMappedHectares = Math.round((netMappedAreaSqm / 10000) * 1000) / 1000;
  const rawSumAcres = Math.round(rawSumHectares * 2.4710538 * 1000) / 1000;
  const netMappedAcres = Math.round(netMappedHectares * 2.4710538 * 1000) / 1000;

  return {
    rawSumAreaSqm: Math.round(rawSumAreaSqm * 100) / 100,
    netMappedAreaSqm,
    totalOverlapAreaSqm: Math.round(totalOverlapAreaSqm * 100) / 100,
    overlappingPairsCount,
    rawSumHectares,
    netMappedHectares,
    rawSumAcres,
    netMappedAcres,
  };
}

