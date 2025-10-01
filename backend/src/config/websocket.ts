import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { logger } from './logger';
import { eventService } from '../services/EventService';
import { SessionEvent } from '../types/events';

let io: Server | null = null;

export function setupWebSocket(httpServer: HTTPServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket: Socket) => {
    logger.info('WebSocket client connected', { socketId: socket.id });

    // Subscribe to specific session
    socket.on('subscribe', (sessionId: string) => {
      socket.join(`session-${sessionId}`);
      logger.debug('Client subscribed to session', { socketId: socket.id, sessionId });
    });

    // Unsubscribe from session
    socket.on('unsubscribe', (sessionId: string) => {
      socket.leave(`session-${sessionId}`);
      logger.debug('Client unsubscribed from session', { socketId: socket.id, sessionId });
    });

    socket.on('disconnect', () => {
      logger.info('WebSocket client disconnected', { socketId: socket.id });
    });
  });

  // Listen to event service and broadcast to connected clients
  eventService.on('session-event', (event: SessionEvent) => {
    if (io) {
      io.to(`session-${event.sessionId}`).emit('session-event', event);
    }
  });

  logger.info('WebSocket server initialized');
  return io;
}

export function getWebSocketServer(): Server | null {
  return io;
}

export function broadcastToSession(sessionId: string, event: SessionEvent): void {
  if (io) {
    io.to(`session-${sessionId}`).emit('session-event', event);
  }
}