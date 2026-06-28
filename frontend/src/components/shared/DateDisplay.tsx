import { useTranslation } from 'react-i18next'
import { useUiStore } from '@store/uiStore'
import { formatDate } from '@utils/nepaliDate'
import { cn } from '@utils/cn'

interface DateDisplayProps {
  date: string | Date
  className?: string
  showToggle?: boolean
}

export function DateDisplay({ date, className, showToggle = false }: DateDisplayProps) {
  const { calendarType, language, toggleCalendar } = useUiStore()

  const formatted = formatDate(date, calendarType, language as 'en' | 'ne')

  if (!showToggle) {
    return <span className={className}>{formatted}</span>
  }

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span>{formatted}</span>
      <button
        onClick={toggleCalendar}
        className="rounded px-1 py-0.5 text-xs text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20"
        title={calendarType === 'AD' ? 'Switch to BS' : 'Switch to AD'}
      >
        {calendarType === 'AD' ? 'BS' : 'AD'}
      </button>
    </span>
  )
}

/** Calendar type toggle button for navbar */
export function CalendarToggle({ className }: { className?: string }) {
  const { calendarType, toggleCalendar } = useUiStore()
  const { t } = useTranslation('common')

  return (
    <button
      onClick={toggleCalendar}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-gray-200',
        'px-3 py-1.5 text-sm font-medium',
        'bg-white text-gray-700 hover:bg-gray-50',
        'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
        'transition-colors duration-150',
        className
      )}
    >
      {calendarType === 'AD' ? t('calendar.switchToBS') : t('calendar.switchToAD')}
    </button>
  )
}
