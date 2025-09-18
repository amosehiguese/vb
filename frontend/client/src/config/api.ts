export const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

export const API_ENDPOINTS = {
  VALIDATE_TOKEN: `${API_BASE_URL}/api/validate-token`,
  CREATE_SESSION: `${API_BASE_URL}/api/create-session`,
  GET_SESSION: (sessionId: string) => `${API_BASE_URL}/api/session/${sessionId}`,
  PAUSE_SESSION: (sessionId: string) => `${API_BASE_URL}/api/session/${sessionId}/pause`,
  RESUME_SESSION: (sessionId: string) => `${API_BASE_URL}/api/session/${sessionId}/resume`,
  STOP_SESSION: (sessionId: string) => `${API_BASE_URL}/api/session/${sessionId}/stop`,
};

