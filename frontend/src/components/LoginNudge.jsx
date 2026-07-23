import React, { useState } from "react";
import { useAuth } from "@/lib/auth";
import { LogIn, X } from "lucide-react";

const DISMISS_KEY = "vs_login_nudge_dismissed_at";
const DISMISS_DAYS = 7;

// Same redirect flow as AuthButton (never hardcode the URL — derive from origin).
function startLogin() {
    const redirectUrl = window.location.origin + "/auth/callback";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
}

// Slim, dismissible banner shown when the user is not logged in, nudging them to
// sign in with Google so their saved companies sync across devices.
export default function LoginNudge() {
    const { user, loading } = useAuth();
    const [dismissed, setDismissed] = useState(() => {
        try {
            const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
            return !!t && Date.now() - t < DISMISS_DAYS * 86400000;
        } catch { return false; }
    });

    if (loading || user || dismissed) return null;

    const dismiss = () => {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
        setDismissed(true);
    };

    return (
        <div
            className="border border-[#052049] bg-[#EAF0F7] px-3 sm:px-4 py-2.5 mb-5 flex items-center gap-3 flex-wrap"
            data-testid="login-nudge"
        >
            <LogIn size={16} className="text-[#052049] shrink-0" />
            <div className="text-sm text-[#052049] flex-1 min-w-[180px]">
                <strong>Entra con Google</strong> para ver y sincronizar tus empresas guardadas (Nivel 1 y Nivel 2) en todos tus dispositivos.
            </div>
            <button
                onClick={startLogin}
                className="btn-primary !py-1 !px-3 text-xs inline-flex items-center gap-1.5"
                data-testid="login-nudge-btn"
            >
                <LogIn size={13} /> Entrar
            </button>
            <button
                onClick={dismiss}
                className="text-[#052049]/60 hover:text-[#052049] p-0.5 shrink-0"
                aria-label="Cerrar"
                data-testid="login-nudge-dismiss"
            >
                <X size={16} />
            </button>
        </div>
    );
}
