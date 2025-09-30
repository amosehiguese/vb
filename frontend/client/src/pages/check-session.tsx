import { useState } from 'react';
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_ENDPOINTS } from '@/config/api';
import { handleApiError } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Search, Play, Pause, Square, AlertCircle, Copy, BarChart3, ArrowLeft, RefreshCw } from 'lucide-react';
import { EnhancedSessionControls } from '@/components/session/EnhancedSessionControls';
import { toast } from "react-hot-toast";

const fetchSession = async (sessionId: string) => {
  if (!sessionId) return null;
  const res = await fetch(API_ENDPOINTS.GET_SESSION(sessionId));

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Session not found or an error occurred.' }));
    throw new Error(errorData.error || 'Session not found or an error occurred.');
  }
  return res.json();
};

export default function CheckSessionPage() {
  const [match, params] = useRoute("/check-session/:sessionId");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  const [sessionId, setSessionId] = useState(params?.sessionId || '');
  const [inputValue, setInputValue] = useState(params?.sessionId || '');

  const { data, isLoading, error, refetch, isError } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
    refetchOnWindowFocus: false,
    retry: false,
    enabled: false, 
  });

  const handleSessionCheck = (e: React.FormEvent) => {
    e.preventDefault();
    const newSessionId = inputValue.trim();
    if (newSessionId) {
      setLocation(`/check-session/${newSessionId}`);
      setSessionId(newSessionId);
      refetch();
    }
  };

  // Enhanced mutation options with better error handling
  const mutationOptions = {
    onSuccess: (response: any, variables: any, context: any) => {
      // Determine action type from context or response
      const action = context?.action || 'action';
      
      switch (action) {
        case 'resume':
          toast.success("✅ Session resumed successfully!");
          break;
        case 'pause':
          toast.success("⏸️ Session paused successfully!");
          break;
        case 'stop':
          toast.success("🛑 Session stopped successfully!");
          break;
        default:
          toast.success("Action completed successfully!");
      }
      
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    },
    onError: (error: Error, variables: any, context: any) => {
      const action = context?.action || 'perform action';
      const errorInfo = handleApiError(error.message, action);
      
      toast.error(errorInfo.title, {
        duration: errorInfo.duration,
      });
      
      // Show additional details in a second toast if available
      if (errorInfo.suggestion) {
        setTimeout(() => {
          toast(errorInfo.suggestion, {
            duration: errorInfo.duration - 2000,
            icon: '💡'
          });
        }, 1000);
      }
    },
  };

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(API_ENDPOINTS.RESUME_SESSION(sessionId), { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Resume failed' }));
        throw new Error(JSON.stringify(errorData));
      }
      return response;
    },
    ...mutationOptions,
    onSuccess: (data, variables, context) => {
      mutationOptions.onSuccess(data, variables, { ...(context || {}), action: 'resume' });
    },
    onError: (error, variables, context) => {
      mutationOptions.onError(error, variables, { ...(context || {}), action: 'resume' });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(API_ENDPOINTS.PAUSE_SESSION(sessionId), { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Pause failed' }));
        throw new Error(JSON.stringify(errorData));
      }
      return response;
    },
    ...mutationOptions,
    onSuccess: (data, variables, context) => {
      mutationOptions.onSuccess(data, variables, { ...(context || {}), action: 'pause' });
    },
    onError: (error, variables, context) => {
      mutationOptions.onError(error, variables, { ...(context || {}), action: 'pause' });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(API_ENDPOINTS.STOP_SESSION(sessionId), { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Stop failed' }));
        throw new Error(JSON.stringify(errorData));
      }
      return response;
    },
    ...mutationOptions,
    onSuccess: (data, variables, context) => {
      mutationOptions.onSuccess(data, variables, { ...(context || {}), action: 'stop' });
    },
    onError: (error, variables, context) => {
      mutationOptions.onError(error, variables, { ...(context || {}), action: 'stop' });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  const sessionData = data?.session;
  const metrics = data?.metrics;
  const tradingState = data?.trading;

  return (
    <div className="container mx-auto max-w-4xl p-4 sm:p-6">
      <Card className="bg-gray-900/80 border-cyan-500/30 backdrop-blur-sm">
        <CardHeader className="pb-4">
            <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
                <CardTitle className="text-cyan-300 flex items-center gap-2 text-lg sm:text-xl">
                    <Search className="w-5 h-5 sm:w-6 sm:h-6" />
                    Check Trading Session
                </CardTitle>
                <div className="flex gap-2">
                    <Button
                    size="sm"
                    className="bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-600 hover:to-emerald-600 text-xs sm:text-sm"
                    onClick={() => setLocation("/")}
                    >
                    <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                    Back
                    </Button>
                    <Button
                    size="sm"
                    className="bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-600 hover:to-emerald-600 text-xs sm:text-sm"
                    onClick={() => refetch()}
                    disabled={isLoading}
                    >
                    <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
                    Refresh
                    </Button>
                </div>
            </div>
          <CardDescription className="text-gray-400 text-sm sm:text-base">
            Enter your Session ID to view live metrics and manage your volume bot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSessionCheck} className="flex flex-col sm:flex-row gap-3 mb-6">
            <Input
              id="sessionIdInput"
              placeholder="Enter your Session ID..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="bg-gray-800 border-gray-600 text-white placeholder-gray-400 text-sm sm:text-base"
            />
            <Button 
              type="submit" 
              disabled={isLoading} 
              className="bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-600 hover:to-emerald-600 whitespace-nowrap text-sm sm:text-base"
            >
              {isLoading ? 'Loading...' : 'Check Status'}
            </Button>
          </form>

          {isError && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm sm:text-base">
                {(error as Error).message}
              </AlertDescription>
            </Alert>
          )}

          {data && sessionData && (
            <div className="space-y-4 sm:space-y-6 animate-in fade-in-50">
              <Card className="bg-gray-800/50 border-gray-700">
                <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <CardTitle className="text-lg sm:text-xl text-white">Session Overview</CardTitle>
                  <Badge 
                    variant={sessionData.status === 'trading' ? 'default' : 'secondary'} 
                    className={`${sessionData.status === 'trading' ? 'bg-green-500/80' : 'bg-gray-600/80'} text-xs text-white sm:text-sm`}
                  >
                    {sessionData.status.toUpperCase()}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4">
                  <div className="grid grid-cols-1 gap-3 text-xs sm:text-sm">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 sm:gap-2">
                      <span className="text-gray-400">Session ID:</span>
                      <span className="font-mono text-cyan-300 flex items-center gap-2 break-all">
                        <span className="hidden sm:inline">{sessionData.sessionId}</span>
                        <span className="sm:hidden">{sessionData.sessionId.slice(0, 20)}...</span>
                        <Copy 
                          className="h-3 w-3 sm:h-4 sm:w-4 cursor-pointer hover:text-white flex-shrink-0" 
                          onClick={() => copyToClipboard(sessionData.sessionId)} 
                        />
                      </span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 sm:gap-2">
                      <span className="text-gray-400">Token:</span>
                      <span className="font-semibold text-white">{sessionData.tokenSymbol}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Enhanced Session Controls - replaces the original controls */}
              <EnhancedSessionControls 
                sessionData={sessionData}
                tradingState={tradingState}
                mutations={{ resume: resumeMutation, pause: pauseMutation, stop: stopMutation }}
              />

              {/* Keep your existing metrics section exactly as is */}
              {metrics && tradingState && (
                <Card className="bg-gray-800/50 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-lg sm:text-xl text-white flex items-center gap-2">
                      <BarChart3 className="w-5 h-5" />
                      Trading Metrics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-center">
                      <div className="p-3 bg-gray-700/50 rounded-lg">
                        <p className="text-xs text-gray-400">Total Trades</p>
                        <p className="text-lg sm:text-xl font-bold text-white">{metrics.totalTrades}</p>
                      </div>
                      <div className="p-3 bg-gray-700/50 rounded-lg">
                        <p className="text-xs text-gray-400">Trading Balance</p>
                        <p className="text-lg sm:text-xl font-bold text-yellow-400">
                          {metrics.currentBalance.toFixed(4)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}