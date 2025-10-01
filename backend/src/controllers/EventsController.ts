import { Request, Response, NextFunction } from 'express';
import { eventService } from '../services/EventService';
import { logger } from '../config/logger';
import { createError } from '../utils/errors';
import { HTTP_STATUS } from '../utils/constants';

export class EventsController {
  // GET /api/events/:sessionId - Get all events for a session
  getSessionEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;

      if (!sessionId) {
        return next(createError.validation('Session ID is required'));
      }

      const events = await eventService.getSessionEvents(sessionId, limit);

      res.status(HTTP_STATUS.OK).json({
        success: true,
        sessionId,
        count: events.length,
        events
      });

    } catch (error) {
      logger.error('Failed to get session events', {
        sessionId: req.params?.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      next(error);
    }
  };

  // GET /api/events/:sessionId/recent - Get events since a timestamp
  getRecentEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      const { since } = req.query;

      if (!sessionId) {
        return next(createError.validation('Session ID is required'));
      }

      const sinceDate = since ? new Date(since as string) : new Date(Date.now() - 3600000); // Default: last hour

      const events = await eventService.getRecentEvents(sessionId, sinceDate);

      res.status(HTTP_STATUS.OK).json({
        success: true,
        sessionId,
        since: sinceDate,
        count: events.length,
        events
      });

    } catch (error) {
      logger.error('Failed to get recent events', {
        sessionId: req.params?.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      next(error);
    }
  };
}