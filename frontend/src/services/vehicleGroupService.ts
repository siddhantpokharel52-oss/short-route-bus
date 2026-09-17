import apiClient, { ApiResponse } from './api'

export interface GroupMemberVehicle {
  id: string
  registration_no: string
  category_code: string | null
  category_name: string | null
}

export interface GroupMember {
  id: string
  group: string
  vehicle: string
  vehicle_detail: GroupMemberVehicle
  valid_from: string
  valid_to: string | null
}

export interface GroupDriverAssignment {
  id: string
  group: string
  driver_user_id: string
  valid_from: string
  valid_to: string | null
}

export interface GroupConductorAssignment {
  id: string
  group: string
  conductor_user_id: string
  valid_from: string
  valid_to: string | null
}

export interface VehicleGroup {
  id: string
  code: string
  kind: 'ROTATING' | 'FIXED' | 'RESERVE'
  composition_mode: 'UNIFORM' | 'MIXED'
  status: 'ACTIVE' | 'INACTIVE'
  home_latitude: string | null
  home_longitude: string | null
  capability_min_seats: number
  capability_total_seats: number
  capability_all_ac: boolean
  capability_ac_count: number
  capability_categories: Record<string, number>
  capability_permit_classes: string[]
  capability_computed_at: string | null
  members: GroupMember[]
  created_at: string
  updated_at: string
}

export type VehicleGroupPayload = Partial<
  Pick<VehicleGroup, 'code' | 'kind' | 'composition_mode' | 'status' | 'home_latitude' | 'home_longitude'>
>

export interface EligibilityRoute {
  route_id: string
  route_code: string
  route_name: string
}
export interface EligibilityResult {
  eligible: EligibilityRoute[]
  not_eligible: (EligibilityRoute & { reasons: string[] })[]
}

export interface RequirementBalance {
  requirement: string
  slots_needing_it: number
  eligible_groups: number
  status: string
}
export interface RouteBalance {
  day_type: string
  total_slots: number
  total_rotating_groups: number
  status: string
  per_requirement: RequirementBalance[]
}

const vehicleGroupService = {
  list: async (params?: Record<string, string>): Promise<VehicleGroup[]> => {
    const { data } = await apiClient.get<ApiResponse<VehicleGroup[]>>('/fleet/groups/', { params })
    return Array.isArray(data.data) ? data.data : []
  },

  get: async (id: string): Promise<VehicleGroup> => {
    // Plain DRF retrieve() -- no success envelope.
    const { data } = await apiClient.get(`/fleet/groups/${id}/`)
    return (data as ApiResponse<VehicleGroup>).data ?? data
  },

  create: async (payload: VehicleGroupPayload): Promise<VehicleGroup> => {
    const { data } = await apiClient.post('/fleet/groups/', payload)
    return (data as ApiResponse<VehicleGroup>).data ?? data
  },

  update: async (id: string, payload: VehicleGroupPayload): Promise<VehicleGroup> => {
    const { data } = await apiClient.patch(`/fleet/groups/${id}/`, payload)
    return (data as ApiResponse<VehicleGroup>).data ?? data
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/fleet/groups/${id}/`)
  },

  addMember: async (groupId: string, vehicleId: string): Promise<GroupMember> => {
    const { data } = await apiClient.post(`/fleet/groups/${groupId}/members/`, { vehicle: vehicleId })
    return (data as ApiResponse<GroupMember>).data ?? data
  },

  removeMember: async (groupId: string, memberId: string): Promise<void> => {
    await apiClient.delete(`/fleet/groups/${groupId}/members/${memberId}/`)
  },

  listDrivers: async (groupId: string): Promise<GroupDriverAssignment[]> => {
    const { data } = await apiClient.get<ApiResponse<GroupDriverAssignment[]>>(`/fleet/groups/${groupId}/drivers/`)
    return Array.isArray(data.data) ? data.data : []
  },

  addDriver: async (groupId: string, driverUserId: string): Promise<GroupDriverAssignment> => {
    const { data } = await apiClient.post(`/fleet/groups/${groupId}/drivers/`, { driver_user_id: driverUserId })
    return (data as ApiResponse<GroupDriverAssignment>).data ?? data
  },

  removeDriver: async (groupId: string, assignmentId: string): Promise<void> => {
    await apiClient.delete(`/fleet/groups/${groupId}/drivers/${assignmentId}/`)
  },

  listConductors: async (groupId: string): Promise<GroupConductorAssignment[]> => {
    const { data } = await apiClient.get<ApiResponse<GroupConductorAssignment[]>>(`/fleet/groups/${groupId}/conductors/`)
    return Array.isArray(data.data) ? data.data : []
  },

  addConductor: async (groupId: string, conductorUserId: string): Promise<GroupConductorAssignment> => {
    const { data } = await apiClient.post(`/fleet/groups/${groupId}/conductors/`, { conductor_user_id: conductorUserId })
    return (data as ApiResponse<GroupConductorAssignment>).data ?? data
  },

  removeConductor: async (groupId: string, assignmentId: string): Promise<void> => {
    await apiClient.delete(`/fleet/groups/${groupId}/conductors/${assignmentId}/`)
  },

  eligibility: async (groupId: string): Promise<EligibilityResult> => {
    const { data } = await apiClient.get<ApiResponse<EligibilityResult>>(`/fleet/groups/${groupId}/eligibility/`)
    return data.data
  },

  balance: async (dayType: string): Promise<RouteBalance> => {
    // Lives under /fleet/* (not /platform/*) because it needs the tenant
    // schema switched -- see the matching comment on the backend action.
    const { data } = await apiClient.get<ApiResponse<RouteBalance>>('/fleet/groups/balance/', {
      params: { day_type: dayType },
    })
    return data.data
  },
}

export default vehicleGroupService
