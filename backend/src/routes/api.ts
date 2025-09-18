import { Router } from 'express';
import { TokenController } from '../controllers/TokenController';
import { SessionController } from '../controllers/SessionController';
import { 
  validateTokenInput, 
  validateSessionInput,
  validateRequest 
} from '../middleware/validation';
import { logger } from '../config/logger';

const router = Router();

// Initialize controllers
const tokenController = new TokenController();
const sessionController = new SessionController();

// Request logging middleware for API routes
router.use((req, res, next) => {
  logger.debug('API request received', {
    method: req.method,
    path: req.path,
    body: req.method !== 'GET' ? req.body : undefined,
    params: req.params,
    query: req.query,
    ip: req.ip
  });
  next();
});

// Token validation routes
router.post('/validate-token', 
  validateRequest,
  validateTokenInput, 
  tokenController.validateToken
);

router.get('/token/health', tokenController.getTokenValidationHealth);

// Session management routes
router.post('/create-session', 
  validateRequest,
  validateSessionInput, 
  sessionController.createSession
);

router.get('/session/:sessionId', sessionController.getSession);

router.get('/session/:sessionId/metrics', sessionController.getSessionMetrics);

router.post('/session/:sessionId/pause', sessionController.pauseSession);

router.post('/session/:sessionId/resume', sessionController.resumeSession);

router.post('/session/:sessionId/stop', sessionController.stopSession);

router.get('/session/:sessionId/validate', sessionController.validateSession);

router.get('/session/health', sessionController.getSessionServiceHealth);

// API health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'WubbaVolumeBot API',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API documentation endpoint
router.get('/docs', (req, res) => {
  res.json({
    success: true,
    api: 'WubbaVolumeBot Backend API',
    version: '1.0.0',
    endpoints: {
      'POST /api/validate-token': {
        description: 'Validate a Solana token contract address for trading',
        body: { contractAddress: 'string' },
        response: 'TokenValidationResponse'
      },
      'POST /api/create-session': {
        description: 'Create a new trading session for a validated token',
        body: { contractAddress: 'string', tokenSymbol: 'string' },
        response: 'SessionCreationResponse'
      },
      'GET /api/session/:sessionId': {
        description: 'Get session details and current status',
        response: 'SessionDetails with trading state and metrics'
      },
      'GET /api/session/:sessionId/metrics': {
        description: 'Get detailed trading metrics for a session',
        response: 'SessionMetrics'
      },
      'POST /api/session/:sessionId/pause': {
        description: 'Pause auto-trading for a session',
        body: { reason: 'string' }
      },
      'POST /api/session/:sessionId/resume': {
        description: 'Resume auto-trading for a paused session'
      },
      'POST /api/session/:sessionId/stop': {
        description: 'Stop auto-trading and complete the session',
        body: { reason: 'string' }
      },
      'GET /api/health': {
        description: 'API health check endpoint'
      }
    }
  });
});

export { router as apiRoutes };