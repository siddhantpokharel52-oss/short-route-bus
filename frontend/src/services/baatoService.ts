/**
 * Baato (Nepal map provider) Search + Places + Directions.
 *
 * Called directly from the browser with the same public VITE_BAATO_API_KEY
 * already exposed for the map style URL -- no new exposure, same key.
 *
 * Search alone does NOT return coordinates (confirmed against the real API,
 * not just the docs) -- it only returns a placeId. Resolving a place to
 * lat/lon always needs a second call to the Places API.
 */
import { BAATO_KEY } from '@/config/baato'

const BASE = 'https://api.baato.io/api/v1'

export interface BaatoSearchResult {
  placeId: number
  name: string
  address: string
  type: string
}

export interface BaatoPlace {
  placeId: number
  name: string
  lat: number
  lon: number
}

export interface BaatoDirectionsResult {
  points: [number, number][] // [lat, lng], decoded, ready for the existing waypoints format
  distanceKm: number
}

export async function searchPlaces(
  query: string,
  biasLat?: number,
  biasLon?: number
): Promise<BaatoSearchResult[]> {
  const q = query.trim()
  if (!q) return []
  const params = new URLSearchParams({ q, key: BAATO_KEY, limit: '6' })
  if (biasLat != null && biasLon != null) {
    params.set('lat', String(biasLat))
    params.set('lon', String(biasLon))
  }
  const res = await fetch(`${BASE}/search?${params.toString()}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.data ?? []).map((d: { placeId: number; name: string; address: string; type: string }) => ({
    placeId: d.placeId, name: d.name, address: d.address, type: d.type,
  }))
}

export async function getPlaceDetails(placeId: number): Promise<BaatoPlace | null> {
  const params = new URLSearchParams({ placeId: String(placeId), key: BAATO_KEY })
  const res = await fetch(`${BASE}/places?${params.toString()}`)
  if (!res.ok) return null
  const data = await res.json()
  const place = data.data?.[0]
  if (!place?.centroid) return null
  return { placeId: place.placeId, name: place.name, lat: place.centroid.lat, lon: place.centroid.lon }
}

// Decodes a Google-style encoded polyline (precision 5) -- the format
// Baato's Directions API returns -- into an ordered [lat, lng][] list.
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let b: number
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    shift = 0
    result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

export async function getDirections(
  start: [number, number],
  end: [number, number]
): Promise<BaatoDirectionsResult | null> {
  const params = new URLSearchParams({ key: BAATO_KEY, mode: 'car' })
  params.append('points[]', `${start[0]},${start[1]}`)
  params.append('points[]', `${end[0]},${end[1]}`)
  const res = await fetch(`${BASE}/directions?${params.toString()}`)
  if (!res.ok) return null
  const data = await res.json()
  const route = data.data?.[0]
  if (!route?.encodedPolyline) return null
  return {
    points: decodePolyline(route.encodedPolyline),
    distanceKm: route.distanceInMeters / 1000,
  }
}
