import React, { useState, useEffect, ReactNode } from 'react';
import { useSessionEvents } from '../hooks/useSessionEvents';
import { API_ENDPOINTS } from '@/config/api';
import { toast } from 'react-hot-toast';
import {
  Wallet, Landmark, Rocket, KeyRound, Zap, Hourglass, CheckCircle2, XCircle,
  Trash2, Sparkles, AlertTriangle, BarChartHorizontal, PauseCircle, PlayCircle,
  StopCircle, Flag, Info, ExternalLink, RefreshCw, Copy
} from 'lucide-react';

// Interfaces remain the same
interface SessionEventType {
  id?: string;
  sessionId: string;
  eventType: string;
  eventData?: Record<string, any>;
  status?: 'pending' | 'completed' | 'failed';
  signature?: string;
  errorMessage?: string;
  createdAt?: Date | string;
}

interface SessionData {
  sessionId: string;
  status: string;
  balance?: number;
  metrics?: {
    totalTrades?: number;
    depletionPercentage?: number;
  };
  trading?: {
    tradingStatus?: string;
  };
}

// Replaced emojis with lucide-react icons, corrected Broom to Trash2
const EventIcon = ({ type }: { type: string }) => {
  const iconMap: Record<string, ReactNode> = {
    funding_detected: <Wallet className="text-blue-400" />,
    revenue_transferred: <Landmark className="text-green-400" />,
    trading_started: <Rocket className="text-purple-400" />,
    ephemeral_created: <KeyRound className="text-gray-400" />,
    ephemeral_funded: <Zap className="text-yellow-400" />,
    trade_executing: <Hourglass className="text-cyan-400 animate-spin" />,
    trade_completed: <CheckCircle2 className="text-green-400" />,
    trade_failed: <XCircle className="text-red-400" />,
    sweep_started: <Trash2 className="text-gray-400" />,
    sweep_completed: <Sparkles className="text-yellow-400" />,
    sweep_failed: <AlertTriangle className="text-red-400" />,
    balance_updated: <BarChartHorizontal className="text-cyan-400" />,
    session_paused: <PauseCircle className="text-yellow-400" />,
    session_resumed: <PlayCircle className="text-green-400" />,
    session_stopped: <StopCircle className="text-red-400" />,
    session_completed: <Flag className="text-purple-400" />
  };
  return <div className="w-5 h-5">{iconMap[type] || <Info className="text-gray-400" />}</div>;
};

// Updated StatusBadge with dark theme styles
const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    created: 'bg-gray-500/30 text-gray-300',
    funded: 'bg-blue-500/30 text-blue-300',
    trading: 'bg-green-500/30 text-green-300',
    paused: 'bg-yellow-500/30 text-yellow-300',
    stopped: 'bg-red-500/30 text-red-300',
    completed: 'bg-purple-500/30 text-purple-300'
  };
  
  return (
    <span className={`px-3 py-1 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap ${colors[status] || 'bg-gray-500/30 text-gray-300'}`}>
      {status}
    </span>
  );
};

// Updated EventItem with dark theme
const EventItem = ({ event }: { event: SessionEventType }) => {
  const formatTime = (date: Date | string | undefined) => {
    if (!date) return '';
    return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getEventMessage = (event: SessionEventType) => {
    const { eventType, eventData, status } = event;
    
    switch (eventType) {
      // FUNDING EVENTS
      case 'funding_detected':
        if (status === 'pending') {
          return (
            <div className="space-y-1">
              <p className="text-sm font-medium text-yellow-300">Funding In Progress</p>
              <div className="text-xs text-gray-300">
                <span>Received: </span>
                <span className="font-mono">{eventData?.balance?.toFixed(6)} SOL</span>
                <span className="mx-1">•</span>
                <span>Required: </span>
                <span className="font-mono">{eventData?.required?.toFixed(6)} SOL</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5 mt-1">
                <div 
                  className="bg-yellow-400 h-1.5 rounded-full transition-all"
                  style={{ width: `${eventData?.percentComplete}%` }}
                />
              </div>
              <p className="text-xs text-gray-400">
                {eventData?.percentComplete}% • {eventData?.stillNeeded?.toFixed(6)} SOL needed
              </p>
            </div>
          );
        } else {
          return (
            <div>
              <p className="text-sm font-medium text-green-300">Funding Complete</p>
              <p className="text-xs text-gray-300 mt-0.5">
                Received: <span className="font-mono">{eventData?.balance?.toFixed(6)} SOL</span>
              </p>
            </div>
          );
        }
  
      // TRADING STARTED
      case 'trading_started':
        return (
          <div>
            <p className="text-sm font-medium text-blue-300">Trading Started</p>
            <p className="text-xs text-gray-300 mt-0.5">
              Balance: <span className="font-mono">{eventData?.initialBalance?.toFixed(6)} SOL</span>
            </p>
          </div>
        );
  
      // TRADE COMPLETED
      case 'trade_completed':
        const isBuy = eventData?.type === 'buy';
        return (
          <div>
            <p className="text-sm font-medium text-green-300">
              {isBuy ? 'Buy' : 'Sell'} Trade Completed
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-300 mt-1">
              <div>
                <span className="text-gray-400">In:</span>
                <span className="font-mono ml-1">{eventData?.amountIn?.toFixed(6)}</span>
              </div>
              <div>
                <span className="text-gray-400">Out:</span>
                <span className="font-mono ml-1">{eventData?.amountOut?.toFixed(6)}</span>
              </div>
            </div>
            {eventData?.ephemeralWallet && (
              <p className="text-xs text-gray-400 mt-1 font-mono truncate">
                {eventData.ephemeralWallet.slice(0, 8)}...{eventData.ephemeralWallet.slice(-8)}
              </p>
            )}
          </div>
        );
  
      // TRADE FAILED
      case 'trade_failed':
        return (
          <div>
            <p className="text-sm font-medium text-red-300">
              {eventData?.type === 'buy' ? 'Buy' : 'Sell'} Trade Failed
            </p>
            <p className="text-xs text-red-200 mt-0.5">{eventData?.reason || 'Unknown error'}</p>
            {eventData?.ephemeralWallet && (
              <p className="text-xs text-gray-400 mt-1 font-mono truncate">
                {eventData.ephemeralWallet.slice(0, 8)}...{eventData.ephemeralWallet.slice(-8)}
              </p>
            )}
          </div>
        );
  
      // Hide other events
      default:
        return null;
    }
  };

  const isError = event.status === 'failed' || event.eventType.includes('failed');
  const isSuccess = event.eventType.includes('completed');

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg transition-all ${isError ? 'bg-red-900/40 hover:bg-red-900/60' : isSuccess ? 'bg-green-900/40 hover:bg-green-900/60' : 'bg-gray-800/60 hover:bg-gray-700/60'}`}>
      <div className="flex-shrink-0 mt-0.5">
        <EventIcon type={event.eventType} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-200">
          {getEventMessage(event)}
        </p>
        {event.signature && (
          <a
            href={`https://solscan.io/tx/${event.signature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 font-mono truncate mt-1"
          >
            {event.signature.slice(0, 8)}...{event.signature.slice(-8)}
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
          </a>
        )}
        {event.errorMessage && (
          <p className="text-xs text-red-400 mt-1">{event.errorMessage}</p>
        )}
      </div>
      <div className="flex-shrink-0 text-xs text-gray-400">
        {formatTime(event.createdAt)}
      </div>
    </div>
  );
};

// Main component updated with dark theme and toast functionality
export default function SessionStatusDashboard({ sessionId, session }: { sessionId: string; session: SessionData }) {
  const { events, isConnected } = useSessionEvents({ sessionId });
  const [allEvents, setAllEvents] = useState<SessionEventType[]>([]);
  const [loading, setLoading] = useState(true);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${field} copied to clipboard!`);
  };

  const fetchEvents = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.GET_EVENTS(sessionId));
      const data = await response.json();
      if (data.success) {
        setAllEvents(data.events);
      }
    } catch (error) {
      console.error('Failed to fetch events:', error);
      toast.error("Failed to fetch historical events.");
    } finally {
      setLoading(false);
    }
  };
  
  const handleRefresh = () => {
    fetchEvents();
    toast.success("Activity timeline refreshed!");
  };

  useEffect(() => {
    fetchEvents();
  }, [sessionId]);

  useEffect(() => {
    if (events.length > 0) {
      setAllEvents(prev => {
        const newEvents = events.filter(e => !prev.some(p => p.id === e.id));
        return [...newEvents, ...prev];
      });
    }
  }, [events]);

  if (!sessionId) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-500">No session selected</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Session Header with Copy */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-500'} transition-colors duration-500 ${isConnected ? 'animate-pulse' : ''}`}></div>
            <span className="text-sm font-medium text-gray-200">
              {isConnected ? 'Live Updates Active' : 'Connecting...'}
            </span>
          </div>
          <div className="flex items-center gap-2 bg-gray-900/50 p-1.5 rounded-lg">
              <span className="text-xs font-mono text-gray-400 pl-2">
                  ID: {sessionId.slice(0, 6)}...{sessionId.slice(-6)}
              </span>
              <button
                  onClick={() => copyToClipboard(sessionId, 'Session ID')}
                  className="p-1.5 text-gray-300 hover:bg-gray-700/80 rounded-md transition-colors"
                  aria-label="Copy Session ID"
              >
                  <Copy className="h-4 w-4" />
              </button>
          </div>
        </div>
      </div>

      {/* Session Metrics */}
      {session && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
             <h3 className="text-lg font-semibold text-white">Session Metrics</h3>
             {session && <StatusBadge status={session.status} />}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gray-700/50 p-3 rounded-lg">
              <p className="text-xs text-gray-400 mb-1">Current Balance</p>
              <p className="text-lg font-bold text-cyan-300">{session.balance?.toFixed(4)} SOL</p>
            </div>
            <div className="bg-gray-700/50 p-3 rounded-lg">
              <p className="text-xs text-gray-400 mb-1">Total Trades</p>
              <p className="text-lg font-bold text-white">{session.metrics?.totalTrades || 0}</p>
            </div>
            <div className="bg-gray-700/50 p-3 rounded-lg">
              <p className="text-xs text-gray-400 mb-1">Depletion</p>
              <p className="text-lg font-bold text-white">{session.metrics?.depletionPercentage?.toFixed(1) || 0}%</p>
            </div>
            <div className="bg-gray-700/50 p-3 rounded-lg">
              <p className="text-xs text-gray-400 mb-1">Trading Status</p>
              <p className="text-sm font-medium capitalize text-white">{session.trading?.tradingStatus || 'idle'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Events Timeline */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Activity Timeline</h3>
           <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">{allEvents.length} events</span>
              <button
                  onClick={handleRefresh}
                  disabled={loading}
                  className="p-1.5 text-gray-300 hover:bg-gray-700/80 rounded-md transition-colors disabled:opacity-50"
                  aria-label="Refresh Timeline"
              >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
        </div>
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
          </div>
        ) : allEvents.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No events yet. Waiting for activity...</p>
          </div>
        ) : (
          allEvents
            .filter(e => 
              e.eventType === 'funding_detected' ||
              e.eventType === 'trading_started' ||
              e.eventType === 'trade_completed' ||
              e.eventType === 'trade_failed'
            )
            .map((event, index) => <EventItem key={event.id || index} event={event} />)
        )}
        </div>
      </div>
    </div>
  );
}