import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, MapPin } from 'lucide-react'
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

interface Stop {
  id: string
  name_en: string
  name_ne: string
  latitude: number
  longitude: number
  district: string
  is_terminal: boolean
  is_active: boolean
  ward_number: number | null
}

export default function StopsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data, isLoading } = useQuery({
    queryKey: ['stops', pagination.page, search],
    queryFn: async () => {
      const { data } = await apiClient.get('/platform/stops/', {
        params: { ...pagination.queryParams, ...(search && { search }) },
      })
      setTotalCount(data.meta?.total_count ?? 0)
      return data.data?.results ?? []
    },
  })

  const { register, handleSubmit, reset } = useForm<Partial<Stop>>()

  const createMutation = useMutation({
    mutationFn: (payload: Partial<Stop>) =>
      apiClient.post('/platform/stops/', payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('Stop added!')
      setShowCreate(false)
      reset()
      qc.invalidateQueries({ queryKey: ['stops'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<Stop>[] = [
    {
      key: 'name_en',
      header: 'Stop Name',
      render: (s) => (
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary-500" />
          <div>
            <p className="font-medium">{s.name_en}</p>
            <p className="text-xs text-gray-400">{s.name_ne}</p>
          </div>
        </div>
      ),
    },
    { key: 'district', header: 'District' },
    { key: 'ward_number', header: 'Ward', render: (s) => s.ward_number ?? '—' },
    {
      key: 'latitude',
      header: 'Coordinates',
      render: (s) => (
        <code className="text-xs">{s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}</code>
      ),
    },
    {
      key: 'is_terminal',
      header: 'Terminal',
      render: (s) => s.is_terminal ? <Badge variant="info">Terminal</Badge> : <span className="text-gray-400">—</span>,
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (s) => <Badge variant={s.is_active ? 'success' : 'neutral'} dot>{s.is_active ? 'Active' : 'Inactive'}</Badge>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bus Stops</h1>
          <p className="page-subtitle">All stops across Kathmandu Valley</p>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
          Add Stop
        </Button>
      </div>

      <Input
        placeholder="Search stops..."
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="card p-0">
        <Table columns={columns} data={data ?? []} keyExtractor={(s) => s.id} loading={isLoading} />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Bus Stop" size="md">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 p-6">
          <Input label="Name (English)" required {...register('name_en', { required: true })} />
          <NepaliInput label="Name (Nepali)" required {...register('name_ne', { required: true })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Latitude" type="number" step="any" required {...register('latitude', { required: true })} />
            <Input label="Longitude" type="number" step="any" required {...register('longitude', { required: true })} />
          </div>
          <Input label="District" {...register('district')} />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_terminal" {...register('is_terminal')} />
            <label htmlFor="is_terminal" className="text-sm">Terminal Stop</label>
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Add Stop</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
