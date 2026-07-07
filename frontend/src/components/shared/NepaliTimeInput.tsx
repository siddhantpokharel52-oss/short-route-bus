import { useUiStore } from '@store/uiStore'
import { toNepaliDigits } from '@utils/nepaliDate'
import { cn } from '@utils/cn'

interface NepaliTimeInputProps {
  label?: string
  error?: string
  required?: boolean
  value?: string // "HH:MM", 24-hour
  onChange?: (value: string) => void
  name?: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Native <input type="time"> renders its digits/separators via the browser's
 * own locale data, which — like <input type="date"> — doesn't reliably show
 * Nepali. Since native <select> elements render whatever option text we give
 * them (no browser-locale involvement), this uses two plain selects for hour
 * and minute instead, so Nepali digits always show correctly when chosen.
 * Value/onChange are always a plain 24-hour "HH:MM" string, same as before.
 */
export function NepaliTimeInput({ label, error, required, value = '', onChange, name }: NepaliTimeInputProps) {
  const { language } = useUiStore()
  const [hh, mm] = value ? value.split(':') : ['05', '00']
  const hour = parseInt(hh, 10) || 0
  const minute = parseInt(mm, 10) || 0

  const digit = (n: number) => (language === 'ne' ? toNepaliDigits(pad(n)) : pad(n))

  const emit = (h: number, m: number) => onChange?.(`${pad(h)}:${pad(m)}`)

  const inputId = name || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </label>
      )}
      <div
        className={cn(
          'flex items-center gap-1 rounded-xl border bg-white px-2 dark:bg-gray-700',
          error ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
        )}
      >
        <select
          id={inputId}
          value={hour}
          onChange={(e) => emit(Number(e.target.value), minute)}
          className="flex-1 bg-transparent py-2 text-sm focus:outline-none dark:text-white"
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{digit(h)}</option>
          ))}
        </select>
        <span className="text-gray-400">:</span>
        <select
          value={minute}
          onChange={(e) => emit(hour, Number(e.target.value))}
          className="flex-1 bg-transparent py-2 text-sm focus:outline-none dark:text-white"
        >
          {Array.from({ length: 60 }, (_, m) => (
            <option key={m} value={m}>{digit(m)}</option>
          ))}
        </select>
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
