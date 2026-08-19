import React, { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { LogIn, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { runFullSync } from "@/lib/cloudSync";
import HoverTip from "@/components/HoverTip";
import { startGoogleLogin } from "@/lib/googleAuth";

const startLogin = () => {
    if (!startGoogleLogin()) {
        toast.error("Google OAuth no configurado. Rellena frontend/.env (REACT_APP_GOOGLE_CLIENT_ID) y reinicia npm start.");
    }
};

export default function AuthButton() {
    const { user, loading, logout } = useAuth();
    const { t } = useI18n();
    const [syncing, setSyncing] = useState(false);

    // Same full reconcile as a page reload: pull cloud, resolve conflicts/deletions
    // (tombstone-aware) for Nivel 1 + Nivel 2, and push the aligned result back.
    const handleSyncFromCloud = async () => {
        if (!user || syncing) return;
        setSyncing(true);
        try {
            const { watchlist, portfolio } = await runFullSync();
            toast.success(`Sincronizado con la nube (Nivel 1: ${portfolio} · Nivel 2: ${watchlist}).`);
        } catch (e) {
            toast.error("Error al sincronizar con la nube. Revisa tu conexión e inténtalo de nuevo.");
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
                <HoverTip text="Sincroniza tus empresas (Nivel 1 y Nivel 2) con tu cuenta en la nube: baja lo guardado en otros dispositivos, resuelve conflictos y aplica los borrados. Hace lo mismo que recargar la página; úsalo si algo se ha quedado desincronizado." maxWidth={280}>
                    <button
                        onClick={handleSyncFromCloud}
                        className="btn-ghost flex items-center gap-1 !py-1 !px-2 text-xs"
                        data-testid="auth-sync"
                        disabled={syncing}
                    >
                        <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
                    </button>
                </HoverTip>
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
            <LogIn size={14} /> {t("nav.login")}
        </button>
    );
}
