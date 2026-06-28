import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, MapPin, Clock, Ruler } from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import { NepaliInput } from '@components/shared/NepaliInput'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { Modal } from '@components/shared/Modal'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

interface Route {
  id: string
  route_number: string
  name_en: string
  name_ne: string
  total_distance_km: number
  estimated_duration_minutes: number
  is_active: boolean
  base_fare: number
  stops_count: number
}

export default function RoutesPage() {
  const { t } = useTranslation('platform')
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data, isLoading } = useQuery({
    queryKey: ['routes', pagination.page, search],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/routes/', {
        params: { ...pagination.queryParams, ...(search && { search }) },
      })
      setTotalCount(data.meta?.total_count ?? 0)
      return data.data?.results ?? []
    },
  })

  const { register, handleSubmit, reset } = useForm<Partial<Route>>()

  const createMutation = useMutation({
    mutationFn: (payload: Partial<Route>) =>
      apiClient.post('/platform/routes/', payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('Route created!')
      setShowCreate(false)
      reset()
      qc.invalidateQueries({ queryKey: ['routes'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<Route>[] = [
    { key: 'route_number', header: t('routes.routeNumber'),
      render: (r) => <span className="font-mono font-bold text-primary-600">{r.route_number}</span> },
    { key: 'name_en', header: 'Route Name',
      render: (r) => (
        <div>
          <p className="font-medium">{r.name_en}</p>
          <p className="text-xs text-gray-400">{r.name_ne}</p>
        </div>
      ) },
    { key: 'stops_count', header: t('routes.stops'),
      render: (r) => (
        <div className="flex items-center gap-1 text-sm">
          <MapPin className="h-3.5 w-3.5 text-gray-400" />
          {r.stops_count} stops
        </div>
      ) },
    { key: 'total_distance_km', header: t('routes.totalDistance'),
      render: (r) => (
        <div className="flex items-center gap-1 text-sm">
          <Ruler className="h-3.5 w-3.5 text-gray-400" />
          {r.total_distance_km} km
        </div>
      ) },
    { key: 'estimated_duration_minutes', header: t('routes.estimatedDuration'),
      render: (r) => (
        <div className="flex items-center gap-1 text-sm">
          <Clock className="h-3.5 w-3.5 text-gray-400" />
          {r.estimated_duration_minutes} min
        </div>
      ) },
    { key: 'base_fare', header: 'Base Fare',
      render: (r) => `Rs. ${r.base_fare}` },
    { key: 'is_active', header: 'Status',
      render: (r) => <Badge variant={r.is_active ? 'success' : 'neutral'} dot>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('routes.title')}</h1>
          <p className="page-subtitle">{t('routes.subtitle', { defaultValue: 'Manage all transit routes across the valley' })}</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          {t('routes.addNew')}
        </Button>
      </div>

      <Input
        placeholder="Search by route number or name..."
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="card p-0">
        <Table columns={columns} data={data ?? []} keyExtractor={(r) => r.id} loading={isLoading} />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t('routes.addNew')} size="lg">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Route Number" required {...register('route_number', { required: true })} />
            <Input label="Base Fare (NPR)" type="number" required {...register('base_fare', { required: true })} />
          </div>
          <Input label="Name (English)" required {...register('name_en', { required: true })} />
          <NepaliInput label="Name (Nepali)" {...register('name_ne')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Total Distance (km)" type="number" step="0.1" {...register('total_distance_km')} />
            <Input label="Est. Duration (min)" type="number" {...register('estimated_duration_minutes')} />
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Create Route</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
