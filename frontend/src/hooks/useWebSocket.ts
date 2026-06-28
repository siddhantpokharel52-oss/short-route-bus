import { useEffect, useRef, useState, useCallback } from 'react'
import { ReconnectingWebSocket } from '@utils/websocket'

interface UseWebSocketOptions<T> {
  url: string | null
  onMessage?: (data: T) => void
  enabled?: boolean
}

interface UseWebSocketReturn<T> {
  lastMessage: T | null
  isConnected: boolean
  send: (data: unknown) => void
}

export function useWebSocket<T = unknown>({
  url,
  onMessage,
  enabled = true,
}: UseWebSocketOptions<T>): UseWebSocketReturn<T> {
  const [lastMessage, setLastMessage] = useState<T | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<ReconnectingWebSocket | null>(null)

  useEffect(() => {
    if (!url || !enabled) return

    wsRef.current = new ReconnectingWebSocket(url, {
      onMessage: (data) => {
        const typed = data as T
        setLastMessage(typed)
        onMessage?.(typed)
      },
      onOpen: () => setIsConnected(true),
      onClose: () => setIsConnected(false),
    })

    return () => {
      wsRef.current?.close()
      wsRef.current = null
      setIsConnected(false)
    }
  }, [url, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((data: unknown) => {
    wsRef.current?.send(data)
  }, [])

  return { lastMessage, isConnected, send }
}
