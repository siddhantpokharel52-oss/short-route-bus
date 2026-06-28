import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Search, AlertCircle } from 'lucide-react'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'

interface InventoryItem {
  id: string
  item_name: string
  category: string
  current_stock: number
  min_stock: number
  reorder_level: number
  unit: string
  unit_cost: number
  is_low_stock: boolean
}

export default function InventoryPage() {
  const { t } = useTranslation('tenant')
  const { language } = useUiStore()
  const [search, setSearch] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', pagination.page, search],
    queryFn: async () => {
      const { data } = await apiClient.get('/inventory/items/', {
        params: { ...pagination.queryParams, ...(search && { search }) },
      })
      setTotalCount(data.meta?.total_count ?? 0)
      return data.data?.results ?? []
    },
  })

  const columns: Column<InventoryItem>[] = [
    {
      key: 'item_name',
      header: t('inventory.itemName'),
      render: (item) => (
        <div className="flex items-center gap-2">
          {item.is_low_stock && <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />}
          <span className="font-medium">{item.item_name}</span>
        </div>
      ),
    },
    { key: 'category', header: t('inventory.category'),
      render: (i) => <Badge variant="neutral">{i.category}</Badge> },
    {
      key: 'current_stock',
      header: t('inventory.currentStock'),
      render: (i) => (
        <span className={i.current_stock <= i.reorder_level ? 'text-red-600 font-bold' : 'text-green-600'}>
          {i.current_stock} {i.unit}
        </span>
      ),
    },
    { key: 'reorder_level', header: t('inventory.reorderLevel'),
      render: (i) => `${i.reorder_level} ${i.unit}` },
    { key: 'unit_cost', header: t('inventory.unitCost'),
      render: (i) => formatNPR(i.unit_cost, language as 'en' | 'ne') },
    {
      key: 'is_low_stock',
      header: 'Stock Status',
      render: (i) => i.is_low_stock
        ? <Badge variant="danger">Low Stock</Badge>
        : <Badge variant="success">OK</Badge>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">{t('inventory.title')}</h1>
      </div>

      {/* Low stock alert banner */}
      {data?.some((i: InventoryItem) => i.is_low_stock) && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">
            {data.filter((i: InventoryItem) => i.is_low_stock).length} items are below reorder level. Please restock soon.
          </p>
        </div>
      )}

      <Input
        placeholder="Search items..."
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="card p-0">
        <Table columns={columns} data={data ?? []} keyExtractor={(i) => i.id} loading={isLoading} />
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
        />
      </div>
    </div>
  )
}
