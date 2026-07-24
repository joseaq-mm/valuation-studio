import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { googleLogin } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

// Runs at <origin>/auth/google?code=... after Google OAuth. Exchanges the code with
// the backend (server-side, using the client secret), refreshes the session, and redirects.
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function GoogleCallback() {
    const navigate = useNavigate();
    const { refresh } = useAuth();
    const processed = useRef(false);

    useEffect(() => {
        if (processed.current) return;   // guard against StrictMode double-invoke
        processed.current = true;

        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const error = params.get("error");
        const redirectUri = window.location.origin + "/auth/google";

        if (error || !code) {
            toast.error("No se pudo iniciar sesión con Google.");
            navigate("/", { replace: true });
            return;
        }
        (async () => {
            try {
                await googleLogin(code, redirectUri);
                await refresh();
                toast.success("Sesión iniciada");
                window.history.replaceState(null, "", "/");
                navigate("/watchlist", { replace: true });
            } catch (e) {
                toast.error("No se pudo iniciar sesión. Inténtalo de nuevo.");
                navigate("/", { replace: true });
            }
        })();
    }, [navigate, refresh]);

    return (
        <div className="min-h-[60vh] flex items-center justify-center" data-testid="google-callback">
            <div className="text-center">
                <div className="font-serif text-3xl mb-2">Iniciando sesión…</div>
                <div className="overline text-[#4A4A4A]">Procesando autenticación con Google</div>
            </div>
        </div>
    );
}
