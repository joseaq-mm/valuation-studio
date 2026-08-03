import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authMe, authLogout } from "./api";

const AuthContext = createContext({
    user: null,
    loading: true,
    refresh: () => {},
    logout: async () => {},
});

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        // CRITICAL: If returning from OAuth callback, skip the /me check.
        // AuthCallback will exchange the session_id and establish the session first.
        if (typeof window !== "undefined" && window.location.hash && window.location.hash.includes("session_id=")) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const me = await authMe();
            setUser(me);
        } catch {
            setUser(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // Cross-tab session sync: when Google login completes in another tab (needed
    // because Google OAuth can't run inside the preview iframe), that tab writes
    // `vs:auth-changed` to localStorage; we re-check the session here.
    useEffect(() => {
        const onStorage = (e) => { if (e.key === "vs:auth-changed") refresh(); };
        const onFocus = () => { if (!user) refresh(); };
        window.addEventListener("storage", onStorage);
        window.addEventListener("focus", onFocus);
        return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", onFocus); };
    }, [refresh, user]);

    const logout = useCallback(async () => {
        try { await authLogout(); } catch { /* ignore */ }
        setUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, refresh, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
