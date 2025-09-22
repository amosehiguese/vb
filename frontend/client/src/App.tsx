import { Switch, Route, Link } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import ProfessionalTokenValidator from "@/pages/professional-token-validator";
import CheckSessionPage from "@/pages/check-session";
import NotFound from "@/pages/not-found";
import { Button } from "@/components/ui/button";
import { Search } from 'lucide-react';

const wubbasolLogoPath = '/wubbasol-logo.png';

// Main Layout Component
const AppLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-cover bg-center bg-no-repeat relative" style={{ backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0.85)), url('/frog-themed-background.svg')` }}>
    <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/20 via-emerald-900/20 to-yellow-900/20"></div>
    <header className="relative z-10 p-4">
      <div className="container mx-auto flex items-center justify-between">
        {/* Left spacer */}
        <div className="flex-1"></div>
        
        {/* Centered Logo */}
        <div className="flex flex-col items-center justify-center">
          <div className="relative mb-2">
            <img 
              src={wubbasolLogoPath} 
              alt="WubbaSol Logo" 
              className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-2xl"
            />
            {/* Glow effect behind logo */}
            <div className="absolute inset-0 w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-cyan-400 via-emerald-400 to-yellow-400 rounded-full blur-xl opacity-20 animate-pulse"></div>
          </div>
          <div className="text-center">
            <p className="text-cyan-200 text-sm sm:text-base font-semibold tracking-wide mb-1">Volume Bot</p>
            <div className="flex items-center justify-center gap-1">
              <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-green-300 text-xs font-medium">Live Volume System</span>
            </div>
          </div>
        </div>

        {/* Right side - Check Session Button */}
        <div className="flex-1 flex justify-end">
          <Link href="/check-session">
            <Button className="bg-gradient-to-r from-emerald-500 to-yellow-500 hover:from-emerald-600 hover:to-yellow-600 text-white font-semibold text-xs sm:text-sm px-2 sm:px-4 py-1 sm:py-2">
              <Search className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Check Session</span>
              <span className="sm:hidden">Check</span>
            </Button>
          </Link>
        </div>
      </div>
    </header>
    <main className="relative z-10">
      {children}
    </main>
  </div>
);

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster 
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: 'rgb(17 24 39)',
              border: '1px solid rgb(55 65 81)',
              color: 'rgb(243 244 246)',
              fontSize: '14px',
            },
            success: {
              style: {
                background: 'rgb(5 46 22)',
                border: '1px solid rgb(34 197 94)',
                color: 'rgb(187 247 208)',
              },
              iconTheme: {
                primary: 'rgb(34 197 94)',
                secondary: 'rgb(5 46 22)',
              },
            },
            error: {
              style: {
                background: 'rgb(69 10 10)',
                border: '1px solid rgb(239 68 68)',
                color: 'rgb(254 202 202)',
              },
              iconTheme: {
                primary: 'rgb(239 68 68)',
                secondary: 'rgb(69 10 10)',
              },
            },
          }}
        />
        <AppLayout>
          <Switch>
            <Route path="/" component={ProfessionalTokenValidator} />
            <Route path="/check-session" component={CheckSessionPage} />
            <Route path="/check-session/:sessionId" component={CheckSessionPage} />
            <Route component={NotFound} />
          </Switch>
        </AppLayout>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;