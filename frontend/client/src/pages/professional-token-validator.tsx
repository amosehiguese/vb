import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { API_ENDPOINTS } from '@/config/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Search, Wallet, CheckCircle, XCircle, Copy, Info, TrendingUp, Key, Shield } from 'lucide-react';
import { toast } from 'react-hot-toast'; 

// Funding tier configurations
const FUNDING_TIERS = [
  {
    name: 'micro',
    label: 'Micro',
    minFunding: 0.01,
    maxFunding: 0.09,
    buyPercentageMin: 0.3,
    buyPercentageMax: 0.8,
    sellPercentageMin: 5,
    sellPercentageMax: 15,
    maxBuyUSD: 0.10,
    estimatedTrades: '1,500-2,000',
    duration: '1-2.5 hours',
    recommended: true
  },
  {
    name: 'small',
    label: 'Small',
    minFunding: 0.1,
    maxFunding: 0.9,
    buyPercentageMin: 0.1,
    buyPercentageMax: 0.5,
    sellPercentageMin: 2,
    sellPercentageMax: 8,
    maxBuyUSD: 0.50,
    estimatedTrades: '3,000-8,000',
    duration: '2-6 hours'
  },
  {
    name: 'standard',
    label: 'Standard',
    minFunding: 1.0,
    maxFunding: 9.0,
    buyPercentageMin: 0.02,
    buyPercentageMax: 0.15,
    sellPercentageMin: 1,
    sellPercentageMax: 5,
    maxBuyUSD: 0.50,
    estimatedTrades: '5,000-15,000',
    duration: '4-12 hours'
  },
  {
    name: 'high',
    label: 'High Volume',
    minFunding: 10.0,
    maxFunding: 100000.0,
    buyPercentageMin: 0.005,
    buyPercentageMax: 0.03,
    sellPercentageMin: 0.5,
    sellPercentageMax: 2,
    maxBuyUSD: 0.50,
    estimatedTrades: '10,000+',
    duration: '8-24+ hours'
  }
];

export default function ProfessionalTokenValidator() {
  const [step, setStep] = useState(1);
  const [contractAddress, setContractAddress] = useState('');
  const [selectedTier, setSelectedTier] = useState('micro');
  const [validationResult, setValidationResult] = useState<any>(null);
  const [sessionResult, setSessionResult] = useState<any>(null);
  const walletRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateTokenMutation = useMutation({
    mutationFn: async (address: string) => {
      const response = await fetch(API_ENDPOINTS.VALIDATE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: address })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (data.error?.includes('timeout') || data.error?.includes('ETIMEDOUT')) {
          throw new Error('API timeout - please try again. The token may still be valid.');
        }
        throw new Error(data.error || 'Validation failed');
      }
      return data;
    },
    onSuccess: (data) => setValidationResult(data),
    onError: (error: Error) => {
      console.error('Validation error:', error);
      toast.error(error.message.includes('timeout') 
        ? "API timeout occurred. You can try again or proceed with session creation."
        : error.message
      );
    },
  });

  const createSessionMutation = useMutation({
    mutationFn: async ({ contractAddress, tokenSymbol, fundingTierName }: {
      contractAddress: string;
      tokenSymbol: string;
      fundingTierName: string;
    }) => {
      const response = await fetch(API_ENDPOINTS.CREATE_SESSION, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress, tokenSymbol, fundingTierName }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Session creation failed');
      return data;
    },
    onSuccess: (data) => {
      setSessionResult(data);
      setStep(2);
    },
    
    onError: (error: Error) => toast.error(error.message),
  });
  

  const handleReset = () => {
    setStep(1);
    setContractAddress('');
    setSelectedTier('micro');
    setValidationResult(null);
    setSessionResult(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
  
      if (validateTokenMutation.isPending || !contractAddress.trim()) {
        return;
      }
      
      validateTokenMutation.mutate(contractAddress);
    }
  };
  
  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${field} copied to clipboard!`);
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="container mx-auto max-w-4xl p-4 sm:p-6">
      {/* Main Content - Centered */}
      <div className="relative z-10">
        {/* Centered Header */}
        <div className="text-center mb-6 sm:mb-8">
          <p className="text-gray-300 max-w-3xl mx-auto text-base sm:text-lg leading-relaxed px-4">
            Validate any Solana token and start volume generation with real DEX trades visible on all charts
          </p>
        </div>
      </div>

      {step === 1 && (
        <Card className="mb-6 sm:mb-8 bg-gray-900/80 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-cyan-300 flex items-center gap-2 text-lg sm:text-xl">
                <Search className="w-5 h-5" />
                Step 1: Validate Token Contract
              </CardTitle>
              <CardDescription className="text-gray-400 text-sm sm:text-base">
                Enter any Solana token contract address to verify its validity and trading pools
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 sm:space-y-6">
                <div className="flex flex-col sm:flex-row gap-3">
                  <Input
                    ref={inputRef} 
                    placeholder="Enter Solana token contract address..."
                    value={contractAddress}
                    onChange={(e) => setContractAddress(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="bg-gray-800 border-gray-600 text-white placeholder-gray-400 text-sm sm:text-base"
                    data-testid="input-contract-address"
                  />
                  <Button
                    onClick={() => validateTokenMutation.mutate(contractAddress)}
                    disabled={validateTokenMutation.isPending || !contractAddress.trim()}
                    className="bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-600 hover:to-emerald-600 w-full sm:w-auto whitespace-nowrap"
                    data-testid="button-validate-token"
                  >
                    {validateTokenMutation.isPending ? (
                      <>
                        <Search className="w-4 h-4 mr-2 animate-spin" />
                        Validating...
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4 mr-2" />
                        Validate
                      </>
                    )}
                  </Button>
                </div>

                {/* Funding Tier Selection */}
                {validationResult?.success && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-white font-semibold mb-3 text-sm sm:text-base">Select Funding Tier</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        {FUNDING_TIERS.map(tier => (
                          <div 
                            key={tier.name}
                            className={`cursor-pointer transition-all duration-200 p-3 sm:p-4 rounded-lg border-2 ${
                              selectedTier === tier.name 
                                ? 'border-emerald-500 bg-emerald-900/20' 
                                : 'border-gray-600 bg-gray-800/50 hover:border-emerald-500/50'
                            } ${tier.recommended ? 'border-emerald-500/30' : ''}`}
                            onClick={() => setSelectedTier(tier.name)}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 sm:mb-3">
                              <div className="mb-2 sm:mb-0">
                                <h4 className="text-white font-semibold text-sm sm:text-base">{tier.label}</h4>
                                <p className="text-gray-400 text-xs sm:text-sm">
                                  {tier.minFunding}-{tier.maxFunding} SOL
                                </p>
                              </div>
                              {tier.recommended && (
                                <Badge className="bg-emerald-500/20 text-emerald-400 px-2 py-1 text-xs font-medium self-start">
                                  Recommended
                                </Badge>
                              )}
                            </div>
                            
                            <div className="space-y-1 sm:space-y-2 text-xs sm:text-sm">
                              <div className="flex items-center text-gray-300">
                                <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 mr-2 text-emerald-400" />
                                <span>{tier.estimatedTrades} trades</span>
                              </div>
                              <div className="flex items-center text-gray-300">
                                <Info className="w-3 h-3 sm:w-4 sm:h-4 mr-2 text-blue-400" />
                                <span>{tier.duration}</span>
                              </div>
                              <div className="flex items-center text-gray-300">
                                <Wallet className="w-3 h-3 sm:w-4 sm:h-4 mr-2 text-purple-400" />
                                <span>$0.01-${tier.maxBuyUSD.toFixed(2)} per trade</span>
                              </div>
                            </div>
                            
                            <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-700">
                              <p className="text-xs text-gray-400">
                                Buy: {tier.buyPercentageMin}-{tier.buyPercentageMax}% • Sell: {tier.sellPercentageMin}-{tier.sellPercentageMax}%
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Validation Results */}
                {validationResult && (
                  <div className="mt-6">
                    {validationResult.success ? (
                      <div className="space-y-4">
                        {/* Token Success */}
                        <div className="p-3 sm:p-4 bg-emerald-900/30 border border-emerald-500/30 rounded-lg">
                          <div className="flex items-center gap-2 text-emerald-300 mb-3">
                            <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                            <span className="font-semibold text-sm sm:text-base">Token Validated Successfully!</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 text-xs sm:text-sm">
                            <div>
                              <span className="text-gray-400">Token:</span>
                              <span className="text-white ml-2">{validationResult.token?.symbol || 'Unknown'}</span>
                            </div>
                            <div>
                              <span className="text-gray-400">Type:</span>
                              <span className="text-cyan-300 ml-2">SPL</span>
                            </div>
                          </div>
                        </div>

                        {/* Comprehensive Liquidity Pools Display */}
                        <div className="p-3 sm:p-4 bg-cyan-900/30 border border-cyan-500/30 rounded-lg">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
                            <div className="flex items-center gap-2 text-cyan-300 mb-2 sm:mb-0">
                              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
                              <span className="font-semibold text-sm sm:text-base">Discovered Liquidity Pools</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge className="bg-cyan-600 text-cyan-100 text-xs">
                                {validationResult.pools?.length || 0} pools
                              </Badge>
                              <Badge className="bg-emerald-600 text-emerald-100 text-xs">
                                ${(validationResult.liquidityUsd || 0).toLocaleString()}
                              </Badge>
                            </div>
                          </div>

                          {/* Best Pool Information */}
                          {validationResult.bestPool && (
                            <div className="mb-4">
                              <div className="text-cyan-300 text-xs sm:text-sm font-medium mb-2">
                                🎯 Optimal Pool Selected
                              </div>
                              <div className="bg-cyan-800/30 p-2 sm:p-3 rounded border border-cyan-600/50">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                                  <div className="mb-2 sm:mb-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <Badge className="bg-cyan-600 text-cyan-100 text-xs">
                                        {validationResult.bestPool.dex}
                                      </Badge>
                                      <span className="text-cyan-200 text-xs sm:text-sm font-medium">
                                        {validationResult.token?.symbol}/SOL
                                      </span>
                                    </div>
                                    <div className="text-xs text-cyan-300">
                                      {validationResult.bestPool.reason || 'Best liquidity and volume'}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-cyan-200 font-mono text-xs sm:text-sm">
                                      ${validationResult.bestPool.liquidity?.toLocaleString() || 'N/A'}
                                    </div>
                                    {validationResult.bestPool.volume24h && (
                                      <div className="text-xs text-cyan-400">
                                        24h: ${validationResult.bestPool.volume24h.toLocaleString()}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {validationResult.bestPool.address && (
                                  <div className="mt-2 pt-2 border-t border-cyan-600/30">
                                    <span className="text-gray-400 text-xs">Pool Address:</span>
                                    <span className="text-cyan-300 ml-2 font-mono text-xs break-all">
                                      {validationResult.bestPool.address}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* All Discovered Pools */}
                          {validationResult.pools && validationResult.pools.length > 1 && (
                            <div>
                              <div className="text-xs sm:text-sm text-gray-300 mb-2 font-medium">
                                All Discovered Pools ({validationResult.pools.length})
                              </div>
                              <div className="space-y-2 max-h-48 sm:max-h-64 overflow-y-auto">
                                {validationResult.pools
                                  .sort((a:any, b:any) => b.liquidity - a.liquidity)
                                  .map((pool:any, index:any) => (
                                    <div key={index} className="flex items-center justify-between p-2 bg-gray-800/50 rounded border border-gray-700/50 hover:border-cyan-500/30 transition-colors">
                                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                                        <div className="flex items-center gap-1">
                                          <span className="text-xs text-gray-400 font-mono">#{index + 1}</span>
                                          <Badge 
                                            className={`text-xs ${
                                              index === 0 
                                                ? 'bg-emerald-600 text-emerald-100' 
                                                : 'bg-gray-600 text-gray-100'
                                            }`}
                                          >
                                            {pool.dex}
                                          </Badge>
                                        </div>
                                        <span className="text-gray-300 text-xs sm:text-sm">{validationResult.token?.symbol}/SOL</span>
                                        {pool.volume24h && pool.volume24h > 0 && (
                                          <span className="text-xs text-yellow-400">
                                            Vol: ${pool.volume24h.toLocaleString()}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-right">
                                        <div className="text-cyan-300 font-mono text-xs sm:text-sm">
                                          ${pool.liquidity.toLocaleString()}
                                        </div>
                                        {pool.isValid && (
                                          <div className="text-xs text-green-400">✓ Tradeable</div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}

                          {/* Single Pool Display */}
                          {validationResult.pools && validationResult.pools.length === 1 && (
                            <div className="text-center text-gray-300 text-xs sm:text-sm">
                              Single pool discovered - ready for volume generation
                            </div>
                          )}

                          {/* Comprehensive Discovery Info */}
                          <div className="mt-4 p-2 sm:p-3 bg-blue-900/30 border border-blue-500/30 rounded-lg">
                            <div className="text-blue-300 text-xs sm:text-sm font-medium mb-2">
                              🔍 Comprehensive DEX Search Completed
                            </div>
                            <div className="text-xs text-blue-200 space-y-1">
                              <div>• Searched across all major DEXs: Raydium, Meteora, Orca, Jupiter, LaunchLab, Pump.fun</div>
                              <div>• Real liquidity data from DexScreener API and direct DEX sources</div>
                              <div>• Smart validation using volume + liquidity + FDV metrics</div>
                              <div>• Ready for authentic volume generation with real swaps</div>
                            </div>
                          </div>
                        </div>

                        {/* Next Step Button */}
                        <Button
                          onClick={() => createSessionMutation.mutate({
                            contractAddress: validationResult.contractAddress,
                            tokenSymbol: validationResult.token.symbol,
                            fundingTierName: selectedTier,
                          })}
                          disabled={createSessionMutation.isPending}
                          className="w-full bg-gradient-to-r from-emerald-500 to-yellow-500 hover:from-emerald-600 hover:to-yellow-600 text-black font-semibold text-sm sm:text-base py-2 sm:py-3"
                          data-testid="button-create-session"
                        >
                          {createSessionMutation.isPending ? (
                            <>
                              <Wallet className="w-4 h-4 mr-2 animate-spin" />
                              Creating Session...
                            </>
                          ) : (
                            <>
                              <Wallet className="w-4 h-4 mr-2" />
                              Create Volume Session
                            </>
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="p-3 sm:p-4 bg-red-900/30 border border-red-500/30 rounded-lg">
                        <div className="flex items-center gap-2 text-red-300">
                          <XCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                          <span className="font-semibold text-sm sm:text-base">Validation Failed</span>
                        </div>
                        <p className="text-red-200 mt-2 text-xs sm:text-sm">{validationResult.error}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
      )}

      {step === 2 && sessionResult && (
        <Card className="mb-6 sm:mb-8 bg-gray-900/80 border-emerald-500/30 backdrop-blur-sm animate-in fade-in-50">
          <CardHeader className="pb-4">
            <CardTitle className="text-emerald-300 flex items-center gap-2 text-lg sm:text-xl">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5" />
              Step 2: Fund Your Session
            </CardTitle>
            <CardDescription className="text-gray-400 text-sm sm:text-base">
              Your secure session is ready. Send SOL to the unique vault address to begin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 sm:space-y-6">
            <Alert variant="destructive" className="bg-yellow-900/30 border-yellow-500/50">
              <Info className="h-4 w-4 text-yellow-300" />
              <AlertTitle className="text-yellow-200 text-sm sm:text-base">Save Your Session ID!</AlertTitle>
              <AlertDescription className="text-yellow-300 text-xs sm:text-sm">
                This ID is the only way to check on or manage your session later. Keep it safe!
              </AlertDescription>
            </Alert>
            <div className="p-3 sm:p-4 bg-black/40 border border-gray-700 rounded-lg space-y-2">
              <div className="text-gray-400 text-xs">Your Unique Session ID</div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <p className="font-mono text-xs sm:text-sm break-all text-white flex-1">{sessionResult.sessionId}</p>
                <Button 
                  className='text-black bg-white hover:bg-gray-200 text-xs sm:text-sm px-2 sm:px-4 py-1 sm:py-2 h-auto' 
                  size="sm" 
                  onClick={() => copyToClipboard(sessionResult.sessionId, 'Session ID')}
                >
                  <Copy className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="ml-1 hidden sm:inline">Copy</span>
                </Button>
              </div>
            </div>
            <div ref={walletRef} className="p-3 sm:p-4 bg-black/40 border-2 border-emerald-500/50 rounded-lg space-y-2 transition-all duration-300">
              <div className="text-emerald-300 text-xs font-medium">Send SOL to this Vault Address</div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <p className="font-mono text-sm sm:text-lg break-all text-white flex-1">{sessionResult.userWallet.address}</p>
                 <Button 
                   className='text-black bg-white hover:bg-gray-200 text-xs sm:text-sm px-2 sm:px-4 py-1 sm:py-2 h-auto' 
                   size="sm" 
                   onClick={() => copyToClipboard(sessionResult.userWallet.address, 'Wallet Address')}
                 >
                   <Copy className="h-3 w-3 sm:h-4 sm:w-4" />
                   <span className="ml-1 hidden sm:inline">Copy</span>
                 </Button>
              </div>
            </div>

            {/* Private Key Section */}
            <div className="p-4 bg-gray-800/50 border border-gray-600/50 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-200 flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  Session Wallet Private Key
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(sessionResult.userWallet.privateKey, 'Private Key')}
                  className="text-xs"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </Button>
              </div>
              
              <textarea
                value={sessionResult.userWallet.privateKey}
                readOnly
                rows={3}
                className="w-full p-3 bg-gray-900/50 border border-gray-600/50 rounded text-xs font-mono text-gray-300 resize-none"
              />
              
              <div className="mt-3 p-3 bg-red-900/20 border border-red-500/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <Shield className="w-4 h-4 text-red-300 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-red-200">
                    <p className="font-semibold mb-1">⚠️ Security Warning</p>
                    <ul className="space-y-1 text-red-300">
                      <li>• Save this private key securely - it controls your session wallet</li>
                      <li>• This is in hex format - compatible with most wallets</li>
                      <li>• Never share this key with anyone</li>
                      <li>• This key will not be shown again</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-center">
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <p className="text-xs text-gray-400">Token</p>
                <p className="font-semibold text-white text-sm sm:text-base">{sessionResult.token.symbol}</p>
              </div>
               <div className="p-3 bg-gray-800/50 rounded-lg">
                <p className="text-xs text-gray-400">Minimum Deposit</p>
                <p className="font-semibold text-white text-sm sm:text-base">
                  {sessionResult.tierConfig?.minFunding || 0.01} SOL
                </p>
              </div>
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <p className="text-xs text-gray-400">Funding Tier</p>
                <p className="font-semibold text-emerald-400 text-sm sm:text-base capitalize">
                  {sessionResult.fundingTier}
                </p>
              </div>
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <p className="text-xs text-gray-400">Estimated Trades</p>
                <p className="font-semibold text-blue-400 text-sm sm:text-base">
                  {sessionResult.estimatedTrades?.toLocaleString() || 'N/A'}
                </p>
              </div>
            </div>
             <Alert className='bg-emerald-900/30 border border-emerald-500/30 rounded-lg text-white'>
                <AlertTitle className="text-sm sm:text-base">What Happens Next?</AlertTitle>
                <AlertDescription className="text-xs sm:text-sm">
                  <ol className="list-decimal list-inside space-y-1 mt-2">
                    <li>Send at least <strong>{sessionResult.tierConfig?.minFunding} SOL</strong> to the vault address above.</li>
                    <li>The bot will automatically detect your deposit within seconds.</li>
                    <li>25% is collected as revenue, 75% used for trading.</li>
                  </ol>
                </AlertDescription>
              </Alert>
            <Button onClick={handleReset} className="w-full bg-gradient-to-r from-emerald-500 to-yellow-500 hover:from-emerald-600 hover:to-yellow-600 text-black font-semibold text-sm sm:text-base py-2 sm:py-3">
              Start a New Session
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}