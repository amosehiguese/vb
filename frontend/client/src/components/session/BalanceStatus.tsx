import { Wallet, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

interface BalanceStatusProps {
  balance: number;
  sessionStatus: string;
}

export const BalanceStatus = ({ balance, sessionStatus }: BalanceStatusProps) => {
  const MIN_TRADE_SOL = 0.001;
  const MIN_REQUIRED_BALANCE = MIN_TRADE_SOL + 0.00204 + 0.001; // trading + fees + buffer
  
  const getBalanceStatus = () => {
    if (balance >= MIN_REQUIRED_BALANCE) {
      return { 
        status: 'good', 
        color: 'text-green-400', 
        icon: CheckCircle, 
        message: 'Sufficient for all operations' 
      };
    } else if (balance >= MIN_TRADE_SOL) {
      return { 
        status: 'low', 
        color: 'text-yellow-400', 
        icon: AlertTriangle, 
        message: 'Can pause, but cannot resume' 
      };
    } else {
      return { 
        status: 'critical', 
        color: 'text-red-400', 
        icon: XCircle, 
        message: 'Cannot pause or resume' 
      };
    }
  };

  const balanceStatus = getBalanceStatus();
  const StatusIcon = balanceStatus.icon;

  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 sm:gap-2 mb-4">
      <span className="text-gray-400">Wallet Balance:</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-white">{balance.toFixed(6)} SOL</span>
        <StatusIcon className={`h-4 w-4 ${balanceStatus.color}`} />
        <span className={`text-xs ${balanceStatus.color} hidden sm:inline`}>
          {balanceStatus.message}
        </span>
      </div>
    </div>
  );
};