import { useState, useCallback } from 'react'

interface PaginationState {
  page: number
  pageSize: number
}

interface UsePaginationReturn extends PaginationState {
  totalPages: number
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  reset: () => void
  queryParams: Record<string, string>
}

export function usePagination(
  totalCount: number,
  defaultPageSize = 20
): UsePaginationReturn {
  const [page, setPageState] = useState(1)
  const [pageSize, setPageSizeState] = useState(defaultPageSize)

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const setPage = useCallback((p: number) => {
    setPageState(Math.min(Math.max(1, p), totalPages))
  }, [totalPages])

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size)
    setPageState(1)
  }, [])

  const reset = useCallback(() => {
    setPageState(1)
  }, [])

  return {
    page,
    pageSize,
    totalPages,
    setPage,
    setPageSize,
    reset,
    queryParams: {
      page: String(page),
      page_size: String(pageSize),
    },
  }
}
