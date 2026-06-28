/**
 * WebSocket connection manager for real-time fleet/trip tracking.
 * Auto-reconnects with exponential back-off.
 */

type MessageHandler = (data: unknown) => void

interface WSOptions {
  onMessage: MessageHandler
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
  maxRetries?: number
}

export class ReconnectingWebSocket {
  private url: string
  private ws: WebSocket | null = null
  private retries = 0
  private readonly maxRetries: number
  private readonly options: WSOptions
  private intentionallyClosed = false

  constructor(url: string, options: WSOptions) {
    this.url = url
    this.options = options
    this.maxRetries = options.maxRetries ?? 5
    this.connect()
  }

  private connect() {
    try {
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        this.retries = 0
        this.options.onOpen?.()
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          this.options.onMessage(data)
        } catch {
          this.options.onMessage(event.data)
        }
      }

      this.ws.onclose = () => {
        this.options.onClose?.()
        if (!this.intentionallyClosed && this.retries < this.maxRetries) {
          const delay = Math.min(1000 * 2 ** this.retries, 30000)
          this.retries++
          setTimeout(() => this.connect(), delay)
        }
      }

      this.ws.onerror = (error) => {
        this.options.onError?.(error)
      }
    } catch (err) {
      console.error('WebSocket connection error:', err)
    }
  }

  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  close() {
    this.intentionallyClosed = true
    this.ws?.close()
  }
}

/** Create WS URL for fleet live tracking */
export function fleetWsUrl(tenantSlug: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/v1/vehicles/${tenantSlug}/`
}

/** Create WS URL for trip live tracking */
export function tripWsUrl(tripId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/v1/trips/${tripId}/`
}

/** Create WS URL for dispatch alerts (Django Channels) */
export function dispatchWsUrl(tenantSlug: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/dispatch/${tenantSlug}/`
}
