import apiClient, { ApiResponse } from './api'

export interface GroupCompositionRule {
  id: string
  group: string | null
  allow_mixed: boolean
  group_size: number
  max_categories_per_group: number
  capacity_spread_limit: number
  permit_class_match: boolean
  required_composition: Record<string, number>
  spares_allowed: number
}

const compositionRuleService = {
  list: async (): Promise<GroupCompositionRule[]> => {
    const { data } = await apiClient.get<ApiResponse<GroupCompositionRule[]>>('/fleet/composition-rules/')
    return Array.isArray(data.data) ? data.data : []
  },
}

export default compositionRuleService
