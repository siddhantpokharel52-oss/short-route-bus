/**
 * Portal context — determines whether the current hostname is the main platform
 * portal (e.g. localhost / citybus.com.np) or a tenant subdomain portal
 * (e.g. test.localhost / test.citybus.com.np).
 *
 * Ground truth comes from window.location.hostname, not the auth store, so it
 * is always correct even before the user logs in.
 */

export interface PortalContext {
  isTenantPortal: boolean
  tenantSlug: string | null
}

export function getPortalContext(): PortalContext {
  const hostname = window.location.hostname
  const parts = hostname.split('.')

  // 'localhost' alone → main portal
  if (parts.length === 1) return { isTenantPortal: false, tenantSlug: null }

  const subdomain = parts[0]

  // 'www' counts as main portal
  if (subdomain === 'www') return { isTenantPortal: false, tenantSlug: null }

  // *.localhost → tenant portal  (works in dev: test.localhost → tenantSlug = 'test')
  if (hostname.endsWith('.localhost')) {
    return { isTenantPortal: true, tenantSlug: subdomain }
  }

  // Production: VITE_BASE_DOMAIN=citybus.com.np
  const baseDomain = import.meta.env.VITE_BASE_DOMAIN as string | undefined
  if (baseDomain) {
    if (hostname === baseDomain) return { isTenantPortal: false, tenantSlug: null }
    if (hostname.endsWith(`.${baseDomain}`)) {
      return { isTenantPortal: true, tenantSlug: subdomain }
    }
  }

  return { isTenantPortal: false, tenantSlug: null }
}

/** Build the login URL for a specific tenant subdomain. */
export function getTenantLoginUrl(tenantSchema: string): string {
  const { protocol, port } = window.location
  const portSuffix = port ? `:${port}` : ''
  const baseDomain = (import.meta.env.VITE_BASE_DOMAIN as string | undefined) || 'localhost'
  return `${protocol}//${tenantSchema}.${baseDomain}${portSuffix}/login`
}

/** Build the login URL for the main (platform) domain. */
export function getMainLoginUrl(): string {
  const { protocol, port } = window.location
  const portSuffix = port ? `:${port}` : ''
  const baseDomain = (import.meta.env.VITE_BASE_DOMAIN as string | undefined) || 'localhost'
  return `${protocol}//${baseDomain}${portSuffix}/login`
}
