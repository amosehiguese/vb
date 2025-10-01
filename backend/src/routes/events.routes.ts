import { Router } from 'express';
import { EventsController } from '../controllers/EventsController';

const router = Router();
const eventsController = new EventsController();

router.get('/:sessionId', eventsController.getSessionEvents);
router.get('/:sessionId/recent', eventsController.getRecentEvents);

export default router;