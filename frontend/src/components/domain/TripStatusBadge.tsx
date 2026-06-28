import { Badge, statusVariant } from '@components/shared/Badge'
import { useTranslation } from 'react-i18next'

type TripStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DELAYED'

interface TripStatusBadgeProps {
  status: TripStatus
}

export function TripStatusBadge({ status }: TripStatusBadgeProps) {
  const { t } = useTranslation('tenant')

  const labels: Record<TripStatus, string> = {
    SCHEDULED: t('scheduling.tripStatus.SCHEDULED'),
    IN_PROGRESS: t('scheduling.tripStatus.IN_PROGRESS'),
    COMPLETED: t('scheduling.tripStatus.COMPLETED'),
    CANCELLED: t('scheduling.tripStatus.CANCELLED'),
    DELAYED: t('scheduling.tripStatus.DELAYED'),
  }

  return (
    <Badge variant={statusVariant(status)} dot>
      {labels[status]}
    </Badge>
  )
}
