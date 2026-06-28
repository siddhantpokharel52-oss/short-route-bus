import { cn } from '@utils/cn'

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
  dot?: boolean
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  neutral: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
}

const dotClasses: Record<BadgeVariant, string> = {
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-gray-500',
}

export function Badge({
  variant = 'neutral',
  children,
  className,
  dot = false,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className
      )}
    >
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', dotClasses[variant])}
        />
      )}
      {children}
    </span>
  )
}

/** Map KVBMS entity status to badge variant */
export function statusVariant(
  status: string
): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    ACTIVE: 'success',
    COMPLETED: 'success',
    VERIFIED: 'success',
    VALID: 'success',
    IN_PROGRESS: 'info',
    SCHEDULED: 'info',
    PENDING: 'warning',
    UNDER_REVIEW: 'warning',
    DELAYED: 'warning',
    MAINTENANCE: 'warning',
    SUSPENDED: 'danger',
    CANCELLED: 'danger',
    OVERDUE: 'danger',
    INACTIVE: 'neutral',
    RETIRED: 'neutral',
    DEACTIVATED: 'neutral',
    CLOSED: 'neutral',
  }
  return map[status] ?? 'neutral'
}
