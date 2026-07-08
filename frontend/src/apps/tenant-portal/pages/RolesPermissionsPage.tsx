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

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  role_created:        'bg-green-100 text-green-700',
  role_updated:        'bg-blue-100 text-blue-700',
  role_deleted:        'bg-red-100 text-red-700',
  role_activated:      'bg-green-100 text-green-700',
  role_deactivated:    'bg-gray-100 text-gray-600',
  permissions_updated: 'bg-purple-100 text-purple-700',
  user_role_assigned:  'bg-indigo-100 text-indigo-700',
  user_role_removed:   'bg-orange-100 text-orange-700',
  role_cloned:         'bg-teal-100 text-teal-700',
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
  const { t } = useTranslation('tenant')

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
      toast.success(mode === 'create' ? t('roles.toast.created') : t('roles.toast.updated'))
      onSaved(role)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || t('roles.toast.saveError')),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {mode === 'create' ? t('roles.createNewRole') : t('roles.editRole')}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4 p-5">
          <Input
            label={t('roles.roleName')}
            required
            placeholder={t('roles.roleNamePlaceholder')}
            error={errors.name?.message}
            {...register('name', { required: t('roles.roleNameRequired') })}
          />

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('roles.description')}
            </label>
            <textarea
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              rows={3}
              placeholder={t('roles.descriptionPlaceholder')}
              {...register('description')}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('roles.badgeColor')}
            </label>
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
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('roles.previewBadgeColor')}
            </span>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-200 dark:border-gray-700 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>{t('common:common.cancel')}</Button>
            <Button type="submit" loading={mutation.isPending} leftIcon={<Save className="h-4 w-4" />}>
              {mode === 'create' ? t('roles.createRole') : t('roles.saveChanges')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Clone modal ───────────────────────────────────────────────────────────────

function CloneModal({ source, onClose, onCloned }: { source: Role; onClose: () => void; onCloned: (r: Role) => void }) {
  const { t } = useTranslation('tenant')
  const [name, setName] = useState(`${t('roles.copyOf')} ${source.name}`)

  const mutation = useMutation({
    mutationFn: () => rbacService.cloneRole(source.id, name),
    onSuccess: (r) => { toast.success(t('roles.toast.cloned')); onCloned(r) },
    onError: (e: any) => toast.error(e?.response?.data?.message || t('roles.toast.cloneError')),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white">{t('roles.cloneRole')}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('roles.cloneDesc', { name: source.name })}
          </p>
          <Input label={t('roles.newRoleName')} value={name} onChange={e => setName(e.target.value)} />
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>{t('common:common.cancel')}</Button>
            <Button loading={mutation.isPending} onClick={() => mutation.mutate()} leftIcon={<Copy className="h-4 w-4" />}>
              {t('roles.clone')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Delete confirmation ───────────────────────────────────────────────────────

function DeleteModal({ role, onClose, onDeleted }: { role: Role; onClose: () => void; onDeleted: () => void }) {
  const { t } = useTranslation('tenant')

  const mutation = useMutation({
    mutationFn: () => rbacService.deleteRole(role.id),
    onSuccess: () => { toast.success(t('roles.toast.deleted')); onDeleted() },
    onError: (e: any) => toast.error(e?.response?.data?.message || t('roles.toast.deleteError')),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 shadow-2xl p-6">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <AlertTriangle className="h-6 w-6 text-red-600" />
        </div>
        <h3 className="mb-1 text-lg font-semibold text-gray-900 dark:text-white">{t('roles.deleteRole')}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          {t('roles.deleteDesc', { name: role.name })}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>{t('common:common.cancel')}</Button>
          <Button
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="bg-red-600 text-white hover:bg-red-700"
            leftIcon={<Trash2 className="h-4 w-4" />}
          >
            {t('roles.delete')}
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
        permissions: m.permissions.filter(p => {
          const tName = t(`permissions.names.${p.codename}`, { defaultValue: p.name })
          const tDesc = t(`permissions.descriptions.${p.codename}`, { defaultValue: p.description })
          return tName.toLowerCase().includes(q) || p.codename.toLowerCase().includes(q) || tDesc.toLowerCase().includes(q)
        }),
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

  const selectAll = () => { setSelected(new Set(modules.flatMap(m => m.permissions.map(p => p.codename)))); setDirty(true) }
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
      toast.success(t('roles.toast.permsSaved'))
      setDirty(false)
      onSaved(updated)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || t('roles.toast.permsError')),
  })

  const totalSelected = selected.size
  const totalAll = modules.reduce((sum, m) => sum + m.permissions.length, 0)

  return (
    <div className="flex flex-col h-full">
      {/* Matrix header */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">{t('roles.permissionMatrix')}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {t('roles.permissionsGranted', { selected: totalSelected, total: totalAll })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={selectAll} className="text-xs font-medium text-primary-600 hover:underline flex items-center gap-1">
            <CheckSquare className="h-3.5 w-3.5" /> {t('roles.selectAll')}
          </button>
          <span className="text-gray-300">|</span>
          <button onClick={deselectAll} className="text-xs font-medium text-gray-500 hover:underline flex items-center gap-1">
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
          placeholder={t('roles.searchPermissions')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 dark:text-white pl-9 pr-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
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
            <div key={mod.module_key} className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div
                className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer select-none"
                onClick={() => toggleExpand(mod.module_key)}
              >
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); toggleModule(mod.module_key, codenames) }}
                  className="flex-shrink-0 text-gray-400 hover:text-primary-600 transition-colors"
                >
                  {allGranted
                    ? <CheckSquare className="h-4 w-4 text-primary-600" />
                    : someGranted
                      ? <div className="h-4 w-4 rounded border-2 border-primary-500 bg-primary-100 flex items-center justify-center">
                          <div className="h-1.5 w-2 bg-primary-500 rounded-sm" />
                        </div>
                      : <Square className="h-4 w-4" />
                  }
                </button>
                <span className="flex-1 text-sm font-semibold text-gray-800 dark:text-gray-200">{t(`permissions.modules.${mod.module_key}`, { defaultValue: mod.module_name })}</span>
                <span className="text-xs text-gray-400 font-medium">{grantedCount}/{codenames.length}</span>
                {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
              </div>

              {isOpen && (
                <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                  {mod.permissions.map(perm => {
                    const granted = selected.has(perm.codename)
                    return (
                      <label key={perm.codename} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={granted}
                          onChange={() => toggle(perm.codename)}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t(`permissions.names.${perm.codename}`, { defaultValue: perm.name })}</span>
                          {perm.description && (
                            <span className="block text-xs text-gray-400 truncate">{t(`permissions.descriptions.${perm.codename}`, { defaultValue: perm.description })}</span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-gray-300 flex-shrink-0 hidden sm:block">{perm.codename}</span>
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
            <p className="text-sm">{t('roles.noPermsMatch', { query: search })}</p>
          </div>
        )}
      </div>

      {/* Save bar */}
      <div className={`mt-4 flex items-center justify-between rounded-xl border px-4 py-3 transition-all ${dirty ? 'border-primary-200 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-800' : 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50'}`}>
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {dirty
            ? <span className="text-primary-700 dark:text-primary-300 font-medium">{t('roles.unsavedChanges')}</span>
            : t('roles.upToDate')
          }
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
  const { t } = useTranslation('tenant')
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
      <p className="text-sm font-medium">{t('roles.audit.noLogs')}</p>
      <p className="text-xs">{t('roles.audit.noLogsDesc')}</p>
    </div>
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3 text-left">{t('roles.audit.colAction')}</th>
            <th className="px-4 py-3 text-left">{t('roles.audit.colRole')}</th>
            <th className="px-4 py-3 text-left">{t('roles.audit.colBy')}</th>
            <th className="px-4 py-3 text-left hidden md:table-cell">{t('roles.audit.colDetails')}</th>
            <th className="px-4 py-3 text-left hidden lg:table-cell">{t('roles.audit.colIP')}</th>
            <th className="px-4 py-3 text-left">{t('roles.audit.colWhen')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
          {logs.map((log: AuditLog) => (
            <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-600'}`}>
                  {t(`roles.actions.${log.action}` as any, { defaultValue: log.action })}
                </span>
              </td>
              <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{log.role_name}</td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{log.actor_name || '—'}</td>
              <td className="px-4 py-3 text-gray-400 max-w-xs truncate hidden md:table-cell">
                {Object.keys(log.details).length > 0
                  ? Object.entries(log.details)
                      .filter(([k]) => !['added', 'removed'].includes(k))
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')
                  : '—'
                }
                {Array.isArray(log.details.added) && (log.details.added as unknown[]).length > 0 && (
                  <span className="text-green-600"> {t('roles.permsAdded', { count: (log.details.added as unknown[]).length })}</span>
                )}
                {Array.isArray(log.details.removed) && (log.details.removed as unknown[]).length > 0 && (
                  <span className="text-red-500"> {t('roles.permsRemoved', { count: (log.details.removed as unknown[]).length })}</span>
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
  const { t } = useTranslation('tenant')

  return (
    <div
      onClick={onSelect}
      className={`group relative rounded-xl border cursor-pointer transition-all duration-150 p-4 ${
        isSelected
          ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 ring-2 ring-primary-200 dark:ring-primary-800'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 hover:shadow-sm bg-white dark:bg-gray-800'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 h-9 w-9 rounded-xl flex-shrink-0 flex items-center justify-center text-white text-sm font-bold"
          style={{ backgroundColor: role.color || '#6366f1' }}
        >
          {role.name.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 dark:text-white truncate">{role.name}</span>
            {role.is_system && (
              <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                {t('roles.system')}
              </span>
            )}
            {!role.is_active && (
              <span className="rounded-full bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                {t('roles.inactive')}
              </span>
            )}
          </div>
          {role.description && (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{role.description}</p>
          )}
          <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Lock className="h-3 w-3" />
              {role.permissions.length} {t('roles.permissionsLabel')}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {role.user_count} {t('roles.usersLabel')}
            </span>
          </div>
        </div>
      </div>

      {/* Action buttons on hover */}
      <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => { e.stopPropagation(); onEdit() }}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700"
          title={t('common:common.edit')}
        >
          <Edit3 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onClone() }}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700"
          title={t('roles.clone')}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onToggleActive() }}
          className={`rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${role.is_active ? 'text-green-500 hover:text-green-700' : 'text-gray-400 hover:text-gray-600'}`}
          title={role.is_active ? t('roles.deactivate') : t('roles.activate')}
        >
          {role.is_active ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
        </button>
        {!role.is_system && (
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500"
            title={t('common:common.delete')}
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
    return roles.filter(r => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
  }, [roles, roleSearch])

  const toggleActiveMutation = useMutation({
    mutationFn: (role: Role) =>
      role.is_active ? rbacService.deactivateRole(role.id) : rbacService.activateRole(role.id),
    onSuccess: (_, role) => {
      toast.success(role.is_active ? t('roles.toast.deactivated') : t('roles.toast.activated'))
      qc.invalidateQueries({ queryKey: ['rbac-roles'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || t('roles.toast.toggleError')),
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
          <p className="mt-1 text-sm text-gray-500">{t('roles.subtitle')}</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)} leftIcon={<Plus className="h-4 w-4" />}>
          {t('roles.addRole')}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {(['roles', 'audit'] as ActiveTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {tab === 'roles'
              ? <><Shield className="h-4 w-4" /> {t('roles.roleManagement')}</>
              : <><History className="h-4 w-4" /> {t('roles.auditLog')}</>
            }
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
                placeholder={t('roles.searchRoles')}
                value={roleSearch}
                onChange={e => setRoleSearch(e.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white pl-9 pr-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            {/* Stats bar */}
            <div className="flex gap-3 text-xs text-gray-500">
              <span>{roles.length} {t('roles.total')}</span>
              <span className="text-green-600">{roles.filter(r => r.is_active).length} {t('roles.active')}</span>
              <span className="text-gray-400">{roles.filter(r => !r.is_active).length} {t('roles.inactive')}</span>
            </div>

            {/* Role cards */}
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[620px] pr-0.5">
              {rolesLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-20 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
                ))
              ) : filteredRoles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <Shield className="h-10 w-10 mb-2" />
                  <p className="text-sm">{roleSearch ? t('roles.noRolesFound') : t('roles.noRolesYet')}</p>
                  {!roleSearch && (
                    <button onClick={() => setShowCreateModal(true)} className="mt-2 text-sm text-primary-600 hover:underline">
                      {t('roles.createFirstRole')}
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
          <div className="flex-1 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-5 flex flex-col">
            {selectedRole ? (
              <>
                {/* Role header */}
                <div className="mb-5 flex items-center gap-3 pb-4 border-b border-gray-100 dark:border-gray-700">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0"
                    style={{ backgroundColor: selectedRole.color || '#6366f1' }}
                  >
                    {selectedRole.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-gray-900 dark:text-white text-lg">{selectedRole.name}</h2>
                      {selectedRole.is_system && <Lock className="h-4 w-4 text-gray-400" />}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${selectedRole.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                        {selectedRole.is_active ? t('common:common.active') : t('roles.inactive')}
                      </span>
                    </div>
                    {selectedRole.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">{selectedRole.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingRole(selectedRole)}
                      className="rounded-xl border border-gray-200 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1.5"
                    >
                      <Edit3 className="h-3.5 w-3.5" /> {t('common:common.edit')}
                    </button>
                    <button
                      onClick={() => setCloningRole(selectedRole)}
                      className="rounded-xl border border-gray-200 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1.5"
                    >
                      <Copy className="h-3.5 w-3.5" /> {t('roles.clone')}
                    </button>
                    {!selectedRole.is_system && (
                      <button
                        onClick={() => setDeletingRole(selectedRole)}
                        className="rounded-xl border border-red-200 dark:border-red-900 px-3 py-1.5 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> {t('common:common.delete')}
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
                <div className="h-16 w-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-4">
                  <Shield className="h-8 w-8" />
                </div>
                <p className="text-base font-medium text-gray-600 dark:text-gray-300">{t('roles.selectRolePrompt')}</p>
                <p className="text-sm mt-1 text-center max-w-xs">{t('roles.selectRoleHint')}</p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="mt-4 flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                >
                  <Plus className="h-4 w-4" /> {t('roles.createNewRole')}
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
              <h2 className="font-semibold text-gray-900 dark:text-white">{t('roles.auditLog')}</h2>
              <p className="text-xs text-gray-500">{t('roles.auditLastDesc')}</p>
            </div>
          </div>
          <AuditLogTable />
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}
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
