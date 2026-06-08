import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import HoverTip from "@/components/HoverTip";

/** Shared "Refrescar" control used on the Tesis dashboard, a thesis page and a
 *  company page. Pressing it re-fetches fundamentals and recomputes the TAM Scores
 *  on the spot; fresh data travels both ways (company ↔ theses) because they share
 *  the same cache. The hover tooltip explains exactly what a refresh does. */
export const REFRESH_LEGEND =
    "Refrescar: actualiza precios, fundamentales y TAM de tus empresas y tesis (de cada eslabón y empresa). " +
    "Al pulsar aquí se hace al instante; los datos frescos viajan entre la empresa y sus tesis. " +
    "Automáticamente se repite cada semana desde tu último refresco.";

export default function RefreshButton({ onRefresh, label, testid = "refresh-btn", className = "" }) {
    const [busy, setBusy] = useState(false);
    const run = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await onRefresh();
            toast.success("Datos actualizados");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo refrescar.");
        } finally {
            setBusy(false);
        }
    };
    return (
        <HoverTip text={REFRESH_LEGEND} maxWidth={320}>
            <button
                onClick={run}
                disabled={busy}
                aria-label="Refrescar datos"
                data-testid={testid}
                className={`border border-black p-2 hover:bg-[#F5E4D4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 ${className}`}
            >
                <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
                {label && <span className="text-xs uppercase tracking-[0.1em] font-semibold">{label}</span>}
            </button>
        </HoverTip>
    );
}
