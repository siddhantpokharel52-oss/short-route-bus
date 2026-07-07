import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useUiStore } from '@store/uiStore'
import {
  adToBS,
  bsToAD,
  daysInBSMonth,
  getBSYearRange,
  toNepaliDigits,
  BS_MONTHS_NE,
  type BSDate,
} from '@utils/nepaliDate'
import { cn } from '@utils/cn'

interface NepaliDateInputProps {
  label?: string
  error?: string
  required?: boolean
  value?: string
  onChange?: (value: string) => void
  name?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * Nepal uses the Bikram Sambat (BS) calendar day-to-day, not Gregorian (AD).
 * When the app language is Nepali, this renders a true BS calendar (e.g.
 * २०८३ असार) built from the BS<->AD lookup tables in @utils/nepaliDate —
 * not just an AD calendar relabeled with Nepali digits. The underlying value
 * stored/emitted is always a standard AD ISO date (yyyy-mm-dd), so the rest
 * of the form/backend is unaffected; only the picking UI changes with the
 * language toggle. English mode shows the familiar Gregorian calendar.
 */
export function NepaliDateInput({ label, error, required, value = '', onChange, name }: NepaliDateInputProps) {
  const { language } = useUiStore()
  const isBS = language === 'ne'
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const selectedAD = value ? new Date(`${value}T00:00:00`) : null
  const { min: minBSYear, max: maxBSYear } = getBSYearRange()

  const initialBS = selectedAD ? safeAdToBS(selectedAD) : null
  const [viewYearBS, setViewYearBS] = useState(initialBS?.year ?? adToBS(new Date()).year)
  const [viewMonthBS, setViewMonthBS] = useState(initialBS?.month ?? adToBS(new Date()).month)
  const [viewYearAD, setViewYearAD] = useState(selectedAD?.getFullYear() ?? new Date().getFullYear())
  const [viewMonthAD, setViewMonthAD] = useState(selectedAD?.getMonth() ?? new Date().getMonth())

  function safeAdToBS(date: Date): BSDate | null {
    try {
      return adToBS(date)
    } catch {
      return null
    }
  }

  useEffect(() => {
    if (!selectedAD) return
    setViewYearAD(selectedAD.getFullYear())
    setViewMonthAD(selectedAD.getMonth())
    const bs = safeAdToBS(selectedAD)
    if (bs) {
      setViewYearBS(bs.year)
      setViewMonthBS(bs.month)
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const digit = (n: number) => (isBS ? toNepaliDigits(n) : String(n))

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(isBS ? 'ne-NP' : 'en-US', { weekday: 'short' }).format(new Date(2023, 0, i + 1))
  )

  const formattedValue = (() => {
    if (!selectedAD) return ''
    if (isBS) {
      const bs = safeAdToBS(selectedAD)
      if (!bs) return ''
      return `${toNepaliDigits(bs.year)} ${BS_MONTHS_NE[bs.month - 1]} ${toNepaliDigits(bs.day)}`
    }
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(selectedAD)
  })()

  const selectDay = (day: number) => {
    if (isBS) {
      const ad = bsToAD({ year: viewYearBS, month: viewMonthBS, day })
      onChange?.(toIso(ad))
    } else {
      onChange?.(`${viewYearAD}-${pad(viewMonthAD + 1)}-${pad(day)}`)
    }
    setOpen(false)
  }

  const goPrevMonth = () => {
    if (isBS) {
      if (viewMonthBS === 1) {
        if (viewYearBS <= minBSYear) return
        setViewMonthBS(12)
        setViewYearBS((y) => y - 1)
      } else {
        setViewMonthBS((m) => m - 1)
      }
    } else if (viewMonthAD === 0) {
      setViewMonthAD(11)
      setViewYearAD((y) => y - 1)
    } else {
      setViewMonthAD((m) => m - 1)
    }
  }

  const goNextMonth = () => {
    if (isBS) {
      if (viewMonthBS === 12) {
        if (viewYearBS >= maxBSYear) return
        setViewMonthBS(1)
        setViewYearBS((y) => y + 1)
      } else {
        setViewMonthBS((m) => m + 1)
      }
    } else if (viewMonthAD === 11) {
      setViewMonthAD(0)
      setViewYearAD((y) => y + 1)
    } else {
      setViewMonthAD((m) => m + 1)
    }
  }

  const monthLabel = isBS
    ? `${BS_MONTHS_NE[viewMonthBS - 1]} ${toNepaliDigits(viewYearBS)}`
    : new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(viewYearAD, viewMonthAD, 1))

  const daysInMonth = isBS ? daysInBSMonth(viewYearBS, viewMonthBS) : new Date(viewYearAD, viewMonthAD + 1, 0).getDate()

  const firstDayOfWeek = isBS
    ? bsToAD({ year: viewYearBS, month: viewMonthBS, day: 1 }).getDay()
    : new Date(viewYearAD, viewMonthAD, 1).getDay()

  const isSelectedDay = (day: number) => {
    if (!selectedAD) return false
    if (isBS) {
      const bs = safeAdToBS(selectedAD)
      return !!bs && bs.year === viewYearBS && bs.month === viewMonthBS && bs.day === day
    }
    return (
      selectedAD.getFullYear() === viewYearAD && selectedAD.getMonth() === viewMonthAD && selectedAD.getDate() === day
    )
  }

  const inputId = name || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="w-full" ref={containerRef}>
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          id={inputId}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-left text-sm',
            'dark:bg-gray-800 dark:text-gray-100',
            error ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
          )}
        >
          <span className={formattedValue ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}>
            {formattedValue || (isBS ? 'मिति छान्नुहोस्' : 'Select date')}
          </span>
          <CalendarDays className="h-4 w-4 text-gray-400" />
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={goPrevMonth}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{monthLabel}</span>
              <button
                type="button"
                onClick={goNextMonth}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-gray-400">
              {weekdays.map((w, i) => (
                <div key={`${w}-${i}`}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={cn(
                    'rounded-lg py-1.5 text-sm hover:bg-primary-50 dark:hover:bg-primary-900/30',
                    isSelectedDay(day)
                      ? 'bg-primary-600 text-white hover:bg-primary-600'
                      : 'text-gray-700 dark:text-gray-200'
                  )}
                >
                  {digit(day)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
