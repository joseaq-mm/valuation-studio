import "@/App.css";
import React from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
import Home from "@/pages/Home";
import Company from "@/pages/Company";
import Watchlist from "@/pages/Watchlist";
import Portfolio from "@/pages/Portfolio";
import Compare from "@/pages/Compare";
import Thesis from "@/pages/Thesis";
import ThesisDetail from "@/pages/ThesisDetail";
import Visual from "@/pages/Visual";
import Kpis from "@/pages/Kpis";
import Macro from "@/pages/Macro";
import AuthCallback from "@/pages/AuthCallback";
import GoogleCallback from "@/pages/GoogleCallback";
import Instructions from "@/pages/Instructions";
import { AuthProvider } from "@/lib/auth";
import { FxProvider } from "@/lib/fx";
import { I18nProvider } from "@/lib/i18n";
import { TourProvider } from "@/lib/tour";
import WatchlistCloudSync from "@/components/WatchlistCloudSync";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5000 },
    },
});

// Detect OAuth callback synchronously during render — running this in useEffect
// would be too late and produce a race with the auth /me check.
function AppRouter() {
    const location = useLocation();
    if (location.hash && location.hash.includes("session_id=")) {
        return <Layout><AuthCallback /></Layout>;
    }
    return (
        <Layout>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/company/:ticker" element={<Company />} />
                <Route path="/watchlist" element={<Watchlist />} />
                <Route path="/portfolio" element={<Portfolio />} />
                <Route path="/compare" element={<Compare />} />
                <Route path="/thesis" element={<Thesis />} />
                <Route path="/thesis/:id" element={<ThesisDetail />} />
                <Route path="/visual" element={<Visual />} />
                <Route path="/kpis" element={<Kpis />} />
                <Route path="/macro" element={<Macro />} />
                <Route path="/instrucciones" element={<Instructions />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/auth/google" element={<GoogleCallback />} />
            </Routes>
        </Layout>
    );
}

function App() {
    return (
        <div className="App">
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <AuthProvider>
                        <FxProvider>
                            <I18nProvider>
                                <WatchlistCloudSync />
                                <TourProvider>
                                    <AppRouter />
                                </TourProvider>
                                <Toaster position="bottom-right" toastOptions={{ style: { borderRadius: 0, border: "1px solid #111", fontFamily: "IBM Plex Sans" } }} />
                                <PWAInstallPrompt />
                            </I18nProvider>
                        </FxProvider>
                    </AuthProvider>
                </BrowserRouter>
            </QueryClientProvider>
        </div>
    );
}

export default App;
