import { ReactNode } from 'react'
import { cn } from '@utils/cn'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: ReactNode
  trend?: number // percentage change, positive = up, negative = down
  className?: string
  colorClass?: string
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  className,
  colorClass = 'text-primary-600',
}: StatCardProps) {
  const trendPositive = trend !== undefined && trend > 0
  const trendNeutral = trend === 0

  return (
    <div
      className={cn(
        'rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100',
        'dark:bg-gray-800 dark:ring-gray-700',
        'transition-shadow hover:shadow-md',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
          <p className={cn('mt-2 text-3xl font-bold', colorClass)}>{value}</p>
          {subtitle && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/20">
            {icon}
          </div>
        )}
      </div>
      {trend !== undefined && (
        <div className="mt-4 flex items-center gap-1 text-sm">
          {trendNeutral ? (
            <Minus className="h-4 w-4 text-gray-400" />
          ) : trendPositive ? (
            <TrendingUp className="h-4 w-4 text-green-500" />
          ) : (
            <TrendingDown className="h-4 w-4 text-red-500" />
          )}
          <span
            className={cn(
              'font-medium',
              trendNeutral
                ? 'text-gray-400'
                : trendPositive
                ? 'text-green-600'
                : 'text-red-600'
            )}
          >
            {trend > 0 ? '+' : ''}{trend}%
          </span>
          <span className="text-gray-400">vs last period</span>
        </div>
      )}
    </div>
  )
}
