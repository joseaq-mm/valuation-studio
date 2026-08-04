import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;

// Lightweight probe against the backend root (/api/). Returns true if the origin is
// reachable and healthy (2xx). Any Cloudflare 5xx / timeout / network error => false.
async function ping(timeoutMs = 6000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(`${API}/api/`, { method: "GET", cache: "no-store", signal: ctrl.signal });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(t);
    }
}

/* Shows a "waking up the servers" splash ONLY when the origin is cold/unreachable
   (preview asleep, a redeploy/restart, or a transient Cloudflare 5xx). When the origin
   is healthy it renders nothing (no flash). Works identically in preview and production
   because it lives entirely on the client. */
export default function ServerWaking() {
    const [waking, setWaking] = useState(false);
    const wasDown = useRef(false);
    const attempt = useRef(0);

    useEffect(() => {
        let alive = true;
        let timer;
        const loop = async () => {
            const ok = await ping();
            if (!alive) return;
            if (ok) {
                // Recovered after having shown the splash → reload for a clean state.
                if (wasDown.current) { window.location.reload(); return; }
                setWaking(false);
                return; // healthy from the start: stop probing, never show the splash
            }
            wasDown.current = true;
            setWaking(true);
            attempt.current += 1;
            const delay = Math.min(1500 * attempt.current, 8000);
            timer = setTimeout(loop, delay);
        };
        loop();
        return () => { alive = false; clearTimeout(timer); };
    }, []);

    if (!waking) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center text-center px-6"
            style={{ background: "#FDF1E6" }} data-testid="server-waking">
            <div className="font-serif text-3xl text-[#052049] mb-2">Valuation Studio</div>
            <Loader2 className="animate-spin text-[#B32A22] my-3" size={30} />
            <div className="font-serif text-xl mb-1">Despertando los servidores…</div>
            <p className="text-sm text-[#4A4A4A] max-w-xs">Esto tarda unos segundos la primera vez tras un rato inactivo. Reconectaremos automáticamente en cuanto estén listos.</p>
        </div>
    );
}
