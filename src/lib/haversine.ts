/**
 * Phase 4 (sesi AB) — haversine distance calculation untuk validasi GPS
 * radius mobile absensi (`/absenkaryawan`).
 *
 * Returns great-circle distance dalam meter antara dua titik (lat,lng).
 * Earth radius pakai WGS-84 mean (6371008.8 m). Akurat sampai cm-level
 * untuk jarak < 100km. Plenty cukup untuk radius 50m kedai.
 */
const EARTH_RADIUS_METERS = 6371008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(EARTH_RADIUS_METERS * c);
}
