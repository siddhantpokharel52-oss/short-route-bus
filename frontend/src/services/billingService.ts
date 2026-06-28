import apiClient, { ApiResponse } from './api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommissionRule {
  id: string
  name: string
  rule_type: string
  rule_type_display: string
  billing_model: 'FIXED_AMOUNT' | 'PERCENTAGE'
  billing_model_display: string
  rate: string
  description: string
  is_active: boolean
  created_at: string
}

export interface PricingPlan {
  id: string
  name: string
  description: string
  billing_frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY'
  billing_frequency_display: string
  is_active: boolean
  commission_rules: CommissionRule[]
  active_rules_count: number
  created_at: string
  updated_at: string
}

export interface SubscriptionRuleOverride {
  id: string
  commission_rule: string
  rule_name: string
  rule_type: string
  rule_type_display: string
  default_rate: string
  override_rate: string | null
  effective_rate: string
  is_active: boolean
}

export interface TenantSubscription {
  id: string
  tenant_schema: string
  tenant_name: string
  plan: string | null
  plan_name: string | null
  plan_frequency: string | null
  status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'EXPIRED'
  status_display: string
  billing_frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY'
  billing_frequency_display: string
  start_date: string
  end_date: string
  trial_end_date: string | null
  grace_period_days: number
  grace_period_end: string | null
  auto_renew: boolean
  notes: string
  rule_overrides: SubscriptionRuleOverride[]
  is_in_grace_period: boolean
  days_remaining: number
  invoice_count: number
  pending_amount: string
  created_at: string
  updated_at: string
}

export interface InvoiceItem {
  id: string
  rule_type: string
  description: string
  quantity: string
  unit_rate: string
  amount: string
}

export interface Invoice {
  id: string
  invoice_number: string
  tenant_schema: string
  tenant_name: string
  subscription: string
  billing_period_start: string
  billing_period_end: string
  subtotal: string
  tax_rate: string
  tax_amount: string
  late_fee: string
  total_amount: string
  payment_status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'WAIVED'
  payment_status_display: string
  due_date: string
  paid_at: string | null
  notes: string
  is_prorated: boolean
  items: InvoiceItem[]
  is_overdue: boolean
  days_overdue: number
  payment_count: number
  created_at: string
  updated_at: string
}

export interface Payment {
  id: string
  invoice: string
  invoice_number: string
  amount: string
  payment_method: string
  payment_method_display: string
  transaction_id: string
  payment_status: string
  payment_status_display: string
  paid_at: string | null
  notes: string
  created_at: string
}

export interface BillingAuditLog {
  id: string
  tenant_schema: string
  action: string
  action_display: string
  performed_by_email: string
  related_invoice_id: string | null
  related_subscription_id: string | null
  details: Record<string, unknown>
  created_at: string
}

export interface CommissionPreview {
  tenant_schema: string
  tenant_name: string
  plan: string | null
  proration_factor: string
  line_items: {
    rule_type: string
    description: string
    quantity: string
    unit_rate: string
    amount: string
  }[]
  subtotal: string
}

// ─── Service ──────────────────────────────────────────────────────────────────

const billingService = {
  // ── Pricing Plans ──────────────────────────────────────────────────────────
  plans: {
    list: async (params?: Record<string, string>) => {
      const { data } = await apiClient.get('/billing/plans/', { params })
      return {
        plans: (data.data?.results ?? data.data ?? []) as PricingPlan[],
        totalCount: (data.meta?.total_count ?? 0) as number,
      }
    },
    get: async (id: string): Promise<PricingPlan> => {
      const { data } = await apiClient.get<ApiResponse<PricingPlan>>(`/billing/plans/${id}/`)
      return data.data
    },
    create: async (payload: Partial<PricingPlan>): Promise<PricingPlan> => {
      const { data } = await apiClient.post<ApiResponse<PricingPlan>>('/billing/plans/', payload)
      if (!data.success) throw new Error(data.message)
      return data.data
    },
    addRule: async (planId: string, rule: Partial<CommissionRule>): Promise<CommissionRule> => {
      const { data } = await apiClient.post<ApiResponse<CommissionRule>>(
        `/billing/plans/${planId}/add-rule/`, rule
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
  },

  // ── Subscriptions ─────────────────────────────────────────────────────────
  subscriptions: {
    list: async (params?: Record<string, string>) => {
      const { data } = await apiClient.get('/billing/subscriptions/', { params })
      return {
        subscriptions: (data.data?.results ?? data.data ?? []) as TenantSubscription[],
        totalCount: (data.meta?.total_count ?? 0) as number,
      }
    },
    get: async (id: string): Promise<TenantSubscription> => {
      const { data } = await apiClient.get<ApiResponse<TenantSubscription>>(
        `/billing/subscriptions/${id}/`
      )
      return data.data
    },
    create: async (payload: Partial<TenantSubscription>): Promise<TenantSubscription> => {
      const { data } = await apiClient.post<ApiResponse<TenantSubscription>>(
        '/billing/subscriptions/', payload
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
    update: async (id: string, payload: Partial<TenantSubscription>): Promise<TenantSubscription> => {
      const { data } = await apiClient.patch<ApiResponse<TenantSubscription>>(
        `/billing/subscriptions/${id}/`, payload
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
    assignPlan: async (id: string, planId: string): Promise<TenantSubscription> => {
      const { data } = await apiClient.post<ApiResponse<TenantSubscription>>(
        `/billing/subscriptions/${id}/assign-plan/`, { plan_id: planId }
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
    generateInvoice: async (
      id: string,
      payload: {
        period_start: string
        period_end: string
        tax_rate?: string
        late_fee?: string
        is_prorated?: boolean
        proration_factor?: string
      }
    ): Promise<Invoice> => {
      const { data } = await apiClient.post<ApiResponse<Invoice>>(
        `/billing/subscriptions/${id}/generate-invoice/`, payload
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
    calculateCommission: async (
      id: string,
      periodStart: string,
      periodEnd: string
    ): Promise<CommissionPreview> => {
      const { data } = await apiClient.get<ApiResponse<CommissionPreview>>(
        `/billing/subscriptions/${id}/calculate-commission/`,
        { params: { period_start: periodStart, period_end: periodEnd } }
      )
      return data.data
    },
    submitUsage: async (id: string, payload: Record<string, unknown>) => {
      const { data } = await apiClient.post(
        `/billing/subscriptions/${id}/submit-usage/`, payload
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
    suspend: async (id: string, reason: string): Promise<TenantSubscription> => {
      const { data } = await apiClient.post<ApiResponse<TenantSubscription>>(
        `/billing/subscriptions/${id}/suspend/`, { reason }
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
    activate: async (id: string): Promise<TenantSubscription> => {
      const { data } = await apiClient.post<ApiResponse<TenantSubscription>>(
        `/billing/subscriptions/${id}/activate/`
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
    renew: async (id: string): Promise<TenantSubscription> => {
      const { data } = await apiClient.post<ApiResponse<TenantSubscription>>(
        `/billing/subscriptions/${id}/renew/`
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
  },

  // ── Invoices ──────────────────────────────────────────────────────────────
  invoices: {
    list: async (params?: Record<string, string>) => {
      const { data } = await apiClient.get('/billing/invoices/', { params })
      return {
        invoices: (data.data?.results ?? data.data ?? []) as Invoice[],
        totalCount: (data.meta?.total_count ?? 0) as number,
      }
    },
    get: async (id: string): Promise<Invoice> => {
      const { data } = await apiClient.get<ApiResponse<Invoice>>(`/billing/invoices/${id}/`)
      return data.data
    },
    markPaid: async (id: string): Promise<Invoice> => {
      const { data } = await apiClient.post<ApiResponse<Invoice>>(
        `/billing/invoices/${id}/mark-paid/`
      )
      if (!data.success) throw new Error(data.message)
      return data.data
    },
    cancel: async (id: string): Promise<void> => {
      await apiClient.post(`/billing/invoices/${id}/cancel/`)
    },
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  payments: {
    list: async (params?: Record<string, string>) => {
      const { data } = await apiClient.get('/billing/payments/', { params })
      return {
        payments: (data.data?.results ?? data.data ?? []) as Payment[],
        totalCount: (data.meta?.total_count ?? 0) as number,
      }
    },
    create: async (payload: Partial<Payment>): Promise<Payment> => {
      const { data } = await apiClient.post<ApiResponse<Payment>>('/billing/payments/', payload)
      if (!data.success) throw new Error(data.message)
      return data.data
    },
  },

  // ── Audit Logs ────────────────────────────────────────────────────────────
  auditLogs: {
    list: async (params?: Record<string, string>) => {
      const { data } = await apiClient.get('/billing/audit-logs/', { params })
      return {
        logs: (data.data?.results ?? data.data ?? []) as BillingAuditLog[],
        totalCount: (data.meta?.total_count ?? 0) as number,
      }
    },
  },
}

export default billingService
