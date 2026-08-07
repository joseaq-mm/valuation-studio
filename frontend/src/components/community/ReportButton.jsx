import React, { useState } from "react";
import { Flag, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { communityReport } from "@/lib/api";

// Small flag button + inline reason popover to report public content.
export default function ReportButton({ targetType, targetId, size = 13 }) {
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [sending, setSending] = useState(false);
    const [done, setDone] = useState(false);

    const send = async () => {
        setSending(true);
        try {
            const r = await communityReport(targetType, targetId, reason.trim() || null);
            setDone(true); setOpen(false);
            toast.success(r.already ? "Ya habías reportado esto" : "Gracias, lo revisaremos");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo reportar");
        } finally { setSending(false); }
    };

    return (
        <span className="relative inline-block">
            <button onClick={() => setOpen((o) => !o)} disabled={done}
                className={`flex items-center gap-1 ${done ? "text-[#4A4A4A]" : "hover:text-[#B32A22]"}`}
                title="Reportar" data-testid={`report-btn-${targetId}`}>
                <Flag size={size} /> {done ? "Reportado" : ""}
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-black shadow-lg z-40 p-2" data-testid="report-popover">
                    <div className="flex items-center justify-between mb-1">
                        <span className="overline text-[#4A4A4A]">Reportar contenido</span>
                        <button onClick={() => setOpen(false)}><X size={13} /></button>
                    </div>
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                        placeholder="Motivo (opcional): spam, insulto, manipulación…"
                        className="w-full border border-black px-2 py-1 text-xs outline-none resize-none" data-testid="report-reason" />
                    <button onClick={send} disabled={sending}
                        className="btn-primary !px-3 !py-1 text-xs mt-1 w-full flex items-center justify-center gap-1 disabled:opacity-50" data-testid="report-send">
                        {sending ? <Loader2 size={12} className="animate-spin" /> : <Flag size={12} />} Enviar reporte
                    </button>
                </div>
            )}
        </span>
    );
}
