/**
 * PlaceSearchInput — search-as-you-type place lookup backed by Baato.
 *
 * Debounced Search call shows a dropdown of matches; picking one resolves
 * its coordinates via a second Places call (Search alone doesn't return
 * lat/lon) and reports the resolved place back via onSelect.
 */
import { useEffect, useRef, useState } from 'react'
import { Input } from './Input'
import { searchPlaces, getPlaceDetails, BaatoSearchResult, BaatoPlace } from '@services/baatoService'

interface PlaceSearchInputProps {
  label?: string
  placeholder?: string
  biasLat?: number
  biasLon?: number
  onSelect: (place: BaatoPlace) => void
}

export function PlaceSearchInput({ label, placeholder, biasLat, biasLon, onSelect }: PlaceSearchInputProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BaatoSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 3) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await searchPlaces(query, biasLat, biasLon)
        setResults(r)
        setOpen(true)
      } finally {
        setLoading(false)
      }
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const handleSelect = async (result: BaatoSearchResult) => {
    setQuery(result.name)
    setOpen(false)
    const place = await getPlaceDetails(result.placeId)
    if (place) onSelect(place)
  }

  return (
    <div className="relative">
      <Input
        label={label}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        hint={loading ? 'Searching…' : undefined}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          {results.map((r) => (
            <button
              key={r.placeId}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(r)}
              className="block w-full border-b border-gray-50 px-3 py-2 text-left text-sm last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
            >
              <p className="font-medium text-gray-800 dark:text-gray-100">{r.name}</p>
              <p className="text-xs text-gray-400">{r.address}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
