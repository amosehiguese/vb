import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { API_ENDPOINTS } from '@/config/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Search, Wallet, CheckCircle, XCircle, Copy, Info, TrendingUp } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

const wubbasolLogoPath = '/wubbasol-logo.png';

export default function ProfessionalTokenValidator() {
  const [step, setStep] = useState(1);
  const [contractAddress, setContractAddress] = useState('');
  const [validationResult, setValidationResult] = useState<any>(null);
  const [sessionResult, setSessionResult] = useState<any>(null);
  const walletRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const validateTokenMutation = useMutation({
    mutationFn: async (address: string) => {
      const response = await fetch(API_ENDPOINTS.VALIDATE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: address })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Validation failed');
      return data;
    },
    onSuccess: (data) => setValidationResult(data),
    onError: (error: Error) => toast({ title: "Validation Error", description: error.message, variant: "destructive" }),
  });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(API_ENDPOINTS.CREATE_SESSION, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contractAddress: validationResult.contractAddress,
          tokenSymbol: validationResult.token.symbol
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Session creation failed');
      return data;
    },
    onSuccess: (data) => {
      setSessionResult(data);
      setStep(2);
    },
    onError: (error: Error) => toast({ title: "Session Creation Error", description: error.message, variant: "destructive" }),
  });

  const handleReset = () => {
    setStep(1);
    setContractAddress('');
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
    toast({ title: "Copied to clipboard!", description: `${field} copied.` });
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="relative z-10 container mx-auto max-w-4xl p-6">
        {/* Header with Your Logo */}
        <div className="text-center mb-8">
          <div className="flex flex-col items-center justify-center mb-6">
            {/* Volume Bot Logo */}
            <div className="relative mb-4">
              <img 
                src={wubbasolLogoPath} 
                alt="WubbaSol Logo" 
                className="w-32 h-32 object-contain drop-shadow-2xl"
              />
              {/* Glow effect behind logo */}
              <div className="absolute inset-0 w-32 h-32 bg-gradient-to-br from-cyan-400 via-emerald-400 to-yellow-400 rounded-full blur-xl opacity-20 animate-pulse"></div>
            </div>
            
            <div className="text-center">
              <p className="text-cyan-200 text-lg font-semibold tracking-wide mb-2">Volume Bot</p>
              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-green-300 text-sm font-medium">Live Volume System</span>
              </div>
            </div>
          </div>
          
          <p className="text-gray-300 max-w-3xl mx-auto text-lg leading-relaxed">
            Validate any Solana token and start volume generation with real DEX trades visible on all charts
          </p>
        </div>
      </div>

      {step === 1 && (
        <Card className="mb-8 bg-gray-900/80 border-cyan-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-cyan-300 flex items-center gap-2">
                <Search className="w-5 h-5" />
                Step 1: Validate Token Contract
              </CardTitle>
              <CardDescription className="text-gray-400">
                Enter any Solana token contract address to verify its validity and trading pools
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <Input
                    ref={inputRef} 
                    placeholder="Enter Solana token contract address..."
                    value={contractAddress}
                    onChange={(e) => setContractAddress(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="bg-gray-800 border-gray-600 text-white placeholder-gray-400"
                    data-testid="input-contract-address"
                  />
                  <Button
                    onClick={() => validateTokenMutation.mutate(contractAddress)}
                    disabled={validateTokenMutation.isPending || !contractAddress.trim()}
                    className="bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-600 hover:to-emerald-600"
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

                {/* Validation Results */}
                {validationResult && (
                  <div className="mt-6">
                    {validationResult.success ? (
                      <div className="space-y-4">
                        {/* Token Success */}
                        <div className="p-4 bg-emerald-900/30 border border-emerald-500/30 rounded-lg">
                          <div className="flex items-center gap-2 text-emerald-300 mb-3">
                            <CheckCircle className="w-5 h-5" />
                            <span className="font-semibold">Token Validated Successfully!</span>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
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
                        <div className="p-4 bg-cyan-900/30 border border-cyan-500/30 rounded-lg">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2 text-cyan-300">
                              <TrendingUp className="w-5 h-5" />
                              <span className="font-semibold">Discovered Liquidity Pools</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge className="bg-cyan-600 text-cyan-100">
                                {validationResult.pools?.length || 0} pools found
                              </Badge>
                              <Badge className="bg-emerald-600 text-emerald-100">
                                ${validationResult.liquidityUsd?.toLocaleString() || '0'} best liquidity
                              </Badge>
                            </div>
                          </div>

                          {/* Primary Pool (Best Liquidity) */}
                          {validationResult.pools && validationResult.pools.length > 0 && (
                            <div className="mb-4 p-3 bg-emerald-900/40 border border-emerald-500/50 rounded-lg">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge className="bg-emerald-500 text-black font-semibold">PRIMARY</Badge>
                                <Badge className="bg-gray-700 text-gray-100">{validationResult.bestPool?.dex || validationResult.primaryDex}</Badge>
                              </div>
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <span className="text-gray-400">Trading Pair:</span>
                                  <span className="text-white ml-2">{validationResult.token?.symbol}/SOL</span>
                                </div>
                                <div>
                                  <span className="text-gray-400">Liquidity:</span>
                                  <span className="text-emerald-300 ml-2 font-mono">${validationResult.liquidityUsd?.toLocaleString()}</span>
                                </div>
                                {validationResult.bestPool?.poolAddress && (
                                  <div className="col-span-2">
                                    <span className="text-gray-400">Pool Address:</span>
                                    <span className="text-cyan-300 ml-2 font-mono text-xs break-all">
                                      {validationResult.bestPool.poolAddress}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* All Discovered Pools */}
                          {validationResult.pools && validationResult.pools.length > 1 && (
                            <div>
                              <div className="text-sm text-gray-300 mb-2 font-medium">
                                All Discovered Pools ({validationResult.pools.length})
                              </div>
                              <div className="space-y-2 max-h-64 overflow-y-auto">
                                {validationResult.pools
                                  .sort((a:any, b:any) => b.liquidity - a.liquidity)
                                  .map((pool:any, index:any) => (
                                    <div key={index} className="flex items-center justify-between p-2 bg-gray-800/50 rounded border border-gray-700/50 hover:border-cyan-500/30 transition-colors">
                                      <div className="flex items-center gap-3">
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
                                        <span className="text-gray-300 text-sm">{validationResult.token?.symbol}/SOL</span>
                                        {pool.volume24h && pool.volume24h > 0 && (
                                          <span className="text-xs text-yellow-400">
                                            Vol: ${pool.volume24h.toLocaleString()}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-right">
                                        <div className="text-cyan-300 font-mono text-sm">
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
                            <div className="text-center text-gray-300 text-sm">
                              Single pool discovered - ready for volume generation
                            </div>
                          )}

                          {/* Comprehensive Discovery Info */}
                          <div className="mt-4 p-3 bg-blue-900/30 border border-blue-500/30 rounded-lg">
                            <div className="text-blue-300 text-sm font-medium mb-2">
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
                          onClick={() => createSessionMutation.mutate()}
                          disabled={createSessionMutation.isPending}
                          className="w-full bg-gradient-to-r from-emerald-500 to-yellow-500 hover:from-emerald-600 hover:to-yellow-600 text-black font-semibold"
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
                      <div className="p-4 bg-red-900/30 border border-red-500/30 rounded-lg">
                        <div className="flex items-center gap-2 text-red-300">
                          <XCircle className="w-5 h-5" />
                          <span className="font-semibold">Validation Failed</span>
                        </div>
                        <p className="text-red-200 mt-2">{validationResult.error}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
      )}

      {step === 2 && sessionResult && (
        <Card className="mb-8 bg-gray-900/80 border-emerald-500/30 backdrop-blur-sm animate-in fade-in-50">
          <CardHeader>
            <CardTitle className="text-emerald-300 flex items-center gap-2"><Wallet className="w-5 h-5" />Step 2: Fund Your Session</CardTitle>
            <CardDescription className="text-gray-400">Your secure session is ready. Send SOL to the unique vault address to begin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert variant="destructive" className="bg-yellow-900/30 border-yellow-500/50">
              <Info className="h-4 w-4 text-yellow-300" />
              <AlertTitle className="text-yellow-200">Save Your Session ID!</AlertTitle>
              <AlertDescription className="text-yellow-300">
                This ID is the only way to check on or manage your session later. Keep it safe!
              </AlertDescription>
            </Alert>
            <div className="p-4 bg-black/40 border border-gray-700 rounded-lg space-y-2">
              <div className="text-gray-400 text-xs">Your Unique Session ID</div>
              <div className="flex items-center gap-2">
                <p className="font-mono text-sm break-all text-white">{sessionResult.sessionId}</p>
                <Button className='text-black bg-white' size="icon" onClick={() => copyToClipboard(sessionResult.sessionId, 'Session ID')}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>
            <div ref={walletRef} className="p-4 bg-black/40 border-2 border-emerald-500/50 rounded-lg space-y-2 transition-all duration-300">
              <div className="text-emerald-300 text-xs">Send SOL to this Vault Address</div>
              <div className="flex items-center gap-2">
                <p className="font-mono text-lg break-all text-white">{sessionResult.userWallet.address}</p>
                 <Button className='text-black bg-white' size="icon" onClick={() => copyToClipboard(sessionResult.userWallet.address, 'Wallet Address')}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <p className="text-xs text-gray-400">Token</p>
                <p className="font-semibold text-white">{sessionResult.token.symbol}</p>
              </div>
               <div className="p-3 bg-gray-800/50 rounded-lg">
                <p className="text-xs text-gray-400">Minimum Deposit</p>
                <p className="font-semibold text-white">{sessionResult.autoTrading.minDeposit} SOL</p>
              </div>
            </div>
             <Alert className='bg-emerald-900/30 border border-emerald-500/30 rounded-lg text-white'>
                
                <AlertTitle>What Happens Next?</AlertTitle>
                <AlertDescription>
                  <ol className="list-decimal list-inside space-y-1 mt-2">
                    <li>Send at least <strong>{sessionResult.autoTrading.minDeposit} SOL</strong> to the vault address above.</li>
                    <li>The bot will automatically detect your deposit within seconds.</li>
                    <li>25% is collected as revenue. The remaining 75% becomes your trading balance.</li>
                    <li>The bot starts executing trades using new, single-use wallets for each swap.</li>
                    <li>All trades are real, on-chain transactions visible on DexScreener.</li>
                  </ol>
                </AlertDescription>
              </Alert>
            <Button onClick={handleReset} className="w-full bg-gradient-to-r from-emerald-500 to-yellow-500 hover:from-emerald-600 hover:to-yellow-600 text-black font-semibold">Start a New Session</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
