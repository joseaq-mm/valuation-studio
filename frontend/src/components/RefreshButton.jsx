import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import HoverTip from "@/components/HoverTip";

/** Shared "Refrescar" control used on the Tesis dashboard, a thesis page and a
 *  company page. Pressing it re-fetches fundamentals (Yahoo) and recomputes the TAM
 *  Scores with the fresh numbers; the data travels both ways (company ↔ theses)
 *  because they share the same cache. It only updates QUANTITATIVE data — the
 *  qualitative scores (overall_score, value-chain TAM) are frozen at generation
 *  time and only change when you regenerate the thesis from the search box. */
export const REFRESH_LEGEND =
    "Refrescar: actualiza fundamentales (revenue, FCF, deuda…) desde Yahoo y recalcula los TAM Scores. " +
    "Al pulsar aquí se hace al instante; los datos viajan entre la empresa y sus tesis. " +
    "Automáticamente se repite cada semana desde tu último refresco. " +
    "Lo CUALITATIVO (scores cualitativos, narrativa, TAM global de la tendencia) NO se actualiza aquí.";

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
