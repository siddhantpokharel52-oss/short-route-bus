/** Extract a browser-accessible path from whatever the backend returns.
 * Django's ImageField can return either an absolute URL (with the internal
 * django hostname) or a relative path -- always reduce to just the path so
 * the /media proxy in front of it works regardless of which one came back. */
export function getMediaPath(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).pathname
  } catch {
    return url.startsWith('/') ? url : `/${url}`
  }
}
