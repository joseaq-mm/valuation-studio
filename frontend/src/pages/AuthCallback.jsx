import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { authSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

// One-time component that runs when the URL contains #session_id=...
// after Google OAuth. It exchanges the session_id for a session_token,
// then navigates back to the dashboard.
export default function AuthCallback() {
    const navigate = useNavigate();
    const { refresh } = useAuth();
    const processed = useRef(false);

    useEffect(() => {
        // useRef guards against React 18 StrictMode double-invoke
        if (processed.current) return;
        processed.current = true;

        const hash = window.location.hash || "";
        const m = hash.match(/session_id=([^&]+)/);
        if (!m) {
            navigate("/", { replace: true });
            return;
        }
        const sessionId = decodeURIComponent(m[1]);
        (async () => {
            try {
                await authSession(sessionId);
                await refresh();
                toast.success("Sesión iniciada");
                // Strip the hash before redirect
                window.history.replaceState(null, "", window.location.pathname);
                navigate("/watchlist", { replace: true });
            } catch (e) {
                toast.error("No se pudo iniciar sesión. Inténtalo de nuevo.");
                navigate("/", { replace: true });
            }
        })();
    }, [navigate, refresh]);

    return (
        <div className="min-h-[60vh] flex items-center justify-center" data-testid="auth-callback">
            <div className="text-center">
                <div className="font-serif text-3xl mb-2">Iniciando sesión…</div>
                <div className="overline text-[#4A4A4A]">Procesando autenticación</div>
            </div>
        </div>
    );
}
