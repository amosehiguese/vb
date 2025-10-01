import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export interface SessionEvent {
  id?: string;
  sessionId: string;
  eventType: string;
  eventData?: Record<string, any>;
  status?: 'pending' | 'completed' | 'failed';
  signature?: string;
  errorMessage?: string;
  createdAt?: Date;
}

interface UseSessionEventsOptions {
  sessionId: string | null;
  onEvent?: (event: SessionEvent) => void;
  autoConnect?: boolean;
}

export function useSessionEvents({
  sessionId,
  onEvent,
  autoConnect = true
}: UseSessionEventsOptions) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const connect = useCallback(() => {
    if (!sessionId || socketRef.current?.connected) return;

    try {
      const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
      });

      socket.on('connect', () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setError(null);
        socket.emit('subscribe', sessionId);
      });

      socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
      });

      socket.on('connect_error', (err: any) => {
        console.error('WebSocket connection error:', err);
        setError('Failed to connect to server');
        setIsConnected(false);
      });

      socket.on('session-event', (event: SessionEvent) => {
        console.log('Received event:', event);
        setEvents(prev => [event, ...prev]);
        onEvent?.(event);
      });

      socketRef.current = socket;
    } catch (err) {
      console.error('Failed to create socket:', err);
      setError('Failed to initialize connection');
    }
  }, [sessionId, onEvent]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      if (sessionId) {
        socketRef.current.emit('unsubscribe', sessionId);
      }
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, [sessionId]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  useEffect(() => {
    if (autoConnect && sessionId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [sessionId, autoConnect, connect, disconnect]);

  return {
    events,
    isConnected,
    error,
    connect,
    disconnect,
    clearEvents
  };
}