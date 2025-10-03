import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '@/config/api';
import { toast } from "react-hot-toast";
import { RefreshCw, Copy, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

// Interfaces remain the same
interface EphemeralWallet {
  address: string;
  status: string;
  balance: number;
  sweepAttempts: number;
  lastSweepAttempt?: string;
  sweepError?: string;
  needsRecovery: boolean;
}

interface RecoveryStatus {
  success: boolean;
  sessionId: string;
  vaultAddress: string;
  ephemeralWallets: EphemeralWallet[];
  summary: {
    total: number;
    swept: number;
    needsRecovery: number;
    totalStrandedBalance: number;
  };
}

interface SweepResult {
  address: string;
  success: boolean;
  message?: string;
  error?: string;
}

interface SweepResults {
  success: boolean;
  sessionId?: string;
  summary?: {
    total: number;
    succeeded: number;
    failed: number;
  };
  results?: SweepResult[];
  error?: string;
}


export default function RecoveryDashboard({ sessionId }: { sessionId: string }) {
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [sweepResults, setSweepResults] = useState<SweepResults | null>(null);

  const fetchRecoveryStatus = async () => {
    if (!sessionId) return;
    
    setLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.GET_RECOVERY_STATUS(sessionId));
      const data = await response.json();
      if (data.success) {
        setRecoveryStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch recovery status:', error);
      toast.error("Failed to fetch recovery status.");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchRecoveryStatus();
    toast.success("Refreshing recovery status...");
  };

  const triggerManualSweep = async () => {
    if (!sessionId) return;
    
    setSweeping(true);
    setSweepResults(null);
    try {
      const response = await fetch(API_ENDPOINTS.TRIGGER_SWEEP(sessionId), {
        method: 'POST'
      });
      const data: SweepResults = await response.json();
      setSweepResults(data);
      if (data.success) {
        toast.success(`Sweep complete! Recovered ${data.summary?.succeeded || 0} wallet(s).`);
      } else {
        toast.error(data.error || "Sweep failed. Please check details.");
      }
      // Refresh status after sweep
      setTimeout(fetchRecoveryStatus, 2000);
    } catch (error) {
      console.error('Failed to trigger sweep:', error);
      const errorMessage = 'Failed to connect to the server for sweep.';
      setSweepResults({ success: false, error: errorMessage });
      toast.error(errorMessage);
    } finally {
      setSweeping(false);
    }
  };

  useEffect(() => {
    if (sessionId) {
      fetchRecoveryStatus();
    }
  }, [sessionId]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${field} copied to clipboard!`);
  };

  if (!sessionId) {
    return null;
  }

  const hasStrandedFunds = (recoveryStatus?.summary?.needsRecovery ?? 0) > 0;
  
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 sm:p-6 text-gray-200">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <h3 className="text-lg font-semibold text-white">Fund Recovery</h3>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs sm:text-sm bg-gray-700/80 hover:bg-gray-600/80 text-cyan-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Checking...' : 'Refresh'}
        </button>
      </div>

      {loading && !recoveryStatus ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
        </div>
      ) : recoveryStatus ? (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-700/50 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Total Wallets</p>
              <p className="text-2xl font-bold text-white">{recoveryStatus.summary.total}</p>
            </div>
            <div className="bg-green-900/50 rounded-lg p-4">
              <p className="text-xs text-green-300/80 mb-1">Swept</p>
              <p className="text-2xl font-bold text-green-400">{recoveryStatus.summary.swept}</p>
            </div>
            <div className="bg-yellow-900/50 rounded-lg p-4">
              <p className="text-xs text-yellow-300/80 mb-1">Needs Recovery</p>
              <p className="text-2xl font-bold text-yellow-400">{recoveryStatus.summary.needsRecovery}</p>
            </div>
            <div className="bg-blue-900/50 rounded-lg p-4">
              <p className="text-xs text-blue-300/80 mb-1">Stranded Balance</p>
              <p className="text-2xl font-bold text-blue-400">{recoveryStatus.summary.totalStrandedBalance?.toFixed(4)} SOL</p>
            </div>
          </div>

          {/* Alert if stranded funds found */}
          {hasStrandedFunds && (
            <div className="bg-yellow-900/50 border border-yellow-700/60 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-6 w-6 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-yellow-300 mb-1">Stranded Funds Detected</h4>
                  <p className="text-sm text-yellow-300/90 mb-3">
                    {recoveryStatus.summary.needsRecovery} wallet(s) have funds that need to be swept to your vault.
                  </p>
                  <button
                    onClick={triggerManualSweep}
                    disabled={sweeping}
                    className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sweeping ? (
                      <span className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Sweeping...
                      </span>
                    ) : (
                      'Recover Funds Now'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sweep Results */}
          {sweepResults && (
            <div className={`border rounded-lg p-4 ${sweepResults.success ? 'bg-green-900/50 border-green-700/60' : 'bg-red-900/50 border-red-700/60'}`}>
              <div className="flex items-start gap-3">
                {sweepResults.success ? <CheckCircle2 className="h-6 w-6 text-green-400 flex-shrink-0" /> : <XCircle className="h-6 w-6 text-red-400 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <h4 className={`font-semibold mb-2 ${sweepResults.success ? 'text-green-300' : 'text-red-300'}`}>
                    {sweepResults.success ? 'Sweep Completed' : 'Sweep Failed'}
                  </h4>
                  {sweepResults.summary && (
                    <div className="space-y-2 text-sm">
                      <p className={sweepResults.success ? 'text-green-300/90' : 'text-red-300/90'}>
                        Successfully recovered: {sweepResults.summary.succeeded} / {sweepResults.summary.total} wallets
                      </p>
                      {sweepResults.results && (
                        <div className="space-y-1 mt-3 max-h-40 overflow-y-auto pr-2">
                          {sweepResults.results.map((result, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-xs">
                              {result.success ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                              <span className="font-mono text-gray-400">{result.address.slice(0, 8)}...{result.address.slice(-6)}</span>
                              <span className="text-gray-300 truncate">{result.message || result.error}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {sweepResults.error && <p className="text-sm text-red-300/90">{sweepResults.error}</p>}
                </div>
              </div>
            </div>
          )}

          {/* Trading Wallets List */}
          <div>
            <h4 className="font-semibold text-white mb-3">Trading Wallets</h4>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
              {recoveryStatus.ephemeralWallets.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No trading wallets found</p>
              ) : (
                recoveryStatus.ephemeralWallets.map((wallet, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 rounded-lg border ${
                      wallet.needsRecovery 
                        ? 'bg-yellow-900/40 border-yellow-700/50' 
                        : wallet.status === 'swept' 
                        ? 'bg-green-900/40 border-green-700/50' 
                        : 'bg-gray-700/40 border-gray-600/50'
                    }`}
                  >
                    <div className="flex-1 min-w-0 mb-2 sm:mb-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-mono text-gray-400 truncate">
                          {wallet.address}
                        </span>
                        <span className={`px-2 py-0.5 text-xs rounded-full whitespace-nowrap ${
                          wallet.status === 'swept' ? 'bg-green-500/30 text-green-300' 
                          : wallet.status === 'funded' ? 'bg-yellow-500/30 text-yellow-300'
                          : 'bg-gray-500/30 text-gray-300'
                        }`}>
                          {wallet.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>Balance: {wallet.balance?.toFixed(6)} SOL</span>
                        {wallet.sweepAttempts > 0 && <span>Attempts: {wallet.sweepAttempts}</span>}
                      </div>
                      {wallet.sweepError && <p className="text-xs text-red-400 mt-1 truncate">{wallet.sweepError}</p>}
                    </div>
                    {wallet.needsRecovery && <AlertTriangle className="text-yellow-500 h-5 w-5 ml-auto sm:ml-2 flex-shrink-0"/>}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Vault Info */}
          <div className="bg-blue-900/50 border border-blue-700/60 rounded-lg p-4">
            <h4 className="font-semibold text-blue-300 mb-2">Vault Address</h4>
            <div className="flex items-center gap-3">
              <code className="text-sm font-mono text-blue-300/90 break-all">{recoveryStatus.vaultAddress}</code>
              <button
                onClick={() => copyToClipboard(recoveryStatus.vaultAddress, 'Vault Address')}
                className="p-2 text-blue-300 bg-blue-500/20 hover:bg-blue-500/40 rounded-md transition-colors"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-center text-gray-500 py-4">Unable to load recovery status for this session.</p>
      )}
    </div>
  );
}