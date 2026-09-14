import { reverseGeocode } from '@services/baatoService'

// Module-level (not per-render) so a place name looked up once stays cached
// for the rest of the session across every page/component that resolves
// coordinates to a name (route waypoints, suggested stops, ...).
const placeNameCache = new globalThis.Map<string, string | null>()

// Cache-first reverse-geocode lookup, only hitting the network on a cache miss.
export async function getCachedPlaceName(lat: number, lon: number): Promise<string | null> {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`
  const cached = placeNameCache.get(key)
  if (cached !== undefined) return cached
  const result = await reverseGeocode(lat, lon)
  placeNameCache.set(key, result?.name ?? null)
  return result?.name ?? null
}
