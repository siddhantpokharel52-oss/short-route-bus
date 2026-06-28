import { useState, useMemo, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Shield, Plus, Search, ChevronDown, ChevronRight,
  CheckSquare, Square, Copy, Trash2, ToggleLeft, ToggleRight,
  Edit3, Save, X, History, Users, Lock, AlertTriangle,
  CheckCircle2, XCircle,
} from 'lucide-react'
import { Button } from '@components/shared/Button'
import { Input } from '@components/shared/Input'
import toast from 'react-hot-toast'
import { useDateFormatter } from '@hooks/useDateFormatter'
import rbacService, { type Role, type ModulePermissions, type AuditLog } from '@services/rbacService'

// ── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  role_created: 'Role Created',
  role_updated: 'Role Updated',
  role_deleted: 'Role Deleted',
  role_activated: 'Role Activated',
  role_deactivated: 'Role Deactivated',
  permissions_updated: 'Permissions Updated',
  user_role_assigned: 'User Assigned',
  user_role_removed: 'User Removed',
  role_cloned: 'Role Cloned',
}

const ACTION_COLORS: Record<string, string> = {
  role_created: 'bg-green-100 text-green-700',
  role_updated: 'bg-blue-100 text-blue-700',
  role_deleted: 'bg-red-100 text-red-700',
  role_activated: 'bg-green-100 text-green-700',
  role_deactivated: 'bg-gray-100 text-gray-600',
  permissions_updated: 'bg-purple-100 text-purple-700',
  user_role_assigned: 'bg-indigo-100 text-indigo-700',
  user_role_removed: 'bg-orange-100 text-orange-700',
  role_cloned: 'bg-teal-100 text-teal-700',
}

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#06b6d4', '#64748b', '#1e293b',
]


// ── Role form modal ───────────────────────────────────────────────────────────

interface RoleFormValues { name: string; description: string; color: string }

interface RoleModalProps {
  mode: 'create' | 'edit'
  initial?: Partial<Role>
  onClose: () => void
  onSaved: (role: Role) => void
}

function RoleModal({ mode, initial, onClose, onSaved }: RoleModalProps) {
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<RoleFormValues>({
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      color: initial?.color ?? '#6366f1',
    },
  })
  const color = watch('color')

  const mutation = useMutation({
    mutationFn: (d: RoleFormValues) =>
      mode === 'create'
        ? rbacService.createRole(d)
        : rbacService.updateRole(initial!.id!, d),
    onSuccess: (role) => {
      toast.success(mode === 'create' ? 'Role created!' : 'Role updated!')
      onSaved(role)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to save role'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-5">
          <h3 className="text-lg font-semibold text-gray-900">
            {mode === 'create' ? 'Create New Role' : 'Edit Role'}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4 p-5">
          <Input
            label="Role Name"
            required
            placeholder="e.g. Finance Officer"
            error={errors.name?.message}
            {...register('name', { required: 'Role name is required' })}
          />

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <textarea
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              rows={3}
              placeholder="Describe this role's responsibilities…"
              {...register('description')}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Badge Color</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setValue('color', c)}
                  className="h-7 w-7 rounded-full ring-offset-2 transition-all"
                  style={{
                    backgroundColor: c,
                    outline: color === c ? `3px solid ${c}` : 'none',
                    outlineOffset: '2px',
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <div className="h-8 w-8 rounded-lg flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-sm font-medium text-gray-700">Preview badge color</span>
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={mutation.isPending} leftIcon={<Save className="h-4 w-4" />}>
              {mode === 'create' ? 'Create Role' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Clone modal ───────────────────────────────────────────────────────────────

function CloneModal({ source, onClose, onCloned }: { source: Role; onClose: () => void; onCloned: (r: Role) => void }) {
  const [name, setName] = useState(`Copy of ${source.name}`)
  const mutation = useMutation({
    mutationFn: () => rbacService.cloneRole(source.id, name),
    onSuccess: (r) => { toast.success('Role cloned!'); onCloned(r) },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Clone failed'),
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-5">
          <h3 className="font-semibold text-gray-900">Clone Role</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-500">Cloning <strong>{source.name}</strong> copies all its permissions.</p>
          <Input label="New Role Name" value={name} onChange={e => setName(e.target.value)} />
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button loading={mutation.isPending} onClick={() => mutation.mutate()} leftIcon={<Copy className="h-4 w-4" />}>Clone</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Delete confirmation ───────────────────────────────────────────────────────

function DeleteModal({ role, onClose, onDeleted }: { role: Role; onClose: () => void; onDeleted: () => void }) {
  const mutation = useMutation({
    mutationFn: () => rbacService.deleteRole(role.id),
    onSuccess: () => { toast.success('Role deleted'); onDeleted() },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Delete failed'),
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <AlertTriangle className="h-6 w-6 text-red-600" />
        </div>
        <h3 className="mb-1 text-lg font-semibold text-gray-900">Delete Role?</h3>
        <p className="text-sm text-gray-500 mb-5">
          <strong>{role.name}</strong> will be permanently deleted. Users assigned this role will lose it.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="bg-red-600 text-white hover:bg-red-700"
            leftIcon={<Trash2 className="h-4 w-4" />}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Permission Matrix ─────────────────────────────────────────────────────────

interface PermissionMatrixProps {
  role: Role
  modules: ModulePermissions[]
  onSaved: (updated: Role) => void
}

function PermissionMatrix({ role, modules, onSaved }: PermissionMatrixProps) {
  const { t } = useTranslation('tenant')
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions))
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set(modules.map(m => m.module_key)))
  const [dirty, setDirty] = useState(false)

  const filtered = useMemo(() => {
    if (!search.trim()) return modules
    const q = search.toLowerCase()
    return modules
      .map(m => ({
        ...m,
        permissions: m.permissions.filter(
          p => p.name.toLowerCase().includes(q) || p.codename.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
        ),
      }))
      .filter(m => m.permissions.length > 0)
  }, [modules, search])

  const toggle = useCallback((codename: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(codename) ? next.delete(codename) : next.add(codename)
      return next
    })
    setDirty(true)
  }, [])

  const toggleModule = useCallback((_moduleKey: string, all: string[]) => {
    setSelected(prev => {
      const next = new Set(prev)
      const anyGranted = all.some(c => next.has(c))
      all.forEach(c => anyGranted ? next.delete(c) : next.add(c))
      return next
    })
    setDirty(true)
  }, [])

  const selectAll = () => {
    setSelected(new Set(modules.flatMap(m => m.permissions.map(p => p.codename))))
    setDirty(true)
  }
  const deselectAll = () => { setSelected(new Set()); setDirty(true) }

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const saveMutation = useMutation({
    mutationFn: () => rbacService.updatePermissions(role.id, Array.from(selected)),
    onSuccess: (updated) => {
      toast.success('Permissions saved!')
      setDirty(false)
      onSaved(updated)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to save permissions'),
  })

  const totalSelected = selected.size
  const totalAll = modules.reduce((sum, m) => sum + m.permissions.length, 0)

  return (
    <div className="flex flex-col h-full">
      {/* Matrix header */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Permission Matrix</h3>
          <p className="text-xs text-gray-500 mt-0.5">{totalSelected} of {totalAll} permissions granted</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={selectAll}
            className="text-xs font-medium text-primary-600 hover:underline flex items-center gap-1"
          >
            <CheckSquare className="h-3.5 w-3.5" /> {t('roles.selectAll')}
          </button>
          <span className="text-gray-300">|</span>
          <button
            onClick={deselectAll}
            className="text-xs font-medium text-gray-500 hover:underline flex items-center gap-1"
          >
            <Square className="h-3.5 w-3.5" /> {t('roles.deselectAll')}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-1.5 rounded-full bg-gray-100">
        <div
          className="h-1.5 rounded-full bg-primary-500 transition-all duration-300"
          style={{ width: `${totalAll ? (totalSelected / totalAll) * 100 : 0}%` }}
        />
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search permissions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Module groups */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {filtered.map(mod => {
          const codenames = mod.permissions.map(p => p.codename)
          const grantedCount = codenames.filter(c => selected.has(c)).length
          const allGranted = grantedCount === codenames.length
          const someGranted = grantedCount > 0 && !allGranted
          const isOpen = expanded.has(mod.module_key)

          return (
            <div key={mod.module_key} className="rounded-xl border border-gray-200 overflow-hidden">
              {/* Module header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 cursor-pointer select-none"
                onClick={() => toggleExpand(mod.module_key)}>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); toggleModule(mod.module_key, codenames) }}
                  className="flex-shrink-0 text-gray-400 hover:text-primary-600 transition-colors"
                >
                  {allGranted
                    ? <CheckSquare className="h-4.5 w-4.5 text-primary-600" />
                    : someGranted
                      ? <div className="h-4 w-4 rounded border-2 border-primary-500 bg-primary-100 flex items-center justify-center">
                          <div className="h-1.5 w-2 bg-primary-500 rounded-sm" />
                        </div>
                      : <Square className="h-4.5 w-4.5" />
                  }
                </button>
                <span className="flex-1 text-sm font-semibold text-gray-800">{mod.module_name}</span>
                <span className="text-xs text-gray-400 font-medium">{grantedCount}/{codenames.length}</span>
                {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
              </div>

              {/* Permission rows */}
              {isOpen && (
                <div className="divide-y divide-gray-100">
                  {mod.permissions.map(perm => {
                    const granted = selected.has(perm.codename)
                    return (
                      <label
                        key={perm.codename}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={granted}
                          onChange={() => toggle(perm.codename)}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-gray-700">{perm.name}</span>
                          {perm.description && (
                            <span className="block text-xs text-gray-400 truncate">{perm.description}</span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-gray-300 flex-shrink-0 hidden sm:block">
                          {perm.codename}
                        </span>
                        {granted
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                          : <XCircle className="h-3.5 w-3.5 text-gray-200 flex-shrink-0" />
                        }
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Search className="h-8 w-8 mb-2" />
            <p className="text-sm">No permissions match "{search}"</p>
          </div>
        )}
      </div>

      {/* Save bar */}
      <div className={`mt-4 flex items-center justify-between rounded-xl border px-4 py-3 transition-all ${dirty ? 'border-primary-200 bg-primary-50' : 'border-gray-100 bg-gray-50'}`}>
        <span className="text-sm text-gray-600">
          {dirty ? (
            <span className="text-primary-700 font-medium">Unsaved changes</span>
          ) : (
            'Permissions are up to date'
          )}
        </span>
        <Button
          onClick={() => saveMutation.mutate()}
          loading={saveMutation.isPending}
          disabled={!dirty}
          leftIcon={<Save className="h-4 w-4" />}
          size="sm"
        >
          {t('roles.applyChanges')}
        </Button>
      </div>
    </div>
  )
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

function AuditLogTable() {
  const fmtDate = useDateFormatter()
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['rbac-audit'],
    queryFn: () => rbacService.getAuditLog(),
  })

  if (isLoading) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-primary-500" />
    </div>
  )

  if (!logs.length) return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <History className="h-12 w-12 mb-3" />
      <p className="text-sm font-medium">No audit logs yet</p>
      <p className="text-xs">Changes to roles and permissions will appear here</p>
    </div>
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3 text-left">Action</th>
            <th className="px-4 py-3 text-left">Role</th>
            <th className="px-4 py-3 text-left">By</th>
            <th className="px-4 py-3 text-left hidden md:table-cell">Details</th>
            <th className="px-4 py-3 text-left hidden lg:table-cell">IP</th>
            <th className="px-4 py-3 text-left">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {logs.map((log: AuditLog) => (
            <tr key={log.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-600'}`}>
                  {ACTION_LABELS[log.action] ?? log.action}
                </span>
              </td>
              <td className="px-4 py-3 font-medium text-gray-800">{log.role_name}</td>
              <td className="px-4 py-3 text-gray-600">{log.actor_name || '—'}</td>
              <td className="px-4 py-3 text-gray-400 max-w-xs truncate hidden md:table-cell">
                {Object.keys(log.details).length > 0
                  ? Object.entries(log.details)
                      .filter(([k]) => !['added', 'removed'].includes(k))
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')
                  : '—'
                }
                {Array.isArray(log.details.added) && (log.details.added as unknown[]).length > 0 && (
                  <span className="text-green-600"> +{(log.details.added as unknown[]).length} perms</span>
                )}
                {Array.isArray(log.details.removed) && (log.details.removed as unknown[]).length > 0 && (
                  <span className="text-red-500"> -{(log.details.removed as unknown[]).length} perms</span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-400 font-mono text-xs hidden lg:table-cell">{log.ip_address ?? '—'}</td>
              <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{fmtDate(log.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Role Card ─────────────────────────────────────────────────────────────────

interface RoleCardProps {
  role: Role
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onClone: () => void
  onDelete: () => void
  onToggleActive: () => void
}

function RoleCard({ role, isSelected, onSelect, onEdit, onClone, onDelete, onToggleActive }: RoleCardProps) {
  return (
    <div
      onClick={onSelect}
      className={`group relative rounded-xl border cursor-pointer transition-all duration-150 p-4 ${
        isSelected
          ? 'border-primary-400 bg-primary-50 ring-2 ring-primary-200'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Color dot */}
        <div
          className="mt-0.5 h-9 w-9 rounded-xl flex-shrink-0 flex items-center justify-center text-white text-sm font-bold"
          style={{ backgroundColor: role.color || '#6366f1' }}
        >
          {role.name.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 truncate">{role.name}</span>
            {role.is_system && (
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">System</span>
            )}
            {!role.is_active && (
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">Inactive</span>
            )}
          </div>
          {role.description && (
            <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">{role.description}</p>
          )}
          <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Lock className="h-3 w-3" />
              {role.permissions.length} permissions
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {role.user_count} users
            </span>
          </div>
        </div>
      </div>

      {/* Action buttons — appear on hover */}
      <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => { e.stopPropagation(); onEdit() }}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          title="Edit"
        >
          <Edit3 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onClone() }}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          title="Clone"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onToggleActive() }}
          className={`rounded-lg p-1.5 hover:bg-gray-100 transition-colors ${role.is_active ? 'text-green-500 hover:text-green-700' : 'text-gray-400 hover:text-gray-600'}`}
          title={role.is_active ? 'Deactivate' : 'Activate'}
        >
          {role.is_active ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
        </button>
        {!role.is_system && (
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type ActiveTab = 'roles' | 'audit'

export default function RolesPermissionsPage() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()

  const [activeTab, setActiveTab] = useState<ActiveTab>('roles')
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [roleSearch, setRoleSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [cloningRole, setCloningRole] = useState<Role | null>(null)
  const [deletingRole, setDeletingRole] = useState<Role | null>(null)

  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => rbacService.getRoles(),
  })

  const { data: modules = [], isLoading: modulesLoading } = useQuery({
    queryKey: ['rbac-permissions'],
    queryFn: () => rbacService.getPermissions(),
  })

  const selectedRole = roles.find(r => r.id === selectedRoleId) ?? null

  const filteredRoles = useMemo(() => {
    if (!roleSearch.trim()) return roles
    const q = roleSearch.toLowerCase()
    return roles.filter(r =>
      r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
    )
  }, [roles, roleSearch])

  const toggleActiveMutation = useMutation({
    mutationFn: (role: Role) =>
      role.is_active ? rbacService.deactivateRole(role.id) : rbacService.activateRole(role.id),
    onSuccess: (_, role) => {
      toast.success(role.is_active ? 'Role deactivated' : 'Role activated')
      qc.invalidateQueries({ queryKey: ['rbac-roles'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to toggle role'),
  })

  const handleRoleSaved = (role: Role) => {
    qc.invalidateQueries({ queryKey: ['rbac-roles'] })
    setShowCreateModal(false)
    setEditingRole(null)
    setSelectedRoleId(role.id)
  }

  const handleCloned = (role: Role) => {
    qc.invalidateQueries({ queryKey: ['rbac-roles'] })
    setCloningRole(null)
    setSelectedRoleId(role.id)
  }

  const handleDeleted = () => {
    qc.invalidateQueries({ queryKey: ['rbac-roles'] })
    setDeletingRole(null)
    if (deletingRole?.id === selectedRoleId) setSelectedRoleId(null)
  }

  const handlePermissionsSaved = (updated: Role) => {
    qc.setQueryData(['rbac-roles'], (old: Role[] | undefined) =>
      old ? old.map(r => r.id === updated.id ? updated : r) : old
    )
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary-600" />
            {t('roles.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('roles.subtitle')}
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)} leftIcon={<Plus className="h-4 w-4" />}>
          {t('roles.addRole')}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(['roles', 'audit'] as ActiveTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'roles' ? <><Shield className="h-4 w-4" /> {t('roles.roleManagement')}</> : <><History className="h-4 w-4" /> {t('roles.auditLog')}</>}
          </button>
        ))}
      </div>

      {/* ── Roles Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'roles' && (
        <div className="flex gap-6 min-h-[600px]">
          {/* Left: role list */}
          <div className="w-80 flex-shrink-0 flex flex-col gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search roles…"
                value={roleSearch}
                onChange={e => setRoleSearch(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            {/* Stats bar */}
            <div className="flex gap-3 text-xs text-gray-500">
              <span>{roles.length} total</span>
              <span className="text-green-600">{roles.filter(r => r.is_active).length} active</span>
              <span className="text-gray-400">{roles.filter(r => !r.is_active).length} inactive</span>
            </div>

            {/* Role cards */}
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[620px] pr-0.5">
              {rolesLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />
                ))
              ) : filteredRoles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <Shield className="h-10 w-10 mb-2" />
                  <p className="text-sm">{roleSearch ? 'No roles found' : 'No roles yet'}</p>
                  {!roleSearch && (
                    <button onClick={() => setShowCreateModal(true)} className="mt-2 text-sm text-primary-600 hover:underline">
                      Create your first role
                    </button>
                  )}
                </div>
              ) : (
                filteredRoles.map(role => (
                  <RoleCard
                    key={role.id}
                    role={role}
                    isSelected={selectedRoleId === role.id}
                    onSelect={() => setSelectedRoleId(role.id)}
                    onEdit={() => setEditingRole(role)}
                    onClone={() => setCloningRole(role)}
                    onDelete={() => setDeletingRole(role)}
                    onToggleActive={() => toggleActiveMutation.mutate(role)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right: permission matrix */}
          <div className="flex-1 rounded-2xl border border-gray-200 bg-white shadow-sm p-5 flex flex-col">
            {selectedRole ? (
              <>
                {/* Role header */}
                <div className="mb-5 flex items-center gap-3 pb-4 border-b border-gray-100">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0"
                    style={{ backgroundColor: selectedRole.color || '#6366f1' }}
                  >
                    {selectedRole.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-gray-900 text-lg">{selectedRole.name}</h2>
                      {selectedRole.is_system && (
                        <Lock className="h-4 w-4 text-gray-400" />
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${selectedRole.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {selectedRole.is_active ? t('common.active') : t('roles.inactive')}
                      </span>
                    </div>
                    {selectedRole.description && (
                      <p className="text-sm text-gray-500">{selectedRole.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingRole(selectedRole)}
                      className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
                    >
                      <Edit3 className="h-3.5 w-3.5" /> {t('common.edit')}
                    </button>
                    <button
                      onClick={() => setCloningRole(selectedRole)}
                      className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
                    >
                      <Copy className="h-3.5 w-3.5" /> {t('roles.clone')}
                    </button>
                    {!selectedRole.is_system && (
                      <button
                        onClick={() => setDeletingRole(selectedRole)}
                        className="rounded-xl border border-red-200 px-3 py-1.5 text-sm font-medium text-red-500 hover:bg-red-50 flex items-center gap-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}
                      </button>
                    )}
                  </div>
                </div>

                {modulesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-primary-500" />
                  </div>
                ) : (
                  <PermissionMatrix
                    key={selectedRole.id}
                    role={selectedRole}
                    modules={modules}
                    onSaved={handlePermissionsSaved}
                  />
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12">
                <div className="h-16 w-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                  <Shield className="h-8 w-8" />
                </div>
                <p className="text-base font-medium text-gray-600">Select a role to manage permissions</p>
                <p className="text-sm mt-1">Choose a role from the list on the left to view and edit its permissions.</p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="mt-4 flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                >
                  <Plus className="h-4 w-4" /> Create New Role
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Audit Log Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="card">
          <div className="mb-4 flex items-center gap-3">
            <History className="h-5 w-5 text-primary-600" />
            <div>
              <h2 className="font-semibold text-gray-900">{t('roles.auditLog')}</h2>
              <p className="text-xs text-gray-500">Last 200 role and permission changes</p>
            </div>
          </div>
          <AuditLogTable />
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {showCreateModal && (
        <RoleModal mode="create" onClose={() => setShowCreateModal(false)} onSaved={handleRoleSaved} />
      )}
      {editingRole && (
        <RoleModal mode="edit" initial={editingRole} onClose={() => setEditingRole(null)} onSaved={handleRoleSaved} />
      )}
      {cloningRole && (
        <CloneModal source={cloningRole} onClose={() => setCloningRole(null)} onCloned={handleCloned} />
      )}
      {deletingRole && (
        <DeleteModal role={deletingRole} onClose={() => setDeletingRole(null)} onDeleted={handleDeleted} />
      )}
    </div>
  )
}
