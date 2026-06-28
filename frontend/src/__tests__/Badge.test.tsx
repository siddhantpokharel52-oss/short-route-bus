import React from 'react'
import { render, screen } from '@testing-library/react'
import { Badge, statusVariant } from '../components/shared/Badge'

describe('Badge component', () => {
  it('renders children', () => {
    render(<Badge>Active</Badge>)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders dot when dot=true', () => {
    const { container } = render(<Badge dot>Status</Badge>)
    const dot = container.querySelector('.rounded-full.h-1\\.5')
    expect(dot).toBeInTheDocument()
  })

  it('applies success variant classes', () => {
    const { container } = render(<Badge variant="success">OK</Badge>)
    expect(container.firstChild).toHaveClass('bg-green-100')
  })

  it('applies danger variant classes', () => {
    const { container } = render(<Badge variant="danger">Error</Badge>)
    expect(container.firstChild).toHaveClass('bg-red-100')
  })
})

describe('statusVariant helper', () => {
  it('returns success for ACTIVE', () => {
    expect(statusVariant('ACTIVE')).toBe('success')
  })

  it('returns danger for SUSPENDED', () => {
    expect(statusVariant('SUSPENDED')).toBe('danger')
  })

  it('returns warning for PENDING', () => {
    expect(statusVariant('PENDING')).toBe('warning')
  })

  it('returns info for IN_PROGRESS', () => {
    expect(statusVariant('IN_PROGRESS')).toBe('info')
  })

  it('returns neutral for unknown status', () => {
    expect(statusVariant('UNKNOWN_STATUS')).toBe('neutral')
  })
})
