import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authMe, authLogout } from "./api";
import { toast } from "sonner";

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

    // Cross-context session sync: the top-level login popup relays the session token
    // via postMessage (works even when third-party cookies are blocked in the iframe).
    // We also listen to `storage`/`focus` as a best-effort fallback for full-tab logins.
    useEffect(() => {
        const onMessage = (e) => {
            if (e.origin !== window.location.origin) return;
            if (e.data && e.data.type === "vs:google-login" && e.data.token) {
                try { localStorage.setItem("vs:token", e.data.token); } catch { /* ignore */ }
                refresh();
                toast.success("Sesión iniciada");
            }
        };
        const onStorage = (e) => { if (e.key === "vs:auth-changed") refresh(); };
        const onFocus = () => { if (!user) refresh(); };
        window.addEventListener("message", onMessage);
        window.addEventListener("storage", onStorage);
        window.addEventListener("focus", onFocus);
        return () => {
            window.removeEventListener("message", onMessage);
            window.removeEventListener("storage", onStorage);
            window.removeEventListener("focus", onFocus);
        };
    }, [refresh, user]);

    const logout = useCallback(async () => {
        try { await authLogout(); } catch { /* ignore */ }
        try { localStorage.removeItem("vs:token"); } catch { /* ignore */ }
        setUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, refresh, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
