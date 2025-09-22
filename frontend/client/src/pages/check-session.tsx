import { useState } from 'react';
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_ENDPOINTS } from '@/config/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Search, Play, Pause, Square, AlertCircle, Copy, BarChart3, ArrowLeft, RefreshCw } from 'lucide-react';
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

  const mutationOptions = {
    onSuccess: () => {
      toast.success("Action sent successfully! Session state will update shortly.");
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  };

  const resumeMutation = useMutation({
    mutationFn: () => fetch(API_ENDPOINTS.RESUME_SESSION(sessionId), { method: 'POST' }),
    ...mutationOptions,
  });

  const pauseMutation = useMutation({
    mutationFn: () => fetch(API_ENDPOINTS.PAUSE_SESSION(sessionId), { method: 'POST' }),
    ...mutationOptions,
  });

  const stopMutation = useMutation({
    mutationFn: () => fetch(API_ENDPOINTS.STOP_SESSION(sessionId), { method: 'POST' }),
    ...mutationOptions,
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
                    onClick={() => setLocation("/")} // go back home
                    >
                    <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                    Back
                    </Button>
                    <Button
                    size="sm"
                    className="bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-600 hover:to-emerald-600 text-xs sm:text-sm"
                    onClick={() => refetch()} // trigger manual refresh
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
                    <div className="flex flex-col gap-1">
                      <span className="text-gray-400">Trading Wallet:</span>
                      <span className="font-mono text-cyan-300 flex items-center gap-2 break-all text-xs">
                          {sessionData.walletAddress}
                          <Copy 
                            className="h-3 w-3 sm:h-4 sm:w-4 cursor-pointer hover:text-white flex-shrink-0" 
                            onClick={() => copyToClipboard(sessionData.walletAddress)} 
                          />
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {metrics && (
                <Card className="bg-gray-800/50 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-lg sm:text-xl text-white flex items-center gap-2">
                      <BarChart3 className="text-emerald-400 w-5 h-5" /> 
                      Live Metrics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-xs sm:text-sm mb-2">
                        <span className="text-gray-400">Fund Depletion Progress</span>
                        <span className="font-semibold text-yellow-300">
                          {metrics.depletionPercentage.toFixed(2)}% of 75% Target
                        </span>
                      </div>
                      <Progress value={(metrics.depletionPercentage / 75) * 100} className="h-2" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
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
                      <div className="p-3 bg-gray-700/50 rounded-lg">
                        <p className="text-xs text-gray-400">Initial Balance</p>
                        <p className="text-lg sm:text-xl font-bold text-gray-300">
                          {metrics.initialBalance.toFixed(4)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {tradingState && sessionData.status !== 'completed' && sessionData.status !== 'stopped' && (
                <Card className="bg-gray-800/50 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-lg sm:text-xl text-white">Session Controls</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
                      <Button 
                        onClick={() => resumeMutation.mutate()} 
                        disabled={resumeMutation.isPending} 
                        className="bg-green-600 hover:bg-green-700 w-full sm:w-auto text-sm"
                      >
                        <Play className="mr-2 h-4 w-4" /> Resume
                      </Button>
                      <Button 
                        onClick={() => pauseMutation.mutate()} 
                        disabled={tradingState.isPaused || !tradingState.isActive || pauseMutation.isPending} 
                        className="bg-yellow-600 hover:bg-yellow-700 w-full sm:w-auto text-sm"
                      >
                        <Pause className="mr-2 h-4 w-4" /> Pause
                      </Button>
                      <Button 
                        onClick={() => stopMutation.mutate()} 
                        disabled={stopMutation.isPending} 
                        variant="destructive"
                        className="w-full sm:w-auto text-sm"
                      >
                        <Square className="mr-2 h-4 w-4" /> Stop Session
                      </Button>
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