import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Table, Column, Pagination } from '@components/shared/Table'
import { Badge } from '@components/shared/Badge'
import { DateDisplay } from '@components/shared/DateDisplay'
import { usePagination } from '@hooks/usePagination'
import apiClient from '@services/api'
import { formatNPR } from '@utils/nepaliDate'
import { useUiStore } from '@store/uiStore'

interface Employee {
  id: string
  employee_name: string
  employee_id: string
  department: string
  basic_salary: number
  allowances: number
  deductions: number
  net_salary: number
}

interface LeaveRequest {
  id: string
  employee_name: string
  leave_type: string
  from_date: string
  to_date: string
  status: string
  reason: string
}

export default function HRPage() {
  const { t } = useTranslation('tenant')
  const { language } = useUiStore()
  const [activeTab, setActiveTab] = useState<'payroll' | 'leaves' | 'attendance'>('payroll')
  const [totalCount, setTotalCount] = useState(0)
  const pagination = usePagination(totalCount)

  const { data: payroll, isLoading: payrollLoading } = useQuery({
    queryKey: ['payroll', pagination.page],
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/payroll/', { params: pagination.queryParams })
      setTotalCount(data.meta?.total_count ?? 0)
      return data.data?.results ?? []
    },
    enabled: activeTab === 'payroll',
  })

  const { data: leaves, isLoading: leavesLoading } = useQuery({
    queryKey: ['leaves', pagination.page],
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/leaves/', { params: pagination.queryParams })
      setTotalCount(data.meta?.total_count ?? 0)
      return data.data?.results ?? []
    },
    enabled: activeTab === 'leaves',
  })

  const payrollColumns: Column<Employee>[] = [
    { key: 'employee_name', header: 'Employee' },
    { key: 'employee_id', header: 'ID',
      render: (e) => <code className="text-xs">{e.employee_id}</code> },
    { key: 'department', header: 'Department' },
    { key: 'basic_salary', header: t('hr.basicSalary'),
      render: (e) => formatNPR(e.basic_salary, language as 'en' | 'ne') },
    { key: 'allowances', header: t('hr.allowances'),
      render: (e) => formatNPR(e.allowances, language as 'en' | 'ne') },
    { key: 'deductions', header: t('hr.deductions'),
      render: (e) => <span className="text-red-600">{formatNPR(e.deductions, language as 'en' | 'ne')}</span> },
    { key: 'net_salary', header: t('hr.netSalary'),
      render: (e) => <span className="font-bold text-green-600">{formatNPR(e.net_salary, language as 'en' | 'ne')}</span> },
  ]

  const leaveColumns: Column<LeaveRequest>[] = [
    { key: 'employee_name', header: 'Employee' },
    { key: 'leave_type', header: 'Type',
      render: (l) => <Badge variant="neutral">{l.leave_type}</Badge> },
    { key: 'from_date', header: 'From',
      render: (l) => <DateDisplay date={l.from_date} /> },
    { key: 'to_date', header: 'To',
      render: (l) => <DateDisplay date={l.to_date} /> },
    { key: 'status', header: 'Status',
      render: (l) => <Badge variant={l.status === 'APPROVED' ? 'success' : l.status === 'REJECTED' ? 'danger' : 'warning'} dot>{l.status}</Badge> },
    { key: 'reason', header: 'Reason' },
  ]

  const tabs = [
    { key: 'payroll', label: t('hr.payroll') },
    { key: 'leaves', label: t('hr.leaves') },
    { key: 'attendance', label: t('hr.attendance') },
  ]

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">{t('hr.title')}</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key as typeof activeTab); pagination.reset() }}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'payroll' && (
        <div className="card p-0">
          <Table columns={payrollColumns} data={payroll ?? []} keyExtractor={(e) => e.id} loading={payrollLoading} />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} totalCount={totalCount} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
        </div>
      )}

      {activeTab === 'leaves' && (
        <div className="card p-0">
          <Table columns={leaveColumns} data={leaves ?? []} keyExtractor={(l) => l.id} loading={leavesLoading} />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} totalCount={totalCount} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
        </div>
      )}

      {activeTab === 'attendance' && (
        <div className="card">
          <p className="text-sm text-gray-400">Attendance view coming soon</p>
        </div>
      )}
    </div>
  )
}
