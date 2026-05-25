import "@/App.css";
import React from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
import Home from "@/pages/Home";
import Company from "@/pages/Company";
import Watchlist from "@/pages/Watchlist";
import Compare from "@/pages/Compare";
import AuthCallback from "@/pages/AuthCallback";
import { AuthProvider } from "@/lib/auth";
import { FxProvider } from "@/lib/fx";
import WatchlistCloudSync from "@/components/WatchlistCloudSync";

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
                <Route path="/compare" element={<Compare />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
            </Routes>
        </Layout>
    );
}

function App() {
    return (
        <div className="App">
            <BrowserRouter>
                <AuthProvider>
                    <FxProvider>
                        <WatchlistCloudSync />
                        <AppRouter />
                        <Toaster position="bottom-right" toastOptions={{ style: { borderRadius: 0, border: "1px solid #111", fontFamily: "IBM Plex Sans" } }} />
                    </FxProvider>
                </AuthProvider>
            </BrowserRouter>
        </div>
    );
}

export default App;
