import { useUiStore } from '@store/uiStore'
import { formatDate } from '@utils/nepaliDate'

/** Returns a date formatter that respects the current calendar type (AD/BS) and language. */
export function useDateFormatter() {
  const { calendarType, language } = useUiStore()
  return (date: string | Date | null | undefined): string => {
    if (!date) return '—'
    try {
      return formatDate(date, calendarType, language as 'en' | 'ne')
    } catch {
      const d = typeof date === 'string' ? new Date(date) : date
      return d.toLocaleDateString()
    }
  }
}
