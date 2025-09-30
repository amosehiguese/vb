import { useState, useEffect } from 'react';
import { validateSessionOperation } from '@/config/api';

// Operation Validation Hook
export const useOperationValidation = (sessionId: string) => {
  const [validations, setValidations] = useState<Record<string, any>>({});
  const [isValidating, setIsValidating] = useState(false);

  const validateOperation = async (operation: 'pause' | 'resume' | 'stop') => {
    try {
      setIsValidating(true);
      const result = await validateSessionOperation(sessionId, operation);
      setValidations(prev => ({ ...prev, [operation]: result.validation }));
      return result.validation;
    } catch (error) {
      console.error(`Validation failed for ${operation}:`, error);
      return null;
    } finally {
      setIsValidating(false);
    }
  };

  const validateAllOperations = async () => {
    if (!sessionId) return;
    
    setIsValidating(true);
    try {
      const operations: ('pause' | 'resume' | 'stop')[] = ['pause', 'resume', 'stop'];
      const promises = operations.map(op => validateOperation(op));
      await Promise.all(promises);
    } finally {
      setIsValidating(false);
    }
  };

  return { 
    validations, 
    validateOperation, 
    validateAllOperations, 
    isValidating 
  };
};