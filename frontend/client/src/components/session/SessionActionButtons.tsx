import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Play, Pause, Square, BarChart3, CheckCircle, XCircle } from 'lucide-react';
import { BalanceStatus } from './BalanceStatus';
import { useOperationValidation } from '@/hooks/use-session-operations';
import { handleApiError } from '@/lib/errors';

interface SessionActionButtonsProps {
  sessionData: any;
  tradingState: any;
  mutations: any;
  balance: number;
}

export const SessionActionButtons = ({ 
  sessionData, 
  tradingState, 
  mutations,
  balance 
}: SessionActionButtonsProps) => {
  const { validations, validateAllOperations } = useOperationValidation(sessionData.sessionId);

  // Validate operations when component mounts or balance changes
  useEffect(() => {
    if (sessionData.sessionId) {
      validateAllOperations();
    }
  }, [sessionData.sessionId, balance, tradingState.isPaused]);

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

  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardHeader>
        <CardTitle className="text-lg text-white flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Session Controls
        </CardTitle>
        <CardDescription className="text-gray-400">
          Manage your trading session
        </CardDescription>
      </CardHeader>
      <CardContent>
        <BalanceStatus balance={balance} sessionStatus={sessionData.status} />
        
        <div className="mt-4 flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
          <Button 
            onClick={() => mutations.resume.mutate()} 
            disabled={resumeState.disabled || mutations.resume.isPending} 
            className="bg-green-600 hover:bg-green-700 w-full sm:w-auto text-sm disabled:opacity-50"
            title={resumeState.tooltip}
          >
            <Play className="mr-2 h-4 w-4" /> 
            {mutations.resume.isPending ? 'Resuming...' : 'Resume'}
          </Button>
          
          <Button 
            onClick={() => mutations.pause.mutate()} 
            disabled={pauseState.disabled || mutations.pause.isPending} 
            className="bg-yellow-600 hover:bg-yellow-700 w-full sm:w-auto text-sm disabled:opacity-50"
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
        
        {/* Operation Status Indicators */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          {['pause', 'resume', 'stop'].map((op) => {
            const validation = validations[op];
            if (!validation) return null;
            
            const canProceed = validation.canProceed;
            return (
              <div key={op} className={`flex items-center gap-1 ${canProceed ? 'text-green-400' : 'text-red-400'}`}>
                {canProceed ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                <span className="capitalize">{op}</span>
              </div>
            );
          })}
        </div>
        
        {/* Helper text */}
        <div className="mt-4 text-xs text-gray-500 space-y-1">
          <p>• Resume: Restart paused trading (requires sufficient balance)</p>
          <p>• Pause: Temporarily stop trading (can be resumed later)</p>
          <p>• Stop: Permanently end the session (cannot be undone)</p>
        </div>
      </CardContent>
    </Card>
  );
};