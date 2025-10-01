// frontend/client/src/config/api.ts
export const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';

export const API_ENDPOINTS = {
  VALIDATE_TOKEN: `${API_BASE_URL}/api/validate-token`,
  CREATE_SESSION: `${API_BASE_URL}/api/create-session`,
  GET_SESSION: (sessionId: string) => `${API_BASE_URL}/api/session/${sessionId}`,
  VALIDATE_OPERATION: (sessionId: string, operation: string) => 
    `${API_BASE_URL}/api/session/${sessionId}/validate?operation=${operation}`,
  PAUSE_SESSION: (sessionId: string) => `${API_BASE_URL}/api/session/${sessionId}/pause`,
  RESUME_SESSION: (sessionId: string) => `${API_BASE_URL}/api/session/${sessionId}/resume`,
  STOP_SESSION: (sessionId: string) => `${API_BASE_URL}/api/session/${sessionId}/stop`,
  
  GET_EVENTS: (sessionId: string) => `${API_BASE_URL}/api/events/${sessionId}`,
  GET_RECENT_EVENTS: (sessionId: string, since?: string) => 
    `${API_BASE_URL}/api/events/${sessionId}/recent${since ? `?since=${since}` : ''}`,
  GET_RECOVERY_STATUS: (sessionId: string) => `${API_BASE_URL}/api/recovery/${sessionId}`,
  TRIGGER_SWEEP: (sessionId: string) => `${API_BASE_URL}/api/recovery/${sessionId}/sweep`,
};

export const validateSessionOperation = async (sessionId: string, operation: 'pause' | 'resume' | 'stop') => {
  const response = await fetch(API_ENDPOINTS.VALIDATE_OPERATION(sessionId, operation));
  if (!response.ok) {
    throw new Error('Validation request failed');
  }
  return response.json();
};