import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, ChevronDown, Plus, Pencil, Trash2, Search, X,
  FolderOpen, Folder, FileText, GripVertical, Move, Save,
  CornerDownRight, ChevronsDown, ChevronsUp, ChevronRight as Breadcrumb,
  Info,
} from 'lucide-react'
import apiClient from '@services/api'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'
type AccountNature = 'DEBIT' | 'CREDIT'

interface COAAccount {
  id: string
  code: string
  name: string
  account_type: AccountType
  account_nature: AccountNature
  parent: string | null
  parent_name: string | null
  description: string
  is_system: boolean
  is_active: boolean
  is_group: boolean
  is_posting_allowed: boolean
  level_no: number
  balance: string
  children_count: number
  children?: COAAccount[]
}

interface FormState {
  code: string
  name: string
  account_type: AccountType
  parent: string
  description: string
  is_group: boolean
  is_posting_allowed: boolean
  is_active: boolean
}

const BLANK_FORM: FormState = {
  code: '', name: '', account_type: 'ASSET',
  parent: '', description: '',
  is_group: false, is_posting_allowed: true, is_active: true,
}

// ─── Visual-only constants (no text) ─────────────────────────────────────────

const TYPE_META: Record<AccountType, { dot: string; badge: string; nature: AccountNature }> = {
  ASSET:     { dot: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800',    nature: 'DEBIT'  },
  LIABILITY: { dot: 'bg-red-500',     badge: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800',       nature: 'CREDIT' },
  EQUITY:    { dot: 'bg-purple-500',  badge: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:ring-purple-800', nature: 'CREDIT' },
  INCOME:    { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800', nature: 'CREDIT' },
  EXPENSE:   { dot: 'bg-orange-500',  badge: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800', nature: 'DEBIT'  },
}

const TYPE_KEYS = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const

const fmt = (n: string | number) =>
  `NPR ${parseFloat(String(n)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectVisibleIds(accounts: COAAccount[], search: string, typeFilter: string): Set<string> {
  const result = new Set<string>()
  function walk(acct: COAAccount): boolean {
    const q = search.toLowerCase()
    const matchesSearch = !q || acct.code.toLowerCase().includes(q) || acct.name.toLowerCase().includes(q)
    const matchesType = !typeFilter || acct.account_type === typeFilter
    let childrenVisible = false
    for (const child of acct.children ?? []) {
      if (walk(child)) childrenVisible = true
    }
    if ((matchesSearch && matchesType) || childrenVisible) { result.add(acct.id); return true }
    return false
  }
  for (const acct of accounts) walk(acct)
  return result
}

function collectAutoExpand(accounts: COAAccount[], search: string, typeFilter: string): Set<string> {
  if (!search && !typeFilter) return new Set()
  const expanded = new Set<string>()
  function walk(acct: COAAccount, ancestors: string[]): boolean {
    const q = search.toLowerCase()
    const matchesSearch = !q || acct.code.toLowerCase().includes(q) || acct.name.toLowerCase().includes(q)
    const matchesType = !typeFilter || acct.account_type === typeFilter
    let childMatch = false
    for (const child of acct.children ?? []) {
      if (walk(child, [...ancestors, acct.id])) childMatch = true
    }
    if ((matchesSearch && matchesType) || childMatch) {
      for (const id of ancestors) expanded.add(id)
      return true
    }
    return false
  }
  for (const acct of accounts) walk(acct, [])
  return expanded
}

function flattenTree(accounts: COAAccount[]): COAAccount[] {
  const result: COAAccount[] = []
  function walk(acct: COAAccount) { result.push(acct); for (const child of acct.children ?? []) walk(child) }
  for (const acct of accounts) walk(acct)
  return result
}

function buildBreadcrumb(tree: COAAccount[], targetId: string): COAAccount[] {
  function find(accounts: COAAccount[], path: COAAccount[]): COAAccount[] | null {
    for (const acct of accounts) {
      const newPath = [...path, acct]
      if (acct.id === targetId) return newPath
      const found = find(acct.children ?? [], newPath)
      if (found) return found
    }
    return null
  }
  return find(tree, []) ?? []
}

// ─── Move Dialog ──────────────────────────────────────────────────────────────

function MoveDialog({ account, flat, onClose, onMove }: {
  account: COAAccount; flat: COAAccount[]
  onClose: () => void; onMove: (parentId: string | null) => void
}) {
  const { t } = useTranslation('tenant')
  const [parentId, setParentId] = useState<string>(account.parent ?? '')

  const eligible = flat.filter(a => {
    if (a.id === account.id) return false
    let node: COAAccount | undefined = a
    const flatMap = Object.fromEntries(flat.map(x => [x.id, x]))
    while (node) {
      if (node.id === account.id) return false
      node = node.parent ? flatMap[node.parent] : undefined
    }
    return true
  })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Move className="h-4 w-4 text-primary-600" />
            <span className="font-semibold text-gray-900 dark:text-white text-sm">{t('accounting.coa.moveDialog.title')}</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('accounting.coa.moveDialog.movingLabel')} <strong className="text-gray-900 dark:text-white">{account.code} — {account.name}</strong>
          </p>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              {t('accounting.coa.moveDialog.newParent')}
            </label>
            <select
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
              value={parentId}
              onChange={e => setParentId(e.target.value)}
            >
              <option value="">{t('accounting.coa.moveDialog.rootParent')}</option>
              {eligible.map(a => (
                <option key={a.id} value={a.id}>
                  {'  '.repeat(a.level_no - 1)}{a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="btn-secondary text-sm">{t('common:common.cancel')}</button>
          <button
            onClick={() => onMove(parentId || null)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2 transition-colors"
          >
            <Move className="h-3.5 w-3.5" />{t('accounting.coa.moveDialog.moveHere')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

function ContextMenu({ x, y, account, onAddChild, onEdit, onDelete, onMove, onClose }: {
  x: number; y: number; account: COAAccount
  onAddChild: () => void; onEdit: () => void
  onDelete: () => void; onMove: () => void; onClose: () => void
}) {
  const { t } = useTranslation('tenant')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const items = [
    { icon: CornerDownRight, labelKey: 'accounting.coa.contextMenu.addChild', action: onAddChild, color: 'text-primary-600 dark:text-primary-400', disabled: false },
    { icon: Pencil,          labelKey: 'accounting.coa.contextMenu.edit',     action: onEdit,     color: 'text-gray-700 dark:text-gray-300', disabled: false },
    { icon: Move,            labelKey: 'accounting.coa.contextMenu.move',     action: onMove,     color: 'text-gray-700 dark:text-gray-300', disabled: false },
    { icon: Trash2,          labelKey: 'accounting.coa.contextMenu.delete',   action: onDelete,   color: account.is_system ? 'text-gray-300 cursor-not-allowed' : 'text-red-600 dark:text-red-400', disabled: account.is_system },
  ]

  return (
    <div
      ref={ref}
      style={{ top: y, left: x }}
      className="fixed z-[70] w-52 rounded-xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden py-1"
    >
      <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-700">
        <p className="text-xs font-mono font-bold text-gray-400">{account.code}</p>
        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{account.name}</p>
      </div>
      {items.map(item => (
        <button
          key={item.labelKey}
          disabled={item.disabled}
          onClick={() => { if (!item.disabled) { item.action(); onClose() } }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors ${item.color}`}
        >
          <item.icon className="h-3.5 w-3.5 flex-shrink-0" />
          {t(item.labelKey)}
        </button>
      ))}
    </div>
  )
}

// ─── Tree Node ────────────────────────────────────────────────────────────────

function TreeNode({
  account, depth, expanded, selected, visibleIds,
  draggedId, dropTargetId, typeLabels,
  onToggle, onSelect, onContextMenu,
  onDragStart, onDragOver, onDragLeave, onDrop,
}: {
  account: COAAccount; depth: number
  expanded: Set<string>; selected: string | null; visibleIds: Set<string>
  draggedId: string | null; dropTargetId: string | null
  typeLabels: Record<AccountType, string>
  onToggle: (id: string) => void; onSelect: (id: string) => void
  onContextMenu: (e: React.MouseEvent, account: COAAccount) => void
  onDragStart: (e: React.DragEvent, id: string) => void
  onDragOver: (e: React.DragEvent, id: string) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, targetId: string) => void
}) {
  if (!visibleIds.has(account.id)) return null

  const hasChildren = (account.children?.length ?? 0) > 0
  const isOpen = expanded.has(account.id)
  const isSelected = selected === account.id
  const isDropTarget = dropTargetId === account.id && draggedId !== account.id
  const isDragging = draggedId === account.id
  const meta = TYPE_META[account.account_type]

  return (
    <>
      <div
        draggable={!account.is_system}
        onDragStart={e => onDragStart(e, account.id)}
        onDragOver={e => onDragOver(e, account.id)}
        onDragLeave={onDragLeave}
        onDrop={e => onDrop(e, account.id)}
        onContextMenu={e => onContextMenu(e, account)}
        onClick={() => onSelect(account.id)}
        className={`group flex items-center gap-1 px-2 py-1.5 cursor-pointer select-none rounded-lg mx-1 transition-colors
          ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'}
          ${isDropTarget ? 'ring-2 ring-primary-400 ring-inset bg-primary-50/50 dark:bg-primary-900/10' : ''}
          ${isDragging ? 'opacity-40' : ''}
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {!account.is_system && (
          <span className="opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing flex-shrink-0">
            <GripVertical className="h-3.5 w-3.5 text-gray-400" />
          </span>
        )}

        <button
          onClick={e => { e.stopPropagation(); if (hasChildren) onToggle(account.id) }}
          className={`w-5 h-5 flex items-center justify-center rounded flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors ${!hasChildren ? 'invisible' : ''}`}
        >
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <span className="flex-shrink-0">
          {account.is_group
            ? (isOpen ? <FolderOpen className="h-3.5 w-3.5 text-amber-500" /> : <Folder className="h-3.5 w-3.5 text-amber-400" />)
            : <FileText className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
          }
        </span>

        <span className="font-mono text-[11px] font-bold text-gray-400 dark:text-gray-500 flex-shrink-0 w-14">
          {account.code}
        </span>

        <span className={`flex-1 text-sm truncate ${
          depth === 0 ? 'font-bold text-gray-900 dark:text-white'
          : account.is_group ? 'font-semibold text-gray-800 dark:text-gray-100'
          : 'font-medium text-gray-700 dark:text-gray-300'
        } ${isSelected ? 'text-primary-700 dark:text-primary-300' : ''}`}>
          {account.name}
        </span>

        {(depth === 0 || isSelected) && (
          <span className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset flex-shrink-0 ${meta.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            {typeLabels[account.account_type]}
          </span>
        )}

        {account.is_system && (
          <span className="text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0">SYS</span>
        )}
      </div>

      {isOpen && account.children?.map(child => (
        <TreeNode
          key={child.id}
          account={child}
          depth={depth + 1}
          expanded={expanded}
          selected={selected}
          visibleIds={visibleIds}
          draggedId={draggedId}
          dropTargetId={dropTargetId}
          typeLabels={typeLabels}
          onToggle={onToggle}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        />
      ))}
    </>
  )
}

// ─── Account Form (right panel) ───────────────────────────────────────────────

function AccountForm({
  mode, initial, flat, tree, selectedId,
  onSave, onDelete, onAddChild, onEdit,
  isSaving, isDeleting, typeLabels,
}: {
  mode: 'create' | 'edit' | null
  initial: Partial<FormState>
  flat: COAAccount[]
  tree: COAAccount[]
  selectedId: string | null
  onSave: (data: FormState) => void
  onDelete: () => void
  onAddChild: () => void
  onEdit: () => void
  isSaving: boolean
  isDeleting: boolean
  typeLabels: Record<AccountType, string>
}) {
  const { t } = useTranslation('tenant')
  const [form, setForm] = useState<FormState>({ ...BLANK_FORM, ...initial })

  useEffect(() => { setForm({ ...BLANK_FORM, ...initial }) }, [initial, mode])

  const set = (k: keyof FormState, v: FormState[typeof k]) =>
    setForm(prev => {
      const next = { ...prev, [k]: v }
      if (k === 'is_group' && v === true) next.is_posting_allowed = false
      if (k === 'is_group' && v === false) next.is_posting_allowed = true
      return next
    })

  const selectedAccount = selectedId ? flat.find(a => a.id === selectedId) : null
  const breadcrumb = selectedId ? buildBreadcrumb(tree, selectedId) : []

  const parentChoices = flat.filter(a => {
    if (selectedId && a.id === selectedId) return false
    if (selectedId) {
      let node: COAAccount | undefined = a
      const flatMap = Object.fromEntries(flat.map(x => [x.id, x]))
      while (node) {
        if (node.parent === selectedId) return false
        node = node.parent ? flatMap[node.parent] : undefined
      }
    }
    return true
  })

  if (!mode && !selectedId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
        <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <FileText className="h-7 w-7 text-gray-300 dark:text-gray-600" />
        </div>
        <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">{t('accounting.coa.selectAccountPrompt')}</p>
        <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">{t('accounting.coa.selectAccountHint')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Breadcrumb */}
      {breadcrumb.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap px-5 pt-4 pb-2">
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              {i > 0 && <Breadcrumb className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />}
              <span className={`text-xs ${i === breadcrumb.length - 1 ? 'font-semibold text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {crumb.name}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">
          {mode === 'create'
            ? t('accounting.coa.newAccount')
            : mode === 'edit'
            ? t('accounting.coa.editAccount')
            : selectedAccount?.name ?? t('accounting.coa.accountDetails')}
        </h3>
        {selectedAccount && mode !== 'create' && (
          <div className="flex items-center gap-2 mt-1">
            <span className="font-mono text-xs text-gray-400">{selectedAccount.code}</span>
            <span className="text-gray-200 dark:text-gray-700">·</span>
            <span className="text-xs text-gray-400">{t('accounting.coa.level')} {selectedAccount.level_no}</span>
            <span className="text-gray-200 dark:text-gray-700">·</span>
            <span className="text-xs text-gray-400">{selectedAccount.account_nature}</span>
            {selectedAccount.is_group && (
              <>
                <span className="text-gray-200 dark:text-gray-700">·</span>
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{t('accounting.coa.group')}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* View mode — details + action buttons */}
      {!mode && selectedAccount && (
        <div className="flex-1 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('accounting.coa.detail.accountCode')}</p>
              <p className="font-mono text-sm font-bold text-gray-900 dark:text-white">{selectedAccount.code}</p>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('accounting.coa.detail.type')}</p>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TYPE_META[selectedAccount.account_type].badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${TYPE_META[selectedAccount.account_type].dot}`} />
                {typeLabels[selectedAccount.account_type]}
              </span>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('accounting.coa.detail.nature')}</p>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{selectedAccount.account_nature}</p>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('accounting.coa.detail.balance')}</p>
              <p className={`font-mono text-sm font-bold ${parseFloat(selectedAccount.balance) >= 0 ? 'text-gray-900 dark:text-white' : 'text-red-600'}`}>
                {fmt(selectedAccount.balance)}
              </p>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('accounting.coa.detail.groupAccount')}</p>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {selectedAccount.is_group ? t('accounting.coa.detail.yes') : t('accounting.coa.detail.no')}
              </p>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('accounting.coa.detail.postingAllowed')}</p>
              <p className={`text-sm font-semibold ${selectedAccount.is_posting_allowed ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                {selectedAccount.is_posting_allowed ? t('accounting.coa.detail.yes') : t('accounting.coa.detail.no')}
              </p>
            </div>
          </div>

          {selectedAccount.parent_name && (
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('accounting.coa.detail.parentAccount')}</p>
              <p className="font-mono text-sm text-gray-700 dark:text-gray-300">{selectedAccount.parent_name}</p>
            </div>
          )}

          {selectedAccount.description && (
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('accounting.coa.detail.description')}</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">{selectedAccount.description}</p>
            </div>
          )}

          {selectedAccount.is_system && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
              <Info className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300">{t('accounting.coa.systemWarning')}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button onClick={onAddChild}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold px-3 py-2 transition-colors">
              <CornerDownRight className="h-3.5 w-3.5" />{t('accounting.coa.actions.addChild')}
            </button>
            <button onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-xs font-semibold px-3 py-2 transition-colors">
              <Pencil className="h-3.5 w-3.5" />{t('accounting.coa.actions.edit')}
            </button>
            {!selectedAccount.is_system && (
              <button onClick={onDelete} disabled={isDeleting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white dark:bg-gray-800 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-xs font-semibold px-3 py-2 transition-colors disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" />{t('accounting.coa.actions.delete')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Edit / Create form */}
      {mode && (
        <div className="flex-1 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                {t('accounting.coa.form.accountCode')} <span className="text-red-500">*</span>
              </label>
              <input
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:text-white"
                placeholder={t('accounting.coa.form.accountCodePlaceholder')}
                value={form.code}
                onChange={e => set('code', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                {t('accounting.coa.form.accountType')} <span className="text-red-500">*</span>
              </label>
              <select
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                value={form.account_type}
                onChange={e => set('account_type', e.target.value as AccountType)}
              >
                {TYPE_KEYS.map(k => (
                  <option key={k} value={k}>{typeLabels[k]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              {t('accounting.coa.form.accountName')} <span className="text-red-500">*</span>
            </label>
            <input
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:text-white"
              placeholder={t('accounting.coa.form.accountNamePlaceholder')}
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              {t('accounting.coa.form.parentAccount')}
            </label>
            <select
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
              value={form.parent}
              onChange={e => set('parent', e.target.value)}
            >
              <option value="">{t('accounting.coa.form.rootParent')}</option>
              {parentChoices.map(a => (
                <option key={a.id} value={a.id}>
                  {'  '.repeat(a.level_no - 1)}{a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Nature — read-only, derived */}
          <div className="flex items-center gap-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900 px-3 py-2">
            <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {t('accounting.coa.form.natureInfo', { nature: TYPE_META[form.account_type].nature })}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2.5 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
              <div
                onClick={() => set('is_group', !form.is_group)}
                className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${form.is_group ? 'bg-amber-500' : 'bg-gray-200 dark:bg-gray-700'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${form.is_group ? 'translate-x-4' : ''}`} />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{t('accounting.coa.form.groupAccount')}</p>
                <p className="text-[10px] text-gray-400">{t('accounting.coa.form.groupAccountHint')}</p>
              </div>
            </label>

            <label className="flex items-center gap-2.5 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
              <div
                onClick={() => !form.is_group && set('is_posting_allowed', !form.is_posting_allowed)}
                className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${form.is_group ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${form.is_posting_allowed ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-700'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${form.is_posting_allowed ? 'translate-x-4' : ''}`} />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{t('accounting.coa.form.allowPosting')}</p>
                <p className="text-[10px] text-gray-400">{t('accounting.coa.form.allowPostingHint')}</p>
              </div>
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              {t('accounting.coa.form.description')}
            </label>
            <textarea
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
              rows={2}
              placeholder={t('accounting.coa.form.descriptionPlaceholder')}
              value={form.description}
              onChange={e => set('description', e.target.value)}
            />
          </div>

          {mode === 'edit' && (
            <label className="flex items-center gap-2.5 cursor-pointer">
              <div
                onClick={() => set('is_active', !form.is_active)}
                className={`relative w-8 h-4 rounded-full transition-colors ${form.is_active ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-700'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${form.is_active ? 'translate-x-4' : ''}`} />
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('accounting.coa.form.accountActive')}</span>
            </label>
          )}

          <button
            onClick={() => onSave(form)}
            disabled={isSaving || !form.code.trim() || !form.name.trim()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving
              ? <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t('accounting.coa.form.saving')}</>
              : <><Save className="h-4 w-4" />{mode === 'create' ? t('accounting.coa.form.createAccount') : t('accounting.coa.form.saveChanges')}</>
            }
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function ChartOfAccountsPanel() {
  const { t } = useTranslation('tenant')
  const qc = useQueryClient()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'create' | 'edit' | null>(null)
  const [formInit, setFormInit] = useState<Partial<FormState>>(BLANK_FORM)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<AccountType | ''>('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; account: COAAccount } | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [moveDialog, setMoveDialog] = useState<COAAccount | null>(null)

  // Translated type labels — computed once from t(), passed down as prop
  const typeLabels: Record<AccountType, string> = {
    ASSET:     t('accounting.coa.typeAsset'),
    LIABILITY: t('accounting.coa.typeLiability'),
    EQUITY:    t('accounting.coa.typeEquity'),
    INCOME:    t('accounting.coa.typeIncome'),
    EXPENSE:   t('accounting.coa.typeExpense'),
  }

  const TYPE_FILTERS: { label: string; value: AccountType | '' }[] = [
    { label: t('accounting.coa.typeAll'),      value: '' },
    { label: t('accounting.coa.typeAsset'),    value: 'ASSET' },
    { label: t('accounting.coa.typeLiability'),value: 'LIABILITY' },
    { label: t('accounting.coa.typeEquity'),   value: 'EQUITY' },
    { label: t('accounting.coa.typeIncome'),   value: 'INCOME' },
    { label: t('accounting.coa.typeExpense'),  value: 'EXPENSE' },
  ]

  const { data: tree = [], isLoading } = useQuery<COAAccount[]>({
    queryKey: ['coa-tree'],
    queryFn: () => apiClient.get('/accounting/accounts/tree/').then(r => r.data),
  })

  const flat = flattenTree(tree)
  const visibleIds = collectVisibleIds(tree, search, typeFilter)

  useEffect(() => {
    if (search || typeFilter) {
      const toExpand = collectAutoExpand(tree, search, typeFilter)
      setExpanded(prev => new Set([...prev, ...toExpand]))
    }
  }, [search, typeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['coa-tree'] })
    qc.invalidateQueries({ queryKey: ['coa-flat'] })
  }, [qc])

  const createMutation = useMutation({
    mutationFn: (data: object) => apiClient.post('/accounting/accounts/', data).then(r => r.data),
    onSuccess: (created: COAAccount) => {
      toast.success(t('accounting.coa.toast.created'))
      invalidate()
      setMode(null)
      setSelected(created.id)
      if (created.parent) setExpanded(prev => new Set([...prev, created.parent!]))
    },
    onError: (e: any) => toast.error(e?.response?.data?.code?.[0] ?? e?.response?.data?.detail ?? t('accounting.coa.toast.createError')),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      apiClient.patch(`/accounting/accounts/${id}/`, data).then(r => r.data),
    onSuccess: () => { toast.success(t('accounting.coa.toast.updated')); invalidate(); setMode(null) },
    onError: (e: any) => toast.error(e?.response?.data?.code?.[0] ?? e?.response?.data?.detail ?? t('accounting.coa.toast.updateError')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/accounting/accounts/${id}/`),
    onSuccess: () => { toast.success(t('accounting.coa.toast.deleted')); invalidate(); setSelected(null); setMode(null) },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? t('accounting.coa.toast.deleteError')),
  })

  const moveMutation = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      apiClient.post(`/accounting/accounts/${id}/move/`, { parent_id: parentId }).then(r => r.data),
    onSuccess: (updated: COAAccount) => {
      toast.success(t('accounting.coa.toast.moved'))
      invalidate()
      if (updated.parent) setExpanded(prev => new Set([...prev, updated.parent!]))
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? t('accounting.coa.toast.moveError')),
  })

  const toggleExpand = (id: string) =>
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  const expandAll = () => setExpanded(new Set(flat.map(a => a.id)))
  const collapseAll = () => setExpanded(new Set())

  const handleSelect = (id: string) => { setSelected(id); setMode(null); setContextMenu(null) }

  const openCreate = (parentId?: string) => {
    const parent = parentId ? flat.find(a => a.id === parentId) : undefined
    setFormInit({ ...BLANK_FORM, parent: parentId ?? '', account_type: parent?.account_type ?? 'ASSET' })
    setMode('create')
    setSelected(null)
  }

  const openEdit = (id: string) => {
    const acct = flat.find(a => a.id === id)
    if (!acct) return
    setFormInit({
      code: acct.code, name: acct.name, account_type: acct.account_type,
      parent: acct.parent ?? '', description: acct.description,
      is_group: acct.is_group, is_posting_allowed: acct.is_posting_allowed, is_active: acct.is_active,
    })
    setMode('edit')
    setSelected(id)
  }

  const handleSave = (data: FormState) => {
    const payload = {
      code: data.code.trim(), name: data.name.trim(), account_type: data.account_type,
      parent: data.parent || null, description: data.description, is_group: data.is_group,
      is_posting_allowed: data.is_group ? false : data.is_posting_allowed, is_active: data.is_active,
    }
    if (mode === 'create') createMutation.mutate(payload)
    else if (mode === 'edit' && selected) updateMutation.mutate({ id: selected, data: payload })
  }

  const handleDelete = (id: string) => {
    const acct = flat.find(a => a.id === id)
    if (!acct) return
    if (acct.children_count > 0) { toast.error(t('accounting.coa.toast.deleteGroupError')); return }
    if (!window.confirm(t('accounting.coa.toast.deleteConfirm', { code: acct.code, name: acct.name }))) return
    deleteMutation.mutate(id)
  }

  const handleDragStart = (e: React.DragEvent, id: string) => { e.dataTransfer.effectAllowed = 'move'; setDraggedId(id) }
  const handleDragOver = (e: React.DragEvent, id: string) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (id !== draggedId) setDropTargetId(id) }
  const handleDragLeave = () => setDropTargetId(null)
  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    setDropTargetId(null)
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return }
    moveMutation.mutate({ id: draggedId, parentId: targetId })
    setDraggedId(null)
  }
  const handleContextMenu = (e: React.MouseEvent, account: COAAccount) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, account })
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col" style={{ minHeight: '600px' }}>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 p-3 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-sm pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:text-white"
              placeholder={t('accounting.coa.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <button onClick={expandAll} title={t('accounting.coa.expandAll')}
            className="rounded-lg p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ChevronsDown className="h-4 w-4" />
          </button>
          <button onClick={collapseAll} title={t('accounting.coa.collapseAll')}
            className="rounded-lg p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ChevronsUp className="h-4 w-4" />
          </button>

          <button
            onClick={() => openCreate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white text-xs font-semibold px-3 py-2 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />{t('accounting.coa.addAccount')}
          </button>
        </div>

        {/* Type filter tabs */}
        <div className="flex gap-1">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                typeFilter === f.value
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-400 dark:text-gray-600 self-center pr-1">
            {flat.filter(a => visibleIds.has(a.id)).length} {t('accounting.coa.accountsCount')}
          </span>
        </div>
      </div>

      {/* Split pane */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left — Tree */}
        <div className="w-[45%] border-r border-gray-100 dark:border-gray-700 overflow-y-auto py-2"
          onDragEnd={() => { setDraggedId(null); setDropTargetId(null) }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <span className="h-6 w-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : tree.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <Folder className="h-10 w-10 text-gray-200 dark:text-gray-700 mb-3" />
              <p className="text-sm text-gray-400">{t('accounting.coa.emptyTitle')}</p>
              <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
                {t('accounting.coa.emptyDesc')}
              </p>
            </div>
          ) : (
            tree.map(root => (
              <TreeNode
                key={root.id}
                account={root}
                depth={0}
                expanded={expanded}
                selected={selected}
                visibleIds={visibleIds}
                draggedId={draggedId}
                dropTargetId={dropTargetId}
                typeLabels={typeLabels}
                onToggle={toggleExpand}
                onSelect={handleSelect}
                onContextMenu={handleContextMenu}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              />
            ))
          )}
        </div>

        {/* Right — Detail / Form panel */}
        <div className="flex-1 overflow-hidden">
          <AccountForm
            mode={mode}
            initial={formInit}
            flat={flat}
            tree={tree}
            selectedId={selected}
            onSave={handleSave}
            onDelete={() => selected && handleDelete(selected)}
            onAddChild={() => selected && openCreate(selected)}
            onEdit={() => selected && openEdit(selected)}
            isSaving={createMutation.isPending || updateMutation.isPending}
            isDeleting={deleteMutation.isPending}
            typeLabels={typeLabels}
          />
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          account={contextMenu.account}
          onAddChild={() => openCreate(contextMenu.account.id)}
          onEdit={() => openEdit(contextMenu.account.id)}
          onDelete={() => handleDelete(contextMenu.account.id)}
          onMove={() => setMoveDialog(contextMenu.account)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Move dialog */}
      {moveDialog && (
        <MoveDialog
          account={moveDialog}
          flat={flat}
          onClose={() => setMoveDialog(null)}
          onMove={(parentId) => { moveMutation.mutate({ id: moveDialog.id, parentId }); setMoveDialog(null) }}
        />
      )}
    </div>
  )
}
