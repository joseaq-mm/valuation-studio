import React, { useState } from "react";
import { useAuth } from "@/lib/auth";
import { LogIn, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cloudWatchlistGet, cloudWatchlistPut } from "@/lib/api";
import { getWatchlist as getLocalWatchlist, replaceWatchlist } from "@/lib/storage";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
// Always derive the redirect URL from window.location.origin so the user lands
// back on the exact domain they came from (prod / preview / local).
function startLogin() {
    const redirectUrl = window.location.origin + "/auth/callback";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
}

export default function AuthButton() {
    const { user, loading, logout } = useAuth();
    const [syncing, setSyncing] = useState(false);

    const handleSyncFromCloud = async () => {
        if (!user) return;
        setSyncing(true);
        try {
            const { entries } = await cloudWatchlistGet();
            // Merge: cloud wins for tickers it has; local-only tickers are preserved.
            const local = getLocalWatchlist();
            const byTicker = new Map(local.map(e => [e.ticker, e]));
            for (const e of entries) byTicker.set(e.ticker, e);
            const merged = Array.from(byTicker.values());
            replaceWatchlist(merged);
            // Push the merged result so cloud and local are aligned
            await cloudWatchlistPut(merged);
            toast.success(`Watchlist sincronizada (${merged.length} acciones).`);
        } catch (e) {
            toast.error("Error al sincronizar la watchlist.");
        } finally {
            setSyncing(false);
        }
    };

    if (loading) {
        return <span className="text-xs font-mono text-[#4A4A4A] px-2" data-testid="auth-loading">…</span>;
    }

    if (user) {
        return (
            <div className="flex items-center gap-1" data-testid="auth-user">
                {user.picture && (
                    <img src={user.picture} alt="" className="w-6 h-6 rounded-full border border-black/30" />
                )}
                <span className="text-xs font-mono text-[#4A4A4A] hidden sm:inline" title={user.email}>
                    {(user.name || user.email).split(" ")[0]}
                </span>
                <button
                    onClick={handleSyncFromCloud}
                    className="btn-ghost flex items-center gap-1 !py-1 !px-2 text-xs"
                    title="Sincronizar watchlist con la nube"
                    data-testid="auth-sync"
                    disabled={syncing}
                >
                    <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
                </button>
                <button
                    onClick={logout}
                    className="btn-ghost flex items-center gap-1 !py-1 !px-2 text-xs"
                    title="Cerrar sesión"
                    data-testid="auth-logout"
                >
                    <LogOut size={12} />
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={startLogin}
            className="btn-ghost flex items-center gap-2 !py-1 !px-2 text-xs"
            data-testid="auth-login"
            title="Iniciar sesión con Google — sincroniza tu watchlist entre dispositivos"
        >
            <LogIn size={14} /> Entrar
        </button>
    );
}
