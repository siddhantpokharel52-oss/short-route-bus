import apiClient from './api'

export interface Permission {
  id: string
  codename: string
  name: string
  module: string
  module_key: string
  action: string
  description: string
  sort_order: number
}

export interface ModulePermissions {
  module_key: string
  module_name: string
  permissions: Permission[]
}

export interface Role {
  id: string
  name: string
  slug: string
  description: string
  color: string
  is_active: boolean
  is_system: boolean
  permissions: string[]   // granted codenames
  user_count: number
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  action: string
  role_name: string
  actor_name: string
  details: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

export interface UserRole {
  id: string
  user_id: string
  role: string
  role_name: string
  role_color: string
  assigned_at: string
}

const rbacService = {
  // Permissions (seeded, read-only from UI)
  getPermissions: () =>
    apiClient.get('/rbac/permissions/').then(r => r.data.data as ModulePermissions[]),

  // Roles CRUD
  getRoles: () =>
    apiClient.get('/rbac/roles/').then(r => r.data.data as Role[]),

  getRole: (id: string) =>
    apiClient.get(`/rbac/roles/${id}/`).then(r => r.data.data as Role),

  createRole: (data: { name: string; description?: string; color?: string; permission_codenames?: string[] }) =>
    apiClient.post('/rbac/roles/', data).then(r => r.data.data as Role),

  updateRole: (id: string, data: { name?: string; description?: string; color?: string; is_active?: boolean; permission_codenames?: string[] }) =>
    apiClient.patch(`/rbac/roles/${id}/`, data).then(r => r.data.data as Role),

  deleteRole: (id: string) =>
    apiClient.delete(`/rbac/roles/${id}/`).then(r => r.data),

  activateRole: (id: string) =>
    apiClient.post(`/rbac/roles/${id}/activate/`).then(r => r.data),

  deactivateRole: (id: string) =>
    apiClient.post(`/rbac/roles/${id}/deactivate/`).then(r => r.data),

  cloneRole: (id: string, name: string) =>
    apiClient.post(`/rbac/roles/${id}/clone/`, { name }).then(r => r.data.data as Role),

  updatePermissions: (id: string, codenames: string[]) =>
    apiClient.post(`/rbac/roles/${id}/permissions/`, { permission_codenames: codenames })
      .then(r => r.data.data as Role),

  // Audit log
  getAuditLog: (roleId?: string) => {
    const params = roleId ? `?role=${roleId}` : ''
    return apiClient.get(`/rbac/audit/${params}`).then(r => r.data.data as AuditLog[])
  },

  // User roles
  getUserRoles: (userId?: string) => {
    const params = userId ? `?user_id=${userId}` : ''
    return apiClient.get(`/rbac/user-roles/${params}`).then(r => r.data.data as UserRole[])
  },

  assignRole: (userId: string, roleId: string) =>
    apiClient.post('/rbac/user-roles/', { user_id: userId, role: roleId })
      .then(r => r.data.data as UserRole),

  removeUserRole: (id: string) =>
    apiClient.delete(`/rbac/user-roles/${id}/`).then(r => r.data),
}

export default rbacService
