import { Switch, Route, Link } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import ProfessionalTokenValidator from "@/pages/professional-token-validator";
import CheckSessionPage from "@/pages/check-session";
import NotFound from "@/pages/not-found";
import { Button } from "@/components/ui/button";
import { Search } from 'lucide-react';

// Main Layout Component
const AppLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-cover bg-center bg-no-repeat relative" style={{ backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0.85)), url('/frog-themed-background.svg')` }}>
    <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/20 via-emerald-900/20 to-yellow-900/20"></div>
    <header className="relative z-10 p-4">
      <div className="container mx-auto flex justify-end">
        <Link href="/check-session">
          <Button className="w-full bg-gradient-to-r from-emerald-500 to-yellow-500 hover:from-emerald-600 hover:to-yellow-600 text-white font-semibold">
            <Search className="w-4 h-4 mr-2" />
            Check Existing Session
          </Button>
        </Link>
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
        <Toaster />
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
