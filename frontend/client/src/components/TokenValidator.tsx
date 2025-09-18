import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Search, CheckCircle, XCircle, ExternalLink, TrendingUp, TrendingDown, DollarSign, Activity } from 'lucide-react';
import { API_ENDPOINTS } from '@/config/api';

interface TokenValidationResult {
  isValid: boolean;
  liquidityPools: Array<{
    dex: string;
    liquidity: number;
    volume24h: number;
    price: number;
    priceChange24h: number;
    poolAddress: string;
  }>;
  totalLiquidity: number;
  is24hVolumeActive: boolean;
  recommendedDex: string;
  validationErrors: string[];
}

export function TokenValidator() {
  const [tokenAddress, setTokenAddress] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<TokenValidationResult | null>(null);

  const validateToken = async () => {
    if (!tokenAddress.trim()) return;

    setIsValidating(true);
    try {
      const response = await fetch(API_ENDPOINTS.VALIDATE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress: tokenAddress.trim() })
      });

      const result = await response.json();
      setValidationResult(result);
    } catch (error) {
      console.error('Validation failed:', error);
      setValidationResult({
        isValid: false,
        liquidityPools: [],
        totalLiquidity: 0,
        is24hVolumeActive: false,
        recommendedDex: '',
        validationErrors: ['Network error during validation']
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      validateToken();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Token Validation
          </CardTitle>
          <CardDescription>
            Validate any Solana token by checking its liquidity pools across all major DEXs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Enter Solana token address (e.g., 5SUzu2XAgJHuig1iPHr6zrnfZxyms5hWf8bcezB4bonk)"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              onKeyPress={handleKeyPress}
              className="flex-1"
              data-testid="input-token-address"
            />
            <Button 
              onClick={validateToken} 
              disabled={isValidating || !tokenAddress.trim()}
              data-testid="button-validate-token"
            >
              {isValidating ? 'Validating...' : 'Validate'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {validationResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {validationResult.isValid ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
              Validation Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {validationResult.isValid ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
                    <DollarSign className="h-4 w-4 text-green-600" />
                    <div>
                      <p className="text-sm font-medium text-green-800">Total Liquidity</p>
                      <p className="text-lg font-bold text-green-900">
                        ${validationResult.totalLiquidity.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
                    <Activity className="h-4 w-4 text-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-blue-800">24h Volume Active</p>
                      <p className="text-lg font-bold text-blue-900">
                        {validationResult.is24hVolumeActive ? 'Yes' : 'No'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 p-3 bg-purple-50 rounded-lg">
                    <TrendingUp className="h-4 w-4 text-purple-600" />
                    <div>
                      <p className="text-sm font-medium text-purple-800">Recommended DEX</p>
                      <p className="text-lg font-bold text-purple-900">
                        {validationResult.recommendedDex}
                      </p>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-lg font-semibold mb-3">Liquidity Pools</h3>
                  <div className="space-y-3">
                    {validationResult.liquidityPools.map((pool, index) => (
                      <div key={index} className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <Badge variant="outline" className="text-sm">
                            {pool.dex}
                          </Badge>
                          <div className="flex items-center gap-1">
                            {pool.priceChange24h >= 0 ? (
                              <TrendingUp className="h-4 w-4 text-green-500" />
                            ) : (
                              <TrendingDown className="h-4 w-4 text-red-500" />
                            )}
                            <span className={`text-sm font-medium ${
                              pool.priceChange24h >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {pool.priceChange24h >= 0 ? '+' : ''}{pool.priceChange24h.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-gray-600">Liquidity</p>
                            <p className="font-semibold">${pool.liquidity.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-gray-600">24h Volume</p>
                            <p className="font-semibold">${pool.volume24h.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-gray-600">Price</p>
                            <p className="font-semibold">${pool.price.toFixed(6)}</p>
                          </div>
                          <div>
                            <p className="text-gray-600">Pool Address</p>
                            <a 
                              href={`https://solscan.io/account/${pool.poolAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            >
                              View <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <h3 className="text-lg font-semibold text-red-800 mb-2">Validation Failed</h3>
                <ul className="list-disc list-inside space-y-1 text-red-700">
                  {validationResult.validationErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
