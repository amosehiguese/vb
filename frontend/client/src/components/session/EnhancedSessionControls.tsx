import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Play, Pause, Square, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { BalanceStatus } from './BalanceStatus';
import { useOperationValidation } from '@/hooks/use-session-operations';
import { handleApiError } from '@/lib/errors';

interface EnhancedSessionControlsProps {
  sessionData: any;
  tradingState: any;
  mutations: any;
}

export const EnhancedSessionControls = ({ 
  sessionData, 
  tradingState, 
  mutations 
}: EnhancedSessionControlsProps) => {
  const { validations, validateAllOperations } = useOperationValidation(sessionData.sessionId);

  // Validate operations when component mounts or relevant data changes
  useEffect(() => {
    if (sessionData.sessionId) {
      validateAllOperations();
    }
  }, [sessionData.sessionId, sessionData.balance, tradingState.isPaused]);

  const getButtonState = (operation: 'pause' | 'resume' | 'stop') => {
    const validation = validations[operation];
    if (!validation) return { disabled: true, tooltip: 'Checking...' };

    if (!validation.canProceed && validation.error) {
      const errorInfo = handleApiError(validation.error, operation);
      return { 
        disabled: true, 
        tooltip: `${errorInfo.message} ${errorInfo.suggestion}` 
      };
    }

    return { disabled: false, tooltip: undefined };
  };

  const pauseState = getButtonState('pause');
  const resumeState = getButtonState('resume');
  const stopState = getButtonState('stop');

  // Show controls only if session is not completed/stopped
  if (sessionData.status === 'completed' || sessionData.status === 'stopped') {
    return null;
  }

  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardHeader>
        <CardTitle className="text-lg sm:text-xl text-white">Session Controls</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Balance Status - matches your existing info layout */}
        <div className="space-y-3 sm:space-y-4 mb-6">
          <div className="grid grid-cols-1 gap-3 text-xs sm:text-sm">
            <BalanceStatus balance={sessionData.balance || 0} sessionStatus={sessionData.status} />
          </div>
        </div>

        {/* Action Buttons - matches your existing button layout */}
        <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 mb-4">
          <Button 
            onClick={() => mutations.resume.mutate()} 
            disabled={resumeState.disabled || mutations.resume.isPending} 
            className="bg-green-600 hover:bg-green-700 w-full sm:w-auto text-sm"
            title={resumeState.tooltip}
          >
            <Play className="mr-2 h-4 w-4" /> 
            {mutations.resume.isPending ? 'Resuming...' : 'Resume'}
          </Button>
          
          <Button 
            onClick={() => mutations.pause.mutate()} 
            disabled={pauseState.disabled || mutations.pause.isPending} 
            className="bg-yellow-600 hover:bg-yellow-700 w-full sm:w-auto text-sm"
            title={pauseState.tooltip}
          >
            <Pause className="mr-2 h-4 w-4" /> 
            {mutations.pause.isPending ? 'Pausing...' : 'Pause'}
          </Button>
          
          <Button 
            onClick={() => mutations.stop.mutate()} 
            disabled={stopState.disabled || mutations.stop.isPending} 
            variant="destructive"
            className="w-full sm:w-auto text-sm"
            title={stopState.tooltip}
          >
            <Square className="mr-2 h-4 w-4" /> 
            {mutations.stop.isPending ? 'Stopping...' : 'Stop Session'}
          </Button>
        </div>
        
        {/* Operation Status - matches your metric card style */}
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { op: 'pause', label: 'Pause' },
            { op: 'resume', label: 'Resume' }, 
            { op: 'stop', label: 'Stop' }
          ].map(({ op, label }) => {
            const validation = validations[op];
            if (!validation) {
              return (
                <div key={op} className="p-2 bg-gray-700/50 rounded-lg">
                  <div className="flex items-center justify-center gap-1 text-gray-500">
                    <AlertTriangle className="h-3 w-3" />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{label}</p>
                </div>
              );
            }
            
            const canProceed = validation.canProceed;
            return (
              <div key={op} className="p-2 bg-gray-700/50 rounded-lg">
                <div className={`flex items-center justify-center gap-1 ${canProceed ? 'text-green-400' : 'text-red-400'}`}>
                  {canProceed ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                </div>
                <p className="text-xs text-gray-400 mt-1">{label}</p>
              </div>
            );
          })}
        </div>

        {/* Helper text - matches your existing text styling */}
        <div className="mt-4 text-xs text-gray-500 space-y-1">
          <p>• Resume: Restart paused trading (requires sufficient balance)</p>
          <p>• Pause: Temporarily stop trading (can be resumed later)</p>
          <p>• Stop: Permanently end the session (cannot be undone)</p>
        </div>
      </CardContent>
    </Card>
  );
};