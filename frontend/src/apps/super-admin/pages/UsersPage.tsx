import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Search, UserCheck, UserX, Shield } from 'lucide-react'
import { Input } from '@components/shared/Input'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge, statusVariant } from '@components/shared/Badge'
import { DateDisplay } from '@components/shared/DateDisplay'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'

interface User {
  id: string
  email: string
  full_name_en: string
  role: string
  tenant_schema: string | null
  is_active: boolean
  date_joined: string
  last_login: string | null
}

export default function UsersPage() {
  const { t } = useTranslation(['common', 'platform'])
  const [search, setSearch] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data, isLoading } = useQuery({
    queryKey: ['users', pagination.page, search],
    queryFn: async () => {
      const { data } = await apiClient.get('/users/', {
        params: { ...pagination.queryParams, ...(search && { search }) },
      })
      setTotalCount(data.meta?.total_count ?? 0)
      return data.data?.results ?? []
    },
  })

  const columns: Column<User>[] = [
    {
      key: 'full_name_en',
      header: t('platform:users.name'),
      render: (u) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-bold">
            {u.full_name_en.charAt(0)}
          </div>
          <div>
            <p className="font-medium">{u.full_name_en}</p>
            <p className="text-xs text-gray-400">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('platform:users.role'),
      render: (u) => (
        <div className="flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-sm">{u.role.replace(/_/g, ' ')}</span>
        </div>
      ),
    },
    {
      key: 'tenant_schema',
      header: t('platform:users.operator'),
      render: (u) => u.tenant_schema ? (
        <code className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">{u.tenant_schema}</code>
      ) : (
        <Badge variant="info">{t('platform:users.platform')}</Badge>
      ),
    },
    {
      key: 'is_active',
      header: t('platform:users.status'),
      render: (u) => (
        <div className="flex items-center gap-1">
          {u.is_active ? (
            <><UserCheck className="h-4 w-4 text-green-500" /><Badge variant="success">{t('common:common.active')}</Badge></>
          ) : (
            <><UserX className="h-4 w-4 text-red-500" /><Badge variant="danger">{t('common:common.inactive')}</Badge></>
          )}
        </div>
      ),
    },
    {
      key: 'date_joined',
      header: t('platform:users.joined'),
      render: (u) => <DateDisplay date={u.date_joined} />,
    },
    {
      key: 'last_login',
      header: t('platform:users.lastLogin'),
      render: (u) => u.last_login ? <DateDisplay date={u.last_login} /> : <span className="text-gray-300">{t('platform:users.never')}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('platform:users.title')}</h1>
          <p className="page-subtitle">{t('platform:users.subtitle')}</p>
        </div>
      </div>

      <Input
        placeholder={t('platform:users.searchPlaceholder')}
        leftAddon={<Search className="h-4 w-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="card p-0">
        <Table columns={columns} data={data ?? []} keyExtractor={(u) => u.id} loading={isLoading} />
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
