import { EventEmitter } from 'events';
import { db } from '../config/database';
import { sessionEvents } from '../db/schema';
import { SessionEvent, SessionEventType } from '../types/events';
import { logger } from '../config/logger';
import { desc, eq, and, gte } from 'drizzle-orm';

class EventService extends EventEmitter {
  private static instance: EventService;

  private constructor() {
    super();
    this.setMaxListeners(100); // Handle many concurrent sessions
  }

  static getInstance(): EventService {
    if (!EventService.instance) {
      EventService.instance = new EventService();
    }
    return EventService.instance;
  }

  async emitSessionEvent(event: SessionEvent): Promise<void> {
    try {
      // Store in database for audit trail
      await db.insert(sessionEvents).values({
        sessionId: event.sessionId,
        eventType: event.eventType,
        eventData: event.eventData || {},
        status: event.status || 'completed',
        signature: event.signature,
        errorMessage: event.errorMessage,
        createdAt: event.createdAt || new Date()
      });

      // Emit to WebSocket listeners
      this.emit('session-event', event);
      this.emit(`session-${event.sessionId}`, event);

      logger.debug('Session event emitted', {
        sessionId: event.sessionId,
        eventType: event.eventType
      });
    } catch (error) {
      logger.error('Failed to emit session event', {
        sessionId: event.sessionId,
        eventType: event.eventType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async getSessionEvents(sessionId: string, limit: number = 50): Promise<SessionEvent[]> {
    try {
      const events = await db
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(desc(sessionEvents.createdAt))
        .limit(limit);

      return events.map(e => ({
        id: e.id,
        sessionId: e.sessionId,
        eventType: e.eventType as SessionEventType,
        eventData: e.eventData as Record<string, any>,
        status: e.status as 'pending' | 'completed' | 'failed',
        signature: e.signature || undefined,
        errorMessage: e.errorMessage || undefined,
        createdAt: e.createdAt || undefined
      }));
    } catch (error) {
      logger.error('Failed to get session events', { sessionId, error });
      return [];
    }
  }

  async getRecentEvents(sessionId: string, since: Date): Promise<SessionEvent[]> {
    try {
      const events = await db
        .select()
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, sessionId),
            gte(sessionEvents.createdAt, since)
          )
        )
        .orderBy(desc(sessionEvents.createdAt));

      return events.map(e => ({
        id: e.id,
        sessionId: e.sessionId,
        eventType: e.eventType as SessionEventType,
        eventData: e.eventData as Record<string, any>,
        status: e.status as 'pending' | 'completed' | 'failed',
        signature: e.signature || undefined,
        errorMessage: e.errorMessage || undefined,
        createdAt: e.createdAt || undefined
      }));
    } catch (error) {
      logger.error('Failed to get recent events', { sessionId, error });
      return [];
    }
  }
}

export const eventService = EventService.getInstance();